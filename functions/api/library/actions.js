// Library microsite — single actions dispatcher.
//
// POST /api/library/actions  { action, args }  →  { ok: true, data }
//                                                  { ok: false, error }
//
// AUDITED 2026-11-07 against Sarah's REAL server code
// (books-library-export/source/server/src/actions.ts) and the real client
// (client/src/App.tsx). Every action below mirrors the real action's
// argument names and its exact response shape (field names, casing,
// nesting, null vs missing). The {ok,data} envelope and the platform auth
// pattern (requireIdentity + appAllowed) are the hosting layer's and are
// unchanged.
//
// Background/AI actions (importLibrary, prepareBookDetail, enrichCovers,
// optimizeCovers, preloadDetails, preloadRecommendations, preloadSeries)
// are SAFE NO-OP STUBS: the hosted D1 is the master copy and all
// generation was already done before export, so each stub returns the
// real action's response shape with zero progress (processed: 0 /
// ready: 0, remaining: the real pending count). The client's auto-load
// loops break immediately on processed===0 / ready===0, so they
// terminate silently on the first batch. importLibrary imports nothing.
// prepareBookDetail returns the book's stored detail (the real action
// returns the fresh DetailResponse; with nothing to generate, the stored
// response IS the fresh one). The long-running populate*/loadEverything
// passes and the export* actions are not part of the client app and stay
// unimplemented (400).

