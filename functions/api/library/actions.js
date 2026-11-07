// Library microsite — single actions dispatcher.
//
// POST /api/library/actions  { action, args }  →  { ok: true, data }
//                                                  { ok: false, error }
//
// Implements ONLY the 14 "Required for editable use" actions from
// books-migration/inspect/functions-spec.md. The background/AI generation
// actions (prepareBookDetail, preload*, populate*, enrichCovers,
// optimizeCovers, loadEverything, importLibrary) are intentionally NOT
// implemented: the cached export data covers the existing library, and any
// unknown action (including those) gets a 400.
//
// Auth first, platform pattern: requireIdentity → 401, then the scoped-
// account check appAllowed(identity, "library") → 403.

import { appAllowed, json, requireIdentity } from "../../_lib/auth.js";
import {
  BOOKS_TABLE,
  DISMISSED_TABLE,
  SERIES_TABLE,
  WISHLIST_TABLE,
  coverUrl,
  ensureLibrarySchema,
  normalizeTitle,
  normalizeWorkKey,
  parseJsonField,
  parseRecommendations,
  shapeBookDetail,
  shapeBookListItem,
  shapeRecommendationPick,
  shapeWishlistItem,
  toJsonText,
  workKeyId,
} from "../../_lib/library.js";

const APP_SLUG = "library";

class ActionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) {
  throw new ActionError(status, message);
}

function requireBookId(args, key = "id") {
  const raw = args ? args[key] : undefined;
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) fail(400, `${key} (positive integer) required`);
  return id;
}

async function getBookRow(db, id) {
  const row = await db.prepare(`SELECT * FROM ${BOOKS_TABLE} WHERE id = ?1`).bind(id).first();
  if (!row) fail(404, "book not found");
  return row;
}

async function allBookRows(db) {
  const { results } = await db
    .prepare(`SELECT * FROM ${BOOKS_TABLE} ORDER BY position ASC, id ASC`)
    .all();
  return results || [];
}

async function nextPosition(db, table) {
  const row = await db
    .prepare(`SELECT COALESCE(MAX(position), -1) AS m FROM ${table}`)
    .first();
  return (row && typeof row.m === "number" ? row.m : -1) + 1;
}

/* ---------- Open Library (plain fetch; failures are never fatal) ---------- */

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "aranguibel-library/1.0 (sites.aranguibel.com/library)" },
    signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined,
  });
  if (!res.ok) throw new Error(`fetch ${res.status} for ${url}`);
  return res.json();
}

// OL descriptions arrive as a plain string or as { type, value }.
function olDescriptionText(desc) {
  if (!desc) return null;
  if (typeof desc === "string") return desc;
  if (typeof desc === "object" && typeof desc.value === "string") return desc.value;
  return null;
}

function yearFromDateText(text) {
  if (!text || typeof text !== "string") return null;
  const m = text.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  return m ? Number(m[1]) : null;
}

async function fetchAuthorName(authorKey) {
  if (!authorKey || typeof authorKey !== "string") return null;
  try {
    const data = await fetchJson(`https://openlibrary.org${authorKey}.json`);
    return typeof data.name === "string" && data.name ? data.name : null;
  } catch {
    return null;
  }
}

// Live work lookup shared by getRecommendationDetail / getWishlistItemDetail
// / addBook / addWishlistItem. Returns a plain detail object; pageCount comes
// from a single cheap editions lookup (first entry carrying
// number_of_pages) and stays null when that is unavailable.
async function fetchWorkDetail(workKey) {
  const key = normalizeWorkKey(workKey);
  if (!key) fail(400, "a valid Open Library work key is required");
  let work;
  try {
    work = await fetchJson(`https://openlibrary.org${key}.json`);
  } catch {
    fail(502, "Open Library lookup failed");
  }
  let author = null;
  const authors = Array.isArray(work.authors) ? work.authors : [];
  if (authors.length && authors[0].author && authors[0].author.key) {
    author = await fetchAuthorName(authors[0].author.key);
  }
  let pageCount = null;
  let editionYear = null;
  try {
    const editions = await fetchJson(
      `https://openlibrary.org${key}/editions.json?limit=5`
    );
    const entries = Array.isArray(editions.entries) ? editions.entries : [];
    for (const e of entries) {
      if (pageCount === null && Number.isInteger(e.number_of_pages)) {
        pageCount = e.number_of_pages;
      }
      if (editionYear === null) editionYear = yearFromDateText(e.publish_date);
      if (pageCount !== null && editionYear !== null) break;
    }
  } catch {
    /* page count is best-effort only */
  }
  const synopsis = olDescriptionText(work.description);
  const firstPublishDate =
    typeof work.first_publish_date === "string" ? work.first_publish_date : null;
  return {
    olWorkKey: key,
    title: typeof work.title === "string" ? work.title : null,
    author,
    synopsis,
    description: synopsis,
    subjects: Array.isArray(work.subjects) ? work.subjects : [],
    pageCount,
    firstPublishDate,
    firstPublishedYear: yearFromDateText(firstPublishDate) ?? editionYear,
  };
}

