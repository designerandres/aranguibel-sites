import { json, requireIdentity } from "../../_lib/auth.js";
import { getDoc, putDoc } from "../../_lib/docStore.js";

// The Apps index archive set, editable by signed-in accounts from the
// index page itself ("Edit order" -> Archive on a tile). Stored as a JSON
// array of site paths in the shared doc store, alongside apps-order.
// Entries baked into the page with archive:true (Wish Day Guide, Lili's
// Business) are permanent and never appear in this list; this set holds
// only the tiles archived from the page. Reads are public because the
// index page is public and the archive state is not sensitive. Writes
// require a passkey session, same as every other account-gated surface.
const SLUG = "apps-archived";

export async function onRequestGet(context) {
  const { env } = context;
  const row = await getDoc(env.DB, SLUG);
  if (!row) return json({ archived: null }, 200);
  try {
    const archived = JSON.parse(row.html);
    if (!Array.isArray(archived)) return json({ archived: null }, 200);
    return json({ archived, updatedAt: row.updated_at });
  } catch {
    return json({ archived: null }, 200);
  }
}

export async function onRequestPut(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  if (id.scope) return json({ error: "guest accounts can't archive index entries" }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const archived = body && body.archived;
  if (!Array.isArray(archived) || archived.length > 50) return json({ error: "archived missing or out of bounds" }, 400);
  for (const p of archived) {
    if (typeof p !== "string" || p.length > 100 || !/^[a-z0-9][a-z0-9\-\/]*\/$/.test(p)) return json({ error: "bad path in archived" }, 400);
  }
  if (new Set(archived).size !== archived.length) return json({ error: "duplicate paths in archived" }, 400);
  const now = await putDoc(env.DB, SLUG, JSON.stringify(archived));
  return json({ ok: true, archived, updatedAt: now });
}
