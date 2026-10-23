// Shared helpers for the Cycles API (Phase 6).
// Auth model: Cloudflare Access already gates sites.aranguibel.com, and Access only
// issues a JWT to users who pass the Household policy. Each Function additionally
// verifies that JWT (RS256 against the team certs, audience + expiry) so the API
// also stays closed on aranguibel-sites.pages.dev, where no Access app exists.
// No email addresses are stored in this (public) repo on purpose.

const TEAM_DOMAIN = "https://proud-pond-ecf3.cloudflareaccess.com";
const ACCESS_AUD = "b1ce97501af24a60af32ffa0ded77272107a3f9835ac873f5a84e26c9edb60ef";

let jwksCache = { at: 0, keys: [] };
async function getKeys() {
  if (Date.now() - jwksCache.at < 3600e3 && jwksCache.keys.length) return jwksCache.keys;
  const r = await fetch(TEAM_DOMAIN + "/cdn-cgi/access/certs");
  if (!r.ok) throw new Error("certs fetch failed");
  const j = await r.json();
  jwksCache = { at: Date.now(), keys: j.keys || [] };
  return jwksCache.keys;
}
const b64uToBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const b64uToJson = (s) => JSON.parse(new TextDecoder().decode(b64uToBytes(s)));

export async function requireAccessUser(request) {
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt) return null;
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  let header, payload;
  try { header = b64uToJson(parts[0]); payload = b64uToJson(parts[1]); } catch (e) { return null; }
  const keys = await getKeys();
  const jwk = keys.find((k) => k.kid === header.kid) || keys[0];
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64uToBytes(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!ok) return null;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(ACCESS_AUD)) return null;
  if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
  if (!payload.email) return null;
  return payload.email;
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

// Seed = the 12 cycles with completion state as last synced by Mumu (Oct 22, 2026,
// plus Trash's Oct 23 round). INSERT OR IGNORE: only fills an empty database.
const SEED = [
  ["cat-litter","Clean Cat Litter","days",2,null,null,null,"litter",0,"2026-10-22",null],
  ["ac-filter","Change AC Filter","months",2,null,null,null,"filter",1,"2026-10-21",null],
  ["robinhood","Pay Robinhood Card","monthlyDay",null,8,null,null,"card",2,null,"2026-10-08"],
  ["chase","Pay Chase Card","monthlyDay",null,27,null,null,"card",3,null,null],
  ["kia-oil","Change Kia Oil","months",2,null,null,null,"oil",0,"2026-10-21",null],
  ["camry-oil","Change Camry Oil","months",4,null,null,null,"oil",1,"2026-10-21",null],
  ["recycling","Take Out Recycling","weeklyDay",null,null,4,"7 AM","recycle",2,null,null],
  ["trash","Take Out Trash","weeklyDay",null,null,5,"7 AM","trash",3,null,"2026-10-23"],
  ["grocery-order","Grocery Order","weeklyDay",null,null,0,"7 PM","cart",2,null,null],
  ["shopvac-ac","ShopVac the AC","monthsWeekday",2,null,6,null,"wind",0,null,null],
  ["phoenix-water","Add Phoenix Water","days",7,null,null,null,"dot",2,"2026-10-22",null],
  ["phoenix-food","Check Phoenix Food","days",15,null,null,null,"dot",3,"2026-10-22",null]
];

export async function ensureSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS cycles (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL,
      every INTEGER, day INTEGER, weekday INTEGER, at TEXT,
      glyph TEXT, grad INTEGER, sort INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      last_done TEXT, done_through TEXT,
      updated_at TEXT, updated_by TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, cycle_id TEXT NOT NULL,
      action TEXT NOT NULL, occurred_date TEXT, actor TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    ...SEED.map((row, i) => db.prepare(
      `INSERT OR IGNORE INTO cycles (id,name,type,every,day,weekday,at,glyph,grad,sort,last_done,done_through,updated_at,updated_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),'seed')`).bind(...row.slice(0, 9), i, row[9], row[10]))
  ]);
}

export function rowToCycle(r) {
  return {
    id: r.id, name: r.name, type: r.type,
    every: r.every ?? undefined, day: r.day ?? undefined, weekday: r.weekday ?? undefined,
    at: r.at ?? undefined, glyph: r.glyph || "dot", grad: r.grad ?? 0,
    lastDone: r.last_done || null, doneThrough: r.done_through || null,
    custom: !SEED.some((s) => s[0] === r.id)
  };
}

export async function listCycles(db) {
  const { results } = await db.prepare(
    "SELECT * FROM cycles WHERE archived = 0 ORDER BY sort, name").all();
  return results.map(rowToCycle);
}

export async function upsertCycle(db, c, actor) {
  await db.prepare(
    `INSERT INTO cycles (id,name,type,every,day,weekday,at,glyph,grad,sort,archived,last_done,done_through,updated_at,updated_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,datetime('now'),?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, type=excluded.type, every=excluded.every,
       day=excluded.day, weekday=excluded.weekday, at=excluded.at, glyph=excluded.glyph,
       grad=excluded.grad, last_done=excluded.last_done, done_through=excluded.done_through,
       archived=0, updated_at=datetime('now'), updated_by=excluded.updated_by`
  ).bind(c.id, c.name, c.type, c.every ?? null, c.day ?? null, c.weekday ?? null, c.at ?? null,
         c.glyph || "dot", c.grad ?? 0, c.sort ?? 99, c.lastDone ?? null, c.doneThrough ?? null, actor).run();
}
