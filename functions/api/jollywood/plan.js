import { appAllowed, json, requireIdentity } from "../../_lib/auth.js";

// Jollywood Fam 2026 gameplan running order — ONE shared sequence. Any
// signed-in account can reorder the night's picks; the Gameplan tab lists
// them in this order. (Replaced the earlier per-item "set time" model on
// Oct 31, 2026 at Andres's direction: the group arranges an order of items
// to hit through the night instead of slotting times.)
async function ensureSchema(db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS jollywood_order (item_id TEXT PRIMARY KEY, position INTEGER NOT NULL, by_email TEXT, by_name TEXT, updated_at TEXT NOT NULL)"
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS jollywood_times (item_id TEXT PRIMARY KEY, time TEXT NOT NULL, by_email TEXT, by_name TEXT, updated_at TEXT NOT NULL)"
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
  if (!appAllowed(id, "jollywood-fam-2026")) return json({ error: "this account doesn't cover this app" }, 403);
  await ensureSchema(env.DB);
  const { results } = await env.DB
    .prepare("SELECT item_id FROM jollywood_order ORDER BY position ASC")
    .all();
  const order = (results || []).map((r) => r.item_id);
  const { results: trows } = await env.DB
    .prepare("SELECT item_id, time, by_name, updated_at FROM jollywood_times")
    .all();
  const times = {};
  const timeMeta = {};
  for (const r of trows || []) {
    times[r.item_id] = r.time;
    timeMeta[r.item_id] = { by: r.by_name, at: r.updated_at };
  }
  return json({ order, times, timeMeta });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  if (!appAllowed(id, "jollywood-fam-2026")) return json({ error: "this account doesn't cover this app" }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  // Suggested-time calls: { itemId, time: "HH:MM" | null }.
  if (body && typeof body.itemId === "string" && "time" in body) {
    const itemId = body.itemId.trim();
    if (!itemId || itemId.length > 160) return json({ error: "bad itemId" }, 400);
    await ensureSchema(env.DB);
    const now = new Date().toISOString();
    if (body.time === null) {
      await env.DB.prepare("DELETE FROM jollywood_times WHERE item_id = ?1").bind(itemId).run();
      return json({ ok: true, itemId, time: null });
    }
    if (typeof body.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.time)) {
      return json({ error: "bad time" }, 400);
    }
    await env.DB
      .prepare("INSERT INTO jollywood_times (item_id, time, by_email, by_name, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(item_id) DO UPDATE SET time = excluded.time, by_email = excluded.by_email, by_name = excluded.by_name, updated_at = excluded.updated_at")
      .bind(itemId, body.time, id.email, displayName(id), now)
      .run();
    return json({ ok: true, itemId, time: body.time });
  }
  if (!body || !Array.isArray(body.order)) return json({ ok: true, ignored: true });
  const seen = new Set();
  const order = [];
  for (const raw of body.order) {
    if (typeof raw !== "string") continue;
    const itemId = raw.trim();
    if (!itemId || itemId.length > 160 || seen.has(itemId)) continue;
    seen.add(itemId);
    order.push(itemId);
    if (order.length >= 300) break;
  }
  await ensureSchema(env.DB);
  const now = new Date().toISOString();
  const stmts = [env.DB.prepare("DELETE FROM jollywood_order")];
  order.forEach((itemId, i) => {
    stmts.push(
      env.DB
        .prepare("INSERT INTO jollywood_order (item_id, position, by_email, by_name, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)")
        .bind(itemId, i, id.email, displayName(id), now)
    );
  });
  await env.DB.batch(stmts);
  return json({ ok: true, order });
}
