import { appAllowed, json, requireIdentity } from "../../_lib/auth.js";
import { ATOMS, DISNEY } from "../../_lib/inspobox-data.js";

// INSPOBOX dynamic Idea Starter — the typed seed line is genuinely read by
// Claude and woven into the grounded IP world. The API key lives only in
// the ANTHROPIC_API_KEY Pages secret; without it this endpoint answers
// 503 and the app silently falls back to its authored banks.
const ASPECTS = ["VERTICAL 9:16", "WIDE 16:9", "SQUARE 1:1"];
const CROSS = /\b(mashup|mash-up|crossover|cross-over|meets|versus|vs)\b/i;

const SYSTEM = `You write concept cards for INSPOBOX's Idea Starter. Each concept is a 10-second video set entirely inside one Disney IP world (or exactly two, for a mashup). The hero is always a newcomer to that world — the person using this concept will feed their own reference photo into a video tool — so the hero is called only "the newcomer": never give them a name, age, gender, or appearance. Named characters from the world may appear as encounters, never as the hero.

You are given the world pack (setting, characters, places, signature prop, example beats in the house voice), a visual style, a genre movement's dressing and light (or none, when you are told to keep the world's native look), and possibly the user's own seed line. If a seed line is present, genuinely use it: lift its concrete images, actions, objects and mood into this world's terms. If it is empty, invent freely within the world.

Write three beats: OPEN (0-3s) a hook in motion; PIVOT (3-7s) a turn or reveal; FINAL (7-10s) a held, poster-worthy closing frame. Present tense, vivid, specific. Each beat at most 200 characters. Choose the role and the look VERBATIM from the pack's lists. Choose the place from the pack's places, or invent a new place clearly inside this world. Title: "THE " plus one to three evocative words, ideally drawn from the world's nouns.

Reply with ONLY a JSON object, no markdown, no commentary:
{"title":"THE ...","role":"...","look":"...","place":"...","open":"...","pivot":"...","final":"...","aspect":"VERTICAL 9:16"} where aspect is one of "VERTICAL 9:16", "WIDE 16:9", "SQUARE 1:1".`;

export function findNamedIPs(text) {
  const t = " " + (text || "").toLowerCase() + " ";
  const hits = [];
  for (const st of DISNEY.studios) for (const ip of DISNEY.packs[st.id]) {
    if (ip.keys.some((k) => t.includes(k))) hits.push({ studio: st, ip });
  }
  return hits;
}

const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Grounding rules (v28): a single named IP wins outright; two named IPs
// mash up; a mashup keyword with one named IP crosses it with a random
// pick from the chosen studio; keyword alone crosses two random IPs.
export function pickGrounding({ prompt, studioId }) {
  const studio = DISNEY.studios.find((s) => s.id === studioId) || DISNEY.studios[0];
  const pack = DISNEY.packs[studio.id];
  const named = findNamedIPs(prompt);
  const wantsCross = named.length >= 2 || CROSS.test(prompt || "");
  let ipA = null, ipB = null;
  if (named.length >= 2) { ipA = named[0].ip; ipB = named[1].ip; }
  else if (named.length === 1 && !wantsCross) ipA = named[0].ip;
  else if (wantsCross && named.length === 1) {
    ipA = rnd(pack);
    if (named[0].ip === ipA) { const others = DISNEY.studios.filter((s) => s.id !== studio.id); ipB = rnd(DISNEY.packs[rnd(others).id]); }
    else ipB = named[0].ip;
  } else if (wantsCross) {
    ipA = rnd(pack);
    const others = DISNEY.studios.filter((s) => s.id !== studio.id);
    ipB = rnd(DISNEY.packs[rnd(others).id]);
  } else {
    // No pack matched. If the seed explicitly declares a world ("in the
    // world of Pixar's Luca"), honor the declaration with a free world
    // instead of silently substituting a random one.
    const dw = declaredWorld(prompt);
    if (dw) {
      const st2 = DISNEY.studios.find((s) => dw.studioWord && s.name.toLowerCase().startsWith(dw.studioWord)) || (dw.studioWord === 'disney' ? DISNEY.studios[0] : studio);
      return { studio: st2, ipA: { name: dw.name, free: true, keys: [], world: "", chars: [], places: [], prop: "", opens: [], pivots: [], finals: [], nouns: [], roles: [], looks: [] }, ipB: null };
    }
    ipA = rnd(pack);
  }
  return { studio, ipA, ipB };
}

