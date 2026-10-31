import { randomB64url, sha256Hex } from "./auth.js";

// Poppy's Picks households: favorites belong to a household, and each
// account belongs to exactly one. Andres & Sarah's existing list became
// household #1 at migration; every other account starts with its own.
export const FOUNDER_HOUSEHOLD = "aranguibel-fam";

export function displayName(identity) {
  const raw = String(identity.name || identity.email || "").toLowerCase();
  if (raw.includes("sarah")) return "Sarah";
  if (raw.includes("dimitri") || raw.includes("andres") || raw.includes("aran")) return "Andres";
  const base = raw.split("@")[0].replace(/[^a-z]/g, " ").trim().split(" ")[0];
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "Family";
}

export async function ensureHouseholdSchema(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS poppy_households (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, join_hash TEXT)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS poppy_household_members (email TEXT PRIMARY KEY, household_id TEXT NOT NULL, joined_at TEXT NOT NULL)").run();
  // favorites gain a household and a composite key (needs a table rebuild once)
  const cols = await db.prepare("PRAGMA table_info(poppy_favorites)").all();
  const names = (cols.results || []).map((r) => r.name);
  if (names.length && !names.includes("household_id")) {
    await db.prepare("CREATE TABLE IF NOT EXISTS poppy_favorites_v2 (household_id TEXT NOT NULL, event_id TEXT NOT NULL, by_email TEXT NOT NULL, by_name TEXT, created_at TEXT NOT NULL, PRIMARY KEY (household_id, event_id))").run();
    await db.prepare("INSERT OR IGNORE INTO poppy_favorites_v2 (household_id, event_id, by_email, by_name, created_at) SELECT ?1, event_id, by_email, by_name, created_at FROM poppy_favorites")
      .bind(FOUNDER_HOUSEHOLD).run();
    await db.prepare("DROP TABLE poppy_favorites").run();
    await db.prepare("ALTER TABLE poppy_favorites_v2 RENAME TO poppy_favorites").run();
  } else if (!names.length) {
    await db.prepare("CREATE TABLE IF NOT EXISTS poppy_favorites (household_id TEXT NOT NULL, event_id TEXT NOT NULL, by_email TEXT NOT NULL, by_name TEXT, created_at TEXT NOT NULL, PRIMARY KEY (household_id, event_id))").run();
  }
  await db.prepare("INSERT OR IGNORE INTO poppy_households (id, name, created_by, created_at) VALUES (?1, 'The Aranguibel Fam', 'andres', ?2)")
    .bind(FOUNDER_HOUSEHOLD, new Date().toISOString()).run();
}

// Which household does this account belong to? Creates/migrates as needed:
// a pending invite-carried household wins, the founding pair land in #1,
// everyone else gets a personal household named "{Name}'s Family".
export async function householdFor(env, identity) {
  const db = env.DB;
  await ensureHouseholdSchema(db);
  const email = identity.email.toLowerCase();
  const member = await db.prepare("SELECT household_id FROM poppy_household_members WHERE email = ?1").bind(email).first();
  if (member) return member.household_id;
  let target = null;
  const user = await db.prepare("SELECT poppy_join FROM users WHERE id = ?1").bind(identity.userId).first().catch(() => null);
  if (user && user.poppy_join) {
    const hh = await db.prepare("SELECT id FROM poppy_households WHERE id = ?1").bind(user.poppy_join).first();
    if (hh) target = hh.id;
    await db.prepare("UPDATE users SET poppy_join = NULL WHERE id = ?1").bind(identity.userId).run();
  }
  const nm = displayName(identity);
  if (!target && (nm === "Andres" || nm === "Sarah")) target = FOUNDER_HOUSEHOLD;
  if (!target) {
    target = "hh-" + randomB64url(9).toLowerCase();
    await db.prepare("INSERT INTO poppy_households (id, name, created_by, created_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(target, nm + "'s Family", email, new Date().toISOString()).run();
  }
  await db.prepare("INSERT OR IGNORE INTO poppy_household_members (email, household_id, joined_at) VALUES (?1, ?2, ?3)")
    .bind(email, target, new Date().toISOString()).run();
  return target;
}

export async function householdInfo(env, householdId) {
  const db = env.DB;
  const hh = await db.prepare("SELECT id, name FROM poppy_households WHERE id = ?1").bind(householdId).first();
  if (!hh) return null;
  const { results } = await db.prepare("SELECT email, joined_at FROM poppy_household_members WHERE household_id = ?1 ORDER BY joined_at ASC").bind(householdId).all();
  return { id: hh.id, name: hh.name, members: results || [] };
}

export async function householdByJoinCode(env, code) {
  if (!code || typeof code !== "string" || code.length > 80) return null;
  const hash = await sha256Hex(code.trim());
  return env.DB.prepare("SELECT id, name FROM poppy_households WHERE join_hash = ?1").bind(hash).first();
}
