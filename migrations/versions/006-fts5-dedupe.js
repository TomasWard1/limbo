/**
 * Migration 006: FTS5 index dedupe (retroactive fix)
 *
 * Before this migration landed, the repo contained TWO identical migration
 * files for FTS5 (004-fts5-search.js and 005-fts5-search.js) due to a
 * staging/main rename mismatch. Runners that executed both ended up running
 * the FTS5 backfill twice, and because the original used plain INSERT (not
 * INSERT OR REPLACE) every note was inserted into notes_fts twice,
 * duplicating every search result.
 *
 * This migration cleans up the contaminated notes_fts table by dropping it
 * and rebuilding from scratch off the markdown files in /data/vault/notes.
 * The notes_meta table is untouched — it was always clean because its
 * original migration used INSERT OR REPLACE.
 *
 * On fresh installs (where 005 ran only once, not twice), this migration is
 * a no-op: it detects that notes_fts already has unique entries and exits
 * without touching anything.
 */

import { createRequire } from "node:module";
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

const require = createRequire(new URL("../../mcp-server/", import.meta.url));
const Database = require("better-sqlite3");

export const version = 6;

/**
 * Extract frontmatter title and body from a markdown file's content.
 * Frontmatter is delimited by --- at the start of the file.
 */
function parseFrontmatter(content) {
  let title = null;
  let body = content;

  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (match) {
    const frontmatter = match[1];
    const titleMatch = frontmatter.match(/^title:\s*"([^"]*)"$/m)
      || frontmatter.match(/^title:\s*'([^']*)'$/m)
      || frontmatter.match(/^title:\s*(.+)$/m);
    if (titleMatch) {
      title = titleMatch[1].trim();
    }
    body = content.slice(match[0].length);
  }

  return { title, body };
}

/**
 * Recursively walk a directory and return all .md file paths.
 */
function walkMd(dir) {
  const results = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkMd(full));
    } else if (entry.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

export async function up({ dataDir, dbDir, log }) {
  const searchDbPath = join(dbDir, "search.db");

  if (!existsSync(searchDbPath)) {
    log("INFO ", "No search.db found — nothing to dedupe, skipping");
    return;
  }

  const db = new Database(searchDbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  // Defensive: check notes_fts table exists (005 should have created it)
  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='notes_fts'")
    .get();
  if (!tableExists) {
    log("INFO ", "notes_fts table does not exist — nothing to dedupe, skipping");
    db.close();
    return;
  }

  // Diagnose: are there actually duplicates to clean up?
  const beforeTotal = db.prepare("SELECT COUNT(*) AS c FROM notes_fts").get().c;
  const uniqueIds = db
    .prepare("SELECT COUNT(DISTINCT note_id) AS c FROM notes_fts")
    .get().c;

  if (beforeTotal === uniqueIds) {
    log("INFO ", `notes_fts is already clean (${beforeTotal} entries, no duplicates) — skipping`);
    db.close();
    return;
  }

  const duplicates = beforeTotal - uniqueIds;
  log("WARN ", `notes_fts has ${beforeTotal} entries but only ${uniqueIds} unique note_ids (${duplicates} duplicate rows) — rebuilding`);

  // Drop and recreate the FTS table to wipe all duplicates
  db.exec("DROP TABLE IF EXISTS notes_fts");
  db.exec(`
    CREATE VIRTUAL TABLE notes_fts USING fts5(
      note_id UNINDEXED,
      title,
      content,
      tokenize='porter unicode61'
    )
  `);

  // Re-index from markdown files on disk
  const notesDir = join(dataDir, "vault", "notes");
  const files = walkMd(notesDir);

  const insertFts = db.prepare(
    "INSERT INTO notes_fts (note_id, title, content) VALUES (?, ?, ?)"
  );

  const insertAll = db.transaction((notes) => {
    for (const { noteId, title, body } of notes) {
      insertFts.run(noteId, title, body);
    }
  });

  const notes = [];
  for (const filePath of files) {
    const content = readFileSync(filePath, "utf8");
    const { title, body } = parseFrontmatter(content);
    const rel = filePath.slice(notesDir.length + 1);
    const noteId = rel.split("/").pop().replace(/\.md$/, "");

    notes.push({
      noteId,
      title: title || noteId,
      body,
    });
  }

  insertAll(notes);

  const afterCount = db.prepare("SELECT COUNT(*) AS c FROM notes_fts").get().c;
  log("INFO ", `notes_fts rebuilt: ${afterCount} entries (removed ${beforeTotal - afterCount} duplicates)`);

  db.close();
}
