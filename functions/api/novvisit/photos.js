import { appAllowed, json, requireIdentity } from "../../_lib/auth.js";

// Headshot bundle for The PhotoPass Exchange. Photos are stored in D1 and
// only ever served (via photo.js) to signed-in accounts that cover the
// app — they never live as files in the public repo. The shell uploads
// the bundle once, right after it transfers the agenda document.
const SLUG = "nov-visit";

export async function onRequestPut(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  if (!appAllowed(id, SLUG)) return json({ error: "this account doesn't cover this app" }, 403);
  let body;
  try { body = await context.request.json(); } catch { return json({ error: "bad json" }, 400); }
  const photos = body && body.photos;
  if (!photos || typeof photos !== "object" || Array.isArray(photos)) return json({ error: "photos missing" }, 400);
  const entries = Object.entries(photos);
  if (!entries.length || entries.length > 80) return json({ error: "photo count out of bounds" }, 400);
  for (const [slug, data] of entries) {
    if (!/^[a-z0-9-]+$/.test(slug)) return json({ error: "bad photo slug" }, 400);
    if (typeof data !== "string" || data.length < 100 || data.length > 400000) return json({ error: "photo data out of bounds" }, 400);
  }
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS novvisit_photos (slug TEXT PRIMARY KEY, data TEXT NOT NULL)"
  ).run();
  const stmt = env.DB.prepare(
    "INSERT INTO novvisit_photos (slug, data) VALUES (?1, ?2) ON CONFLICT(slug) DO UPDATE SET data = excluded.data"
  );
  await env.DB.batch(entries.map(([slug, data]) => stmt.bind(slug, data)));
  return json({ ok: true, count: entries.length });
}
