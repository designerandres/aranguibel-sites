// Shared helpers for the Cycles API (Phases 6–7).
// Auth model (Phase 7): identity comes from _lib/auth.js — our own passkey
// session cookie, or (during the transition) a verified Cloudflare Access JWT.
// Either way the API also stays closed on aranguibel-sites.pages.dev.
// No email addresses are stored in this (public) repo on purpose.

import { requireIdentity } from "./auth.js";

// Historical name kept for the route files: returns the caller's email or null.
export async function requireAccessUser(env, request) {
  const identity = await requireIdentity(env, request);
  return identity ? identity.email : null;
}

export { json } from "./auth.js";

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
