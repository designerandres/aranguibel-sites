import { ensureAuthSchema, json, parseScope, sha256Hex } from "../../_lib/auth.js";

// Public, read-only: an invite link carries its code in the URL hash, and the
// login page uses this to theme itself for a single-app invite and prefill
// the invited email. The code is the secret; registration still re-validates
// everything server-side. Returns { ok:false } for unknown/used/expired codes.
export async function onRequestGet({ request, env }) {
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!token || token.length > 200) return json({ ok: false });
  await ensureAuthSchema(env);
  const row = await env.DB
    .prepare("SELECT email, scope, expires_at FROM invites WHERE code_hash = ?1 AND used_at IS NULL AND expires_at > ?2")
    .bind(await sha256Hex(token), new Date().toISOString())
    .first();
  if (!row) return json({ ok: false });
  return json({ ok: true, email: row.email, scope: parseScope(row.scope) });
}
