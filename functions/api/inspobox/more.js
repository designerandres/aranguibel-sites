import { appAllowed, json, requireIdentity } from "../../_lib/auth.js";
import { AFFINITY, QUALITY_BAR, RUBRIC } from "../../_lib/inspobox-rubric.js";

// INSPOBOX live feed — the app pulls fresh pieces from Civitai's public API
// itself, per session, when a locked genre's stack runs low. Nothing here is
// persisted: pieces live only in the client's in-memory deck. Galleries are
// the same model pools the curated sourcing used (old genre pools folded
// into the current 13 movements), images sorted by most reactions.
const QUERIES = {
  "surreal": ["surreal", "surrealism", "liminal space", "backrooms", "claymation", "stop motion", "greek mythology", "ancient greece"],
  "art-deco": ["art deco", "great gatsby"],
  "art-moderne": ["bauhaus", "dieselpunk"],
  "mid-century": ["mid century", "retro futurism"],
  "pop": ["comic book style", "comic art", "memphis design", "80s design", "vaporwave", "psychedelic", "psychedelic art"],
  "afrofuturism": ["afrofuturism", "afro futurism"],
  "brutalist": ["brutalist architecture", "brutalism"],
  "cyberpunk": ["cyberpunk", "cyberpunk city", "liquid metal", "chrome style"],
  "film-noir": ["film noir", "noir style"],
  "gothic": ["gothic architecture", "gothic style"],
  "minimalist": ["minimalist", "minimalism"],
  "solarpunk": ["solarpunk", "cozy interior", "cozy"],
  "steampunk": ["steampunk", "steampunk machinery"],
};
const CIV = "https://civitai.com/api/v1";
const BATCH = 8;

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

// Metadata pre-pass (v50): Civitai images carry their own generation
// prompt, and the gallery model's name — when that text speaks the genre's
// vocabulary fluently, the intent is explicit and no vision call is spent.
// Score: genre name in the text = 3; each distinct affinity term = 1.
// >= 3 passes on metadata alone.
export function metaScore(piece, modelName, modelText) {
  return scoreAll(piece, modelName, modelText)[piece.movement] || 0;
}

// Score a candidate's metadata against EVERY genre at once (v51): the
// prompt is the artist's own declaration of intent, so it can file a piece
// — including one found in the WRONG genre's gallery — better than a
// gallery label can. Genre name in the text = 3; each affinity term = 1.
export function scoreHay(hay) {
  const out = {};
  for (const mv of Object.keys(AFFINITY)) {
    let score = 0;
    if (hay.includes(mv.replace(/-/g, " "))) score += 3;
    for (const term of AFFINITY[mv]) if (hay.includes(term)) score += 1;
    if (score) out[mv] = score;
  }
  return out;
}

