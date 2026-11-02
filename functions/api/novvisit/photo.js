import { appAllowed, json, requireIdentity } from "../../_lib/auth.js";

// Serves one headshot from D1 to a signed-in account that covers the app.
// Anonymous requests get a 401 — the photos are never public files.
const SLUG = "nov-visit";

export async function onRequestGet(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  if (!appAllowed(id, SLUG)) return json({ error: "this account doesn't cover this app" }, 403);
  const name = new URL(request.url).searchParams.get("name") || "";
  if (!/^[a-z0-9-]+$/.test(name)) return json({ error: "bad name" }, 400);
  const row = await env.DB.prepare("SELECT data FROM novvisit_photos WHERE slug = ?1").bind(name).first();
  if (!row) return json({ error: "no such photo" }, 404);
  const bin = atob(row.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, max-age=604800",
    },
  });
}
