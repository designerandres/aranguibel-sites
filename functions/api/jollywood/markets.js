import { appAllowed, json, requireIdentity } from "../../_lib/auth.js";

// Jollywood Fam 2026 prediction markets — the market list itself lives in D1
// so the admin can add new questions from the app's More tab. The four
// original markets seed on first use. predictions.js validates calls against
// these rows.
export const DEFAULT_MARKETS = [
  { id: "maingate-passes", q: "Will Andrés remember his maingate guest passes?", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] },
  { id: "early-festival-items", q: "Will anybody let us purchase festival items before 7:30pm?", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] },
  { id: "rain-this-year", q: "Will rain pour down on us this year?", options: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }] },
  { id: "how-long-will-we-last", q: "How long will we last?", options: [{ id: "11pm", label: "11pm" }, { id: "12am", label: "12am" }, { id: "1am", label: "1am" }] },
];

export async function ensureMarkets(db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS jollywood_markets (id TEXT PRIMARY KEY, question TEXT NOT NULL, options TEXT NOT NULL, created_by TEXT, created_at TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0)"
  ).run();
  const row = await db.prepare("SELECT COUNT(*) AS n FROM jollywood_markets").first();
  if (!row || !row.n) {
    for (let i = 0; i < DEFAULT_MARKETS.length; i++) {
      const m = DEFAULT_MARKETS[i];
      await db
        .prepare("INSERT OR IGNORE INTO jollywood_markets (id, question, options, created_by, created_at, sort) VALUES (?1, ?2, ?3, 'seed', ?4, ?5)")
        .bind(m.id, m.q, JSON.stringify(m.options), new Date().toISOString(), i)
        .run();
    }
  }
}

export async function listMarkets(db) {
  await ensureMarkets(db);
  const { results } = await db
    .prepare("SELECT id, question, options FROM jollywood_markets ORDER BY sort ASC, created_at ASC")
    .all();
  return (results || []).map((r) => {
    let options = [];
    try { options = JSON.parse(r.options); } catch { options = []; }
    return { id: r.id, q: r.question, options };
  });
}

function slugify(text, maxLen) {
  const base = String(text || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return (base || "market").slice(0, maxLen).replace(/-+$/g, "") || "market";
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  if (!appAllowed(id, "jollywood-fam-2026")) return json({ error: "this account doesn't cover this app" }, 403);
  if (id.role !== "admin") return json({ error: "only the admin can add markets" }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const question = body && typeof body.question === "string" ? body.question.trim() : "";
  if (question.length < 3 || question.length > 140) return json({ error: "question must be 3–140 characters" }, 400);
  const rawOptions = body && Array.isArray(body.options) ? body.options : [];
  const labels = rawOptions.map((o) => String(o && o.label != null ? o.label : o || "").trim()).filter((l) => l.length > 0);
  if (labels.length < 2 || labels.length > 5) return json({ error: "give the market 2–5 choices" }, 400);
  if (labels.some((l) => l.length > 24)) return json({ error: "choices must be 24 characters or fewer" }, 400);
  const seenLabels = new Set();
  for (const l of labels) {
    const k = l.toLowerCase();
    if (seenLabels.has(k)) return json({ error: "choices must be unique" }, 400);
    seenLabels.add(k);
  }
  const usedIds = new Set();
  const options = labels.map((label) => {
    let oid = slugify(label, 24);
    if (usedIds.has(oid)) { let n = 2; while (usedIds.has(`${oid}-${n}`)) n++; oid = `${oid}-${n}`; }
    usedIds.add(oid);
    return { id: oid, label };
  });
  await ensureMarkets(env.DB);
  const suffix = Math.random().toString(36).slice(2, 6);
  const marketId = `${slugify(question, 40)}-${suffix}`;
  const maxRow = await env.DB.prepare("SELECT MAX(sort) AS m FROM jollywood_markets").first();
  const sort = (maxRow && typeof maxRow.m === "number" ? maxRow.m : 0) + 1;
  await env.DB
    .prepare("INSERT INTO jollywood_markets (id, question, options, created_by, created_at, sort) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(marketId, question, JSON.stringify(options), id.email, new Date().toISOString(), sort)
    .run();
  return json({ ok: true, market: { id: marketId, q: question, options } });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  if (!appAllowed(id, "jollywood-fam-2026")) return json({ error: "this account doesn't cover this app" }, 403);
  if (id.role !== "admin") return json({ error: "only the admin can remove markets" }, 403);
  const url = new URL(request.url);
  let marketId = url.searchParams.get("id") || "";
  if (!marketId) {
    try { const body = await request.json(); marketId = body && typeof body.id === "string" ? body.id : ""; } catch { /* no body */ }
  }
  if (!marketId) return json({ error: "id required" }, 400);
  await ensureMarkets(env.DB);
  await env.DB.prepare("DELETE FROM jollywood_markets WHERE id = ?1").bind(marketId).run();
  try { await env.DB.prepare("DELETE FROM jollywood_predictions WHERE market_id = ?1").bind(marketId).run(); } catch { /* predictions table may not exist yet */ }
  return json({ ok: true });
}
