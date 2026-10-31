import { appAllowed, json, requireIdentity } from "../../_lib/auth.js";

// Poppy's Picks event data. The listings themselves are public information
// (harvested daily from public event sources into poppy-picks/events.json by
// the refresh job), but the feed is only served to signed-in household
// accounts, like every other microsite's content.
export async function onRequestGet(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  if (!appAllowed(id, "poppy-picks")) return json({ error: "this account doesn't cover this app" }, 403);

  const url = new URL(request.url);
  url.pathname = "/poppy-picks/events.json";
  url.search = "";
  try {
    const res = await env.ASSETS.fetch(url);
    if (res.ok) {
      return new Response(res.body, {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
  } catch (e) { /* fall through to the public-path fetch */ }
  const res = await fetch(url.toString());
  if (!res.ok) return json({ error: "events not published yet" }, 502);
  return new Response(res.body, {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
