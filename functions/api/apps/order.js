import { json, requireIdentity } from "../../_lib/auth.js";
import { getDoc, putDoc } from "../../_lib/docStore.js";

// The Apps index card order, editable by signed-in accounts from the
// index page itself ("Edit order"). Stored as a JSON array of site
// paths in the shared doc store; reads are public because the index
// page is public and the order is not sensitive. Writes require a
// passkey session, same as every other account-gated surface.
const SLUG = "apps-order";

export async function onRequestGet(context) {
  const { env } = context;
  const row = await getDoc(env.DB, SLUG);
  if (!row) return json({ order: null }, 200);
  try {
    const order = JSON.parse(row.html);
    if (!Array.isArray(order)) return json({ order: null }, 200);
    return json({ order, updatedAt: row.updated_at });
  } catch {
    return json({ order: null }, 200);
  }
}

export async function onRequestPut(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const order = body && body.order;
  if (!Array.isArray(order) || order.length < 1 || order.length > 50) return json({ error: "order missing or out of bounds" }, 400);
  for (const p of order) {
    if (typeof p !== "string" || p.length > 100 || !/^[a-z0-9][a-z0-9\-\/]*\/$/.test(p)) return json({ error: "bad path in order" }, 400);
  }
  if (new Set(order).size !== order.length) return json({ error: "duplicate paths in order" }, 400);
  const now = await putDoc(env.DB, SLUG, JSON.stringify(order));
  return json({ ok: true, order, updatedAt: now });
}
