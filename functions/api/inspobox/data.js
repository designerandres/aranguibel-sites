import { appAllowed, json, requireIdentity } from "../../_lib/auth.js";
import { ATOMS, DISNEY, FEED, MEDIA, MOVEMENTS } from "../../_lib/inspobox-data.js";

// INSPOBOX feed + idea banks — served only to signed-in accounts,
// like every other microsite's content.
export async function onRequestGet(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  if (!appAllowed(id, "inspobox")) return json({ error: "this account doesn't cover this app" }, 403);
  return json({ feed: FEED, movements: MOVEMENTS, media: MEDIA, atoms: ATOMS, disney: DISNEY });
}
