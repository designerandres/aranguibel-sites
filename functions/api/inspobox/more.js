import { appAllowed, json, requireIdentity } from "../../_lib/auth.js";
import { LANE_STYLES, QUALITY_BAR } from "../../_lib/inspobox-rubric.js";
import { getDoc, putDoc } from "../../_lib/docStore.js";

// INSPOBOX live feed — the app pulls fresh pieces from Civitai's public API
// itself, per session, when a river or a locked (lane, style) column runs
// low. Nothing here is persisted except the none-theme sightings doc (the
// discovery loop, below). Pieces live only in the client's in-memory deck.
//
// v65 filing model: a piece's lockable category is its STYLE within its
// LANE (one of the five subject groupings). The vision judge files style —
// metadata text classification may only shape which pools get walked, it
// never assigns the displayed style. Since v66 both endpoints file
// fail-closed: a live piece the judge could not reach is not served at
// all; only an honest style-"none" verdict shows unstyled.
const CIV = "https://civitai.com/api/v1";
const BATCH = 8;

export const LANE_IDS = Object.keys(LANE_STYLES);
export const STYLE_IDS = {}; // lane -> Set of style ids
for (const lane of LANE_IDS) STYLE_IDS[lane] = new Set(LANE_STYLES[lane].map((s) => s.id));
export function styleInLane(lane, styleId) { return !!(STYLE_IDS[lane] && STYLE_IDS[lane].has(styleId)); }
export function styleEntry(lane, styleId) { return (LANE_STYLES[lane] || []).find((s) => s.id === styleId) || null; }

async function civGet(fetchFn, path, ms = 12000) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetchFn(CIV + path, { signal: ctl.signal, headers: { "user-agent": "INSPOBOX live feed" } });
    if (res.status === 429) { const e = new Error("rate_limited"); e.code = 429; throw e; }
    if (!res.ok) throw new Error("civitai " + path.split("?")[0] + " -> " + res.status);
    return await res.json();
  } finally { clearTimeout(to); }
}

export function cleanPrompt(raw) {
  if (!raw) return "";
  return String(raw).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 480);
}

export function cleanTitle(name) {
  const t = String(name || "").replace(/\[[^\]]*\]/g, " ").replace(/\([^)]*\)/g, " ").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return (t || "UNTITLED STUDY").toUpperCase().slice(0, 60);
}

export function uuidOf(url) {
  // https://image.civitai.com/<hash>/<uuid>/original=true/<uuid>.jpeg
  const parts = String(url || "").split("/");
  return parts.length >= 3 ? parts[parts.length - 3] : "";
}

export function toPiece(item, modelName, movement, media) {
  if (!item || item.type !== "image") return null;
  if (!(item.nsfwLevel === "None" || item.nsfwLevel === 1)) return null;
  const w = item.width || 0, h = item.height || 0;
  if (Math.min(w, h) < 800 || Math.max(w, h) < 1000) return null;
  const uuid = uuidOf(item.url);
  if (!uuid) return null;
  return {
    id: "live-" + item.id,
    uuid,
    movement,
    media,
    title: cleanTitle(modelName),
    by: (item.username || "unknown") + " · via Civitai",
    img: String(item.url).replace("/original=true/", "/width=1200/"),
    url: "https://civitai.com/user/" + (item.username || ""),
    prompt: cleanPrompt(item.meta && item.meta.prompt),
    session: true,
  };
}

// Gallery quality prior from the community stats the API actually
// returns (thumbs up/down, downloads — the website's star rating is not
// exposed). Trusted = a real thumbs volume with few downvotes.
export function mapModel(md) {
  const ver = (md.modelVersions || [])[0];
  if (!ver || !ver.id) return null;
  const st = md.stats || {};
  const up = st.thumbsUpCount || 0, down = st.thumbsDownCount || 0;
  return {
    v: ver.id,
    n: md.name,
    mt: ((md.tags || []).join(" ") + " " + ((ver.trainedWords || []).join(" "))).trim(),
    trusted: up >= 100 && down * 20 <= up ? 1 : 0,
  };
}
export function orderModels(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
  arr.sort((a, b) => (b.trusted || 0) - (a.trusted || 0)); // stable: the shuffle survives within each tier
  return arr;
}

