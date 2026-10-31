import { appAllowed, json, requireIdentity } from "../../_lib/auth.js";
import { GUIDE } from "../../_lib/jollywood-data.js";

// Jollywood Fam 2026 guide data — Disney's published foodie guide, served
// only to signed-in accounts, like every other microsite's content.
export async function onRequestGet(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  if (!appAllowed(id, "jollywood-fam-2026")) return json({ error: "this account doesn't cover this app" }, 403);
  return json(GUIDE);
}
