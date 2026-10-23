// Shared server-side document store for the passkey-gated microsites whose
// content is a single HTML document (MAX uses its own max_content table from
// before this helper existed; Wish Day Guide uses doc_content keyed by slug).
export async function ensureDocSchema(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS doc_content (slug TEXT PRIMARY KEY, html TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
}

export async function getDoc(db, slug) {
  await ensureDocSchema(db);
  const row = await db.prepare("SELECT html, updated_at FROM doc_content WHERE slug = ?1").bind(slug).first();
  return row || null;
}

export async function putDoc(db, slug, html) {
  await ensureDocSchema(db);
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO doc_content (slug, html, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(slug) DO UPDATE SET html = excluded.html, updated_at = excluded.updated_at").bind(slug, html, now).run();
  return now;
}
