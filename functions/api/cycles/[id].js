// PATCH  /api/cycles/:id  — edit name/cadence fields
// PUT    /api/cycles/:id  — set completion state { lastDone, doneThrough } (done / undo / edit)
// DELETE /api/cycles/:id  — archive the cycle
import { requireAccessUser, ensureSchema, listCycles, json } from "../../_lib/cyclesApi.js";

async function guard(request, env) {
  const email = await requireAccessUser(env, request);
  if (!email) return { error: json({ error: "unauthorized" }, 401) };
  if (!env.DB) return { error: json({ error: "db not bound" }, 500) };
  await ensureSchema(env.DB);
  return { email };
}

export async function onRequestPatch({ request, env, params }) {
  const g = await guard(request, env);
  if (g.error) return g.error;
  const item = await request.json().catch(() => null);
  if (!item) return json({ error: "bad body" }, 400);
  await env.DB.prepare(
    `UPDATE cycles SET name = ?, type = ?, every = ?, day = ?, weekday = ?, at = ?,
       glyph = COALESCE(?, glyph), grad = COALESCE(?, grad),
       updated_at = datetime('now'), updated_by = ? WHERE id = ?`
  ).bind(item.name, item.type, item.every ?? null, item.day ?? null, item.weekday ?? null,
         item.at ?? null, item.glyph ?? null, item.grad ?? null, g.email, params.id).run();
  return json({ cycles: await listCycles(env.DB) });
}

export async function onRequestPut({ request, env, params }) {
  const g = await guard(request, env);
  if (g.error) return g.error;
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "bad body" }, 400);
  const prev = await env.DB.prepare("SELECT last_done, done_through FROM cycles WHERE id = ?")
    .bind(params.id).first();
  await env.DB.prepare(
    `UPDATE cycles SET last_done = ?, done_through = ?,
       updated_at = datetime('now'), updated_by = ? WHERE id = ?`
  ).bind(body.lastDone ?? null, body.doneThrough ?? null, g.email, params.id).run();
  const advanced = prev && ((body.lastDone || "") > (prev.last_done || "") || (body.doneThrough || "") > (prev.done_through || ""));
  await env.DB.prepare("INSERT INTO completions (cycle_id, action, occurred_date, actor) VALUES (?, ?, ?, ?)")
    .bind(params.id, advanced ? "done" : "set", body.lastDone || body.doneThrough || null, g.email).run();
  return json({ cycles: await listCycles(env.DB) });
}

export async function onRequestDelete({ request, env, params }) {
  const g = await guard(request, env);
  if (g.error) return g.error;
  await env.DB.prepare("UPDATE cycles SET archived = 1, updated_at = datetime('now'), updated_by = ? WHERE id = ?")
    .bind(g.email, params.id).run();
  return json({ cycles: await listCycles(env.DB) });
}
