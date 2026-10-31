import { appAllowed, json, requireIdentity } from "../../_lib/auth.js";
import { getDoc, putDoc } from "../../_lib/docStore.js";

// The Wish Day Guide document, stored server-side so it is only ever
// served to signed-in accounts (it contains day-of logistics for the
// Oct 30, 2026 Disney Wish visit). The public shell fetches status from
// here after a passkey sign-in; the document itself is served as a page
// by functions/wish-day-guide/app.js.
const SLUG = "wish-day-guide";

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
  if (!html.includes("Wish Day Guide")) return json({ error: "content does not look like the Wish Day Guide" }, 400);
  const now = await putDoc(env.DB, SLUG, html);
  return json({ ok: true, bytes: html.length, updatedAt: now });
}
