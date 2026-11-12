import { appAllowed, json, requireIdentity } from "../../_lib/auth.js";
import { ATOMS, DISNEY, FEED, MEDIA, MOVEMENTS } from "../../_lib/inspobox-data.js";
import { LANE_STYLES } from "../../_lib/inspobox-rubric.js";

// INSPOBOX feed + idea banks — served only to signed-in accounts,
// like every other microsite's content. `movements` (the 13 globals)
// now serves ONLY the Idea Starter's movement dropdown; the feed files
// by `laneStyles` — the native per-lane style taxonomies (v65).
export async function onRequestGet(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  if (!appAllowed(id, "inspobox")) return json({ error: "this account doesn't cover this app" }, 403);
  const laneStyles = {};
  for (const [lane, styles] of Object.entries(LANE_STYLES)) {
    laneStyles[lane] = styles.map((s) => ({ id: s.id, name: s.name, tag: s.tag, img: s.img }));
  }
  return json({ feed: FEED, movements: MOVEMENTS, media: MEDIA, laneStyles, atoms: ATOMS, disney: DISNEY });
}
