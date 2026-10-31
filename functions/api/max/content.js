import { appAllowed, json, requireIdentity } from "../../_lib/auth.js";

// The MAX Pocket Agenda app document itself, stored server-side so the app
// is only served to signed-in accounts. The public shell page fetches it
// after a passkey sign-in and boots it; before that, the only copy online
// was the AES-encrypted gate payload (kept for the one-time transfer).
async function ensureContentSchema(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS max_content (id INTEGER PRIMARY KEY CHECK (id = 1), html TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  if (!appAllowed(id, "max-pocket-agenda")) return json({ error: "this account doesn't cover this app" }, 403);
  const db = context.env.DB;
  await ensureContentSchema(db);
  const row = await db.prepare("SELECT html, updated_at FROM max_content WHERE id = 1").first();
  if (!row) return json({ error: "no content yet" }, 404);
  return json({ html: row.html, updatedAt: row.updated_at });
}

export async function onRequestPut(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  if (!appAllowed(id, "max-pocket-agenda")) return json({ error: "this account doesn't cover this app" }, 403);
  let body;
  try { body = await context.request.json(); } catch { return json({ error: "bad json" }, 400); }
  const html = body && body.html;
  if (typeof html !== "string" || html.length < 1000 || html.length > 900000) return json({ error: "content missing or out of size bounds" }, 400);
  if (!html.includes("MAX Pocket Agenda")) return json({ error: "content does not look like the MAX app" }, 400);
  const db = context.env.DB;
  await ensureContentSchema(db);
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO max_content (id, html, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET html = excluded.html, updated_at = excluded.updated_at").bind(html, now).run();
  return json({ ok: true, bytes: html.length, updatedAt: now });
}