import { appAllowed, json, requireIdentity } from "../../_lib/auth.js";
import {
  BOOKS_TABLE,
  DISMISSED_TABLE,
  SERIES_TABLE,
  WISHLIST_TABLE,
  authorFuzzyMatch,
  baseTitle,
  buildDetailResponse,
  coverUrl,
  emptyDetailResponse,
  ensureLibrarySchema,
  isJunkRec,
  isLatinTitle,
  normalizeWorkKey,
  parseSeriesEntries,
  parseStoredRecs,
  pendingCounts,
  recCacheComplete,
  seriesKey,
  shapeBookSummary,
  shapeRecommendationOut,
  shapeWishlistItem,
  wishlistCoverBlobKey,
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

async function allBookRows(db) {
  const { results } = await db.prepare(`SELECT * FROM ${BOOKS_TABLE}`).all();
  return results || [];
}

async function allWishlistRows(db) {
  const { results } = await db.prepare(`SELECT * FROM ${WISHLIST_TABLE}`).all();
  return results || [];
}

async function findBookRow(db, id) {
  return db.prepare(`SELECT * FROM ${BOOKS_TABLE} WHERE id = ?1`).bind(id).first();
}

async function findWishlistRow(db, id) {
  return db.prepare(`SELECT * FROM ${WISHLIST_TABLE} WHERE id = ?1`).bind(id).first();
}

// Real listBooks ordering: yearRead ASC (NULLs first), position ASC, id ASC.
function byYearPositionId(a, b) {
  const ya = a.year_read ?? null;
  const yb = b.year_read ?? null;
  if (ya === null && yb !== null) return -1;
  if (ya !== null && yb === null) return 1;
  if (ya !== null && yb !== null && ya !== yb) return ya - yb;
  if ((a.position ?? 0) !== (b.position ?? 0)) return (a.position ?? 0) - (b.position ?? 0);
  return a.id - b.id;
}

function byPositionId(a, b) {
  if ((a.position ?? 0) !== (b.position ?? 0)) return (a.position ?? 0) - (b.position ?? 0);
  return a.id - b.id;
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

function isProbablyEnglish(text) {
  const sample = text.slice(0, 400).toLowerCase();
  const hits = [" the ", " and ", " is ", " of ", " to ", " a ", " in "].filter((w) =>
    sample.includes(w),
  ).length;
  return hits >= 2;
}

// The real fetchWorkPreview(): display details for any book identified
// only by its Open Library work key — English description (>= 40 chars)
// as synopsis, subjects (max 12), the MEDIAN edition page count, and the
// EARLIEST edition year. Missing data stays null, never guessed.
async function fetchWorkPreview(workKey) {
  let synopsis = null;
  let pageCount = null;
  let publishYear = null;
  let subjects = [];
  try {
    const work = await fetchJson(`https://openlibrary.org${workKey}.json`);
    const raw =
      typeof work.description === "string" ? work.description : work.description?.value;
    if (typeof raw === "string" && raw) {
      const cleaned = raw.replace(/\r\n/g, "\n").trim();
      if (cleaned.length >= 40 && isProbablyEnglish(cleaned)) {
        synopsis = cleaned.slice(0, 4000);
      }
    }
    if (Array.isArray(work.subjects) && work.subjects.length > 0) {
      subjects = work.subjects.filter((s) => typeof s === "string").slice(0, 12);
    }
  } catch {
    /* the editions pass may still land */
  }
  try {
    const ed = await fetchJson(`https://openlibrary.org${workKey}/editions.json?limit=50`);
    const entries = Array.isArray(ed.entries) ? ed.entries : [];
    const pages = entries
      .map((e) => e.number_of_pages)
      .filter((n) => typeof n === "number" && n > 0)
      .sort((a, b) => a - b);
    if (pages.length > 0) pageCount = pages[Math.floor(pages.length / 2)] ?? null;
    const years = entries
      .map((e) => {
        const m = String(e.publish_date ?? "").match(/\d{4}/);
        return m ? Number(m[0]) : null;
      })
      .filter((y) => y !== null && y >= 1450 && y <= 2030);
    if (years.length > 0) publishYear = Math.min(...years);
  } catch {
    /* length/year stay unknown rather than guessed */
  }
  return { synopsis, pageCount, publishYear, subjects };
}

// Best-effort single-doc Open Library search (metadata enrichment for
// addBook / typed wishlist adds). Returns null on any failure — callers
// always shelve the caller's own title/author regardless.
async function searchOpenLibrary(title, author) {
  const q = author ? `${title} ${author}` : title;
  const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(
    title,
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
      subjects: Array.isArray(doc.subject) ? doc.subject.slice(0, 12) : [],
    };
  } catch {
    return null;
  }
}

/* ================================ READS ================================ */

// Real: { books: BookSummary[], coversPending, coversMissing,
//         coversUnoptimized, detailsPending, recsPending, seriesPending }
// — flat top-level counts (the client reads list.data.coversPending etc.),
// books ordered by yearRead/position/id.
async function listBooks(db) {
  const rows = await allBookRows(db);
  const counts = pendingCounts(rows);
  return {
    books: rows.slice().sort(byYearPositionId).map(shapeBookSummary),
    ...counts,
  };
}

// Real: DetailResponse for the stored row; a missing book returns the
// ok:false empty detail payload (never a throw). force=true is the
// explicit regenerate path in the real action; generation does not exist
// on this host, so force returns the same stored response (documented
// no-op — the client's regenerate control simply re-renders stored data).
async function getBookDetail(db, args) {
  const id = requireBookId(args, "id");
  const row = await findBookRow(db, id);
  if (!row) return emptyDetailResponse();
  return buildDetailResponse(row);
}

// Real series response: { found, name, author, description, totalBooks,
// readCount, entries: [{ title, position, author, coverUrl, olWorkKey,
// bookId, inLibrary, bookStatus, rating, yearRead }] }.
async function getSeries(db, args) {
  const bookId = requireBookId(args, "bookId");
  const empty = {
    found: false,
    name: null,
    author: null,
    description: null,
    totalBooks: 0,
    readCount: 0,
    entries: [],
  };
  const book = await findBookRow(db, bookId);
  if (!book) return empty;

  const { results: seriesRows } = await db.prepare(`SELECT * FROM ${SERIES_TABLE}`).all();
  const records = seriesRows || [];
  const readyRecords = records.filter((r) => r.status === "ready");

  // Stored-data equivalent of the real ensureSeriesInfo step (1): a
  // ready series record whose entries name this title settles membership
  // with no lookup. (The real action's further steps generate; the
  // hosted copy uses only what is stored.)
  let seriesName = book.series_name ?? null;
  if (!seriesName) {
    const author = book.author ?? book.author_hint;
    const myBase = baseTitle(book.title);
    for (const rec of readyRecords) {
      if (!authorFuzzyMatch(rec.author, author)) continue;
      const hit = parseSeriesEntries(rec.entries).find(
        (e) => baseTitle(e.title) === myBase,
      );
      if (hit) {
        seriesName = rec.name;
        break;
      }
    }
  }
  if (!seriesName) return { ...empty, author: book.author ?? null };

  // Record lookup by the real series key first, then by normalised name
  // (seeded keys are seriesKey(name, author) already).
  const key = seriesKey(seriesName, book.author ?? null);
  let record =
    records.find((r) => r.key === key) ||
    records.find((r) => baseTitle(r.name) === baseTitle(seriesName)) ||
    null;
  if (!record || record.status !== "ready") {
    // The real action returns found:true with the name/author while the
    // series page is still being gathered.
    return { ...empty, found: true, name: seriesName, author: book.author ?? null };
  }

  const books = await allBookRows(db);
  const byId = new Map(books.map((b) => [b.id, b]));
  const stored = parseSeriesEntries(record.entries);
  const sorted = stored.slice().sort((a, b) => {
    if (a.position !== null && b.position !== null) return a.position - b.position;
    if (a.position !== null) return -1;
    if (b.position !== null) return 1;
    return a.title.localeCompare(b.title);
  });
  let readCount = 0;
  const entries = sorted.map((e) => {
    // Live re-match, as the real buildSeriesResponse does.
    let owned = e.bookId !== null ? byId.get(e.bookId) : undefined;
    if (!owned) {
      owned = books.find(
        (r) =>
          baseTitle(r.title) === baseTitle(e.title) &&
          (record.author === null ||
            r.author === null ||
            authorFuzzyMatch(r.author, record.author)),
      );
    }
    if (owned) {
      if (owned.status === "read") readCount += 1;
      return {
        title: owned.title,
        position: e.position,
        author: owned.author ?? null,
        coverUrl: coverUrl(owned.cover_blob_key),
        olWorkKey: e.olWorkKey,
        bookId: owned.id,
        inLibrary: true,
        bookStatus: owned.status,
        rating: owned.rating ?? null,
        yearRead: owned.year_read ?? null,
      };
    }
    return {
      title: e.title,
      position: e.position,
      author: e.author,
      coverUrl: coverUrl(e.coverBlobKey),
      olWorkKey: e.olWorkKey,
      bookId: null,
      inLibrary: false,
      bookStatus: null,
      rating: null,
      yearRead: null,
    };
  });
  return {
    found: true,
    name: record.name,
    author: record.author ?? null,
    description: record.description ?? null,
    totalBooks: entries.length,
    readCount,
    entries,
  };
}

// Real: { recommendations: Recommendation[] } — the book's cached set;
// a missing book returns an empty list (never a throw).
async function getRecommendations(db, args) {
  const id = requireBookId(args, "id");
  const row = await findBookRow(db, id);
  if (!row) return { recommendations: [] };
  return {
    recommendations: parseStoredRecs(row.recommendations).map(shapeRecommendationOut),
  };
}

// Real: PreviewDetailResponse { ok, synopsis, pageCount, publishYear,
// subjects }, fetched live by { olWorkKey }. An unusable key returns
// ok:false with nulls (the real fetchWorkPreview contract).
async function getRecommendationDetail(db, args) {
  const rawKey = args && typeof args.olWorkKey === "string" ? args.olWorkKey : "";
  if (!rawKey) fail(400, "olWorkKey required");
  const key = normalizeWorkKey(rawKey);
  if (!key) {
    return { ok: false, synopsis: null, pageCount: null, publishYear: null, subjects: [] };
  }
  const preview = await fetchWorkPreview(key);
  return { ok: true, ...preview };
}

// Real: WishlistDetailResponse { ok, title, author, coverUrl, synopsis,
// pageCount, publishYear, subjects }. A missing item returns ok:false
// with an empty title (never a throw). Details are fetched once from
// Open Library and cached on the row (detail_fetched), exactly like the
// real fetchWishlistDetail.
async function getWishlistItemDetail(db, args) {
  const id = requireBookId(args, "id");
  const row = await findWishlistRow(db, id);
  if (!row) {
    return {
      ok: false,
      title: "",
      author: null,
      coverUrl: null,
      synopsis: null,
      pageCount: null,
      publishYear: null,
      subjects: [],
    };
  }
  let full = row;
  if (!row.detail_fetched) {
    full = await fetchAndCacheWishlistDetail(db, row);
  }
  return {
    ok: true,
    title: full.title,
    author: full.author ?? null,
    coverUrl: coverUrl(wishlistCoverBlobKey(full)),
    synopsis: full.synopsis ?? null,
    pageCount: full.page_count ?? null,
    publishYear: full.publish_year ?? null,
    subjects: parseSubjects(full.subjects),
  };
}

function parseSubjects(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) return parsed.filter((s) => typeof s === "string");
  } catch {
    /* fall through */
  }
  return [];
}

