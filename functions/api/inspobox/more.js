import { appAllowed, json, requireIdentity } from "../../_lib/auth.js";
import { QUALITY_BAR, RUBRIC } from "../../_lib/inspobox-rubric.js";

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

export function gatePrompt(movement) {
  return `You are the genre-fit gate for INSPOBOX, a design-inspiration app. Decide whether this image belongs in the "${movement}" feed.\n\n${RUBRIC[movement] || ""}\n\n${QUALITY_BAR}\n\nReply with ONLY this JSON: {"fits": true} or {"fits": false}. fits=true requires the genre's core idea AND at least two of its hallmarks, clearly present, plus the quality bar. When in doubt, answer false — a missing image is cheap; a wrong-genre image breaks the feed's promise.`;
}

// One vision verdict. Fails CLOSED: any error, timeout, or unparseable
// reply culls the piece (the standing bar: rather lose a pretty image
// than let a category lie).
function b64(buf) {
  let out = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

export async function gateOne(env, piece, fetchFn) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 12000);
  try {
    const imgUrl = String(piece.img).replace("/width=1200/", "/width=640/");
    const imgRes = await fetchFn(imgUrl, { signal: ctl.signal, headers: { "user-agent": "INSPOBOX live feed" } });
    if (!imgRes.ok) return false;
    const mt = (imgRes.headers && imgRes.headers.get && imgRes.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    const mediaType = ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(mt) ? mt : "image/jpeg";
    const imgData = b64(await imgRes.arrayBuffer());
    const res = await fetchFn("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctl.signal,
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-5-5",
        max_tokens: 40,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imgData } },
          { type: "text", text: gatePrompt(piece.movement) },
        ] }],
      }),
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    const text = ((data && data.content) || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return false;
    return JSON.parse(m[0]).fits === true;
  } catch { return false; } finally { clearTimeout(to); }
}

// Gate a list of candidates in parallel waves of 9 (keeps burst rate sane).
export async function gatePieces(env, candidates, fetchFn) {
  const kept = [];
  for (let i = 0; i < candidates.length; i += 9) {
    const wave = candidates.slice(i, i + 6);
    const verdicts = await Promise.all(wave.map((p) => gateOne(env, p, fetchFn)));
    wave.forEach((p, j) => { if (verdicts[j]) { p.gated = true; kept.push(p); } });
  }
  return kept;
}

// One batch of live pieces. `cursor` is the opaque state from the previous
// response ({q, v, c, m}); `exclude` is a list of image uuids the client
// already has (curated + this session). Pure w.r.t. fetchFn for testability.
// When `env.ANTHROPIC_API_KEY` is present, candidates pass the Claude
// genre-fit gate before they can be returned; without a key the batch is
// served ungated (mechanical filters only).
export async function fetchMoreBatch({ movement, media, cursor, exclude }, fetchFn, env) {
  const queries = QUERIES[movement];
  if (!queries) return { pieces: [], cursor: cursor || null, done: true };
  const seen = new Set(exclude || []);
  const st = cursor && typeof cursor === "object" ? { q: 0, v: 0, c: null, m: null, ...cursor } : { q: 0, v: 0, c: null, m: null };
  const pieces = [];
  const gate = env && env.ANTHROPIC_API_KEY ? (cands) => gatePieces(env, cands, fetchFn) : null;
  let calls = 0, examined = 0;
  while (pieces.length < BATCH && calls < 5 && examined < 12) {
    if (st.q >= queries.length) return { pieces, cursor: st, done: true, stats: { examined, passed: pieces.length, gated: !!gate, civCalls: calls } };
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
    let cands = [];
    for (const item of page.items || []) {
      const p = toPiece(item, ver.n, movement, media);
      if (p && !seen.has(p.uuid)) { seen.add(p.uuid); cands.push(p); }
    }
    if (gate) {
      cands = cands.slice(0, Math.max(0, 12 - examined));
      examined += cands.length;
      cands = await gate(cands);
    }
    for (const p of cands) { pieces.push(p); if (pieces.length >= BATCH) break; }
    st.c = (page.metadata && page.metadata.nextCursor) || null;
    if (!st.c) st.v++;
  }
  return { pieces, cursor: st, done: st.q >= queries.length, stats: { examined, passed: pieces.length, gated: !!gate, civCalls: calls } };
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