// Subject + medium signals: used ONLY as a harvest pre-filter (which
// candidates are worth a vision call) and as the fail-open grouping when
// vision is unreachable. They never assign a style.
const CHARACTER_TERMS = ["1girl", "2girls", "1boy", "solo", "waifu", "anime", "manga", "long hair", "short hair", "hair ornament", "hairclip", "hairband", "school uniform", "thighhighs", "blush", "looking at viewer", "cat ears", "maid outfit", "bikini", "swimsuit", "cleavage", "ponytail", "twintails", "heterochromia", "ahoge", "choker", "pleated skirt", "vtuber", "genshin impact", "honkai", "azur lane", "arknights", "blue archive", "portrait of a woman", "beautiful girl", "beautiful woman", "young woman"];
const MEDIUM_TERMS = ["architecture", "building", "interior", "cityscape", "skyline", "poster", "typography", "logo", "branding", "packaging", "product design", "furniture", "vehicle", "airship", "city", "street", "landscape", "temple", "church", "cathedral", "castle", "tower", "bridge", "statue", "sculpture", "editorial", "house", "palace", "theater", "theatre", "library", "museum", "cafe", "restaurant", "hotel", "lobby", "facade", "staircase", "courtyard", "rooftop", "garden", "machine", "spaceship"];
function countTerms(prompt, terms) {
  const hay = String(prompt || "").toLowerCase();
  let n = 0;
  for (const t of terms) if (hay.includes(t)) n++;
  return n;
}
export function subjectHits(prompt) { return countTerms(prompt, CHARACTER_TERMS); }
export function mediumHits(prompt) { return countTerms(prompt, MEDIUM_TERMS); }