// The real fetchWishlistDetail, minus cover resolution: resolve a
// missing work key by search, then cache the preview fields on the row
// and mark detail_fetched. Patch semantics match the real action: the
// synopsis is only overwritten when a usable one was fetched, subjects
// only when non-empty; page count / year only when editions yielded
// them.
async function fetchAndCacheWishlistDetail(db, row) {
  let r = row;
  if (!r.ol_work_key) {
    const found = await searchOpenLibrary(r.title, r.author || undefined);
    if (found && found.olWorkKey) {
      await db
        .prepare(`UPDATE ${WISHLIST_TABLE} SET ol_work_key = ?1 WHERE id = ?2`)
        .bind(found.olWorkKey, r.id)
        .run();
      r = { ...r, ol_work_key: found.olWorkKey };
    }
  }
  const patch = { detail_fetched: 1 };
  if (r.ol_work_key) {
    const preview = await fetchWorkPreview(r.ol_work_key);
    if (preview.synopsis !== null) patch.synopsis = preview.synopsis;
    if (preview.subjects.length > 0) patch.subjects = JSON.stringify(preview.subjects);
    if (preview.pageCount !== null) patch.page_count = preview.pageCount;
    if (preview.publishYear !== null) patch.publish_year = preview.publishYear;
  }
  const cols = Object.keys(patch);
  const sql = `UPDATE ${WISHLIST_TABLE} SET ${cols
    .map((c, i) => `${c} = ?${i + 1}`)
    .join(", ")} WHERE id = ?${cols.length + 1}`;
  await db.prepare(sql).bind(...cols.map((c) => patch[c]), r.id).run();
  const fresh = await findWishlistRow(db, r.id);
  return fresh || { ...r, ...patch };
}

