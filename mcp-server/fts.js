// mcp-server/fts.js — SQLite FTS5 full-text search for vault notes
import Database from "better-sqlite3";

let db = null;

export function initFts(dbPath) {
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS notes_meta (
      note_id TEXT PRIMARY KEY,
      title   TEXT NOT NULL,
      domain  TEXT
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      note_id UNINDEXED,
      title,
      content,
      tokenize='porter unicode61'
    );
  `);
}

export function upsertNote(noteId, title, content, domain) {
  const run = db.transaction(() => {
    db.prepare("DELETE FROM notes_fts WHERE note_id = ?").run(noteId);
    db.prepare("DELETE FROM notes_meta WHERE note_id = ?").run(noteId);
    db.prepare("INSERT INTO notes_meta (note_id, title, domain) VALUES (?, ?, ?)").run(noteId, title, domain);
    db.prepare("INSERT INTO notes_fts (note_id, title, content) VALUES (?, ?, ?)").run(noteId, title, content);
  });
  run();
}

export function deleteNote(noteId) {
  const run = db.transaction(() => {
    db.prepare("DELETE FROM notes_fts WHERE note_id = ?").run(noteId);
    db.prepare("DELETE FROM notes_meta WHERE note_id = ?").run(noteId);
  });
  run();
}

/**
 * Sanitize a user query for FTS5 MATCH syntax.
 * - Escapes special characters by wrapping terms in double quotes
 * - Adds prefix match (*) on the last term
 */
function sanitizeQuery(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Strip FTS5 operators and special chars, keep alphanumeric + spaces
  const terms = trimmed
    .replace(/["()*:^{}~]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);

  if (terms.length === 0) return null;

  // Quote each term; add prefix match on last term
  const quoted = terms.map((t, i) => {
    if (i === terms.length - 1) return `"${t}"*`;
    return `"${t}"`;
  });

  return quoted.join(" ");
}

/**
 * Search indexed notes. Returns up to 20 results sorted by BM25 score.
 * Title matches are weighted 5x over content matches.
 */
export function searchNotes(query) {
  const sanitized = sanitizeQuery(query);
  if (!sanitized) return [];

  const sql = `
    SELECT
      f.note_id   AS noteId,
      m.title      AS title,
      snippet(notes_fts, 2, '>>>', '<<<', '...', 32) AS snippet,
      bm25(notes_fts, 0, 5.0, 1.0) AS score,
      m.domain     AS domain
    FROM notes_fts f
    JOIN notes_meta m ON m.note_id = f.note_id
    WHERE notes_fts MATCH ?
    ORDER BY score
    LIMIT 20
  `;

  try {
    return db.prepare(sql).all(sanitized);
  } catch (e) {
    // Fallback: simple term search without prefix matching on syntax error
    const fallbackTerms = query
      .trim()
      .replace(/["()*:^{}~]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0)
      .map((t) => `"${t}"`)
      .join(" ");

    if (!fallbackTerms) return [];

    try {
      return db.prepare(sql).all(fallbackTerms);
    } catch {
      return [];
    }
  }
}

export function indexedCount() {
  return db.prepare("SELECT COUNT(*) AS cnt FROM notes_meta").get().cnt;
}

export function indexedIds() {
  const rows = db.prepare("SELECT note_id FROM notes_meta").all();
  return new Set(rows.map((r) => r.note_id));
}

export function closeFts() {
  if (db) {
    db.close();
    db = null;
  }
}