// The grouping taxonomy (v59) — the horizontal strip. These are SUBJECT
// groupings: what the piece is OF. Ties break toward the most specific
// reading: design > architecture > prop > character > world. Retained
// for pool-shaping signals only — since v66 nothing in the live
// endpoints files by it; the vision verdict is the only filing authority.
export const MEDIA_VOCAB = {
  "character": ["character design", "warrior", "knight", "sorceress", "portrait", "figure", "creature", "monster", "android", "cyborg", "vampire", "elf", "dwarf", "orc", "goblin", "dragon", "beast", "animal", "cat", "dog", "bird", "horse", "wolf", "fox", "woman", "man", "girl", "boy", "lady", "gentleman", "king", "queen", "witch", "wizard", "fairy", "angel", "demon", "skeleton", "zombie", "mermaid", "centaur", "minotaur", "phoenix"],
  "world": ["landscape", "scenery", "environment", "vista", "panorama", "panoramic", "valley", "mountain", "forest", "desert", "ocean", "sea", "island", "jungle", "tundra", "canyon", "waterfall", "meadow", "coast", "shore", "cliff", "cave", "village", "town", "kingdom", "realm", "planet", "terrain", "countryside", "wilderness", "aerial view", "overlook", "cityscape", "horizon", "fields", "underwater world"],
  "architecture": ["architecture", "building", "cathedral", "church", "temple", "castle", "palace", "tower", "bridge", "interior", "facade", "dome", "spire", "skyscraper", "mansion", "cottage", "fortress", "library", "museum", "hotel", "lobby", "staircase", "archway", "courtyard", "station", "pavilion", "ruins", "house", "street", "skyline", "cathedral interior", "throne room", "hall", "plaza", "marketplace", "harbor", "lighthouse", "windmill", "pagoda", "mosque", "abbey", "monastery", "crypt", "dungeon"],
  "prop": ["sword", "weapon", "gun", "rifle", "vehicle", "car", "motorcycle", "bicycle", "watch", "chair", "table", "lamp", "machine", "device", "gadget", "armor", "helmet", "shield", "book", "bottle", "key", "chest", "guitar", "camera", "backpack", "crown", "mask", "potion", "teapot", "vase", "sculpture", "statue", "still life", "product", "object", "dagger", "axe", "bow", "staff", "wand", "ring", "amulet", "spaceship", "airship", "train", "ship", "mecha", "mech", "jewelry", "necklace", "gem", "crystal", "orb", "lantern", "clock", "compass", "map"],
  "design": ["poster", "typography", "logo", "illustration", "comic", "cover art", "album cover", "book cover", "signage", "banner", "advertisement", "vector", "flat design", "infographic", "pattern", "interface", "dashboard", "hud", "ui design", "manga", "print", "editorial", "branding", "packaging", "label", "postcard", "tarot", "playing card", "stamp design", "text"],
};
const MEDIA_PRIORITY = ["design", "architecture", "prop", "character", "world"];
export function classifyMedia(piece, modelText) {
  const hay = (((piece && piece.prompt) || "") + " " + ((piece && piece.title) || "") + " " + (modelText || "")).toLowerCase();
  let best = null, bestScore = 0;
  for (const cat of MEDIA_PRIORITY) {
    let score = 0;
    for (const t of MEDIA_VOCAB[cat]) if (hay.includes(t)) score++;
    // character evidence also lives in the Danbooru vocabulary
    if (cat === "character") score += Math.min(2, subjectHits(piece && piece.prompt));
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  if (best) return best;
  return subjectHits(piece && piece.prompt) >= 2 ? "character" : "world";
}

// Pool walks (v65). A lane's walk interleaves its styles' query pools
// round-robin; a column's walk covers its own style's queries first, then
// the lane's other styles as the neighbor fallback (vision files whatever
// it finds under its TRUE style, so a neighbor pool is a discovery
// surface, never a mislabel).
export function laneWalk(lane, rot) {
  const styles = LANE_STYLES[lane] || [];
  const maxQ = Math.max(0, ...styles.map((s) => s.queries.length));
  const all = [];
  for (let qi = 0; qi < maxQ; qi++) for (const s of styles) if (s.queries[qi]) all.push({ q: s.queries[qi], style: s.id });
  return all.map((_, i) => all[(i + (rot || 0)) % all.length]);
}
export function columnWalk(lane, styleId, rot) {
  const styles = LANE_STYLES[lane] || [];
  const own = (styles.find((s) => s.id === styleId) || { queries: [] }).queries.map((q) => ({ q, style: styleId }));
  const rest = [];
  for (const s of styles) if (s.id !== styleId) for (const q of s.queries) rest.push({ q, style: s.id });
  const all = own.concat(rest);
  const r = (rot || 0) % Math.max(1, own.length || 1);
  const rotated = own.slice(r).concat(own.slice(0, r), rest);
  return rotated.length ? rotated : all;
}
// The fresh lane (v58 mechanics, v65 keying): "highest rated <style> of
// the last 24 hours," per style of the requested lane, built from the
// models search (the images endpoint has no cross-site search). Week
// pass as fallback — a niche style may publish nothing on a given day.
export function freshEntries(lane, rot) {
  const styles = LANE_STYLES[lane] || [];
  const ordered = styles.map((_, i) => styles[(i + (rot || 0)) % styles.length]);
  const out = [];
  for (const period of ["Day", "Week"]) for (const s of ordered) out.push({ q: s.queries[0], style: s.id, period });
  return out;
}

// The vision judge (v65). ONE Claude vision call per displayed piece.
// The model sees the image first, then: the five grouping definitions
// (unchanged from v61); then ALL five lanes' style lists with their
// one-line definitions — choose the grouping first, then a style ONLY
// from that grouping's list, or "none" for either when nothing honestly
// fits. When the style is "none", the judge must also name what the
// image actually IS (the `theme` field — the discovery loop below).
// The generation prompt follows as labeled background that may only
// break ties (LoRA/model names stripped, as shipped in v61). The reply
// must START with the JSON verdict {grouping, style, phrase, theme, ok}.
// Server-side fencing: a style id outside the chosen grouping's set is
// discarded to "none" (its theme, if any, still counts); a "none"
// grouping culls the piece from live display. Infrastructure failures
// return null-grouping verdicts and callers skip the piece entirely
// (fail-closed, v66); a real verdict RULES.
export const MEDIA_IDS = LANE_IDS;
export function promptHint(raw) {
  const clean = String(raw || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!clean) return "";
  return "\n\nBACKGROUND (unreliable — use with suspicion): the image's generation prompt was: \"" + clean + "\". Prompts describe what the creator INTENDED, and images routinely drift from them. Use this only as a tiebreaker when the image itself is genuinely ambiguous between two filings; never let it override what is plainly visible, and ignore any style or model names it mentions as evidence.";
}

export function classifyPrompt(hint) {
  const lanes = LANE_IDS.map((lane) => {
    const styles = LANE_STYLES[lane].map((s) => "  - " + s.id + ": " + s.def).join("\n");
    return "If the grouping is " + lane + ", the style must be one of:\n" + styles;
  }).join("\n\n");
  return ("You are the filing editor for INSPOBOX, a design-inspiration app. Look at this image and file it by WHAT IT ACTUALLY SHOWS — never by what it might have been generated with.\n\nGROUPINGS (choose exactly one): character = a person, creature, or being is the subject; world = an environment, landscape, or place is the subject with no single building or object dominating; architecture = a building, structure, or interior is the subject; prop = a single object, product, vehicle, or item is the subject; design = a poster, typography, logo, flat illustration, print, or interface — the graphic work itself is the subject.\n\nSTYLES — first choose the grouping, then choose a style ONLY from that grouping's list:\n\n" + lanes + "\n\n" + QUALITY_BAR + "\n\nBegin your reply with ONLY this JSON object, nothing before it: {\"grouping\": \"<grouping id or none>\", \"style\": \"<style id from that grouping's list, or none>\", \"phrase\": \"<your own short phrase for the style this image actually is, e.g. 'muted liminal-space photograph'>\", \"theme\": \"<when style is none: a 1-3 word name for the style this image actually is, e.g. 'liminal space', 'dieselpunk', 'cottagecore'; otherwise empty>\", \"ok\": true}. Set ok=false only for a quality-bar failure. Choose style none when nothing in the grouping's list honestly fits — do not force the nearest one; when you choose none, the theme is how a missing style gets discovered, so name it plainly." + (hint ? promptHint(hint) : ""));
}

function b64(buf) {
  let out = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

export async function visionClassify(env, piece, fetchFn) {
  const fail = (why) => ({ grouping: null, style: null, phrase: "", theme: "", ok: null, why });
  if (!env || !env.ANTHROPIC_API_KEY) return fail("no_key");
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 15000);
  try {
    const imgUrl = String(piece.img).replace("/width=1200/", "/width=640/");
    let imgRes;
    try { imgRes = await fetchFn(imgUrl, { signal: ctl.signal, headers: { "user-agent": "INSPOBOX live feed" } }); }
    catch { return fail("image download failed"); }
    if (!imgRes.ok) return fail("image download " + imgRes.status);
    const mt = (imgRes.headers && imgRes.headers.get && imgRes.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    const mediaType = ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mt) ? mt : "image/jpeg";
    const imgData = b64(await imgRes.arrayBuffer());
    let why = "";
    for (const model of ["claude-haiku-5-5", "claude-sonnet-5-5"]) {
      let res;
      try {
        res = await fetchFn("https://api.anthropic.com/v1/messages", {
          method: "POST", signal: ctl.signal,
          headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model, max_tokens: 768, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: imgData } }, { type: "text", text: classifyPrompt(piece.prompt) }] }] }),
        });
      } catch { continue; }
      if (!res.ok) { why = model + " -> HTTP " + res.status; continue; }
      const data = await res.json().catch(() => null);
      const blocks = (data && data.content) || [];
      let txt = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
      if (!txt.includes("{")) txt += blocks.filter((b) => b.type === "thinking").map((b) => b.thinking || "").join("");
      const a = txt.indexOf("{"), b = txt.lastIndexOf("}");
      if (a < 0 || b <= a) { why = model + ": no JSON verdict"; continue; }
      let v = null;
      try { v = JSON.parse(txt.slice(a, b + 1)); } catch { why = model + ": unparseable verdict"; continue; }
      if (!v || (v.grouping !== "none" && !MEDIA_IDS.includes(v.grouping))) { why = model + ": verdict outside the taxonomy"; continue; }
      // Fencing: the style must belong to the chosen grouping's set.
      let style = "none";
      if (v.grouping !== "none" && styleInLane(v.grouping, v.style)) style = v.style;
      const theme = style === "none" ? normalizeTheme(v.theme) : "";
      return { grouping: v.grouping, style, phrase: String(v.phrase || "").slice(0, 80), theme, ok: v.ok !== false, why: "" };
    }
    return fail(why || "no verdict");
  } catch (e) {
    return fail(String(e && e.message || e));
  } finally { clearTimeout(to); }
}

