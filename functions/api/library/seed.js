// Library microsite — one-time D1 seed endpoint (admin only).
//
// POST /api/library/seed
// Body: { books: [...], series_info: [...], wishlist_items: [...],
//         wishlist_dismissed: [...] }
// Rows are keyed by the d1-schema.sql column names, with explicit ids to
// preserve, created_at already millisecond integers, booleans already 0/1,
// and JSON-string columns stored verbatim as TEXT (see the data
// workstream's seed JSON). Refuses with 409 when library_books is already
// non-empty, so a publish can never double-load the library.
//
// This endpoint is only ever WRITTEN here — the publish step calls it
// against production; nothing in this repo calls it automatically.

import { appAllowed, json, requireIdentity } from "../../_lib/auth.js";
import {
  BOOKS_TABLE,
  BOOK_COLUMNS,
  DISMISSED_TABLE,
  DISMISSED_COLUMNS,
  SERIES_TABLE,
  SERIES_COLUMNS,
  WISHLIST_TABLE,
  WISHLIST_COLUMNS,
  ensureLibrarySchema,
} from "../../_lib/library.js";

const APP_SLUG = "library";
const BATCH_CHUNK = 20;

// A cell value for D1: booleans become 0/1 (defensive — the seed contract
// already sends 0/1), objects/arrays in a JSON TEXT column are stringified,
// strings/numbers/null pass through verbatim.
function cellValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

async function insertRows(db, table, columns, rows) {
  const placeholders = columns.map((_, i) => `?${i + 1}`).join(", ");
  const sql = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_CHUNK) {
    const chunk = rows.slice(i, i + BATCH_CHUNK);
    const stmts = chunk.map((row) =>
      db.prepare(sql).bind(...columns.map((c) => cellValue(row ? row[c] : null)))
    );
    await db.batch(stmts);
    inserted += chunk.length;
  }
  return inserted;
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const identity = await requireIdentity(env, request);
  if (!identity) return json({ ok: false, error: "not signed in" }, 401);
  if (!appAllowed(identity, APP_SLUG)) {
    return json({ ok: false, error: "this account doesn't cover this app" }, 403);
  }
  if (identity.role !== "admin") {
    return json({ ok: false, error: "admin only" }, 403);
  }
  if (!env.DB) return json({ ok: false, error: "db not bound" }, 500);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "bad json" }, 400);
  }
  const books = Array.isArray(body && body.books) ? body.books : [];
  const seriesInfo = Array.isArray(body && body.series_info) ? body.series_info : [];
  const wishlistItems = Array.isArray(body && body.wishlist_items)
    ? body.wishlist_items
    : [];
  const wishlistDismissed = Array.isArray(body && body.wishlist_dismissed)
    ? body.wishlist_dismissed
    : [];

  await ensureLibrarySchema(env.DB);
  const existing = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM ${BOOKS_TABLE}`)
    .first();
  if (existing && existing.n > 0) {
    return json(
      { ok: false, error: "library_books is not empty — seed refused" },
      409
    );
  }
  try {
    const counts = {
      books: await insertRows(env.DB, BOOKS_TABLE, BOOK_COLUMNS, books),
      series_info: await insertRows(env.DB, SERIES_TABLE, SERIES_COLUMNS, seriesInfo),
      wishlist_items: await insertRows(
        env.DB,
        WISHLIST_TABLE,
        WISHLIST_COLUMNS,
        wishlistItems
      ),
      wishlist_dismissed: await insertRows(
        env.DB,
        DISMISSED_TABLE,
        DISMISSED_COLUMNS,
        wishlistDismissed
      ),
    };
    return json({ ok: true, data: { counts } }, 200);
  } catch (err) {
    return json(
      { ok: false, error: err && err.message ? err.message : "seed failed" },
      500
    );
  }
}