// The model's own declarations — its human-applied tags and trained
// trigger words (v56) — corroborate the image's prompt. They describe the
// model rather than this one image, so their contribution is capped at
// +3 per genre: enough to firm up a whisper, never enough to outvote
// what the image's own prompt says.
export function scoreAll(piece, modelName, modelText) {
  const out = scoreHay((((piece && piece.prompt) || "") + " " + (modelName || "") + " " + ((piece && piece.title) || "")).toLowerCase());
  if (modelText) {
    const ms = scoreHay(String(modelText).toLowerCase());
    for (const mv of Object.keys(ms)) out[mv] = (out[mv] || 0) + Math.min(3, ms[mv]);
  }
  return out;
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

// Subject + medium signals (v54). Civitai showcase galleries are
// dominated by character generations whatever the style — the prompt
// reveals the SUBJECT as plainly as the style. CHARACTER_TERMS mark a
// character-led piece (Danbooru tag soup is unmistakable); MEDIUM_TERMS
// mark designed-media subject matter — the places, objects, graphics and
// spaces the app's disciplines are actually about.
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

// The grouping taxonomy (v59) — the horizontal strip, replacing
// Design/Photo/Architecture/UI. These are SUBJECT groupings: what the
// piece is OF, read from the same prompt evidence as the genre. A castle
// in a valley files as architecture (the built thing is the subject);
// the valley alone files as world; a poster OF a castle files as
// graphics (the medium is the subject). Ties break toward the most
// specific reading: graphics > architecture > prop > character > world.
export const MEDIA_VOCAB = {
  "character": ["character design", "warrior", "knight", "sorceress", "portrait", "figure", "creature", "monster", "android", "cyborg", "vampire", "elf", "dwarf", "orc", "goblin", "dragon", "beast", "animal", "cat", "dog", "bird", "horse", "wolf", "fox", "woman", "man", "girl", "boy", "lady", "gentleman", "king", "queen", "witch", "wizard", "fairy", "angel", "demon", "skeleton", "zombie", "mermaid", "centaur", "minotaur", "phoenix"],
  "world": ["landscape", "scenery", "environment", "vista", "panorama", "panoramic", "valley", "mountain", "forest", "desert", "ocean", "sea", "island", "jungle", "tundra", "canyon", "waterfall", "meadow", "coast", "shore", "cliff", "cave", "village", "town", "kingdom", "realm", "planet", "terrain", "countryside", "wilderness", "aerial view", "overlook", "cityscape", "horizon", "fields", "underwater world"],
  "architecture": ["architecture", "building", "cathedral", "church", "temple", "castle", "palace", "tower", "bridge", "interior", "facade", "dome", "spire", "skyscraper", "mansion", "cottage", "fortress", "library", "museum", "hotel", "lobby", "staircase", "archway", "courtyard", "station", "pavilion", "ruins", "house", "street", "skyline", "cathedral interior", "throne room", "hall", "plaza", "marketplace", "harbor", "lighthouse", "windmill", "pagoda", "mosque", "abbey", "monastery", "crypt", "dungeon"],
  "prop": ["sword", "weapon", "gun", "rifle", "vehicle", "car", "motorcycle", "bicycle", "watch", "chair", "table", "lamp", "machine", "device", "gadget", "armor", "helmet", "shield", "book", "bottle", "key", "chest", "guitar", "camera", "backpack", "crown", "mask", "potion", "teapot", "vase", "sculpture", "statue", "still life", "product", "object", "dagger", "axe", "bow", "staff", "wand", "ring", "amulet", "spaceship", "airship", "train", "ship", "mecha", "mech", "jewelry", "necklace", "gem", "crystal", "orb", "lantern", "clock", "compass", "map"],
  "graphics": ["poster", "typography", "logo", "illustration", "comic", "cover art", "album cover", "book cover", "signage", "banner", "advertisement", "vector", "flat design", "infographic", "pattern", "interface", "dashboard", "hud", "ui design", "manga", "print", "editorial", "branding", "packaging", "label", "postcard", "tarot", "playing card", "stamp design", "text"],
};
const MEDIA_PRIORITY = ["graphics", "architecture", "prop", "character", "world"];
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

// Neighbor genres whose galleries most often hide this genre's pieces
// (dieselpunk lives under art-moderne, neon-noir under cyberpunk, ...).
// The live walk covers the genre's own pool first, then the neighbors',
// and classification — not the gallery label — decides what files here.
const NEIGHBORS = {
  "surreal": ["pop", "gothic"],
  "art-deco": ["art-moderne", "pop"],
  "art-moderne": ["art-deco", "mid-century"],
  "mid-century": ["art-moderne", "pop"],
  "pop": ["surreal", "mid-century"],
  "afrofuturism": ["cyberpunk", "surreal"],
  "brutalist": ["minimalist", "art-moderne"],
  "cyberpunk": ["afrofuturism", "film-noir"],
  "film-noir": ["cyberpunk", "gothic"],
  "gothic": ["film-noir", "surreal"],
  "minimalist": ["brutalist", "mid-century"],
  "solarpunk": ["cyberpunk", "surreal"],
  "steampunk": ["art-moderne", "gothic"],
};
export function walkList(movement, rot) {
  const own = QUERIES[movement] || [];
  const all = own.slice();
  for (const nb of NEIGHBORS[movement] || []) for (const q of QUERIES[nb] || []) if (!all.includes(q)) all.push(q);
  return all.map((_, i) => all[(i + (rot || 0)) % all.length]);
}

export function gatePrompt(movement) {
  return `You are the genre-fit gate for INSPOBOX, a design-inspiration app. Decide whether this image belongs in the "${movement}" feed.\n\n${RUBRIC[movement] || ""}\n\n${QUALITY_BAR}\n\nBegin your reply with the JSON verdict, exactly {"fits": true} or {"fits": false}, then — only if you want — one short sentence of explanation. Nothing before the JSON. Standard: fits=true when the genre's core idea is present with at least one strong hallmark, or the image has an unmistakable overall ${movement} read, and it clears the quality bar. Borderline but plausible counts as true. Answer false only for a clearly different genre, an off-topic subject, or a quality-bar failure (watermarks, garbled text, AI artifacts, presentation boards, blockouts, murk, IP characters).`;
}

// One vision verdict. A MERIT verdict (fits true/false) is honored. But
// since v50 (Andres: "loosen the gates") an INFRASTRUCTURE failure — the
// image would not download, the API errored, the reply held no verdict,
// the call timed out — returns fits:null and the piece flows ungated
// instead of being culled by a check that never actually ran.
function b64(buf) {
  let out = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

export async function gateOne(env, piece, fetchFn) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 15000);
  try {
    const imgUrl = String(piece.img).replace("/width=1200/", "/width=640/");
    let imgRes;
    try { imgRes = await fetchFn(imgUrl, { signal: ctl.signal, headers: { "user-agent": "INSPOBOX live feed" } }); }
    catch { return { fits: null, why: "image download failed" }; }
    if (!imgRes.ok) return { fits: null, why: "image download " + imgRes.status };
    const mt = (imgRes.headers && imgRes.headers.get && imgRes.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    const mediaType = ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mt) ? mt : "image/jpeg";
    const imgData = b64(await imgRes.arrayBuffer());
    let why = "";
    for (const model of ["claude-haiku-5-5", "claude-sonnet-5-5"]) {
      const res = await fetchFn("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: ctl.signal,
        headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model,
          max_tokens: 768,
          messages: [{ role: "user", content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: imgData } },
            { type: "text", text: gatePrompt(piece.movement) },
          ] }],
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => null);
        const errMsg = (errBody && errBody.error && (errBody.error.type + ": " + errBody.error.message)) || "";
        why = model + " " + res.status + (errMsg ? " " + errMsg.slice(0, 70) : "");
        continue;
      }
      const data = await res.json().catch(() => null);
      const blocks = (data && data.content) || [];
      let text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
      if (!/\{/.test(text)) text += blocks.filter((b) => b.type === "thinking").map((b) => b.thinking || "").join("");
      let verdict = null;
      const fm = text.match(/\{\s*"fits"\s*:\s*(true|false)/);
      if (fm) verdict = { fits: fm[1] === "true" };
      if (!verdict) {
        const cands = text.match(/\{[^{}]*\}/g) || [];
        for (const cand of cands) { try { const j = JSON.parse(cand); if (typeof j.fits === "boolean") verdict = j; } catch {} }
      }
      if (!verdict) { why = model + " unparseable verdict: " + (text.slice(0, 60) || "(empty response)"); continue; }
      return { fits: verdict.fits, why: "" };
    }
    return { fits: null, why };
  } catch { return { fits: null, why: "gate timed out" }; } finally { clearTimeout(to); }
}

