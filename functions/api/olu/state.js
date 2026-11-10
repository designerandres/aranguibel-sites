import { appAllowed, json, requireIdentity } from "../../_lib/auth.js";

// Our Little Universe — the couples check-in. Dynamic data (prompts and
// answers) lives in D1 and is served only to signed-in accounts whose scope
// covers this app. Ported from Sarah's Muse Space ("Our Check-In"):
// prompts arrive every other day at varied morning times (his early, hers
// later), answers stay sealed until both partners have answered.

const SLUG = "our-little-universe";
const TZ = "America/New_York";

// The 49-prompt pool, in rotation order (seq % 49). Same pool as the Space.
const POOL = [{"theme":"Silly Memory","mood":"silly","text":"What's a moment with your partner that still makes you laugh out loud when it pops into your head — the more ridiculous, the better?"},{"theme":"Thoughtful","mood":"thoughtful","text":"When have you felt most proud of your partner recently — not for something big necessarily, just something that made you think, 'that's who I married'?"},{"theme":"Little Things","mood":"silly","text":"What's a tiny thing your partner does — a face, a phrase, a habit — that always gets you, even when you're trying very hard to be annoyed?"},{"theme":"Gratitude","mood":"thoughtful","text":"What's something your partner has quietly carried for your family lately that might have gone unthanked? Thank them here, specifically."},{"theme":"Us Then & Now","mood":"silly","text":"Think back to your early days together: what's something you two used to do all the time that would be absolutely unhinged to attempt now, with a kid and adult schedules?"},{"theme":"Future Us","mood":"thoughtful","text":"Picture an ordinary Saturday twenty years from now. What's one small part of your life together today that you hope is still exactly the same?"},{"theme":"Silly Memory","mood":"silly","text":"If your partner had to compete in a talent show tonight with a skill they actually have, what would their act be — and would they win?"},{"theme":"Thoughtful","mood":"thoughtful","text":"What's something your partner understands about you that almost nobody else does — maybe not even you, until they showed you?"},{"theme":"Little Things","mood":"silly","text":"What's your partner's most predictable move? The thing you could set your watch by — and secretly find kind of adorable?"},{"theme":"Gratitude","mood":"thoughtful","text":"Describe a hard season you two got through together. What did your partner do in the middle of it that you've never forgotten?"},{"theme":"Us Then & Now","mood":"silly","text":"What's a song, meal, or place that instantly teleports you both back to a specific era of your relationship? Set the scene."},{"theme":"Future Us","mood":"thoughtful","text":"What's something you want to learn, try, or get back to together — just the two of you — in the next year or so?"},{"theme":"Silly Memory","mood":"silly","text":"Tell the story of your partner's most legendary fail in the kitchen, car, or great outdoors. Affectionate roasting encouraged."},{"theme":"Thoughtful","mood":"thoughtful","text":"In what way has your partner changed the most since you first got together — and what do you admire about who they've become?"},{"theme":"Little Things","mood":"silly","text":"Your partner gets home after a long day. What's the exact sequence of things they do in the first ten minutes? Narrate it like a nature documentary."},{"theme":"Gratitude","mood":"thoughtful","text":"What's a compliment you wish you gave your partner more often? Give it now, properly, like you mean it (you do)."},{"theme":"Us Then & Now","mood":"silly","text":"Which fictional couple are you two most like on a good day — and which one are you on a chaotic day with a toddler?"},{"theme":"Future Us","mood":"thoughtful","text":"When your kid is grown, what do you hope they say about how you two treated each other?"},{"theme":"Silly Memory","mood":"silly","text":"What's the most trouble you two have ever gotten into together — and whose idea was it, honestly?"},{"theme":"Thoughtful","mood":"thoughtful","text":"What's one thing your partner believes about you — a strength they see — that you're still learning to believe about yourself?"},{"theme":"Little Things","mood":"silly","text":"What's your partner's signature move when they're trying to make you laugh in public without anyone else noticing?"},{"theme":"Gratitude","mood":"thoughtful","text":"Think of an ordinary day this week. What moment with your partner, however small, would you bottle up if you could?"},{"theme":"Us Then & Now","mood":"silly","text":"Early-relationship you had some theories about how life together would go. Which one turned out most hilariously wrong?"},{"theme":"Future Us","mood":"thoughtful","text":"If you could steal one free hour together this week — no phones, no logistics — what would you do with it?"},{"theme":"Silly Memory","mood":"silly","text":"What's a purchase your partner defended with total confidence that turned out to be… a journey? Defend or bury it here."},{"theme":"Thoughtful","mood":"thoughtful","text":"What's something you and your partner disagree about, big or small, that you've come to respect their side of?"},{"theme":"Little Things","mood":"silly","text":"Describe your partner's laugh — the real one, not the polite one. When did you last hear it, and what caused it?"},{"theme":"Gratitude","mood":"thoughtful","text":"What's a way your partner makes the everyday logistics of life — the house, the kid, the calendar — noticeably easier, that deserves more credit?"},{"theme":"Us Then & Now","mood":"silly","text":"You have to describe your partner to a sketch artist using only comparisons to foods, weather, and animals. Go."},{"theme":"Future Us","mood":"thoughtful","text":"What's a trip — big, small, or completely imaginary — that you still daydream about taking together someday? Paint the picture."},{"theme":"Firsts","mood":"thoughtful","text":"What was your first thought when we first saw each other? Give the honest, unedited version — not the polished story you tell now."},{"theme":"Silly Memory","mood":"silly","text":"What's a memory that instantly makes you laugh when you think of it — the one that has never once gotten less funny?"},{"theme":"Favorite Places","mood":"thoughtful","text":"Where's your favorite place that we've ever been together — and what happened there that made it stick in your heart?"},{"theme":"Discovery","mood":"silly","text":"What's a food opinion you would defend to the death that your partner probably doesn't know you hold?"},{"theme":"Future Us","mood":"thoughtful","text":"What's something you look forward to doing together in 20 years? Dream as big or as gloriously ordinary as you like."},{"theme":"Discovery","mood":"thoughtful","text":"What's a small preference of yours — how you take your coffee, how you like a Sunday to unfold — that you've somehow never actually said out loud in twenty years?"},{"theme":"Firsts","mood":"silly","text":"What do you remember about our very first real conversation — and what's the thought running underneath it that you'd never have admitted at the time?"},{"theme":"Discovery","mood":"thoughtful","text":"Is there a dream you used to talk about that quietly went into a drawer somewhere? What was it — and does any part of it still tug at you?"},{"theme":"Favorite Places","mood":"silly","text":"If you could teleport us back to one trip for exactly 24 hours, which one would you pick — and what's the very first thing you'd do there?"},{"theme":"Discovery","mood":"silly","text":"What's something you loved doing alone before you met — a weird little ritual, hobby, or pleasure — that your partner has never really seen you do?"},{"theme":"Firsts","mood":"thoughtful","text":"When did you first know this was different — that this person might actually be your person? Walk through the moment."},{"theme":"Discovery","mood":"thoughtful","text":"What's a compliment someone gave you once that you've never forgotten — and has your partner ever heard this story before tonight?"},{"theme":"Future Us","mood":"silly","text":"Twenty years from now, what's the gloriously unserious thing you hope we're still doing — the bit that never, ever retires?"},{"theme":"Discovery","mood":"thoughtful","text":"What's one thing you're quietly a little nervous about in this next chapter of life — the thing that hasn't quite made it into regular conversation yet?"},{"theme":"Favorite Places","mood":"thoughtful","text":"Is there a place we've never been that lives in your head as 'ours, someday'? Describe the day we'd spend there."},{"theme":"Discovery","mood":"silly","text":"You get one completely free day — no kid, no budget worries, no explaining yourself to anyone. What's the real answer for how you'd spend it, not the sensible one?"},{"theme":"Discovery","mood":"thoughtful","text":"What's a song, a scent, or a taste that takes you somewhere from before us — a place your partner has never been with you? Take them there for a paragraph."},{"theme":"Discovery","mood":"silly","text":"What's a skill you quietly believe you'd be weirdly good at, with absolutely zero evidence? Fencing? Beekeeping? Competitive napping?"},{"theme":"Discovery","mood":"thoughtful","text":"What do you wish your partner would ask you about more often — the topic where there's always a little more to say?"}];

