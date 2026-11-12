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
export function metaScore(piece, modelName) {
  const text = ((piece && piece.prompt) || "") + " " + (modelName || "") + " " + ((piece && piece.title) || "");
  const hay = text.toLowerCase();
  let score = 0;
  const genre = String(piece.movement || "").replace(/-/g, " ");
  if (genre && hay.includes(genre)) score += 3;
  for (const term of AFFINITY[piece.movement] || []) {
    if (hay.includes(term)) score += 1;
  }
  return score;
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

export async function fetchMoreBatch({ movement, media, cursor, exclude }, fetchFn, env) {
  const rawQueries = QUERIES[movement];
  if (!rawQueries) return { pieces: [], cursor: cursor || null, done: true };
  const seen = new Set(exclude || []);
  // Fresh sessions start at a random rotation of the genre's query pool and
  // walk shuffled model lists, so repeat visits do not retrace the same
  // head of the same galleries (the rotation rides in the cursor).
  const st = cursor && typeof cursor === "object" ? { q: 0, v: 0, c: null, m: null, rot: 0, ...cursor } : { q: 0, v: 0, c: null, m: null, rot: Math.floor(Math.random() * 1024) };
  const queries = rawQueries.map((_, i) => rawQueries[(i + (st.rot || 0)) % rawQueries.length]);
  const pieces = [];
  const gate = env && env.ANTHROPIC_API_KEY ? (cands) => gatePieces(env, cands, fetchFn) : null;
  let calls = 0, examined = 0, gateWhy = "", metaPassed = 0, gateErrors = 0;
  while (pieces.length < BATCH && calls < 5 && examined < 12) {
    if (st.q >= queries.length) return { pieces, cursor: st, done: true, stats: { examined, passed: pieces.length, gated: !!gate, civCalls: calls, gateWhy, metaPassed, gateErrors } };
    if (!st.m) {
      const qs = new URLSearchParams({ query: queries[st.q], limit: "6", sort: "Most Downloaded", nsfw: "false" });
      qs.append("types", "LORA"); qs.append("types", "Checkpoint");
      const models = await civGet(fetchFn, "/models?" + qs.toString()); calls++;
      st.m = (models.items || []).map((md) => ({ v: (md.modelVersions || [])[0] && md.modelVersions[0].id, n: md.name })).filter((x) => x.v);
      for (let i = st.m.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = st.m[i]; st.m[i] = st.m[j]; st.m[j] = t; }
      st.v = 0; st.c = null;
      if (!st.m.length) { st.q++; st.m = null; continue; }
    }
    if (st.v >= st.m.length) { st.q++; st.m = null; st.c = null; continue; }
    const ver = st.m[st.v];
    const qs = new URLSearchParams({ modelVersionId: String(ver.v), limit: "30", nsfw: "false", sort: "Most Reactions", period: st.v % 2 ? "Month" : "AllTime", withMeta: "true" });
    if (st.c) qs.set("cursor", st.c);
    const page = await civGet(fetchFn, "/images?" + qs.toString()); calls++;
    let cands = [];
    for (const item of page.items || []) {
      const p = toPiece(item, ver.n, movement, media);
      if (p && !seen.has(p.uuid)) { seen.add(p.uuid); cands.push(p); }
    }
    if (gate) {
      const strong = [], rest = [];
      for (const p of cands) { if (metaScore(p, ver.n) >= 3) { p.meta = true; strong.push(p); } else rest.push(p); }
      metaPassed += strong.length;
      const toGate = rest.slice(0, Math.max(0, 12 - examined));
      examined += toGate.length;
      const g = await gate(toGate);
      if (g.why && !gateWhy) gateWhy = g.why;
      gateErrors += g.errors || 0;
      cands = strong.concat(g.kept);
    }
    for (const p of cands) { pieces.push(p); if (pieces.length >= BATCH) break; }
    st.c = (page.metadata && page.metadata.nextCursor) || null;
    if (!st.c) st.v++;
  }
  return { pieces, cursor: st, done: st.q >= queries.length, stats: { examined, passed: pieces.length, gated: !!gate, civCalls: calls, gateWhy, metaPassed, gateErrors } };
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