// Extract an explicitly declared world from a seed line, or null when the
// declaration actually names a packed world (the normal path owns those).
function declaredWorld(prompt) {
  const m = String(prompt || "").match(/(?:in\s+)?the\s+world\s+of\s+(?:([a-z]+)['’]s\s+)?([^\n,.;]{2,44})/i);
  if (!m) return null;
  const name = m[2].trim().replace(/\s+(when|where|in which)\b.*$/i, "").trim();
  if (!name) return null;
  const norm = " " + name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ") + " ";
  for (const st of DISNEY.studios) for (const p of DISNEY.packs[st.id]) {
    const pn = " " + p.name.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim() + " ";
    if (norm.includes(pn) || p.keys.some((k) => norm.includes(" " + k + " ") || norm.includes(k))) return null;
  }
  return { name: name.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1)), studioWord: (m[1] || "").toLowerCase() };
}

export function buildMessages({ prompt, styleId, movementId, studioId, reroll }) {
  const style = ATOMS.styles.find((s) => s.id === styleId) || ATOMS.styles[0];
  const noMove = movementId === "none";
  const move = noMove ? null : (ATOMS.moves[movementId] || ATOMS.moves.surreal);
  const moveName = noMove ? "none" : (movementId || "surreal").replace(/-/g, " ");
  const g = pickGrounding({ prompt, studioId });
  const packBlock = (label, p) => [
    `${label}: ${p.name}`,
    `World: ${p.world}`,
    `Characters (encounters only): ${p.chars.join("; ")}`,
    `Places: ${p.places.join("; ")}`,
    `Signature prop: ${p.prop}`,
    `Nouns for the title: ${p.nouns.join(", ")}`,
    `Roles (pick one verbatim): ${p.roles.join(" | ")}`,
    `Looks (pick one verbatim): ${p.looks.join(" | ")}`,
    `House voice — example beats: OPEN "${p.opens[0]}" / PIVOT "${p.pivots[0]}" / FINAL "${p.finals[0]}" (the hero token in the examples stands for "the newcomer")`,
  ].join("\n");
  const lines = [
    `Visual style: ${style.name} — ${style.look}`,
    noMove ? "Movement: none — do not dress the world in any genre movement; keep the world's own native look and light." : `Movement: ${moveName} — dress the world in ${move.dress}; light: ${move.light}`,
    `Studio: ${g.studio.name}`,
  ];
  if (g.ipA.free) lines.push(`IP: ${g.ipA.name} — this world has NO curated pack. Build the concept entirely inside ${g.ipA.name}, from your own knowledge of that world: invent a role, a look and a place that belong unmistakably to it, with the same specificity a pack would give. The hero is still only "the newcomer"; named characters may appear only as encounters.`);
  else lines.push(packBlock("IP pack", g.ipA));
  if (g.ipB) lines.push(packBlock("MASHUP — second IP pack (the two worlds collide; the pivot is where they meet)", g.ipB));
  lines.push(prompt ? `The user's seed line (use it): "${prompt}"` : "Seed line: none — invent freely within the world.");
  if (reroll > 0) lines.push(`This is take ${reroll + 1} — make it distinctly different from the obvious take.`);
  return { system: SYSTEM, user: lines.join("\n"), grounding: g };
}

const cap = (s, n) => (typeof s === "string" ? s.trim().slice(0, n) : "");

function extractJsonSpan(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; }
    else if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { if (--depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

export function parseConceptDetailed(text, grounding) {
  if (!text) return { concept: null, why: "empty response" };
  const span = extractJsonSpan(text);
  if (!span) return { concept: null, why: "no complete JSON object in " + text.length + " chars (truncated?)" };
  let o;
  try { o = JSON.parse(span); } catch { return { concept: null, why: "JSON would not parse" }; }
  const { ipA } = grounding;
  let title = cap(o.title, 70).toUpperCase();
  if (!title) return { concept: null, why: "missing title" };
  if (!title.startsWith("THE ")) title = "THE " + title;
  let role, look;
  if (ipA.free) {
    role = cap(o.role, 140); look = cap(o.look, 260);
    if (!role) return { concept: null, why: "missing role" };
    if (!look) return { concept: null, why: "missing look" };
  } else {
    role = ipA.roles.includes(o.role) ? o.role : ipA.roles[0];
    look = ipA.looks.includes(o.look) ? o.look : ipA.looks[0];
  }
  const place = cap(o.place, 120), open = cap(o.open, 240), pivot = cap(o.pivot, 240), final = cap(o.final, 240);
  for (const [k, v] of [["place", place], ["open", open], ["pivot", pivot], ["final", final]]) if (!v) return { concept: null, why: "missing " + k };
  const aspect = ASPECTS.includes(o.aspect) ? o.aspect : ASPECTS[0];
  return { concept: { title, role, look, place, open, pivot, final, aspect, ip: ipA.name, ip2: grounding.ipB ? grounding.ipB.name : null, mashup: !!grounding.ipB, studio: grounding.studio.name }, why: "" };
}

export function parseConceptText(text, grounding) { return parseConceptDetailed(text, grounding).concept; }

export async function callAnthropic(env, built) {
  // Haiku first: this is a small structured-JSON task and latency is the
  // whole game — a slow first attempt used to eat the entire budget and the
  // edge dropped the connection before any answer came back (seen live on
  // 2026-11-12 as client-side "Load failed" / bare HTTP 502 fallbacks).
  // Total budget 26s so the function always answers with real JSON.
  const models = [...new Set([env.ANTHROPIC_MODEL, "claude-haiku-5-5", "claude-sonnet-5-5"].filter(Boolean))];
  const deadline = Date.now() + 26000;
  let lastErr = "no models";
  const attemptOrder = models.flatMap((m) => [m, m]);
  for (const model of attemptOrder) {
    const remain = deadline - Date.now();
    if (remain < 4000) break;
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), Math.min(15000, remain));
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: ctl.signal,
        headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 2048, system: built.system, messages: [{ role: "user", content: built.user }] }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        lastErr = model + ": " + ((data && data.error && (data.error.type + ": " + data.error.message)) || ("http " + res.status));
        if (res.status === 401 || res.status === 403) throw new Error(lastErr); // a bad key fails every model — say so fast
        continue; // 404 / 429 / 5xx — try the next model while budget remains
      }
      const blocks = data.content || [];
      const textPool = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
      const thinkPool = blocks.filter((b) => b.type === "thinking").map((b) => b.thinking || "").join("");
      const d1 = parseConceptDetailed(textPool, built.grounding);
      const det = d1.concept ? d1 : (thinkPool ? parseConceptDetailed(thinkPool, built.grounding) : d1);
      if (det.concept) return det.concept;
      const snip = (textPool || thinkPool).slice(0, 60).replace(/\s+/g, " ");
      lastErr = model + ": unparseable concept (" + det.why + ")" + (snip ? ": " + snip : "");
      continue; // a parse failure is worth one retry of the SAME model (fresh variance) before falling through
    } catch (e) {
      if (e && /: (authentication_error|permission_error)/.test(e.message || "")) throw e;
      lastErr = model + ": " + (e && e.name === "AbortError" ? "timed out" : String(e && e.message || e));
      // timeouts and network errors fall through to the next model
    } finally { clearTimeout(to); }
  }
  throw new Error(lastErr);
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  if (!appAllowed(id, "inspobox")) return json({ error: "this account doesn't cover this app" }, 403);
  if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "no_key" }, 503);
  let body = {};
  try { body = await request.json(); } catch { /* empty body is fine */ }
  const built = buildMessages({
    prompt: cap(body.prompt, 500),
    styleId: body.styleId, movementId: body.movementId, studioId: body.studioId,
    reroll: Math.max(0, Math.min(50, body.reroll | 0)),
  });
  // Stream the answer (NDJSON): a heartbeat line lands immediately and
  // repeats every 4s while Claude thinks, so no proxy, edge, or cellular
  // NAT along the path sees an idle connection to drop — the failure mode
  // behind the silent edge 502s of 2026-11-12. The result (or the error)
  // is the final line.
  const enc = new TextEncoder();
  let timer = null;
  const stream = new ReadableStream({
    async start(ctl) {
      const beat = () => { try { ctl.enqueue(enc.encode(JSON.stringify({ wait: true }) + "\n")); } catch {} };
      beat();
      timer = setInterval(beat, 4000);
      try {
        const concept = await callAnthropic(env, built);
        clearInterval(timer);
        ctl.enqueue(enc.encode(JSON.stringify({ ok: true, concept }) + "\n"));
      } catch (e) {
        clearInterval(timer);
        ctl.enqueue(enc.encode(JSON.stringify({ ok: false, error: String(e && e.message || e) }) + "\n"));
      }
      ctl.close();
    },
    cancel() { clearInterval(timer); },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" } });
}

export async function onRequestGet() {
  return json({ error: "POST only" }, 405);
}