// Gate a list of candidates in parallel waves of 9 (keeps burst rate sane).
// Vision-first filing (v61, Andres's direction after the diagnosis: the
// label was describing the gallery, not the picture). One Claude vision
// call per DISPLAYED piece decides everything from the image itself:
//  - genre: CLOSED set — exactly one of the 13 movement ids, or "none"
//    when none honestly fits (a wrong label is worse than no label; the
//    app files pieces into the 13 folders, so filing needs the taxonomy).
//  - media: one of the 5 subject groupings.
//  - style: Claude's OWN free-text phrase for what the image actually
//    looks like. Shown on the piece as a descriptor, and logged in stats
//    — a phrase that keeps recurring outside the 13 is a candidate new
//    genre to propose, never a folder invented on the fly.
//  - ok: the shared quality bar (watermarks, artifacts, IP characters…).
// Infrastructure failures return nulls and the piece flows on its
// metadata filing (fail-open, per the standing rule); a real verdict
// RULES — it overrides the metadata genre and grouping outright.
export const GENRE_IDS = ["surreal", "art-deco", "art-moderne", "mid-century", "pop", "afrofuturism", "brutalist", "cyberpunk", "film-noir", "gothic", "minimalist", "solarpunk", "steampunk"];
export const MEDIA_IDS = ["character", "world", "architecture", "prop", "graphics"];
export function classifyPrompt() {
  const genres = GENRE_IDS.map((id) => "- " + id + ": " + (RUBRIC[id] || "")).join("\n");
  return "You are the filing editor for INSPOBOX, a design-inspiration app. Look at this image and file it by WHAT IT ACTUALLY SHOWS — never by what it might have been generated with.\n\nGENRES (choose exactly one id, or none):\n" + genres + "\n\nGROUPINGS (choose exactly one): character = a person, creature, or being is the subject; world = an environment, landscape, or place is the subject with no single building or object dominating; architecture = a building, structure, or interior is the subject; prop = a single object, product, vehicle, or item is the subject; graphics = a poster, typography, logo, flat illustration, print, or interface — the graphic itself is the subject.\n\n" + QUALITY_BAR + "\n\nBegin your reply with ONLY this JSON object, nothing before it: {\"genre\": \"<genre id or none>\", \"media\": \"<grouping id>\", \"style\": \"<your own short phrase for the style this image actually is, e.g. 'muted liminal-space photograph'>\", \"ok\": true}. Set ok=false only for a quality-bar failure. Choose genre none when no listed genre honestly fits — do not force the nearest one.";
}