// Search fallback for addBook/addWishlistItem when no work key is given.
async function searchOpenLibrary(title, author) {
  const q = author ? `${title} ${author}` : title;
  const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(
    title
  )}&q=${encodeURIComponent(q)}&limit=1`;
  try {
    const data = await fetchJson(url);
    const doc = Array.isArray(data.docs) && data.docs.length ? data.docs[0] : null;
    if (!doc) return null;
    return {
      title: typeof doc.title === "string" ? doc.title : null,
      author:
        Array.isArray(doc.author_name) && doc.author_name.length
          ? doc.author_name[0]
          : null,
      olWorkKey: doc.key ? normalizeWorkKey(doc.key) : null,
      publishYear: Number.isInteger(doc.first_publish_year)
        ? doc.first_publish_year
        : null,
    };
  } catch {
    return null;
  }
}

/* ================================ READS ================================ */

async function listBooks(db) {
  const rows = await allBookRows(db);
  let coversMissing = 0;
  let detailsPending = 0;
  let recsPending = 0;
  let seriesPending = 0;
  for (const row of rows) {
    if (!row.cover_blob_key) coversMissing++;
    if (row.detail_status !== "ready") detailsPending++;
    if (parseRecommendations(row).length === 0) recsPending++;
    if (!row.series_checked) seriesPending++;
  }
  return {
    books: rows.map(shapeBookListItem),
    pending: {
      coversMissing,
      detailsPending,
      recommendationsPending: recsPending,
      recsPending,
      seriesPending,
    },
  };
}

async function getBookDetail(db, args) {
  const id = requireBookId(args, "id");
  const row = await getBookRow(db, id);
  return shapeBookDetail(row);
}

async function getSeries(db, args) {
  // Takes {bookId} — NOT {id}.
  const bookId = requireBookId(args, "bookId");
  const book = await getBookRow(db, bookId);
  if (!book.series_name) {
    // series_checked = 0 → membership unknown; a checked book with no
    // series_name simply has no series page. Either way: no entries, and
    // the book is never labeled standalone.
    return {
      found: false,
      bookId,
      name: null,
      seriesName: null,
      author: null,
      description: null,
      status: null,
      entries: [],
    };
  }
  const seriesName = book.series_name;
  let info = await db
    .prepare(`SELECT * FROM ${SERIES_TABLE} WHERE name = ?1`)
    .bind(seriesName)
    .first();
  if (!info) {
    const { results } = await db
      .prepare(`SELECT * FROM ${SERIES_TABLE}`)
      .all();
    info =
      (results || []).find(
        (r) => normalizeTitle(r.name) === normalizeTitle(seriesName)
      ) || null;
  }
  const books = await allBookRows(db);
  const ownedFor = (entry) => {
    const entryKey = entry.olWorkKey || entry.ol_work_key || null;
    const entryTitle = normalizeTitle(entry.title);
    return (
      books.find((b) => entryKey && b.ol_work_key === entryKey) ||
      books.find((b) => entry.bookId != null && b.id === entry.bookId) ||
      books.find((b) => entryTitle && normalizeTitle(b.title) === entryTitle) ||
      null
    );
  };
  let rawEntries = info ? parseJsonField(info.entries, []) : null;
  if (!Array.isArray(rawEntries)) rawEntries = [];
  let entries;
  if (info && rawEntries.length) {
    entries = rawEntries
      .slice()
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((entry) => {
        const owned = ownedFor(entry);
        const blobKey = entry.coverBlobKey || entry.cover_blob_key || null;
        return {
          title: entry.title ?? null,
          author: entry.author ?? null,
          position: entry.position ?? null,
          olWorkKey: entry.olWorkKey || entry.ol_work_key || null,
          coverBlobKey: blobKey,
          coverUrl: coverUrl(blobKey),
          bookId: owned ? owned.id : entry.bookId ?? null,
          owned: !!owned,
          rating: owned ? owned.rating ?? null : null,
          year_read: owned ? owned.year_read ?? null : null,
          yearRead: owned ? owned.year_read ?? null : null,
        };
      });
  } else {
    // No series_info row (or no entries): fall back to the library books
    // that share this series_name, in series order.
    entries = books
      .filter((b) => b.series_name === seriesName)
      .sort((a, b) => (a.series_position ?? 0) - (b.series_position ?? 0))
      .map((b) => ({
        title: b.title,
        author: b.author,
        position: b.series_position ?? null,
        olWorkKey: b.ol_work_key ?? null,
        coverBlobKey: b.cover_blob_key ?? null,
        coverUrl: coverUrl(b.cover_blob_key),
        bookId: b.id,
        owned: true,
        rating: b.rating ?? null,
        year_read: b.year_read ?? null,
        yearRead: b.year_read ?? null,
      }));
  }
  return {
    found: true,
    bookId,
    name: seriesName,
    seriesName,
    author: info ? info.author ?? null : book.author,
    description: info ? info.description ?? null : null,
    status: info ? info.status ?? null : null,
    key: info ? info.key ?? null : null,
    entries,
  };
}

async function getRecommendations(db, args) {
  const id = requireBookId(args, "id");
  const row = await getBookRow(db, id);
  // Cached set only — an empty/missing cache returns an empty list and is
  // never regenerated here (generation actions are out of scope).
  return { bookId: id, recommendations: parseRecommendations(row) };
}

async function getRecommendationDetail(db, args) {
  const workKey =
    (args && (args.olWorkKey || args.workKey || args.ol_work_key || args.key)) ||
    (args && typeof args.id === "string" ? args.id : null);
  if (!workKey) fail(400, "olWorkKey required");
  // Fetched live from Open Library per request; no server-side caching
  // beyond the request (kept simple, per spec).
  const detail = await fetchWorkDetail(workKey);
  return detail;
}

async function getWishlistItemDetail(db, args) {
  let row = null;
  if (args && (Number.isInteger(Number(args.id)) || typeof args.id === "number")) {
    const id = requireBookId(args, "id");
    row = await db
      .prepare(`SELECT * FROM ${WISHLIST_TABLE} WHERE id = ?1`)
      .bind(id)
      .first();
    if (!row) fail(404, "wishlist item not found");
  } else if (args && (args.olWorkKey || args.ol_work_key)) {
    const key = normalizeWorkKey(args.olWorkKey || args.ol_work_key);
    row = await db
      .prepare(`SELECT * FROM ${WISHLIST_TABLE} WHERE ol_work_key = ?1`)
      .bind(key)
      .first();
    if (!row) fail(404, "wishlist item not found");
  } else {
    fail(400, "id (or olWorkKey) required");
  }
  const cachedSubjects = parseJsonField(row.subjects, null);
  if (
    row.detail_fetched &&
    (row.synopsis || cachedSubjects || row.page_count !== null)
  ) {
    return {
      id: row.id,
      olWorkKey: row.ol_work_key ?? null,
      title: row.title,
      author: row.author ?? null,
      synopsis: row.synopsis ?? null,
      description: row.synopsis ?? null,
      subjects: cachedSubjects || [],
      pageCount: row.page_count ?? null,
      publishYear: row.publish_year ?? null,
      firstPublishedYear: row.publish_year ?? null,
      firstPublishDate: null,
      fromCache: true,
    };
  }
  if (!row.ol_work_key) {
    return {
      id: row.id,
      olWorkKey: null,
      title: row.title,
      author: row.author ?? null,
      synopsis: row.synopsis ?? null,
      description: row.synopsis ?? null,
      subjects: cachedSubjects || [],
      pageCount: row.page_count ?? null,
      publishYear: row.publish_year ?? null,
      firstPublishedYear: row.publish_year ?? null,
      firstPublishDate: null,
      fromCache: !!row.detail_fetched,
    };
  }
  const detail = await fetchWorkDetail(row.ol_work_key);
  // Cache the first fetch on the wishlist row, as the original did.
  try {
    await db
      .prepare(
        `UPDATE ${WISHLIST_TABLE} SET synopsis = ?1, subjects = ?2, page_count = ?3, publish_year = ?4, detail_fetched = 1 WHERE id = ?5`
      )
      .bind(
        detail.synopsis ?? row.synopsis ?? null,
        detail.subjects && detail.subjects.length
          ? JSON.stringify(detail.subjects)
          : row.subjects ?? null,
        detail.pageCount ?? row.page_count ?? null,
        detail.firstPublishedYear ?? row.publish_year ?? null,
        row.id
      )
      .run();
  } catch {
    /* caching is best-effort; the fetched detail is still returned */
  }
  return { id: row.id, ...detail, fromCache: false };
}

async function getWishlistRecommendations(db) {
  const { results: sourceRows } = await db
    .prepare(
      `SELECT * FROM ${BOOKS_TABLE} WHERE rating >= 4 ORDER BY rating DESC, position ASC, id ASC`
    )
    .all();
  const books = await allBookRows(db);
  const { results: wishlistRows } = await db
    .prepare(`SELECT * FROM ${WISHLIST_TABLE}`)
    .all();
  const { results: dismissedRows } = await db
    .prepare(`SELECT * FROM ${DISMISSED_TABLE}`)
    .all();
  const blockedKeys = new Set();
  const blockedTitles = new Set();
  const block = (key, title) => {
    const nk = normalizeWorkKey(key);
    if (nk) blockedKeys.add(nk);
    const nt = normalizeTitle(title);
    if (nt) blockedTitles.add(nt);
  };
  for (const b of books) block(b.ol_work_key, b.title);
  for (const w of wishlistRows || []) block(w.ol_work_key, w.title);
  for (const d of dismissedRows || []) block(d.ol_work_key, d.title);
  const seen = new Set();
  const out = [];
  for (const row of sourceRows || []) {
    for (const pick of parseRecommendations(row)) {
      const nk = normalizeWorkKey(pick.olWorkKey);
      const nt = normalizeTitle(pick.title);
      const dedupeKey = nk || `title:${nt}`;
      if (!dedupeKey || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      if (nk && blockedKeys.has(nk)) continue;
      if (nt && blockedTitles.has(nt)) continue;
      out.push({
        ...pick,
        sourceBookId: row.id,
        sourceBookTitle: row.title,
      });
      if (out.length >= 12) return { recommendations: out };
    }
  }
  return { recommendations: out };
}

async function listWishlist(db) {
  const { results } = await db
    .prepare(`SELECT * FROM ${WISHLIST_TABLE} ORDER BY position ASC, id ASC`)
    .all();
  return { items: (results || []).map(shapeWishlistItem) };
}

/* ================================ WRITES ================================ */

const ALLOWED_STATUSES = new Set(["read", "currently_reading", "want_to_read"]);

function pickField(args, camel, snake) {
  if (args && camel in args) return { present: true, value: args[camel] };
  if (args && snake in args) return { present: true, value: args[snake] };
  return { present: false, value: undefined };
}

async function updateBook(db, args) {
  const id = requireBookId(args, "id");
  const existing = await getBookRow(db, id);
  const sets = {};
  const currentYear = new Date().getFullYear();

  const rating = pickField(args, "rating", "rating");
  if (rating.present) {
    if (rating.value === null) {
      sets.rating = null; // back to unrated — NULL, never 0
    } else {
      const r = Number(rating.value);
      if (
        !Number.isFinite(r) ||
        r < 0 ||
        r > 5 ||
        Math.abs(r * 2 - Math.round(r * 2)) > 1e-9
      ) {
        fail(400, "rating must be null or a half-step between 0 and 5");
      }
      sets.rating = r;
    }
  }
  const notes = pickField(args, "personalNotes", "personal_notes");
  if (notes.present) {
    if (notes.value !== null && typeof notes.value !== "string") {
      fail(400, "personalNotes must be a string");
    }
    sets.personal_notes = notes.value ?? "";
  }
  const answers = pickField(args, "reviewAnswers", "review_answers");
  if (answers.present) {
    sets.review_answers = toJsonText(answers.value);
  }
  const statusNote = pickField(args, "statusNote", "status_note");
  if (statusNote.present) {
    if (statusNote.value !== null && typeof statusNote.value !== "string") {
      fail(400, "statusNote must be a string");
    }
    sets.status_note = statusNote.value;
  }
  const yearRead = pickField(args, "yearRead", "year_read");
  if (yearRead.present) {
    if (yearRead.value === null) sets.year_read = null;
    else {
      const y = Number(yearRead.value);
      if (!Number.isInteger(y)) fail(400, "yearRead must be an integer or null");
      sets.year_read = y;
    }
  }
  const status = pickField(args, "status", "status");
  if (status.present) {
    if (!ALLOWED_STATUSES.has(status.value)) {
      fail(400, "status must be 'read', 'currently_reading', or 'want_to_read'");
    }
    sets.status = status.value;
  }

  const abandon = pickField(args, "abandonReason", "abandon_reason");
  if (abandon.present && typeof abandon.value === "string" && abandon.value.trim()) {
    // Abandoning: shelved as read at 0 stars in the current year, reason in
    // status_note as "Abandoned — <reason>". Overrides the fields above.
    sets.status = "read";
    sets.rating = 0;
    sets.year_read = currentYear;
    sets.status_note = `Abandoned — ${abandon.value.trim()}`;
  } else if (sets.status === "read") {
    // Finished flow: a book finished now was read this year, unless the
    // caller supplied an explicit yearRead.
    if (!("year_read" in sets) && existing.year_read === null) {
      sets.year_read = currentYear;
    }
  } else if (sets.status === "currently_reading") {
    // Invariant: currently-reading books have year_read NULL.
    if (!("year_read" in sets)) sets.year_read = null;
  }

  const cols = Object.keys(sets);
  if (!cols.length) fail(400, "no updatable fields provided");
  const sql = `UPDATE ${BOOKS_TABLE} SET ${cols
    .map((c, i) => `${c} = ?${i + 1}`)
    .join(", ")} WHERE id = ?${cols.length + 1}`;
  await db
    .prepare(sql)
    .bind(...cols.map((c) => sets[c]), id)
    .run();
  const updated = await getBookRow(db, id);
  return shapeBookDetail(updated);
}

async function addBook(db, args) {
  const rawKey = args && (args.olWorkKey || args.ol_work_key || args.workKey);
  const workKey = rawKey ? normalizeWorkKey(rawKey) : null;
  let title = args && typeof args.title === "string" ? args.title.trim() : "";
  let author = args && typeof args.author === "string" ? args.author.trim() : "";
  let publishYear = null;
  let olDescription = null;
  let subjects = null;
  let resolvedKey = null;

  if (workKey) {
    try {
      const detail = await fetchWorkDetail(workKey);
      if (!title && detail.title) title = detail.title;
      if (!author && detail.author) author = detail.author;
      publishYear = detail.firstPublishedYear ?? null;
      olDescription = detail.synopsis ?? null;
      subjects =
        detail.subjects && detail.subjects.length
          ? JSON.stringify(detail.subjects)
          : null;
    } catch {
      /* metadata is best-effort; the caller's title/author still shelve */
    }
  }
  if (!title) fail(400, "title required (or an olWorkKey that resolves to one)");
  if (!workKey) {
    const found = await searchOpenLibrary(title, author || undefined);
    if (found) {
      if (!author && found.author) author = found.author;
      publishYear = found.publishYear ?? null;
      // Re-resolve through the work key for description/subjects.
      if (found.olWorkKey) {
        try {
          const detail = await fetchWorkDetail(found.olWorkKey);
          olDescription = detail.synopsis ?? null;
          subjects =
            detail.subjects && detail.subjects.length
              ? JSON.stringify(detail.subjects)
              : null;
          if (publishYear === null) publishYear = detail.firstPublishedYear ?? null;
        } catch {
          /* best-effort */
        }
      }
      resolvedKey = found.olWorkKey;
    }
  }
  const finalKey = workKey || resolvedKey;
  const status =
    args && ALLOWED_STATUSES.has(args.status) ? args.status : "currently_reading";
  const position = await nextPosition(db, BOOKS_TABLE);
  // NOTE (cover handling): cover_blob_key stays NULL on purpose. The old
  // "covers/book-<newid>.jpg" convention would point at bytes that do not
  // exist (nothing downloads a cover here), so the coverUrl helper returns
  // null and the client shows its placeholder until the covers pipeline
  // supplies a real file and key. The book counts as "covers missing" in
  // listBooks' pending counts in the meantime.
  const result = await db
    .prepare(
      `INSERT INTO ${BOOKS_TABLE} (title, author, author_hint, year_read, rating, status, publish_year, position, cover_blob_key, ol_work_key, ol_description, subjects, detail_status, personal_notes, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9, ?10, ?11, 'none', '', ?12)`
    )
    .bind(
      title,
      author || "Unknown",
      author || null,
      status === "read" ? new Date().getFullYear() : null,
      null,
      status,
      publishYear,
      position,
      finalKey,
      olDescription,
      subjects,
      Date.now()
    )
    .run();
  const newId = result && result.meta ? result.meta.last_row_id : null;
  if (!newId) fail(500, "insert did not return a new id");
  const row = await getBookRow(db, Number(newId));
  return shapeBookDetail(row);
}

async function addWishlistItem(db, args) {
  const rawKey = args && (args.olWorkKey || args.ol_work_key || args.workKey);
  const workKey = rawKey ? normalizeWorkKey(rawKey) : null;
  let title = args && typeof args.title === "string" ? args.title.trim() : "";
  let author = args && typeof args.author === "string" ? args.author.trim() : "";

  // Dedupe first: same work key, or same normalized title → existing entry.
  if (workKey) {
    const existing = await db
      .prepare(`SELECT * FROM ${WISHLIST_TABLE} WHERE ol_work_key = ?1`)
      .bind(workKey)
      .first();
    if (existing) return shapeWishlistItem(existing);
  }
  if (title) {
    const { results } = await db
      .prepare(`SELECT * FROM ${WISHLIST_TABLE} ORDER BY position ASC, id ASC`)
      .all();
    const dupe = (results || []).find(
      (r) => normalizeTitle(r.title) === normalizeTitle(title)
    );
    if (dupe) return shapeWishlistItem(dupe);
  }

  let resolvedKey = workKey;
  if (workKey) {
    try {
      const detail = await fetchWorkDetail(workKey);
      if (!title && detail.title) title = detail.title;
      if (!author && detail.author) author = detail.author;
    } catch {
      /* best-effort */
    }
  } else if (title) {
    const found = await searchOpenLibrary(title, author || undefined);
    if (found) {
      if (!author && found.author) author = found.author;
      resolvedKey = found.olWorkKey;
    }
  }
  if (!title) fail(400, "title required (or an olWorkKey that resolves to one)");

  const position = await nextPosition(db, WISHLIST_TABLE);
  const source =
    args && typeof args.source === "string" && args.source ? args.source : "manual";
  // cover_blob_key stays NULL: listWishlist derives the cover URL from the
  // work key ("wishlist/<WORKKEY>.jpg") until a real key is stored.
  const result = await db
    .prepare(
      `INSERT INTO ${WISHLIST_TABLE} (title, author, ol_work_key, cover_blob_key, source, position, detail_fetched, created_at)
       VALUES (?1, ?2, ?3, NULL, ?4, ?5, 0, ?6)`
    )
    .bind(title, author || null, resolvedKey, source, position, Date.now())
    .run();
  const newId = result && result.meta ? result.meta.last_row_id : null;
  const row = await db
    .prepare(`SELECT * FROM ${WISHLIST_TABLE} WHERE id = ?1`)
    .bind(Number(newId))
    .first();
  return shapeWishlistItem(row);
}

async function removeWishlistItem(db, args) {
  const id = requireBookId(args, "id");
  const existing = await db
    .prepare(`SELECT id FROM ${WISHLIST_TABLE} WHERE id = ?1`)
    .bind(id)
    .first();
  if (!existing) fail(404, "wishlist item not found");
  await db.prepare(`DELETE FROM ${WISHLIST_TABLE} WHERE id = ?1`).bind(id).run();
  return { removed: true, id };
}

async function startWishlistItem(db, args) {
  const id = requireBookId(args, "id");
  const item = await db
    .prepare(`SELECT * FROM ${WISHLIST_TABLE} WHERE id = ?1`)
    .bind(id)
    .first();
  if (!item) fail(404, "wishlist item not found");
  // Carry the cover over via the wishlist cover-path convention
  // ("wishlist/<WORKKEY>.jpg") so the new book's coverUrl resolves to the
  // same file the wishlist showed; keep a stored key when there is one.
  const wkId = workKeyId(item.ol_work_key);
  const coverBlobKey =
    item.cover_blob_key || (wkId ? `wishlist/${wkId}.jpg` : null);
  const position = await nextPosition(db, BOOKS_TABLE);
  const result = await db
    .prepare(
      `INSERT INTO ${BOOKS_TABLE} (title, author, author_hint, year_read, rating, status, publish_year, position, cover_blob_key, ol_work_key, ol_description, subjects, detail_status, personal_notes, created_at)
       VALUES (?1, ?2, ?3, NULL, NULL, 'currently_reading', ?4, ?5, ?6, ?7, ?8, ?9, 'none', '', ?10)`
    )
    .bind(
      item.title,
      item.author || "Unknown",
      item.author || null,
      item.publish_year ?? null,
      position,
      coverBlobKey,
      item.ol_work_key ?? null,
      item.synopsis ?? null,
      item.subjects ?? null,
      Date.now()
    )
    .run();
  const newId = result && result.meta ? result.meta.last_row_id : null;
  if (!newId) fail(500, "insert did not return a new id");
  await db.prepare(`DELETE FROM ${WISHLIST_TABLE} WHERE id = ?1`).bind(id).run();
  const row = await getBookRow(db, Number(newId));
  return shapeBookDetail(row);
}

async function dismissWishlistRecommendation(db, args) {
  const rawKey = args && (args.olWorkKey || args.ol_work_key || args.workKey);
  const workKey = rawKey ? normalizeWorkKey(rawKey) : null;
  if (!workKey) fail(400, "olWorkKey required");
  const existing = await db
    .prepare(`SELECT * FROM ${DISMISSED_TABLE} WHERE ol_work_key = ?1`)
    .bind(workKey)
    .first();
  if (existing) {
    return {
      dismissed: true,
      already: true,
      id: existing.id,
      olWorkKey: existing.ol_work_key,
      title: existing.title ?? null,
      author: existing.author ?? null,
    };
  }
  const title = args && typeof args.title === "string" ? args.title : null;
  const author = args && typeof args.author === "string" ? args.author : null;
  const result = await db
    .prepare(
      `INSERT INTO ${DISMISSED_TABLE} (ol_work_key, title, author, created_at) VALUES (?1, ?2, ?3, ?4)`
    )
    .bind(workKey, title, author, Date.now())
    .run();
  return {
    dismissed: true,
    already: false,
    id: result && result.meta ? result.meta.last_row_id : null,
    olWorkKey: workKey,
    title,
    author,
  };
}

/* ============================== DISPATCHER ============================== */

const ACTIONS = {
  listBooks,
  getBookDetail,
  getSeries,
  getRecommendations,
  getRecommendationDetail,
  getWishlistItemDetail,
  getWishlistRecommendations,
  listWishlist,
  updateBook,
  addBook,
  addWishlistItem,
  removeWishlistItem,
  startWishlistItem,
  dismissWishlistRecommendation,
};

export async function onRequestPost(context) {
  const { env, request } = context;
  const identity = await requireIdentity(env, request);
  if (!identity) return json({ ok: false, error: "not signed in" }, 401);
  if (!appAllowed(identity, APP_SLUG)) {
    return json({ ok: false, error: "this account doesn't cover this app" }, 403);
  }
  if (!env.DB) return json({ ok: false, error: "db not bound" }, 500);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad json" }, 400);
  }
  const action = body && typeof body.action === "string" ? body.action : "";
  const handler = ACTIONS[action];
  if (!handler) {
    return json({ ok: false, error: `unknown action: ${action || "(missing)"}` }, 400);
  }
  const args = body && body.args && typeof body.args === "object" ? body.args : {};
  try {
    await ensureLibrarySchema(env.DB);
    const data = await handler(env.DB, args);
    return json({ ok: true, data }, 200);
  } catch (err) {
    if (err instanceof ActionError) {
      return json({ ok: false, error: err.message }, err.status);
    }
    return json(
      { ok: false, error: err && err.message ? err.message : "internal error" },
      500
    );
  }
}
