import { json, requireIdentity } from "../../_lib/auth.js";

// Jollywood Fam 2026 ballot — every signed-in person gets their own star on
// each food item and activity. The Gameplan tab is built from these.
async function ensureSchema(db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS jollywood_votes (item_id TEXT NOT NULL, voter_email TEXT NOT NULL, voter_name TEXT, created_at TEXT NOT NULL, PRIMARY KEY (item_id, voter_email))"
  ).run();
}

function displayName(identity) {
  const raw = String(identity.name || identity.email || "").toLowerCase();
  if (raw.includes("sarah")) return "Sarah";
  if (raw.includes("dimitri") || raw.includes("andres") || raw.includes("aran")) return "Andres";
  const base = raw.split("@")[0].replace(/[^a-z]/g, " ").trim().split(" ")[0];
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "Fam";
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  await ensureSchema(env.DB);
  const { results } = await env.DB
    .prepare("SELECT item_id, voter_email, voter_name, created_at FROM jollywood_votes ORDER BY created_at ASC")
    .all();
  const votes = (results || []).map((r) => ({
    itemId: r.item_id,
    by: r.voter_name || "Fam",
    mine: r.voter_email.toLowerCase() === id.email.toLowerCase(),
    at: r.created_at,
  }));
  return json({ votes, me: displayName(id) });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const itemId = body && typeof body.itemId === "string" ? body.itemId.trim() : "";
  if (!itemId || itemId.length > 160) return json({ error: "itemId required" }, 400);
  await ensureSchema(env.DB);
  if (body.vote) {
    await env.DB
      .prepare("INSERT INTO jollywood_votes (item_id, voter_email, voter_name, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(item_id, voter_email) DO NOTHING")
      .bind(itemId, id.email, displayName(id), new Date().toISOString())
      .run();
  } else {
    await env.DB
      .prepare("DELETE FROM jollywood_votes WHERE item_id = ?1 AND voter_email = ?2")
      .bind(itemId, id.email)
      .run();
  }
  return json({ ok: true });
}