// Vision-classify a batch in waves of 6 (keeps burst rate sane).
export async function visionClassifyBatch(env, pieces, fetchFn) {
  const out = new Map();
  for (let i = 0; i < pieces.length; i += 6) {
    const wave = pieces.slice(i, i + 6);
    const verdicts = await Promise.all(wave.map((p) => visionClassify(env, p, fetchFn)));
    wave.forEach((p, j) => out.set(p, verdicts[j]));
  }
  return out;
}

// "None-theme" discovery loop (v65 addition, Andres's direction): every
// time the judge answers style "none" it also names what the image
// actually IS. Those names are tallied per lane per batch (returned in
// stats.noneThemes) and accumulated across sessions in a D1 doc, so a
// theme that keeps recurring can be proposed to Andres as a candidate
// new style (weekly refresh report; his approval adds it — never
// automatic). D1 failures are non-fatal.
export function normalizeTheme(raw) {
  return String(raw || "").toLowerCase().trim().replace(/\s+/g, " ").slice(0, 40);
}
export function tallyTheme(tally, lane, theme) {
  const t = normalizeTheme(theme);
  if (!t || !LANE_IDS.includes(lane)) return;
  (tally[lane] = tally[lane] || {})[t] = (tally[lane][t] || 0) + 1;
}
export const NONE_THEMES_SLUG = "inspobox-none-themes";
export const NONE_THEMES_CAP = 40;
export async function persistNoneThemes(env, tally) {
  if (!env || !env.DB || !tally || !Object.keys(tally).length) return false;
  try {
    const row = await getDoc(env.DB, NONE_THEMES_SLUG);
    let doc = {};
    try { doc = row && row.html ? JSON.parse(row.html) : {}; } catch { doc = {}; }
    const now = new Date().toISOString();
    for (const lane of Object.keys(tally)) {
      const cell = doc[lane] = doc[lane] || {};
      for (const [theme, n] of Object.entries(tally[lane])) {
        const cur = cell[theme] || { n: 0, lastSeen: "" };
        cur.n += n; cur.lastSeen = now;
        cell[theme] = cur;
      }
      const keys = Object.keys(cell);
      if (keys.length > NONE_THEMES_CAP) {
        keys.sort((a, b) => (cell[a].n - cell[b].n) || String(cell[a].lastSeen).localeCompare(String(cell[b].lastSeen)));
        for (const k of keys.slice(0, keys.length - NONE_THEMES_CAP)) delete cell[k];
      }
    }
    await putDoc(env.DB, NONE_THEMES_SLUG, JSON.stringify(doc));
    return true;
  } catch { return false; }
}

