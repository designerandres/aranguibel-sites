import { appAllowed, json, requireIdentity } from "../../_lib/auth.js";

// Jollywood Fam 2026 prediction markets — each signed-in person calls each
// market Yes or No. Calls can be flipped; created_at keeps the first-cast
// time so the odds graph steps in the order the fam first weighed in.
const MARKET_OPTIONS = {
  "maingate-passes": ["yes", "no"],
  "early-festival-items": ["yes", "no"],
  "rain-this-year": ["yes", "no"],
  "how-long-will-we-last": ["11pm", "12am", "1am"],
};

async function ensureSchema(db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS jollywood_predictions (market_id TEXT NOT NULL, voter_email TEXT NOT NULL, voter_name TEXT, choice TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (market_id, voter_email))"
  ).run();
}

function displayName(identity) {
  const raw = String(identity.name || identity.email || "").toLowerCase();
  if (raw.includes("sarah")) return "Sarah";
  if (raw.includes("dimitri") || raw.includes("andres") || raw.includes("aran")) return "Andres";
  const base = raw.split("@")[0].replace(/[^a-z]/g, " ").trim().split(" ")[0];
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "Fam";
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  if (!appAllowed(id, "jollywood-fam-2026")) return json({ error: "this account doesn't cover this app" }, 403);
  await ensureSchema(env.DB);
  const { results } = await env.DB
    .prepare("SELECT market_id, voter_email, voter_name, choice, created_at FROM jollywood_predictions ORDER BY created_at ASC")
    .all();
  const predictions = (results || []).map((r) => ({
    marketId: r.market_id,
    by: r.voter_name || "Fam",
    mine: r.voter_email.toLowerCase() === id.email.toLowerCase(),
    choice: r.choice,
    at: r.created_at,
  }));
  return json({ predictions, me: displayName(id) });
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return json({ error: "not signed in" }, 401);
  if (!appAllowed(id, "jollywood-fam-2026")) return json({ error: "this account doesn't cover this app" }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: "bad json" }, 400); }
  const marketId = body && typeof body.marketId === "string" ? body.marketId.trim() : "";
  if (!Object.prototype.hasOwnProperty.call(MARKET_OPTIONS, marketId)) return json({ error: "unknown market" }, 400);
  const choice = body && typeof body.choice === "string" ? body.choice : "";
  if (!MARKET_OPTIONS[marketId].includes(choice)) return json({ error: "choice is not an option in this market" }, 400);
  await ensureSchema(env.DB);
  const now = new Date().toISOString();
  await env.DB
    .prepare("INSERT INTO jollywood_predictions (market_id, voter_email, voter_name, choice, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5) ON CONFLICT(market_id, voter_email) DO UPDATE SET choice = excluded.choice, voter_name = excluded.voter_name, updated_at = excluded.updated_at")
    .bind(marketId, id.email, displayName(id), choice, now)
    .run();
  return json({ ok: true });
}
