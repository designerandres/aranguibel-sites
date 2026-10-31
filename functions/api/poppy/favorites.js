import { appAllowed, json, requireIdentity } from "../../_lib/auth.js";
import { displayName, householdFor } from "../../_lib/poppy-household.js";

// Poppy's Picks favorites — one list per HOUSEHOLD. Members of the same
// household see (and can edit) the same picks; each row remembers who
// favorited it so the app can show "favorited by Sarah / Andres".
export async function onRequestGet(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  if (!appAllowed(id, "poppy-picks")) return json({ error: "this account doesn't cover this app" }, 403);
  const hh = await householdFor(env, id);
  const { results } = await env.DB
    .prepare("SELECT event_id, by_email, by_name, created_at FROM poppy_favorites WHERE household_id = ?1 ORDER BY created_at ASC")
    .bind(hh)
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
  if (!appAllowed(id, "poppy-picks")) return json({ error: "this account doesn't cover this app" }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const eventId = body && typeof body.eventId === "string" ? body.eventId.trim() : "";
  if (!eventId || eventId.length > 160) return json({ error: "eventId required" }, 400);
  const hh = await householdFor(env, id);
  if (body.fav) {
    await env.DB
      .prepare("INSERT INTO poppy_favorites (household_id, event_id, by_email, by_name, created_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(household_id, event_id) DO NOTHING")
      .bind(hh, eventId, id.email, displayName(id), new Date().toISOString())
      .run();
  } else {
    await env.DB.prepare("DELETE FROM poppy_favorites WHERE household_id = ?1 AND event_id = ?2").bind(hh, eventId).run();
  }
  return json({ ok: true });
}