const HOME_BATCH = 16;
// Vision budget for one river batch: the harvest stops here so EVERY
// harvested candidate gets a vision verdict attempt (v66 — the river
// files fail-closed; see the filing loop below).
const HOME_VISION_BUDGET = 18;

// The home river (v65): one walk across the requested LANE's style
// pools, round-robin. Candidates are pre-filtered by their metadata
// (designed-media subject matter, or a subject-led piece under a small
// cap — Civitai galleries flood character work otherwise), then ONE
// vision verdict per candidate files it: grouping, style within that
// grouping's list, caption phrase. Cross-lane verdicts bank into their
// own lanes' rivers; style overflow in the requested lane banks into
// that style's locked column.
export async function fetchHomeBatch({ cursor, exclude, media }, fetchFn, env) {
  const primary = LANE_IDS.includes(media) ? media : "design";
  const seen = new Set(exclude || []);
  const st = cursor && typeof cursor === "object" ? { q: 0, v: 0, c: null, m: null, rot: 0, ...cursor } : { q: 0, v: 0, c: null, m: null, rot: Math.floor(Math.random() * 1024) };
  const walk = laneWalk(primary, st.rot || 0);
  const buckets = {}; // lane -> pieces (filed)
  let total = 0, calls = 0, examined = 0, charFiled = 0, charCapped = 0, skipped = 0;
  let freshFiled = 0;
  const harvest = [];
  const absorb = (page, ver, fresh) => {
    for (const item of page.items || []) {
      const p = toPiece(item, ver.n, null, null);
      if (!p || seen.has(p.uuid)) continue;
      seen.add(p.uuid);
      examined++;
      const med = mediumHits(p.prompt);
      const charStrong = subjectHits(p.prompt) >= 2;
      const eligible = !p.prompt || med >= 1 || charStrong;
      if (!eligible) { skipped++; continue; }
      if (charStrong && med === 0) {
        if (charFiled >= 2) { charCapped++; continue; }
        charFiled++;
      }
      if (fresh) p.fresh = true;
      p._mt = ver.mt;
      harvest.push(p);
      if (harvest.length >= HOME_VISION_BUDGET) break;
    }
  };
  if (!st.f) st.f = { i: 0, m: null, v: 0, c: null, done: false };
  const freshWalk = freshEntries(primary, st.rot || 0);
  let fCalls = 0;
  while (harvest.length < HOME_VISION_BUDGET && fCalls < 5 && !st.f.done) {
    if (st.f.i >= freshWalk.length) { st.f.done = true; break; }
    const entry = freshWalk[st.f.i];
    if (!st.f.m) {
      const qs = new URLSearchParams({ query: entry.q, limit: "6", sort: "Highest Rated", period: entry.period, nsfw: "false" });
      qs.append("types", "LORA"); qs.append("types", "Checkpoint");
      let models;
      try { models = await civGet(fetchFn, "/models?" + qs.toString()); } catch (e) { if (e && e.code === 429) throw e; break; }
      fCalls++;
      st.f.m = orderModels((models.items || []).map(mapModel).filter(Boolean));
      st.f.v = 0; st.f.c = null;
      if (!st.f.m.length) { st.f.i++; st.f.m = null; continue; }
    }
    if (st.f.v >= st.f.m.length) { st.f.i++; st.f.m = null; st.f.c = null; continue; }
    const ver = st.f.m[st.f.v];
    const qs = new URLSearchParams({ modelVersionId: String(ver.v), limit: "30", nsfw: "false", sort: "Most Reactions", period: entry.period, withMeta: "true" });
    if (st.f.c) qs.set("cursor", st.f.c);
    let page;
    try { page = await civGet(fetchFn, "/images?" + qs.toString()); } catch (e) { if (e && e.code === 429) throw e; break; }
    fCalls++;
    absorb(page, ver, true);
    st.f.c = (page.metadata && page.metadata.nextCursor) || null;
    if (!st.f.c) st.f.v++;
  }
  while (harvest.length < HOME_VISION_BUDGET && calls < 10 && st.q < walk.length) {
    if (!st.m) {
      const qs = new URLSearchParams({ query: walk[st.q].q, limit: "6", sort: "Most Downloaded", nsfw: "false" });
      qs.append("types", "LORA"); qs.append("types", "Checkpoint");
      let models;
      try { models = await civGet(fetchFn, "/models?" + qs.toString()); } catch (e) { if (e && e.code === 429) throw e; break; }
      calls++;
      st.m = orderModels((models.items || []).map(mapModel).filter(Boolean));
      st.v = 0; st.c = null;
      if (!st.m.length) { st.q++; st.m = null; continue; }
    }
    if (st.v >= st.m.length) { st.q++; st.m = null; st.c = null; continue; }
    const ver = st.m[st.v];
    const qs = new URLSearchParams({ modelVersionId: String(ver.v), limit: "30", nsfw: "false", sort: "Most Reactions", period: st.v % 2 ? "Month" : "AllTime", withMeta: "true" });
    if (st.c) qs.set("cursor", st.c);
    let page;
    try { page = await civGet(fetchFn, "/images?" + qs.toString()); } catch (e) { if (e && e.code === 429) throw e; break; }
    calls++;
    absorb(page, ver, false);
    st.c = (page.metadata && page.metadata.nextCursor) || null;
    if (!st.c) st.v++;
  }
  // Vision-first filing (v66): the harvest is capped at the vision
  // budget, so every harvested candidate gets a verdict attempt — and
  // the river files FAIL-CLOSED, exactly like the locked columns. A
  // candidate with no verdict (judge infra failure, or no judge key)
  // is skipped, never metadata-filed: an unverdicted piece must not
  // render under a guessed lane or style. Honest verdicts rule; style
  // "none" still decks unstyled in its verdicted lane; "none"
  // grouping and quality failures still cull.
  let visionChecked = 0, visionCulled = 0, unstyled = 0, unverified = 0;
  const noneThemes = {};
  const toVerify = harvest.slice(0, HOME_VISION_BUDGET);
  const verdicts = (env && env.ANTHROPIC_API_KEY) ? await visionClassifyBatch(env, toVerify, fetchFn) : new Map();
  for (const p of harvest) {
    const v = verdicts.get(p);
    delete p._mt;
    if (!v || v.grouping === null) {
      // fail-closed: no verdict, no filing (counted, never decked)
      unverified++;
      continue;
    }
    visionChecked++;
    if (v.ok === false || v.grouping === "none") { visionCulled++; if (v.theme) tallyTheme(noneThemes, primary, v.theme); continue; }
    p.media = v.grouping;
    if (v.style === "none") {
      p.movement = null;
      unstyled++;
      if (v.theme) tallyTheme(noneThemes, v.grouping, v.theme);
    } else {
      p.movement = v.style;
      p.gated = true;
    }
    if (v.phrase) p.style = v.phrase;
    if (p.fresh) freshFiled++;
    (buckets[p.media] = buckets[p.media] || []).push(p); total++;
  }
  if (Object.keys(noneThemes).length) await persistNoneThemes(env, noneThemes);
  // Round-robin interleave by STYLE with a per-style cap: one deep style
  // may not flood the river. Surplus styled pieces BANK into their
  // style's locked column; other-lane pieces bank into their home river.
  const HOME_STYLE_CAP = 3, BANK_CAP = 8;
  const inLane = (buckets[primary] || []).slice();
  const byStyle = {};
  for (const p of inLane) (byStyle[p.movement || "none"] = byStyle[p.movement || "none"] || []).push(p);
  const styleKeys = Object.keys(byStyle);
  const pieces = [];
  const counts = {};
  let guard = 0;
  while (pieces.length < HOME_BATCH && guard++ < 500) {
    let progressed = false;
    for (const sk of styleKeys) {
      if ((counts[sk] || 0) >= HOME_STYLE_CAP) continue;
      if (byStyle[sk].length) { pieces.push(byStyle[sk].shift()); counts[sk] = (counts[sk] || 0) + 1; progressed = true; if (pieces.length >= HOME_BATCH) break; }
    }
    if (!progressed) break;
  }
  const banked = {};
  const bankedHome = {};
  let bankedCount = 0, bankedHomeCount = 0;
  for (const sk of styleKeys) for (const p of byStyle[sk]) if (p.movement) (banked[p.movement] = banked[p.movement] || []).push(p);
  for (const lane of Object.keys(buckets)) {
    if (lane === primary) continue;
    for (const p of buckets[lane]) (bankedHome[lane] = bankedHome[lane] || []).push(p);
  }
  for (const mv of Object.keys(banked)) { banked[mv] = banked[mv].slice(0, BANK_CAP); bankedCount += banked[mv].length; }
  for (const md of Object.keys(bankedHome)) { bankedHome[md] = bankedHome[md].slice(0, BANK_CAP); bankedHomeCount += bankedHome[md].length; }
  return { pieces, banked, bankedHome, cursor: st, done: st.q >= walk.length, stats: { examined, passed: pieces.length, civCalls: calls, styles: Object.keys(counts).length, charCapped, skipped, banked: bankedCount, bankedHome: bankedHomeCount, freshFiled, visionChecked, visionCulled, unstyled, unverified, noneThemes } };
}

