import { json, requireIdentity } from "../../_lib/auth.js";

// Jollywood Fam 2026 gameplan times — ONE shared itinerary. Any signed-in
// account can set or clear the time for a picked item; the Gameplan tab
// sorts the night's picks chronologically by these.
async function ensureSchema(db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS jollywood_plan (item_id TEXT PRIMARY KEY, time TEXT, by_email TEXT, by_name TEXT, updated_at TEXT NOT NULL)"
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
    .prepare("SELECT item_id, time FROM jollywood_plan WHERE time IS NOT NULL")
    .all();
  const times = {};
  for (const r of results || []) times[r.item_id] = r.time;
  return json({ times });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const itemId = body && typeof body.itemId === "string" ? body.itemId.trim() : "";
  if (!itemId || itemId.length > 160) return json({ error: "itemId required" }, 400);
  const time = body && typeof body.time === "string" && /^\d{2}:\d{2}$/.test(body.time) ? body.time : null;
  await ensureSchema(env.DB);
  if (time) {
    await env.DB
      .prepare("INSERT INTO jollywood_plan (item_id, time, by_email, by_name, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(item_id) DO UPDATE SET time = ?2, by_email = ?3, by_name = ?4, updated_at = ?5")
      .bind(itemId, time, id.email, displayName(id), new Date().toISOString())
      .run();
  } else {
    await env.DB.prepare("DELETE FROM jollywood_plan WHERE item_id = ?1").bind(itemId).run();
  }
  return json({ ok: true });
}
