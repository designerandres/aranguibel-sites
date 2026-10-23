// POST /api/cycles/sync  { items: [...], mode: "merge" | "replace" }
// merge   — first-run import from a phone: upsert each item, but for completion
//           state keep whichever date is later (never move a cycle backward).
// replace — make the server match the posted set exactly (undo of delete/reset);
//           items missing from the set are archived.
import { requireAccessUser, ensureSchema, listCycles, upsertCycle, json } from "../../_lib/cyclesApi.js";

const later = (a, b) => (!a ? b : !b ? a : (a > b ? a : b));

export async function onRequestPost({ request, env }) {
  const email = await requireAccessUser(env, request);
  if (!email) return json({ error: "unauthorized" }, 401);
  if (!env.DB) return json({ error: "db not bound" }, 500);
  await ensureSchema(env.DB);
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.items)) return json({ error: "bad body" }, 400);
  const mode = body.mode === "replace" ? "replace" : "merge";

  const { results: existing } = await env.DB.prepare(
    "SELECT id, last_done, done_through FROM cycles").all();
  const byId = new Map(existing.map((r) => [r.id, r]));

  for (const item of body.items) {
    if (!item || !item.id || !item.name || !item.type) continue;
    const cur = byId.get(item.id);
    const merged = { ...item };
    if (mode === "merge" && cur) {
      merged.lastDone = later(cur.last_done, item.lastDone ?? null);
      merged.doneThrough = later(cur.done_through, item.doneThrough ?? null);
    }
    await upsertCycle(env.DB, merged, email);
  }

  if (mode === "replace") {
    const keep = new Set(body.items.map((i) => i && i.id).filter(Boolean));
    const { results } = await env.DB.prepare("SELECT id FROM cycles WHERE archived = 0").all();
    for (const r of results) {
      if (!keep.has(r.id)) {
        await env.DB.prepare("UPDATE cycles SET archived = 1, updated_at = datetime('now'), updated_by = ? WHERE id = ?")
          .bind(email, r.id).run();
      }
    }
  }
  return json({ cycles: await listCycles(env.DB) });
}
