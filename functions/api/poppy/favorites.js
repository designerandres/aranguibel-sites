import { json, requireIdentity } from "../../_lib/auth.js";

// Poppy's Picks favorites — ONE shared household list. Any signed-in
// account sees (and can edit) the same set; each row remembers who
// favorited it so the app can show "favorited by Sarah / Andres".
async function ensureSchema(db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS poppy_favorites (event_id TEXT PRIMARY KEY, by_email TEXT NOT NULL, by_name TEXT, created_at TEXT NOT NULL)"
  ).run();
}

function displayName(identity) {
  const raw = String(identity.name || identity.email || "").toLowerCase();
  if (raw.includes("sarah")) return "Sarah";
  if (raw.includes("dimitri") || raw.includes("andres") || raw.includes("aran")) return "Andres";
  const base = raw.split("@")[0].replace(/[^a-z]/g, " ").trim().split(" ")[0];
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "Family";
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  await ensureSchema(env.DB);
  const { results } = await env.DB
    .prepare("SELECT event_id, by_email, by_name, created_at FROM poppy_favorites ORDER BY created_at ASC")
    .all();
  const favorites = (results || []).map((r) => ({
    eventId: r.event_id,
    by: r.by_name || "Family",
    mine: r.by_email.toLowerCase() === id.email.toLowerCase(),
    at: r.created_at,
  }));
  return json({ favorites });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const eventId = body && typeof body.eventId === "string" ? body.eventId.trim() : "";
  if (!eventId || eventId.length > 160) return json({ error: "eventId required" }, 400);
  await ensureSchema(env.DB);
  if (body.fav) {
    await env.DB
      .prepare("INSERT INTO poppy_favorites (event_id, by_email, by_name, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(event_id) DO NOTHING")
      .bind(eventId, id.email, displayName(id), new Date().toISOString())
      .run();
  } else {
    await env.DB.prepare("DELETE FROM poppy_favorites WHERE event_id = ?1").bind(eventId).run();
  }
  return json({ ok: true });
}