export async function visionClassify(env, piece, fetchFn) {
  const fail = (why) => ({ genre: null, media: null, style: "", ok: null, why });
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
          body: JSON.stringify({ model, max_tokens: 768, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: imgData } }, { type: "text", text: classifyPrompt() }] }] }),
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
      if (!v || (v.genre !== "none" && !GENRE_IDS.includes(v.genre)) || !MEDIA_IDS.includes(v.media)) { why = model + ": verdict outside the taxonomy"; continue; }
      return { genre: v.genre, media: v.media, style: String(v.style || "").slice(0, 80), ok: v.ok !== false, why: "" };
    }
    return fail(why || "no verdict");
  } catch (e) {
    return fail(String(e && e.message || e));
  } finally { clearTimeout(to); }
}

// Vision-classify a batch in waves of 6 (mirrors gatePieces' pacing).
export async function visionClassifyBatch(env, pieces, fetchFn) {
  const out = new Map();
  for (let i = 0; i < pieces.length; i += 6) {
    const wave = pieces.slice(i, i + 6);
    const verdicts = await Promise.all(wave.map((p) => visionClassify(env, p, fetchFn)));
    wave.forEach((p, j) => out.set(p, verdicts[j]));
  }
  return out;
}

export async function gatePieces(env, candidates, fetchFn) {
  const kept = [];
  let why = "";
  let errors = 0;
  for (let i = 0; i < candidates.length; i += 6) {
    const wave = candidates.slice(i, i + 6);
    const verdicts = await Promise.all(wave.map((p) => gateOne(env, p, fetchFn)));
    wave.forEach((p, j) => {
      const v = verdicts[j];
      if (v.fits === true) { p.gated = true; kept.push(p); }
      else if (v.fits === null) { errors++; kept.push(p); if (!why && v.why) why = v.why; }
      else if (!why && v.why) why = v.why;
    });
  }
  return { kept, why, errors };
}