// Real wishlistRecPool(): the cached "more like this" sets of books
// rated 4+ (read shelf, highest rated first, then most recent year),
// screened again here — dismissed keys, wishlist keys, non-Latin or
// "--" titles, junk, and base-title duplicates against the library and
// the wishlist are all excluded; capped at twelve. The real pool tops
// up by generating missing sets; here the stored caches of
// not-yet-complete books are the fallback (already screened the same
// way), since there is no generation on this host.
async function getWishlistRecommendations(db) {
  const books = await allBookRows(db);
  const wishlist = await allWishlistRows(db);
  const { results: dismissedRows } = await db
    .prepare(`SELECT * FROM ${DISMISSED_TABLE}`)
    .all();
  const dismissedKeys = new Set((dismissedRows || []).map((d) => d.ol_work_key));
  const wishKeys = new Set(
    wishlist.map((w) => w.ol_work_key).filter((k) => typeof k === "string"),
  );
  const libraryBase = new Set(books.map((r) => baseTitle(r.title)));
  const wishBase = new Set(wishlist.map((w) => baseTitle(w.title)));
  const sources = books
    .filter((r) => r.status === "read" && (r.rating ?? 0) >= 4)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.year_read ?? 0) - (a.year_read ?? 0));

  const pool = [];
  const seenBase = new Set();
  const considerRec = (rec) => {
    if (dismissedKeys.has(rec.olWorkKey) || wishKeys.has(rec.olWorkKey)) return;
    if (!isLatinTitle(rec.title) || rec.title.includes("--")) return;
    if (isJunkRec({ title: rec.title, author: rec.author })) return;
    const bt = baseTitle(rec.title);
    if (!bt || seenBase.has(bt) || libraryBase.has(bt) || wishBase.has(bt)) return;
    seenBase.add(bt);
    pool.push(rec);
  };
  for (const src of sources) {
    if (recCacheComplete(src)) {
      for (const rec of parseStoredRecs(src.recommendations)) considerRec(rec);
    }
  }
  for (const src of sources) {
    if (pool.length >= 12) break;
    if (recCacheComplete(src)) continue;
    for (const rec of parseStoredRecs(src.recommendations)) considerRec(rec);
  }
  return {
    recommendations: pool.slice(0, 12).map(shapeRecommendationOut),
  };
}

