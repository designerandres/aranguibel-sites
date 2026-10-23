// MAX Pocket Agenda — synced notes state (Oct 2026).
// The app's personal data (session notes, people notes, added contacts, done
// checkmarks) used to live only in one phone's localStorage. It now also lives
// here, per user account: one JSON document per user with per-section
// timestamps the client uses to merge. Optimistic concurrency via
// baseUpdatedAt — a stale writer gets a 409 with the current document.
import { json, randomB64url, requireIdentity } from "../../_lib/auth.js";

async function ensureMaxSchema(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS max_state (
       user_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL)`
  ).run();
}
async function authedUser(env, request) {
  const identity = await requireIdentity(env, request);
  if (!identity || !identity.userId) return null;
  return identity;
}

export async function onRequestGet({ request, env }) {
  const identity = await authedUser(env, request);
  if (!identity) return json({ error: "unauthorized" }, 401);
  await ensureMaxSchema(env);
  const row = await env.DB.prepare("SELECT data, updated_at FROM max_state WHERE user_id = ?1")
    .bind(identity.userId).first();
  if (!row) return json({ data: null });
  return json({ data: JSON.parse(row.data), updatedAt: row.updated_at });
}

export async function onRequestPut({ request, env }) {
  const identity = await authedUser(env, request);
  if (!identity) return json({ error: "unauthorized" }, 401);
  await ensureMaxSchema(env);
  let body = {};
  try { body = await request.json(); } catch { /* handled below */ }
  const data = body.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return json({ error: "bad data" }, 400);
  const raw = JSON.stringify(data);
  if (raw.length > 512000) return json({ error: "too large" }, 413);
  const row = await env.DB.prepare("SELECT data, updated_at FROM max_state WHERE user_id = ?1")
    .bind(identity.userId).first();
  if (row && body.baseUpdatedAt !== row.updated_at) {
    return json({ error: "conflict", data: JSON.parse(row.data), updatedAt: row.updated_at }, 409);
  }
  const updatedAt = new Date().toISOString() + "-" + randomB64url(4);
  await env.DB.prepare(
    `INSERT INTO max_state (user_id, data, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).bind(identity.userId, raw, updatedAt).run();
  return json({ updatedAt });
}