// A locked column (v65): contract is {media: lane, movement: style id
// within that lane} — param names unchanged from the genre era. The walk
// covers the style's own pools, then the lane's neighbor styles; every
// kept candidate gets ONE vision verdict and the verdict files it: this
// column only when grouping AND style match the request; another
// (lane, style) banks under its true filing; "none"/quality culls. A
// piece vision could not reach is NOT delivered (it carries no honest
// style) — it stays unserved rather than mislabeled.
export async function fetchMoreBatch({ movement, media, cursor, exclude }, fetchFn, env) {
  const lane = LANE_IDS.includes(media) ? media : null;
  const styleId = movement;
  if (!lane || !styleInLane(lane, styleId)) return { pieces: [], banked: [], cursor: cursor || null, done: true, stats: { examined: 0, passed: 0, gated: !!(env && env.ANTHROPIC_API_KEY), civCalls: 0, unknownStyle: true, noneThemes: {} } };
  const seen = new Set(exclude || []);
  const st = cursor && typeof cursor === "object" ? { q: 0, v: 0, c: null, m: null, rot: 0, ...cursor } : { q: 0, v: 0, c: null, m: null, rot: Math.floor(Math.random() * 1024) };
  const queries = columnWalk(lane, styleId, st.rot || 0);
  const pieces = [];
  const banked = [];
  const noneThemes = {};
  let calls = 0, examined = 0, visionCulled = 0, unstyled = 0;
  while (pieces.length < BATCH && calls < 5) {
    if (st.q >= queries.length) break;
    if (!st.m) {
      const qs = new URLSearchParams({ query: queries[st.q].q, limit: "6", sort: "Most Downloaded", nsfw: "false" });
      qs.append("types", "LORA"); qs.append("types", "Checkpoint");
      let models;
      try { models = await civGet(fetchFn, "/models?" + qs.toString()); } catch (e) { if (e && e.code === 429) throw e; break; }
      calls++;
      st.m = orderModels((models.items || []).map(mapModel).filter(Boolean));
      st.v = 0; st.c = null;
      if (!st.m.length) { st.q++; st.m = null; continue; }
    }
    if (st.v >= st.m.length) { st.q++; st.m = null; st.c = null; continue; }
    const ver = st.m[st.v];
    const qs = new URLSearchParams({ modelVersionId: String(ver.v), limit: "30", nsfw: "false", sort: "Most Reactions", period: st.v % 2 ? "Month" : "AllTime", withMeta: "true" });
    if (st.c) qs.set("cursor", st.c);
    let page;
    try { page = await civGet(fetchFn, "/images?" + qs.toString()); } catch (e) { if (e && e.code === 429) throw e; break; }
    calls++;
    const cands = [];
    for (const item of page.items || []) {
      const p = toPiece(item, ver.n, styleId, lane);
      if (p && !seen.has(p.uuid)) { seen.add(p.uuid); cands.push(p); examined++; }
    }
    if (env && env.ANTHROPIC_API_KEY && cands.length) {
      const toVerify = cands.slice(0, 12);
      const verdicts = await visionClassifyBatch(env, toVerify, fetchFn);
      for (const p of toVerify) {
        const v = verdicts.get(p);
        if (!v || v.grouping === null) { unstyled++; continue; }
        if (v.ok === false || v.grouping === "none") { visionCulled++; if (v.theme) tallyTheme(noneThemes, lane, v.theme); continue; }
        if (v.style === "none") { visionCulled++; if (v.theme) tallyTheme(noneThemes, v.grouping, v.theme); continue; }
        p.movement = v.style; p.media = v.grouping; p.gated = true;
        if (v.phrase) p.style = v.phrase;
        if (v.grouping === lane && v.style === styleId) { if (pieces.length < BATCH) pieces.push(p); else banked.push(p); }
        else banked.push(p);
      }
      unstyled += cands.length - toVerify.length; // beyond the vision cap: unserved, not mislabeled
    } else {
      unstyled += cands.length; // no judge available: nothing can be honestly styled
    }
    st.c = (page.metadata && page.metadata.nextCursor) || null;
    if (!st.c) st.v++;
  }
  if (Object.keys(noneThemes).length) await persistNoneThemes(env, noneThemes);
  return { pieces, banked, cursor: st, done: st.q >= queries.length, stats: { examined, passed: pieces.length, gated: !!(env && env.ANTHROPIC_API_KEY), civCalls: calls, visionCulled, unstyled, mediaBanked: banked.length, noneThemes } };
}