// Real: { items: WishlistItem[] } in position order.
async function listWishlist(db) {
  const rows = await allWishlistRows(db);
  return { items: rows.slice().sort(byPositionId).map(shapeWishlistItem) };
}

/* ================================ WRITES ================================ */

// Real updateBook: a pure patch of Sarah's own fields — no implicit
// year/status side effects (the client composes e.g. the Abandon flow
// itself: status 'read' + rating 0 + yearRead + statusNote). Response
// is exactly { ok: true }; a missing book is still ok:true in the real
// action (the update simply matches no row). reviewAnswers are cleaned
// the real way: blank answers are dropped before storing.
async function updateBook(db, args) {
  const id = requireBookId(args, "id");
  const patch = {};
  if (args.rating !== undefined) {
    if (args.rating !== null) {
      const r = Number(args.rating);
      if (!Number.isFinite(r) || r < 0 || r > 5) {
        fail(400, "rating must be null or a number between 0 and 5");
      }
      patch.rating = r;
    } else {
      patch.rating = null; // back to unrated — NULL, never 0
    }
  }
  if (args.personalNotes !== undefined) {
    if (args.personalNotes !== null && typeof args.personalNotes !== "string") {
      fail(400, "personalNotes must be a string");
    }
    patch.personal_notes = args.personalNotes ?? "";
  }
  if (args.reviewAnswers !== undefined) {
    if (
      args.reviewAnswers !== null &&
      (typeof args.reviewAnswers !== "object" || Array.isArray(args.reviewAnswers))
    ) {
      fail(400, "reviewAnswers must be an object");
    }
    const cleaned = {};
    for (const [k, v] of Object.entries(args.reviewAnswers || {})) {
      if (typeof v === "string" && v.trim()) cleaned[k] = v;
    }
    patch.review_answers = JSON.stringify(cleaned);
  }
  if (args.status !== undefined) {
    if (args.status !== "read" && args.status !== "currently_reading") {
      fail(400, "status must be 'read' or 'currently_reading'");
    }
    patch.status = args.status;
  }
  if (args.yearRead !== undefined) {
    if (args.yearRead !== null) {
      const y = Number(args.yearRead);
      if (!Number.isInteger(y) || y < 1990 || y > 2100) {
        fail(400, "yearRead must be an integer between 1990 and 2100, or null");
      }
      patch.year_read = y;
    } else {
      patch.year_read = null;
    }
  }
  if (args.statusNote !== undefined) {
    if (args.statusNote !== null && typeof args.statusNote !== "string") {
      fail(400, "statusNote must be a string or null");
    }
    patch.status_note = args.statusNote;
  }
  const cols = Object.keys(patch);
  if (cols.length > 0) {
    const sql = `UPDATE ${BOOKS_TABLE} SET ${cols
      .map((c, i) => `${c} = ?${i + 1}`)
      .join(", ")} WHERE id = ?${cols.length + 1}`;
    await db.prepare(sql).bind(...cols.map((c) => patch[c]), id).run();
  }
  return { ok: true };
}

