// Shared helpers for the Library microsite (sites.aranguibel.com/library).
//
// The shared D1 database already hosts other apps' tables, so every Library
// table is prefixed: library_books, library_series_info,
// library_wishlist_items, library_wishlist_dismissed.
//
// AUDIT NOTE (2026-11-07): every shaper in this file mirrors Sarah's REAL
// server code (books-library-export/source/server/src/actions.ts +
// schema.ts) field-by-field — camelCase names, exact nesting, null vs
// missing — because the ported client (client/src/App.tsx) consumes those
// exact shapes. Key real shapes:
//   BookSummary   { id, title, author, yearRead, yearInferred, status,
//                   statusNote, rating, isAudiobook, isSpicy, hasStarMarker,
//                   coverUrl, publishYear, detailStatus }
//   DetailResponse{ ok, book, synopsis, premise, mainCharacters, storyArc,
//                   takeaway, description, subjects, sources, personalNotes,
//                   reviewAnswers, detailStatus, seriesName, seriesPosition,
//                   seriesChecked }
//   Recommendation{ title, author, coverUrl, olUrl, olWorkKey }
//   WishlistItem  { id, title, author, coverUrl, source }
//   SeriesEntry   { title, position, author, coverUrl, olWorkKey, bookId,
//                   inLibrary, bookStatus, rating, yearRead }
//
// Data distinctions that must survive every read/write (hard requirements):
//  - rating NULL = unrated (never coerce to 0); rating 0 = abandoned/hated.
//  - detail_status 'failed' books still expose ol_description as the detail
//    page's "About this book" text (DetailResponse.description).
//  - series_checked = 0 means series membership is UNKNOWN — never label
//    such a book "standalone" anywhere.
//  - currently-reading books have year_read NULL — never assign one.

export const BOOKS_TABLE = "library_books";
export const SERIES_TABLE = "library_series_info";
export const WISHLIST_TABLE = "library_wishlist_items";
export const DISMISSED_TABLE = "library_wishlist_dismissed";

export const MAX_COVER_ATTEMPTS = 3;
export const REC_CACHE_VERSION = 4;

// Column lists (real schema.ts column names, snake_case as stored). The
// seed endpoint inserts rows keyed by exactly these names, preserving
// explicit ids. NOTE: wishlist_dismissed has NO author column in the real
// schema.ts (an earlier written spec added one — removed in this audit).
export const BOOK_COLUMNS = [
  "id", "title", "author", "author_hint", "year_read", "year_inferred",
  "rating", "status", "status_note", "is_audiobook", "is_spicy",
  "has_star_marker", "publish_year", "position", "cover_blob_key",
  "ol_work_key", "ol_description", "cover_attempts", "cover_checked",
  "cover_optimized", "detail_status", "detail_sources", "synopsis",
  "premise", "main_characters", "story_arc", "takeaway", "subjects",
  "recommendations", "recommendations_version", "series_name",
  "series_position", "series_checked", "personal_notes", "review_answers",
  "created_at",
];

export const SERIES_COLUMNS = [
  "id", "key", "name", "author", "description", "entries", "status",
  "created_at",
];

export const WISHLIST_COLUMNS = [
  "id", "title", "author", "ol_work_key", "cover_blob_key", "source",
  "position", "page_count", "publish_year", "subjects", "synopsis",
  "detail_fetched", "created_at",
];

// Real schema.ts wishlist_dismissed: id, ol_work_key (NOT NULL), title
// (NOT NULL), created_at — no author.
export const DISMISSED_COLUMNS = [
  "id", "ol_work_key", "title", "created_at",
];