export async function readNoneThemes(env) {
  if (!env || !env.DB) return {};
  try {
    const row = await getDoc(env.DB, NONE_THEMES_SLUG);
    return row && row.html ? JSON.parse(row.html) : {};
  } catch { return {}; }
}
export async function resetNoneTheme(env, lane, theme) {
  if (!env || !env.DB || !LANE_IDS.includes(lane)) return false;
  const t = normalizeTheme(theme);
  if (!t) return false;
  try {
    const doc = await readNoneThemes(env);
    if (doc[lane] && doc[lane][t]) { delete doc[lane][t]; await putDoc(env.DB, NONE_THEMES_SLUG, JSON.stringify(doc)); }
    return true;
  } catch { return false; }
}

export async function onRequestPost({ request, env }) {
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  if (!appAllowed(id, "inspobox")) return json({ error: "this account doesn't cover this app" }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
  // Admin maintenance for the discovery loop: after Andres approves a
  // none-theme as a new style (and it ships in LANE_STYLES), its counter
  // resets here. Admin role only; never part of the feed path.
  if (body && body.resetNoneTheme) {
    if (id.role !== "admin") return json({ error: "admin only" }, 403);
    const ok = await resetNoneTheme(env, String(body.resetNoneTheme.lane || ""), String(body.resetNoneTheme.theme || ""));
    return json({ ok });
  }
  try {
    if (body.home === true) {
      const out = await fetchHomeBatch({
        cursor: body.cursor || null,
        exclude: Array.isArray(body.exclude) ? body.exclude.slice(0, 1000).map(String) : [],
        media: String(body.media || "design"),
      }, fetch, env);
      return json({ ok: true, ...out });
    }
    const out = await fetchMoreBatch({
      movement: String(body.movement || ""),
      media: String(body.media || "design"),
      cursor: body.cursor || null,
      exclude: Array.isArray(body.exclude) ? body.exclude.slice(0, 1000).map(String) : [],
    }, fetch, env);
    return json({ ok: true, ...out });
  } catch (e) {
    if (e && e.code === 429) return json({ ok: false, error: "rate_limited" }, 429);
    return json({ ok: false, error: String(e && e.message || e) }, 502);
  }
}

export async function onRequestGet({ request, env }) {
  // Admin-only read of the none-theme sightings doc (the weekly refresh
  // reports any theme at n >= 5 in a lane as a candidate new style).
  const url = new URL(request.url);
  if (url.searchParams.get("noneThemes") === "1") {
    const id = await requireIdentity(env, request);
    if (!id) return json({ error: "not signed in" }, 401);
    if (id.role !== "admin") return json({ error: "admin only" }, 403);
    return json({ ok: true, themes: await readNoneThemes(env) });
  }
  return json({ error: "POST only" }, 405);
}