// Real addBook: { title, author?, yearRead?, rating?, status (default
// 'read'), isAudiobook (default false) } → { book: BookSummary }.
// Position is next within the same status + yearRead group. The real
// action then enriches cover/metadata from Open Library; here metadata
// enrichment is best-effort only and cover_blob_key stays NULL (no
// cover bytes exist for a brand-new book on this host, so coverUrl is
// null and the client shows its placeholder — the book counts toward
// coversMissing in listBooks, like the real thing before enrichment).
async function addBook(db, args) {
  const title = args && typeof args.title === "string" ? args.title.trim() : "";
  if (!title) fail(400, "title required");
  const author = args && typeof args.author === "string" ? args.author.trim() || null : null;
  const status = args && args.status !== undefined ? args.status : "read";
  if (status !== "read" && status !== "currently_reading") {
    fail(400, "status must be 'read' or 'currently_reading'");
  }
  let yearRead = null;
  if (args && args.yearRead !== undefined && args.yearRead !== null) {
    const y = Number(args.yearRead);
    if (!Number.isInteger(y) || y < 1990 || y > 2100) {
      fail(400, "yearRead must be an integer between 1990 and 2100, or null");
    }
    yearRead = y;
  }
  let rating = null;
  if (args && args.rating !== undefined && args.rating !== null) {
    const r = Number(args.rating);
    if (!Number.isFinite(r) || r < 0 || r > 5) {
      fail(400, "rating must be null or a number between 0 and 5");
    }
    rating = r;
  }
  const isAudiobook = args && args.isAudiobook ? 1 : 0;

  const siblings = await allBookRows(db);
  const sameGroup = siblings.filter(
    (r) => r.status === status && (r.year_read ?? null) === yearRead,
  );
  const position =
    sameGroup.length > 0 ? Math.max(...sameGroup.map((r) => r.position ?? 0)) + 1 : 0;

  const result = await db
    .prepare(
      `INSERT INTO ${BOOKS_TABLE} (title, author, author_hint, year_read, rating, status, is_audiobook, position, detail_status, personal_notes, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'none', '', ?9)`,
    )
    .bind(title, author, author, yearRead, rating, status, isAudiobook, position, Date.now())
    .run();
  const newId = result && result.meta ? result.meta.last_row_id : null;
  if (!newId) fail(500, "insert did not return a new id");

  // Best-effort metadata enrichment (author / publish year / subjects /
  // work key), mirroring the real enrichBook's metadata half. Failures
  // are never fatal.
  try {
    const found = await searchOpenLibrary(title, author || undefined);
    if (found && found.olWorkKey) {
      const fresh = await findBookRow(db, Number(newId));
      const sets = { ol_work_key: found.olWorkKey };
      if (fresh && !fresh.author && found.author) sets.author = found.author;
      if (found.publishYear !== null) sets.publish_year = found.publishYear;
      if (found.subjects && found.subjects.length) {
        sets.subjects = JSON.stringify(found.subjects);
      }
      const cols = Object.keys(sets);
      const sql = `UPDATE ${BOOKS_TABLE} SET ${cols
        .map((c, i) => `${c} = ?${i + 1}`)
        .join(", ")} WHERE id = ?${cols.length + 1}`;
      await db.prepare(sql).bind(...cols.map((c) => sets[c]), Number(newId)).run();
    }
  } catch {
    /* metadata is best-effort; the caller's title/author still shelve */
  }

  const row = await findBookRow(db, Number(newId));
  return { book: shapeBookSummary(row) };
}