// The home river (v53): one walk across ALL thirteen genre pools,
// round-robin. Every candidate is filed by its own prompt — the genre is
// wherever the classification lands, not the gallery it was found in.
export function walkAll(rot) {
  const mvs = Object.keys(QUERIES);
  const maxQ = Math.max(...mvs.map((m) => QUERIES[m].length));
  const all = [];
  for (let qi = 0; qi < maxQ; qi++) for (const mv of mvs) if (QUERIES[mv][qi]) all.push({ q: QUERIES[mv][qi], src: mv });
  return all.map((_, i) => all[(i + (rot || 0)) % all.length]);
}

// The fresh lane (v58): "highest rated <genre> of the last 24 hours."
// Civitai has no cross-site genre search — the images endpoint filters
// only within a gallery — so the lane is built from the models search:
// each genre's canonical query with period=Day and sort="Highest Rated",
// then a Week pass as fallback (a niche genre may publish nothing on a
// given day). Entries carry their period through to the images call, so
// a TODAY piece really is from the window on its badge.
export function freshEntries(rot) {
  const mvs = Object.keys(QUERIES);
  const ordered = mvs.map((_, i) => mvs[(i + (rot || 0)) % mvs.length]);
  const out = [];
  for (const period of ["Day", "Week"]) for (const mv of ordered) out.push({ q: QUERIES[mv][0], src: mv, period });
  return out;
}

export function classifySlot(scores, minTop = 4, margin = 2) {
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  const [top, second] = [entries[0], entries[1]];
  if (top[1] >= minTop && (!second || top[1] >= second[1] + margin)) return top[0];
  return null;
}

const HOME_BATCH = 16;

// Ambiguous prompts (a whisper of signal, no dominant genre) get ONE
// batched TEXT classification call — prompts only, no images — so the
// whole batch costs a fraction of a single vision check. Haiku first.
export async function classifyAmbiguous(env, items, fetchFn) {
  if (!items.length || !env || !env.ANTHROPIC_API_KEY) return {};
  const list = items.slice(0, 16);
  const text = "Each numbered image-generation prompt comes with the small set of movements its own vocabulary already plausibly matches. For each one, choose the single best movement FROM ITS OWN SET, or none if the style is not truly the subject of the prompt. A character portrait with a plain or simple background is NOT minimalist — minimalist means deliberate geometric reduction, spare architecture, or abstract composition as the subject. Reply with ONLY a JSON array like [{\"i\":0,\"m\":\"gothic\"}].\n\n" + list.map((p, i) => i + ". " + String(p.prompt || "").slice(0, 220) + " [choose: " + (p.cands || []).join(", ") + " — or none]").join("\n");
  for (const model of ["claude-haiku-5-5", "claude-sonnet-5-5"]) {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 15000);
      const res = await fetchFn("https://api.anthropic.com/v1/messages", {
        method: "POST", signal: ctl.signal,
        headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 700, messages: [{ role: "user", content: [{ type: "text", text }] }] }),
      });
      clearTimeout(to);
      if (!res.ok) continue;
      const data = await res.json().catch(() => null);
      const blocks = (data && data.content) || [];
      let txt = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
      if (!txt.includes("[")) txt += blocks.filter((b) => b.type === "thinking").map((b) => b.thinking || "").join("");
      const a = txt.indexOf("["), b = txt.lastIndexOf("]");
      if (a < 0 || b <= a) continue;
      const arr = JSON.parse(txt.slice(a, b + 1));
      const out = {};
      for (const r of arr) if (r && Number.isInteger(r.i) && list[r.i] && (r.m === "none" || (list[r.i].cands || []).includes(r.m))) out[r.i] = r.m;
      return out;
    } catch { /* try the next model */ }
  }
  return {};
}