async function ensureSchema(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS olu_settings (id INTEGER PRIMARY KEY, name_a TEXT NOT NULL DEFAULT 'Sarah', name_b TEXT NOT NULL DEFAULT 'Andres')").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS olu_prompts (id INTEGER PRIMARY KEY AUTOINCREMENT, seq INTEGER NOT NULL UNIQUE, cycle_date TEXT NOT NULL, theme TEXT NOT NULL, mood TEXT NOT NULL, text TEXT NOT NULL, release_a_at INTEGER NOT NULL, release_b_at INTEGER NOT NULL, created_at INTEGER NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS olu_answers (id INTEGER PRIMARY KEY AUTOINCREMENT, prompt_id INTEGER NOT NULL REFERENCES olu_prompts(id), author TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL)").run();
}

// ---------------------------------------------------------------------------
// Time helpers (America/New_York wall-clock) — from the Space's actions.ts
// ---------------------------------------------------------------------------
function nyParts(now) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day") };
}
function dateStr(y, m, d) { return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0"); }
function todayNY(now) { const p = nyParts(now); return dateStr(p.y, p.m, p.d); }
function addDays(ds, n) {
  const [y = 2026, m = 1, d = 1] = ds.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return dateStr(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}
function tzOffsetMs(tz, utcDate) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(utcDate);
  const get = (t) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcDate.getTime() / 1000) * 1000;
}
function zonedTimeToUtc(ds, hour, minute) {
  const [y = 2026, m = 1, d = 1] = ds.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, hour, minute);
  let utc = guess - tzOffsetMs(TZ, new Date(guess));
  utc = guess - tzOffsetMs(TZ, new Date(utc));
  return utc;
}
// B (Andres, early riser): 6:05–7:35 AM. A (Sarah): 7:50–9:50 AM. 5-minute steps.
function randomRelease(ds, author) {
  const startMin = author === "B" ? 6 * 60 + 5 : 7 * 60 + 50;
  const endMin = author === "B" ? 7 * 60 + 35 : 9 * 60 + 50;
  const steps = Math.floor((endMin - startMin) / 5);
  const picked = startMin + 5 * Math.floor(Math.random() * (steps + 1));
  return zonedTimeToUtc(ds, Math.floor(picked / 60), picked % 60);
}
function prettyDate(ds) {
  const [y = 2026, m = 1, d = 1] = ds.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

// ---------------------------------------------------------------------------
// Core state machine (mirrors the Space's actions.ts)
// ---------------------------------------------------------------------------
async function ensureSettings(db) {
  const row = await db.prepare("SELECT name_a, name_b FROM olu_settings WHERE id = 1").first();
  if (!row) {
    await db.prepare("INSERT INTO olu_settings (id, name_a, name_b) VALUES (1, 'Sarah', 'Andres')").run();
    return { nameA: "Sarah", nameB: "Andres" };
  }
  return { nameA: row.name_a, nameB: row.name_b };
}

async function createPrompt(db, seq, cycleDate) {
  const entry = POOL[seq % POOL.length];
  await db.prepare("INSERT OR IGNORE INTO olu_prompts (seq, cycle_date, theme, mood, text, release_a_at, release_b_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
    .bind(seq, cycleDate, entry.theme, entry.mood, entry.text, randomRelease(cycleDate, "A"), randomRelease(cycleDate, "B"), Date.now()).run();
}

async function allPrompts(db) {
  const res = await db.prepare("SELECT id, seq, cycle_date, theme, mood, text, release_a_at, release_b_at, created_at FROM olu_prompts ORDER BY seq ASC").all();
  return res.results || [];
}

async function ensurePrompts(db, now) {
  const today = todayNY(now);
  let all = await allPrompts(db);
  if (all.length === 0) {
    await createPrompt(db, 0, today);
    await createPrompt(db, 1, addDays(today, 2));
    return allPrompts(db);
  }
  let last = all[all.length - 1];
  let guard = 0;
  while (last.cycle_date <= today && guard++ < 400) {
    await createPrompt(db, last.seq + 1, addDays(last.cycle_date, 2));
    all = await allPrompts(db);
    last = all[all.length - 1];
  }
  return all;
}

async function buildState(db, viewer) {
  const now = new Date();
  const settings = await ensureSettings(db);
  const prompts = await ensurePrompts(db, now);
  const nowMs = now.getTime();
  const releaseFor = (p) => (viewer === "A" ? p.release_a_at : p.release_b_at);

  const released = prompts.filter((p) => releaseFor(p) <= nowMs);
  const activeRow = released.length > 0 ? released[released.length - 1] : null;
  const upcomingRow = prompts.find((p) => releaseFor(p) > nowMs) || null;

  const ansRes = await db.prepare("SELECT id, prompt_id, author, text, created_at FROM olu_answers ORDER BY created_at ASC").all();
  const byPrompt = new Map();
  for (const a of ansRes.results || []) {
    const list = byPrompt.get(a.prompt_id) || [];
    list.push(a);
    byPrompt.set(a.prompt_id, list);
  }
  const isComplete = (pid) => {
    const list = byPrompt.get(pid) || [];
    return list.some((a) => a.author === "A") && list.some((a) => a.author === "B");
  };
  const toShape = (a) => ({ author: a.author === "B" ? "B" : "A", text: a.text, createdAt: new Date(a.created_at).toISOString() });

  let active = null;
  if (activeRow) {
    const list = byPrompt.get(activeRow.id) || [];
    const mine = list.find((a) => a.author === viewer);
    const partner = list.find((a) => a.author !== viewer);
    const revealed = Boolean(mine && partner);
    active = {
      id: activeRow.id,
      cycleDate: activeRow.cycle_date,
      cycleLabel: prettyDate(activeRow.cycle_date),
      theme: activeRow.theme,
      mood: activeRow.mood,
      text: activeRow.text,
      myAnswer: mine ? mine.text : null,
      partnerAnswered: Boolean(partner),
      revealed,
      answers: revealed ? list.map(toShape) : [],
    };
  }

  const history = prompts
    .filter((p) => activeRow == null || p.id !== activeRow.id || isComplete(p.id))
    .filter((p) => releaseFor(p) <= nowMs && (byPrompt.get(p.id) || []).length > 0)
    .slice()
    .reverse()
    .map((p) => {
      const list = byPrompt.get(p.id) || [];
      const complete = isComplete(p.id);
      return {
        id: p.id,
        cycleDate: p.cycle_date,
        cycleLabel: prettyDate(p.cycle_date),
        theme: p.theme,
        mood: p.mood,
        text: p.text,
        complete,
        myAnswered: list.some((a) => a.author === viewer),
        partnerAnswered: list.some((a) => a.author !== viewer),
        answers: (complete ? list : list.filter((a) => a.author === viewer)).map(toShape),
      };
    });

  return {
    nameA: settings.nameA,
    nameB: settings.nameB,
    completedCount: prompts.filter((p) => isComplete(p.id)).length,
    active,
    upcoming: upcomingRow ? { cycleDate: upcomingRow.cycle_date, cycleLabel: prettyDate(upcomingRow.cycle_date), theme: upcomingRow.theme } : null,
    history,
  };
}

// ---------------------------------------------------------------------------
// Routes: GET ?viewer=A|B · POST {action:"submitAnswer"|"updateNames", ...}
// ---------------------------------------------------------------------------
async function gate(context) {
  const { env, request } = context;
  const id = await requireIdentity(env, request);
  if (!id) return { error: json({ error: "not signed in" }, 401) };
  if (!appAllowed(id, SLUG)) return { error: json({ error: "this account doesn't cover this app" }, 403) };
  const db = env.DB;
  await ensureSchema(db);
  return { db };
}

export async function onRequestGet(context) {
  const g = await gate(context);
  if (g.error) return g.error;
  const viewer = new URL(context.request.url).searchParams.get("viewer");
  if (viewer !== "A" && viewer !== "B") return json({ error: "viewer must be A or B" }, 400);
  return json(await buildState(g.db, viewer));
}

export async function onRequestPost(context) {
  const g = await gate(context);
  if (g.error) return g.error;
  const db = g.db;
  let body;
  try { body = await context.request.json(); } catch { return json({ error: "bad json" }, 400); }
  const action = body && body.action;

  if (action === "submitAnswer") {
    const { promptId, author, text } = body;
    if (!Number.isInteger(promptId) || promptId <= 0) return json({ error: "bad promptId" }, 400);
    if (author !== "A" && author !== "B") return json({ error: "bad author" }, 400);
    if (typeof text !== "string") return json({ error: "bad text" }, 400);
    const trimmed = text.trim();
    if (trimmed.length < 1 || trimmed.length > 4000) return json({ error: "answer must be 1-4000 characters" }, 400);
    const prompt = await db.prepare("SELECT id FROM olu_prompts WHERE id = ?1").bind(promptId).first();
    if (!prompt) return json({ error: "no such prompt" }, 404);
    // Deliberately no release window here: the Space lets a partner write or
    // edit an answer whenever the prompt exists (the reveal is what gates
    // the partner's view of it, not the write path).
    const existing = await db.prepare("SELECT id FROM olu_answers WHERE prompt_id = ?1 AND author = ?2").bind(promptId, author).first();
    if (existing) {
      await db.prepare("UPDATE olu_answers SET text = ?1 WHERE id = ?2").bind(trimmed, existing.id).run();
    } else {
      await db.prepare("INSERT INTO olu_answers (prompt_id, author, text, created_at) VALUES (?1, ?2, ?3, ?4)").bind(promptId, author, trimmed, Date.now()).run();
    }
    return json({ ok: true });
  }

  if (action === "updateNames") {
    const { nameA, nameB } = body;
    if (typeof nameA !== "string" || typeof nameB !== "string") return json({ error: "bad names" }, 400);
    const a = nameA.trim(), b = nameB.trim();
    if (a.length < 1 || a.length > 40 || b.length < 1 || b.length > 40) return json({ error: "names must be 1-40 characters" }, 400);
    await ensureSettings(db);
    await db.prepare("UPDATE olu_settings SET name_a = ?1, name_b = ?2 WHERE id = 1").bind(a, b).run();
    return json({ ok: true });
  }

  return json({ error: "unknown action" }, 400);
}
