// GET  /api/cycles  -> { cycles: [...] }  (initializes schema + seed on first call)
// POST /api/cycles  -> create one cycle (full item in body), returns the list
import { requireAccessUser, ensureSchema, listCycles, upsertCycle, json } from "../_lib/cyclesApi.js";

export async function onRequestGet({ request, env }) {
  const email = await requireAccessUser(env, request);
  if (!email) return json({ error: "unauthorized" }, 401);
  if (!env.DB) return json({ error: "db not bound" }, 500);
  await ensureSchema(env.DB);
  return json({ cycles: await listCycles(env.DB), you: email });
}

export async function onRequestPost({ request, env }) {
  const email = await requireAccessUser(env, request);
  if (!email) return json({ error: "unauthorized" }, 401);
  if (!env.DB) return json({ error: "db not bound" }, 500);
  await ensureSchema(env.DB);
  const item = await request.json().catch(() => null);
  if (!item || !item.id || !item.name || !item.type) return json({ error: "bad item" }, 400);
  await upsertCycle(env.DB, item, email);
  return json({ cycles: await listCycles(env.DB) }, 201);
}