export async function ensureLibrarySchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS library_books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT,
      author_hint TEXT,
      year_read INTEGER,
      year_inferred INTEGER NOT NULL DEFAULT 0,
      rating REAL,
      status TEXT NOT NULL DEFAULT 'read',
      status_note TEXT,
      is_audiobook INTEGER NOT NULL DEFAULT 0,
      is_spicy INTEGER NOT NULL DEFAULT 0,
      has_star_marker INTEGER NOT NULL DEFAULT 0,
      publish_year INTEGER,
      position INTEGER NOT NULL DEFAULT 0,
      cover_blob_key TEXT,
      ol_work_key TEXT,
      ol_description TEXT,
      cover_attempts INTEGER NOT NULL DEFAULT 0,
      cover_checked INTEGER NOT NULL DEFAULT 0,
      cover_optimized INTEGER NOT NULL DEFAULT 0,
      detail_status TEXT NOT NULL DEFAULT 'none',
      detail_sources TEXT,
      synopsis TEXT,
      premise TEXT,
      main_characters TEXT,
      story_arc TEXT,
      takeaway TEXT,
      subjects TEXT,
      recommendations TEXT,
      recommendations_version INTEGER NOT NULL DEFAULT 0,
      series_name TEXT,
      series_position REAL,
      series_checked INTEGER NOT NULL DEFAULT 0,
      personal_notes TEXT NOT NULL DEFAULT '',
      review_answers TEXT,
      created_at INTEGER
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS library_books_year_read_idx ON library_books (year_read)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS library_books_status_idx ON library_books (status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS library_books_series_name_idx ON library_books (series_name)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS library_series_info (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      author TEXT,
      description TEXT,
      entries TEXT,
      status TEXT NOT NULL DEFAULT 'ready',
      created_at INTEGER
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS library_wishlist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT,
      ol_work_key TEXT,
      cover_blob_key TEXT,
      source TEXT NOT NULL DEFAULT 'typed',
      position INTEGER NOT NULL DEFAULT 0,
      page_count INTEGER,
      publish_year INTEGER,
      subjects TEXT,
      synopsis TEXT,
      detail_fetched INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS library_wishlist_dismissed (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ol_work_key TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER
    )`),
  ]);
}

/* ---------- cover URLs ---------- */

// Cover bytes are served as static files under /library/covers/<blobKey>
// (see the covers workstream). Null-safe: a book/item with no blob key gets
// a null coverUrl and the client renders its designed placeholder. This is
// the platform equivalent of the real server's ctx.blobs.getUrl(blobKey):
// the URL still comes from the server response, never built client-side.
export function coverUrl(blobKey) {
  if (!blobKey || typeof blobKey !== "string") return null;
  const key = blobKey.replace(/^\/+/, "");
  if (!key) return null;
  return "/library/covers/" + key;
}

// The bare work id (e.g. "OL45132595W") from any stored key form:
// "/works/OL45132595W", "works/OL45132595W", or already bare.
export function workKeyId(key) {
  if (!key || typeof key !== "string") return null;
  const parts = key.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

// Canonical stored form: "/works/OL45132595W". Accepts bare ids and
// "works/..." forms; returns null for anything unusable.
export function normalizeWorkKey(key) {
  const id = workKeyId(key);
  if (!id) return null;
  return "/works/" + id;
}

// Wishlist covers are saved by the covers workstream under
// "wishlist/<WORKKEY>.jpg" (e.g. blob key "wishlist/OL45132595W.jpg" →
// URL /library/covers/wishlist/OL45132595W.jpg). Seeded wishlist rows have
// cover_blob_key NULL, so the key is derived from ol_work_key.
export function wishlistCoverBlobKey(row) {
  if (row && row.cover_blob_key) return row.cover_blob_key;
  const id = row ? workKeyId(row.ol_work_key) : null;
  return id ? `wishlist/${id}.jpg` : null;
}

/* ---------- text normalisation (ported from the real actions.ts) ---------- */

// Real norm(): lowercase, curly apostrophes straightened, anything that
// is not [a-z0-9 ] becomes a space, whitespace collapsed.
export function norm(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Real baseTitle(): everything before a subtitle colon, dash, or
// parenthetical, normalised, with "a novel"-style suffixes removed. Used
// for duplicate detection across editions of the same book.
export function baseTitle(t) {
  const head = String(t ?? "").split(/:\s| — | – | \(/)[0] ?? String(t ?? "");
  return norm(head)
    .replace(/\b(a novel|the novel|a memoir|a novel in stories)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Title comparison key kept for older callers: case- and
// punctuation-insensitive, whitespace-collapsed.
export function normalizeTitle(title) {
  return norm(title);
}

export function authorFuzzyMatch(a, b) {
  if (!a || !b) return false;
  const na = norm(a);
  const nb = norm(b);
  return na === nb || na.includes(nb) || nb.includes(na);
}

// Non-Latin scripts in a title almost always mean a non-English edition.
export function isLatinTitle(t) {
  return /[A-Za-z]/.test(t) && !/[Ѐ-ӿ֐-׿؀-ۿ぀-ヿ㐀-鿿가-힯]/.test(t);
}

/* ---------- junk filter for recommendations (ported marker lists) ---------- */

const JUNK_TITLE_MARKERS = [
  "textbook", "prentice hall", "study guide", "study guides", "workbook",
  "teacher's edition", "teachers edition", "instructor's edition",
  "student edition", "test bank", "cliffsnotes", "cliff notes",
  "sparknotes", "summary of", "summaries of", "analysis of",
  "annotated bibliography", "critical essays", "cambridge companion",
  "bloom's", "blooms ", "casebook", "coursebook", "travel guide",
  "visitor's guide", "visitors guide", "pocket guide to",
  "eyewitness travel", "rough guide", "insight guide", "let's go",
  "omnibus", "collected works", "complete works", "box set", "boxed set",
  "anthology",
];
const JUNK_AUTHOR_MARKERS = [
  "lonely planet", "frommer", "fodor", "rick steves", "rough guides",
  "dk eyewitness", "cliffs notes", "sparknotes", "prentice hall",
];
const JUNK_SUBJECT_MARKERS = [
  "textbooks", "study guides", "examinations", "travel guides",
  "guidebooks", "juvenile study aids", "outlines, syllabi, etc",
  "handbooks, manuals",
];

// Mirrors the real isJunkRec({ title, author_name, subject }).
export function isJunkRec({ title = "", author = null, subjects = [] } = {}) {
  const t = String(title ?? "").toLowerCase();
  if (t.includes("[") || t.includes("]")) return true;
  if (/\bedition\b/.test(t) || /\bed\.$/.test(t)) return true;
  if (JUNK_TITLE_MARKERS.some((m) => t.includes(m))) return true;
  const authors = (Array.isArray(author) ? author.join(" ") : author ?? "").toLowerCase();
  if (JUNK_AUTHOR_MARKERS.some((m) => authors.includes(m))) return true;
  const subs = (Array.isArray(subjects) ? subjects.join(" ") : "").toLowerCase();
  if (JUNK_SUBJECT_MARKERS.some((m) => subs.includes(m))) return true;
  return false;
}

/* ---------- JSON TEXT column helpers ---------- */

// Parse a TEXT column that stores a JSON string. Values that are already
// arrays/objects pass through; unparseable text yields the fallback.
export function parseJsonField(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  if (typeof value !== "string") return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

// Serialize a value for a JSON TEXT column: strings are stored verbatim,
// objects/arrays are JSON-stringified, null/undefined stay NULL.
export function toJsonText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function bool01(value) {
  return value ? 1 : 0;
}
export { bool01 };

/* ---------- stored recommendations ---------- */

// Parse a book row's cached recommendations TEXT into the stored pick
// shape { title, author, coverBlobKey, olWorkKey } (the real StoredRec).
// Anything malformed is dropped, exactly like the real parseStoredRecs.
export function parseStoredRecs(raw) {
  if (!raw) return [];
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (r) =>
        typeof r === "object" && r !== null &&
        typeof r.title === "string" &&
        typeof (r.olWorkKey || r.ol_work_key) === "string",
    )
    .map((r) => ({
      title: r.title,
      author: typeof r.author === "string" ? r.author : null,
      coverBlobKey: r.coverBlobKey || r.cover_blob_key || null,
      olWorkKey: r.olWorkKey || r.ol_work_key,
    }));
}

// Parse a book row's cached recommendations (row object form).
export function parseRecommendations(row) {
  return parseStoredRecs(row ? row.recommendations : null);
}

// The real recCacheComplete(): caches from the current engine version
// with a full set of four non-junk, base-title-unique picks are trusted.
export function recCacheComplete(row) {
  if (!row || (row.recommendations_version ?? 0) < REC_CACHE_VERSION) return false;
  const recs = parseStoredRecs(row.recommendations);
  if (recs.length < 4) return false;
  const bases = new Set();
  for (const r of recs) {
    if (isJunkRec({ title: r.title, author: r.author })) return false;
    const b = baseTitle(r.title);
    if (!b || bases.has(b)) return false;
    bases.add(b);
  }
  return true;
}

// The real listBooks pending counts, computed over all book rows.
export function pendingCounts(rows) {
  return {
    coversPending: rows.filter(
      (r) => !r.cover_blob_key && (r.cover_attempts ?? 0) < MAX_COVER_ATTEMPTS,
    ).length,
    coversMissing: rows.filter((r) => !r.cover_blob_key).length,
    coversUnoptimized: rows.filter((r) => r.cover_blob_key && !r.cover_optimized).length,
    detailsPending: rows.filter((r) => r.detail_status !== "ready").length,
    recsPending: rows.filter((r) => !recCacheComplete(r)).length,
    seriesPending: rows.filter((r) => !r.series_checked).length,
  };
}

/* ---------- row shaping (mirrors the real actions.ts builders) ---------- */

// The real toSummary(): the ONLY shape listBooks/addBook expose per book.
export function shapeBookSummary(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    author: row.author ?? null,
    yearRead: row.year_read ?? null,
    yearInferred: !!row.year_inferred,
    status: row.status,
    statusNote: row.status_note ?? null,
    rating: row.rating ?? null,
    isAudiobook: !!row.is_audiobook,
    isSpicy: !!row.is_spicy,
    hasStarMarker: !!row.has_star_marker,
    coverUrl: coverUrl(row.cover_blob_key),
    publishYear: row.publish_year ?? null,
    detailStatus: row.detail_status,
  };
}

// Backwards-compatible alias (the pre-audit name for the summary shaper
// was shapeBookListItem, but its snake_case output was wrong; do not use).
export const shapeBookListItem = shapeBookSummary;

export function parseMainCharacters(raw) {
  const parsed = parseJsonField(raw, null);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (c) =>
        typeof c === "object" && c !== null &&
        typeof c.name === "string" && typeof c.role === "string",
    )
    .map((c) => ({ name: c.name, role: c.role }));
}

export function parseSubjectsArray(raw) {
  const parsed = parseJsonField(raw, null);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((s) => typeof s === "string");
}

export function parseSources(raw) {
  const parsed = parseJsonField(raw, null);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (s) => typeof s === "object" && s !== null && typeof s.url === "string",
    )
    .map((s) => ({ title: s.title || s.url, url: s.url }));
}

// The real parseReviewAnswers(): an object map of string -> string;
// non-object / non-string entries are dropped, missing/invalid -> {}.
export function parseReviewAnswers(raw) {
  if (!raw) return {};
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const out = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === "string" && k.trim()) out[k] = v;
  }
  return out;
}

// The real buildDetailResponse() over a stored row — no generation.
// `description` is the Open Library description (the fallback text the
// detail page shows for detail_status 'failed' books).
export function buildDetailResponse(row) {
  return {
    ok: true,
    book: shapeBookSummary(row),
    synopsis: row.synopsis ?? null,
    premise: row.premise ?? null,
    mainCharacters: parseMainCharacters(row.main_characters),
    storyArc: row.story_arc ?? null,
    takeaway: row.takeaway ?? null,
    description: row.ol_description ?? null,
    subjects: parseSubjectsArray(row.subjects),
    sources: parseSources(row.detail_sources),
    personalNotes: row.personal_notes ?? "",
    reviewAnswers: parseReviewAnswers(row.review_answers),
    detailStatus: row.detail_status,
    seriesName: row.series_name ?? null,
    seriesPosition: row.series_position ?? null,
    seriesChecked: !!row.series_checked,
  };
}

// The exact payload the real getBookDetail / prepareBookDetail return
// for a missing book (ok:false, detailStatus 'failed', empty fields) —
// the real actions return this instead of throwing.
export function emptyDetailResponse() {
  return {
    ok: false,
    book: null,
    synopsis: null,
    premise: null,
    mainCharacters: [],
    storyArc: null,
    takeaway: null,
    description: null,
    subjects: [],
    sources: [],
    personalNotes: "",
    reviewAnswers: {},
    detailStatus: "failed",
    seriesName: null,
    seriesPosition: null,
    seriesChecked: false,
  };
}

// Backwards-compatible alias: the pre-audit shapeBookDetail returned a
// snake_case superset the real client cannot consume; it now returns the
// real DetailResponse.
export const shapeBookDetail = buildDetailResponse;

// The real storedRecToOut(): one recommendation as the client sees it.
export function shapeRecommendationOut(rec) {
  if (!rec) return null;
  return {
    title: rec.title,
    author: rec.author ?? null,
    coverUrl: coverUrl(rec.coverBlobKey),
    olUrl: `https://openlibrary.org${rec.olWorkKey}`,
    olWorkKey: rec.olWorkKey,
  };
}

