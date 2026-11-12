import { appAllowed, json, requireIdentity } from "../../_lib/auth.js";

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
    if (!res.ok) throw new Error("civitai " + res.status);
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

// One batch of live pieces. `cursor` is the opaque state from the previous
// response ({q, v, c, m}); `exclude` is a list of image uuids the client
// already has (curated + this session). Pure w.r.t. fetchFn for testability.
export async function fetchMoreBatch({ movement, media, cursor, exclude }, fetchFn) {
  const queries = QUERIES[movement];
  if (!queries) return { pieces: [], cursor: cursor || null, done: true };
  const seen = new Set(exclude || []);
  const st = cursor && typeof cursor === "object" ? { q: 0, v: 0, c: null, m: null, ...cursor } : { q: 0, v: 0, c: null, m: null };
  const pieces = [];
  let calls = 0;
  while (pieces.length < BATCH && calls < 4) {
    if (st.q >= queries.length) return { pieces, cursor: st, done: true };
    if (!st.m) {
      const qs = new URLSearchParams({ query: queries[st.q], limit: "6", sort: "Most Downloaded", nsfw: "false" });
      qs.append("types", "LORA"); qs.append("types", "Checkpoint");
      const models = await civGet(fetchFn, "/models?" + qs.toString()); calls++;
      st.m = (models.items || []).map((md) => ({ v: (md.modelVersions || [])[0] && md.modelVersions[0].id, n: md.name })).filter((x) => x.v);
      st.v = 0; st.c = null;
      if (!st.m.length) { st.q++; st.m = null; continue; }
    }
    if (st.v >= st.m.length) { st.q++; st.m = null; st.c = null; continue; }
    const ver = st.m[st.v];
    const qs = new URLSearchParams({ modelVersionId: String(ver.v), limit: "30", nsfw: "false", sort: "Most Reactions", period: "AllTime", withMeta: "true" });
    if (st.c) qs.set("cursor", st.c);
    const page = await civGet(fetchFn, "/images?" + qs.toString()); calls++;
    for (const item of page.items || []) {
      const p = toPiece(item, ver.n, movement, media);
      if (p && !seen.has(p.uuid)) { seen.add(p.uuid); pieces.push(p); if (pieces.length >= BATCH) break; }
    }
    st.c = (page.metadata && page.metadata.nextCursor) || null;
    if (!st.c) st.v++;
  }
  return { pieces, cursor: st, done: st.q >= queries.length };
}

export async function onRequestPost({ request, env }) {
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  if (!appAllowed(id, "inspobox")) return json({ error: "this account doesn't cover this app" }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
  try {
    const out = await fetchMoreBatch({
      movement: String(body.movement || ""),
      media: String(body.media || "design"),
      cursor: body.cursor || null,
      exclude: Array.isArray(body.exclude) ? body.exclude.slice(0, 600).map(String) : [],
    }, fetch);
    return json({ ok: true, ...out });
  } catch (e) {
    if (e && e.code === 429) return json({ ok: false, error: "rate_limited" }, 429);
    return json({ ok: false, error: String(e && e.message || e) }, 502);
  }
}

export async function onRequestGet() {
  return json({ error: "POST only" }, 405);
}
