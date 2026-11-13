// INSPOBOX — the per-account Box (v71).
//
// Until v70 the Box lived only in the browser's localStorage: permanent
// on that one device, gone if the app's data was cleared, and invisible
// on any other device. At Andres's direction it now syncs to his
// account: the box is stored as a D1 doc keyed by user id, the client
// keeps localStorage as its working cache, union-merges the server copy
// on load, and PUTs the whole box (debounced) after every mutation.
import { appAllowed, json, requireIdentity } from "../../_lib/auth.js";
import { getDoc, putDoc } from "../../_lib/docStore.js";

const MAX_ENTRIES = 500;
const MAX_BYTES = 2000000;
const slugFor = (id) => "inspobox-box:" + id.userId;

async function guard(env, request) {
  const id = await requireIdentity(env, request);
  if (!id) return { error: json({ error: "not signed in" }, 401) };
  if (!appAllowed(id, "inspobox")) return { error: json({ error: "this account doesn't cover this app" }, 403) };
  return { id };
}

export async function onRequestGet({ request, env }) {
  const g = await guard(env, request);
  if (g.error) return g.error;
  const row = await getDoc(env.DB, slugFor(g.id));
  let box = null; // null = this account has never synced a box
  if (row && row.html) {
    try { const v = JSON.parse(row.html); if (Array.isArray(v)) box = v; } catch { box = null; }
  }
  return json({ ok: true, box });
}

export async function onRequestPut({ request, env }) {
  const g = await guard(env, request);
  if (g.error) return g.error;
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
  if (!body || !Array.isArray(body.box)) return json({ ok: false, error: "box must be an array" }, 400);
  const box = body.box.slice(0, MAX_ENTRIES).filter((b) => b && typeof b === "object" && (b.type === "piece" || b.type === "spark"));
  const payload = JSON.stringify(box);
  if (payload.length > MAX_BYTES) return json({ ok: false, error: "box too large" }, 413);
  await putDoc(env.DB, slugFor(g.id), payload);
  return json({ ok: true, n: box.length });
}
