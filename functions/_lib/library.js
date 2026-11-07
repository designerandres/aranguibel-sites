// Shared helpers for the Library microsite (sites.aranguibel.com/library).
//
// The shared D1 database already hosts other apps' tables, so every Library
// table is prefixed: library_books, library_series_info,
// library_wishlist_items, library_wishlist_dismissed. Column definitions are
// EXACTLY those in books-migration/inspect/d1-schema.sql (the package schema
// is unprefixed; prefixing is the platform convention, e.g. jollywood_votes).
//
// Data distinctions that must survive every read/write (hard requirements):
//  - rating NULL = unrated (never coerce to 0); rating 0 = abandoned/hated.
//  - detail_status 'failed' books expose ol_description as a fallback.
//  - series_checked = 0 means series membership is UNKNOWN — never label
//    such a book "standalone" anywhere.
//  - currently-reading books have year_read NULL — never assign one.

export const BOOKS_TABLE = "library_books";
export const SERIES_TABLE = "library_series_info";
export const WISHLIST_TABLE = "library_wishlist_items";
export const DISMISSED_TABLE = "library_wishlist_dismissed";

// Column lists, in d1-schema.sql order. The seed endpoint inserts rows keyed
// by exactly these names, preserving explicit ids.
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

export const DISMISSED_COLUMNS = [
  "id", "ol_work_key", "title", "author", "created_at",
];

export async function ensureLibrarySchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS library_books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT NOT NULL,
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
      series_position INTEGER,
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
      source TEXT,
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
      title TEXT,
      author TEXT,
      created_at INTEGER
    )`),
  ]);
}

/* ---------- cover URLs ---------- */

// Cover bytes are served as static files under /library/covers/<blobKey>
// (see the covers workstream). Null-safe: a book/item with no blob key gets
// a null coverUrl and the client renders its designed placeholder.
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

/* ---------- small shared helpers ---------- */

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

// Title comparison key for owned/dedupe matching: case- and
// punctuation-insensitive, whitespace-collapsed.
export function normalizeTitle(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bool01(value) {
  return value ? 1 : 0;
}
export { bool01 };

/* ---------- row shaping ---------- */
// Shapers keep the snake_case column names of the export (so the client port
// stays mechanical) and ADD camelCase coverUrl. JSON TEXT columns are
// returned parsed. rating is passed through untouched: NULL stays null
// (unrated) and 0 stays 0 (abandoned) — never coerced either way.

// Light shape for the shelf feed (listBooks): no heavy detail/recommendation
// payloads.
export function shapeBookListItem(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    author: row.author,
    author_hint: row.author_hint ?? null,
    year_read: row.year_read ?? null,
    year_inferred: !!row.year_inferred,
    rating: row.rating ?? null,
    status: row.status,
    status_note: row.status_note ?? null,
    is_audiobook: !!row.is_audiobook,
    is_spicy: !!row.is_spicy,
    has_star_marker: !!row.has_star_marker,
    publish_year: row.publish_year ?? null,
    position: row.position ?? 0,
    cover_blob_key: row.cover_blob_key ?? null,
    coverUrl: coverUrl(row.cover_blob_key),
    ol_work_key: row.ol_work_key ?? null,
    detail_status: row.detail_status,
    series_name: row.series_name ?? null,
    series_position: row.series_position ?? null,
    series_checked: !!row.series_checked,
    personal_notes: row.personal_notes ?? "",
    subjects: parseJsonField(row.subjects, null),
    created_at: row.created_at ?? null,
  };
}

// Full stored detail for one book (getBookDetail / write-action returns).
// No generation: everything here comes from the row.
export function shapeBookDetail(row) {
  if (!row) return null;
  const base = shapeBookListItem(row);
  const series = row.series_name
    ? { name: row.series_name, position: row.series_position ?? null }
    : null;
  return {
    ...base,
    ol_description: row.ol_description ?? null,
    // For 'failed' books the Open Library description is the fallback the
    // client shows in place of the missing breakdown; books with neither
    // get null here and render a clean empty state.
    fallbackDescription:
      row.detail_status === "failed" ? row.ol_description ?? null : null,
    detail_sources: parseJsonField(row.detail_sources, null),
    synopsis: row.synopsis ?? null,
    premise: row.premise ?? null,
    main_characters: parseJsonField(row.main_characters, null),
    story_arc: row.story_arc ?? null,
    takeaway: row.takeaway ?? null,
    recommendations_version: row.recommendations_version ?? 0,
    review_answers: parseJsonField(row.review_answers, null),
    cover_attempts: row.cover_attempts ?? 0,
    cover_checked: !!row.cover_checked,
    cover_optimized: !!row.cover_optimized,
    // Series label info: a label exists ONLY when a series_name is stored.
    // series_checked = 0 means "unknown" — series stays null and nothing
    // here (or anywhere) calls the book standalone.
    series,
    seriesLabel: series ? series.name : null,
  };
}

// One cached recommendation pick with its cover URL rewritten from
// coverBlobKey.
export function shapeRecommendationPick(pick) {
  if (!pick || typeof pick !== "object") return null;
  const blobKey = pick.coverBlobKey || pick.cover_blob_key || null;
  return {
    title: pick.title ?? null,
    author: pick.author ?? null,
    olWorkKey: pick.olWorkKey || pick.ol_work_key || null,
    coverBlobKey: blobKey,
    coverUrl: coverUrl(blobKey),
  };
}

// Parse a book row's cached recommendations TEXT into shaped picks.
// Empty/missing/invalid cache → empty list (never regenerated here).
export function parseRecommendations(row) {
  const raw = parseJsonField(row ? row.recommendations : null, []);
  if (!Array.isArray(raw)) return [];
  return raw.map(shapeRecommendationPick).filter(Boolean);
}

export function shapeWishlistItem(row) {
  if (!row) return null;
  const blobKey = wishlistCoverBlobKey(row);
  return {
    id: row.id,
    title: row.title,
    author: row.author ?? null,
    ol_work_key: row.ol_work_key ?? null,
    cover_blob_key: row.cover_blob_key ?? null,
    coverUrl: coverUrl(blobKey),
    source: row.source ?? null,
    position: row.position ?? 0,
    page_count: row.page_count ?? null,
    publish_year: row.publish_year ?? null,
    subjects: parseJsonField(row.subjects, null),
    synopsis: row.synopsis ?? null,
    detail_fetched: !!row.detail_fetched,
    created_at: row.created_at ?? null,
  };
}