// Real addWishlistItem: { title, author?, olWorkKey?, source (default
// 'typed') } → { item: WishlistItem }. Dedupe is by base title (the real
// baseTitle, subtitle-insensitive) and returns the existing entry.
async function addWishlistItem(db, args) {
  const title = args && typeof args.title === "string" ? args.title.trim() : "";
  if (!title) fail(400, "title required");
  const author = args && typeof args.author === "string" ? args.author.trim() || null : null;
  const source = args && args.source !== undefined ? args.source : "typed";
  if (source !== "typed" && source !== "recommended") {
    fail(400, "source must be 'typed' or 'recommended'");
  }
  const olWorkKey =
    args && typeof args.olWorkKey === "string" && args.olWorkKey
      ? args.olWorkKey
      : null;

  const existing = await allWishlistRows(db);
  const dupe = existing.find((r) => baseTitle(r.title) === baseTitle(title));
  if (dupe) return { item: shapeWishlistItem(dupe) };

  const position =
    existing.length > 0 ? Math.max(...existing.map((r) => r.position ?? 0)) + 1 : 0;
  const result = await db
    .prepare(
      `INSERT INTO ${WISHLIST_TABLE} (title, author, ol_work_key, cover_blob_key, source, position, detail_fetched, created_at)
       VALUES (?1, ?2, ?3, NULL, ?4, ?5, 0, ?6)`,
    )
    .bind(title, author, olWorkKey, source, position, Date.now())
    .run();
  const newId = result && result.meta ? result.meta.last_row_id : null;
  if (!newId) fail(500, "insert did not return a new id");

  // Typed adds resolve their work key by search (the real
  // resolveTypedWishlist); recommended adds already carry theirs.
  if (!olWorkKey) {
    try {
      const found = await searchOpenLibrary(title, author || undefined);
      if (found && found.olWorkKey) {
        await db
          .prepare(`UPDATE ${WISHLIST_TABLE} SET ol_work_key = ?1 WHERE id = ?2`)
          .bind(found.olWorkKey, Number(newId))
          .run();
      }
    } catch {
      /* best-effort */
    }
  }
  const row = await findWishlistRow(db, Number(newId));
  return { item: shapeWishlistItem(row) };
}

// Real removeWishlistItem: deletes (missing ids are a no-op) → { ok: true }.
async function removeWishlistItem(db, args) {
  const id = requireBookId(args, "id");
  await db.prepare(`DELETE FROM ${WISHLIST_TABLE} WHERE id = ?1`).bind(id).run();
  return { ok: true };
}

// Real startWishlistItem: { started, bookId }. Shelves the item as
// currently_reading (position next within the currently-reading group)
// and clears it from the wishlist; if that title is already on the
// nightstand, the wishlist entry is simply cleared. A missing item
// returns { started: false, bookId: null } (never a throw).
async function startWishlistItem(db, args) {
  const id = requireBookId(args, "id");
  const item = await findWishlistRow(db, id);
  if (!item) return { started: false, bookId: null };

  const allBooks = await allBookRows(db);
  const already = allBooks.find(
    (b) => b.status === "currently_reading" && baseTitle(b.title) === baseTitle(item.title),
  );
  if (already) {
    await db.prepare(`DELETE FROM ${WISHLIST_TABLE} WHERE id = ?1`).bind(id).run();
    return { started: true, bookId: already.id };
  }

  const reading = allBooks.filter((b) => b.status === "currently_reading");
  const position =
    reading.length > 0 ? Math.max(...reading.map((r) => r.position ?? 0)) + 1 : 0;
  // Cover carry-over: the real action carries the stored blob key; on
  // this host a seeded item's key is NULL but its cover file lives at
  // the wishlist/<WORKKEY>.jpg convention, so carry that key to keep
  // the new book's coverUrl resolving to the same file.
  const coverBlobKey = item.cover_blob_key || wishlistCoverBlobKey(item);
  const result = await db
    .prepare(
      `INSERT INTO ${BOOKS_TABLE} (title, author, author_hint, year_read, rating, status, position, cover_blob_key, cover_checked, cover_attempts, cover_optimized, ol_work_key, detail_status, personal_notes, created_at)
       VALUES (?1, ?2, ?3, NULL, NULL, 'currently_reading', ?4, ?5, ?6, ?7, ?8, ?9, 'none', '', ?10)`,
    )
    .bind(
      item.title,
      item.author ?? null,
      item.author ?? null,
      position,
      coverBlobKey,
      coverBlobKey ? 1 : 0,
      coverBlobKey ? 1 : 0,
      coverBlobKey ? 1 : 0,
      item.ol_work_key ?? null,
      Date.now(),
    )
    .run();
  const newId = result && result.meta ? result.meta.last_row_id : null;
  if (!newId) fail(500, "insert did not return a new id");
  await db.prepare(`DELETE FROM ${WISHLIST_TABLE} WHERE id = ?1`).bind(id).run();
  return { started: true, bookId: Number(newId) };
}

