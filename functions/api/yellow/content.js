import { appAllowed, json, requireIdentity } from "../../_lib/auth.js";
import { getDoc, putDoc } from "../../_lib/docStore.js";

// The Yellowstone 2027 trip guide document, stored server-side so the
// app page is only ever served to signed-in accounts. The public shell
// fetches status from here after a passkey sign-in; the document itself
// is served as a page by functions/yellowstone-2027/app.js.
const SLUG = "yellowstone-2027";

export async function onRequestGet(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  if (!appAllowed(id, SLUG)) return json({ error: "this account doesn't cover this app" }, 403);
  const row = await getDoc(env.DB, SLUG);
  if (!row) return json({ error: "no content yet" }, 404);
  return json({ html: row.html, updatedAt: row.updated_at });
}

export async function onRequestPut(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  if (!appAllowed(id, SLUG)) return json({ error: "this account doesn't cover this app" }, 403);
  let body;
  try { body = await context.request.json(); } catch { return json({ error: "bad json" }, 400); }
  const html = body && body.html;
  if (typeof html !== "string" || html.length < 1000 || html.length > 900000) return json({ error: "content missing or out of size bounds" }, 400);
  if (!html.includes("yellowapp:")) return json({ error: "content does not look like the Yellowstone trip guide" }, 400);
  const now = await putDoc(env.DB, SLUG, html);
  return json({ ok: true, bytes: html.length, updatedAt: now });
}