export async function fetchHomeBatch({ cursor, exclude, media }, fetchFn, env) {
  const seen = new Set(exclude || []);
  const st = cursor && typeof cursor === "object" ? { q: 0, v: 0, c: null, m: null, rot: 0, ...cursor } : { q: 0, v: 0, c: null, m: null, rot: Math.floor(Math.random() * 1024) };
  const walk = walkAll(st.rot || 0);
  const buckets = {};
  let total = 0, calls = 0, examined = 0, charFiled = 0, charCapped = 0, skipped = 0;
  const ambiguous = [];
  let freshFiled = 0;
  const absorb = (page, ver, src, fresh) => {
    for (const item of page.items || []) {
      const p = toPiece(item, ver.n, src, "world"); // placeholder — the grouping is classified below, at filing
      if (!p || seen.has(p.uuid)) continue;
      p.media = classifyMedia(p, ver.mt);
      seen.add(p.uuid);
      examined++;
      // Style-tagged media focus (v54): the style must be the SUBJECT.
      // Character-led pieces (the Civitai showcase default) file only
      // when their style signal is dominant, and at most 2 per batch;
      // everything else needs designed-media subject matter in the
      // prompt, or an overwhelming style score.
      const scores = scoreAll(p, ver.n, ver.mt);
      const topScore = Math.max(0, ...Object.values(scores));
      const slot = classifySlot(scores);
      const charStrong = subjectHits(p.prompt) >= 2;
      const med = mediumHits(p.prompt);
      if (slot && (med >= 1 || topScore >= 6)) {
        if (charStrong && charFiled >= 2) { charCapped++; }
        else { p.movement = slot; p.meta = true; if (fresh) { p.fresh = true; freshFiled++; } (buckets[slot] = buckets[slot] || []).push(p); total++; if (charStrong) charFiled++; }
      }
      else if (!slot && p.prompt && topScore >= 2 && !charStrong && med >= 1 && ambiguous.length < 16) {
        p.cands = Object.entries(scores).filter(([, v]) => v >= 2).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
        if (p.cands.length) { if (fresh) p.fresh = true; ambiguous.push(p); } else skipped++;
      }
      else skipped++;
      if (total >= HOME_BATCH) break;
    }
  };
  if (!st.f) st.f = { i: 0, m: null, v: 0, c: null, done: false };
  const freshWalk = freshEntries(st.rot || 0);
  let fCalls = 0;
  while (total < HOME_BATCH && fCalls < 5 && !st.f.done) {
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
    absorb(page, ver, entry.src, true);
    st.f.c = (page.metadata && page.metadata.nextCursor) || null;
    if (!st.f.c) st.f.v++;
  }
  while (total < HOME_BATCH && calls < 10 && st.q < walk.length) {
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
    absorb(page, ver, walk[st.q].src, false);
    st.c = (page.metadata && page.metadata.nextCursor) || null;
    if (!st.c) st.v++;
  }
  let claude = 0;
  if (ambiguous.length && total < HOME_BATCH) {
    const verdicts = await classifyAmbiguous(env, ambiguous, fetchFn);
    for (const [ix, mv] of Object.entries(verdicts)) {
      if (mv === "none" || claude >= 6) continue;
      const p = ambiguous[Number(ix)];
      p.movement = mv; p.claude = true;
      (buckets[mv] = buckets[mv] || []).push(p); total++; claude++;
      if (total >= HOME_BATCH) break;
    }
  }
  // Vision-first filing (v61): the harvest gets one vision verdict per
  // piece (capped) — genre, grouping and style from the picture itself,
  // overriding the metadata filing. "None" and quality failures leave
  // the river; cross-genre verdicts move buckets; infra failures keep
  // the metadata filing.
  let visionChecked = 0, visionCulled = 0;
  if (env && env.ANTHROPIC_API_KEY) {
    const filedAll = [];
    for (const mv of Object.keys(buckets)) for (const p of buckets[mv]) filedAll.push(p);
    const toVerify = filedAll.slice(0, 18);
    if (toVerify.length) {
      const verdicts = await visionClassifyBatch(env, toVerify, fetchFn);
      for (const p of toVerify) {
        const v = verdicts.get(p);
        if (!v || v.genre === null) continue;
        visionChecked++;
        const from = buckets[p.movement];
        const pull = () => { if (from) { const ix = from.indexOf(p); if (ix >= 0) from.splice(ix, 1); } };
        if (v.ok === false || v.genre === "none") { visionCulled++; pull(); continue; }
        p.style = v.style; p.gated = true; p.media = v.media;
        if (v.genre !== p.movement) { pull(); p.movement = v.genre; (buckets[v.genre] = buckets[v.genre] || []).push(p); }
      }
    }
  }
  // Round-robin interleave with a per-genre cap (v57): one deep bucket
  // (surreal is the usual suspect — its vocabulary is everywhere) may not
  // flood the river. Surplus classified pieces are BANKED under their
  // genre instead of discarded: the client files them into that genre's
  // locked column, so locking Surreal opens a pre-filled stack and home
  // stays diverse. Filing is bookkeeping on the same payload — no extra
  // calls, no extra spend.
  const HOME_GENRE_CAP = 3, BANK_CAP = 8;
  const primary = MEDIA_VOCAB[media] ? media : "character";
  const mvs = Object.keys(buckets).filter((k) => buckets[k].length);
  const pieces = [];
  const counts = {};
  let guard = 0;
  while (pieces.length < HOME_BATCH && guard++ < 500) {
    let progressed = false;
    for (const mv of mvs) {
      if ((counts[mv] || 0) >= HOME_GENRE_CAP) continue;
      const ix = buckets[mv].findIndex((p) => p.media === primary);
      if (ix >= 0) { pieces.push(buckets[mv].splice(ix, 1)[0]); counts[mv] = (counts[mv] || 0) + 1; progressed = true; if (pieces.length >= HOME_BATCH) break; }
    }
    if (!progressed) break;
  }
  // Leftovers bank along the axis they overflowed: same-grouping pieces
  // go to their genre's locked column; other-grouping pieces go to that
  // grouping's home river, so switching the strip finds them waiting.
  const banked = {};
  const bankedHome = {};
  let bankedCount = 0, bankedHomeCount = 0;
  for (const mv of mvs) for (const p of buckets[mv]) {
    if (p.media === primary) (banked[mv] = banked[mv] || []).push(p);
    else (bankedHome[p.media] = bankedHome[p.media] || []).push(p);
  }
  for (const mv of Object.keys(banked)) { banked[mv] = banked[mv].slice(0, BANK_CAP); bankedCount += banked[mv].length; }
  for (const md of Object.keys(bankedHome)) { bankedHome[md] = bankedHome[md].slice(0, BANK_CAP); bankedHomeCount += bankedHome[md].length; }
  return { pieces, banked, bankedHome, cursor: st, done: st.q >= walk.length, stats: { examined, passed: pieces.length, claude, civCalls: calls, genres: mvs.length, charCapped, skipped, banked: bankedCount, bankedHome: bankedHomeCount, freshFiled, visionChecked, visionCulled } };
}

