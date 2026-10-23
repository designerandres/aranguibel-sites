import { createInvite, ensureAuthSchema, json, originOk, requireIdentity } from "../../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  if (!originOk(request)) return json({ error: "bad origin" }, 403);
  await ensureAuthSchema(env);
  const identity = await requireIdentity(env, request);
  if (!identity || identity.role !== "admin") return json({ error: "admin only" }, 403);
  let body = {};
  try { body = await request.json(); } catch { /* handled below */ }
  const email = String(body.email || "").trim();
  if (!email.includes("@")) return json({ error: "valid email required" }, 400);
  return json(await createInvite(env, identity, email), 201);
}