// Backwards-compatible alias with the corrected real shape.
export function shapeRecommendationPick(pick) {
  if (!pick || typeof pick !== "object") return null;
  return shapeRecommendationOut({
    title: pick.title ?? null,
    author: pick.author ?? null,
    coverBlobKey: pick.coverBlobKey || pick.cover_blob_key || null,
    olWorkKey: pick.olWorkKey || pick.ol_work_key || null,
  });
}

// The real toWishlistOut(): the ONLY shape listWishlist/addWishlistItem
// expose per item.
export function shapeWishlistItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    author: row.author ?? null,
    coverUrl: coverUrl(wishlistCoverBlobKey(row)),
    source: row.source ?? "typed",
  };
}

/* ---------- series ---------- */

// The real seriesKey(): normalised name + author.
export function seriesKey(name, author) {
  return `${norm(name)}|${author ? norm(author) : ""}`;
}

// Parse a series_info row's entries TEXT into StoredSeriesEntry objects
// { title, position, author, olWorkKey, coverBlobKey, bookId }.
export function parseSeriesEntries(raw) {
  if (!raw) return [];
  let parsed = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((e) => typeof e === "object" && e !== null && typeof e.title === "string")
    .map((e) => ({
      title: e.title,
      position: typeof e.position === "number" ? e.position : null,
      author: typeof e.author === "string" ? e.author : null,
      olWorkKey: e.olWorkKey || e.ol_work_key || null,
      coverBlobKey: e.coverBlobKey || e.cover_blob_key || null,
      bookId: typeof e.bookId === "number" ? e.bookId : e.book_id ?? null,
    }));
}