export async function fetchMoreBatch({ movement, media, cursor, exclude }, fetchFn, env) {
  const rawQueries = QUERIES[movement];
  if (!rawQueries) return { pieces: [], cursor: cursor || null, done: true };
  const seen = new Set(exclude || []);
  // Fresh sessions start at a random rotation of the genre's query pool and
  // walk shuffled model lists, so repeat visits do not retrace the same
  // head of the same galleries (the rotation rides in the cursor).
  const st = cursor && typeof cursor === "object" ? { q: 0, v: 0, c: null, m: null, rot: 0, ...cursor } : { q: 0, v: 0, c: null, m: null, rot: Math.floor(Math.random() * 1024) };
  const queries = walkList(movement, st.rot || 0);
  const ownCount = rawQueries.length;
  const pieces = [];
  const gate = env && env.ANTHROPIC_API_KEY ? (cands) => gatePieces(env, cands, fetchFn) : null;
  let calls = 0, examined = 0, gateWhy = "", metaPassed = 0, gateErrors = 0, cross = 0, classCulled = 0, visionCulled = 0;
  const banked = [];
  while (pieces.length < BATCH && calls < 5 && examined < 12) {
    if (st.q >= queries.length) return { pieces, cursor: st, done: true, stats: { examined, passed: pieces.length, gated: !!gate, civCalls: calls, gateWhy, metaPassed, gateErrors, cross, classCulled } };
    if (!st.m) {
      const qs = new URLSearchParams({ query: queries[st.q], limit: "6", sort: "Most Downloaded", nsfw: "false" });
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
    let cands = [];
    for (const item of page.items || []) {
      const p = toPiece(item, ver.n, movement, media);
      if (p && !seen.has(p.uuid)) { seen.add(p.uuid); cands.push(p); }
    }
    // Classification first (v51): the prompt files the piece. Target-
    // dominant metadata passes outright (cross-discovered pieces from a
    // neighbor gallery count as refiled); metadata that confidently names
    // a DIFFERENT genre culls without spending a vision call; everything
    // ambiguous goes to the vision gate (or flows, when no gate is set).
    {
      const fromNeighbor = !rawQueries.includes(queries[st.q]); // rotation shuffles the combined walk, so tag by query ownership, not index
      const strong = [], rest = [];
      for (const p of cands) {
        const scores = scoreAll(p, ver.n, ver.mt);
        const t = scores[movement] || 0;
        let bestOther = 0;
        for (const k in scores) if (k !== movement && scores[k] > bestOther) bestOther = scores[k];
        if (t >= 3 && t >= bestOther) { p.meta = true; strong.push(p); if (fromNeighbor) cross++; }
        else if (bestOther >= 4 && bestOther > t + 1) classCulled++;
        else rest.push(p);
      }
      metaPassed += strong.length;
      // The old per-movement vision gate is superseded by the v61 vision
      // verdict below: one call files the piece by its TRUE genre and
      // grouping instead of merely judging fit for the target folder.
      cands = strong.concat(rest);
    }
    // Vision-first filing (v61): kept candidates get one Claude vision
    // verdict each (capped per page) and the verdict RULES over the
    // metadata filing. Another genre -> banked under its true genre;
    // "none" or a quality failure leaves the column entirely. Infra
    // failures keep the metadata filing (fail-open).
    if (env && env.ANTHROPIC_API_KEY && cands.length) {
      const toVerify = cands.slice(0, 12);
      const verdicts = await visionClassifyBatch(env, toVerify, fetchFn);
      const verified = [];
      for (const p of toVerify) {
        const v = verdicts.get(p);
        if (!v || v.genre === null) { verified.push(p); continue; }
        if (v.ok === false || v.genre === "none") { visionCulled++; continue; }
        p.style = v.style; p.gated = true;
        if (v.genre !== movement) { p.movement = v.genre; p.media = v.media; banked.push(p); continue; }
        p.media = v.media;
        verified.push(p);
      }
      cands = verified.concat(cands.slice(12));
    }
    // Grouping split (v59): a kept piece joins THIS column only when its
    // classified grouping matches the one requested; the rest are banked
    // under their own grouping for the client to file into that column —
    // a character piece found while filling Architecture is filed as a
    // character piece, never stamped over.
    for (const p of cands) {
      const m = classifyMedia(p, ver.mt);
      if (m === media && pieces.length < BATCH) pieces.push(p);
      else { p.media = m; banked.push(p); }
    }
    st.c = (page.metadata && page.metadata.nextCursor) || null;
    if (!st.c) st.v++;
  }
  return { pieces, banked, cursor: st, done: st.q >= queries.length, stats: { examined, passed: pieces.length, gated: !!gate, civCalls: calls, gateWhy, metaPassed, gateErrors, cross, classCulled, mediaBanked: banked.length, visionCulled } };
}

export async function onRequestPost({ request, env }) {
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  if (!appAllowed(id, "inspobox")) return json({ error: "this account doesn't cover this app" }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
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

export async function onRequestGet() {
  return json({ error: "POST only" }, 405);
}