// Real dismissWishlistRecommendation: { olWorkKey, title } (both
// required) → { ok: true }; inserts only when not already dismissed.
async function dismissWishlistRecommendation(db, args) {
  const olWorkKey = args && typeof args.olWorkKey === "string" ? args.olWorkKey : "";
  const title = args && typeof args.title === "string" ? args.title : "";
  if (!olWorkKey) fail(400, "olWorkKey required");
  if (!title) fail(400, "title required");
  const existing = await db
    .prepare(`SELECT * FROM ${DISMISSED_TABLE} WHERE ol_work_key = ?1`)
    .bind(olWorkKey)
    .first();
  if (!existing) {
    await db
      .prepare(
        `INSERT INTO ${DISMISSED_TABLE} (ol_work_key, title, created_at) VALUES (?1, ?2, ?3)`,
      )
      .bind(olWorkKey, title, Date.now())
      .run();
  }
  return { ok: true };
}

/* ==================== BACKGROUND STUBS (safe no-ops) ==================== */
// Each returns the real action's response shape with zero progress and
// `remaining` set to the real pending count, so the client's auto-load
// loops (which break on processed===0 / ready===0) stop immediately.

// Real: { imported, alreadyImported }. The hosted D1 is the master
// copy — this NEVER imports anything; alreadyImported is always true so
// the one-shot client import effect settles.
async function importLibrary(db) {
  const rows = await allBookRows(db);
  void rows;
  return { imported: 0, alreadyImported: true };
}

// Real: DetailResponse. Stored-data equivalent of the real action: when
// the detail already exists it is returned unchanged; when it doesn't,
// the real action would generate one — on this host the stored response
// (which faithfully shows detailStatus as-is) is returned instead. A
// missing book returns the same ok:false payload the real action does.
async function prepareBookDetail(db, args) {
  const id = requireBookId(args, "id");
  const row = await findBookRow(db, id);
  if (!row) return emptyDetailResponse();
  return buildDetailResponse(row);
}

// Real: { processed, remaining }.
async function enrichCovers(db) {
  const counts = pendingCounts(await allBookRows(db));
  return { processed: 0, remaining: counts.coversPending };
}

// Real: { processed, remaining }.
async function optimizeCovers(db) {
  const counts = pendingCounts(await allBookRows(db));
  return { processed: 0, remaining: counts.coversUnoptimized };
}

// Real: { processed, ready, remaining }.
async function preloadDetails(db) {
  const counts = pendingCounts(await allBookRows(db));
  return { processed: 0, ready: 0, remaining: counts.detailsPending };
}

// Real: { processed, ready, remaining }.
async function preloadRecommendations(db) {
  const counts = pendingCounts(await allBookRows(db));
  return { processed: 0, ready: 0, remaining: counts.recsPending };
}

// Real: { processed, withSeries, remaining }.
async function preloadSeries(db) {
  const counts = pendingCounts(await allBookRows(db));
  return { processed: 0, withSeries: 0, remaining: counts.seriesPending };
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
  // Background stubs (see above).
  importLibrary,
  prepareBookDetail,
  enrichCovers,
  optimizeCovers,
  preloadDetails,
  preloadRecommendations,
  preloadSeries,
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
