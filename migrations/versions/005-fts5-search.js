/**
 * Migration 005: FTS5 full-text search backfill
 *
 * Creates search.db with FTS5 virtual table and indexes all existing
 * vault notes for full-text search.
 */

import { createRequire } from "node:module";
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";

const require = createRequire(new URL("../../mcp-server/", import.meta.url));
const Database = require("better-sqlite3");

export const version = 5;

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
 * Determine the domain from a note's path relative to the notes directory.
 * If the note is directly in notes/, domain is null.
 * If it's in notes/research/foo.md, domain is "research".
 */
function getDomain(filePath, notesDir) {
  const rel = filePath.slice(notesDir.length + 1); // strip notesDir + leading /
  const parts = rel.split("/");
  if (parts.length <= 1) return null;
  return parts[0];
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
  const notesDir = join(dataDir, "vault", "notes");

  const db = new Database(searchDbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");

  // Create metadata table
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes_meta (
      note_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      domain TEXT
    )
  `);

  // Create FTS5 virtual table
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      note_id UNINDEXED,
      title,
      content,
      tokenize='porter unicode61'
    )
  `);

  // Walk and index all notes
  const files = walkMd(notesDir);

  const insertMeta = db.prepare(
    "INSERT OR REPLACE INTO notes_meta (note_id, title, domain) VALUES (?, ?, ?)"
  );
  const insertFts = db.prepare(
    "INSERT INTO notes_fts (note_id, title, content) VALUES (?, ?, ?)"
  );

  const insertAll = db.transaction((notes) => {
    for (const { noteId, title, body, domain } of notes) {
      insertMeta.run(noteId, title, domain);
      insertFts.run(noteId, title, body);
    }
  });

  const notes = [];
  for (const filePath of files) {
    const content = readFileSync(filePath, "utf8");
    const { title, body } = parseFrontmatter(content);
    const rel = filePath.slice(notesDir.length + 1);
    const noteId = rel.split("/").pop().replace(/\.md$/, "");
    const domain = getDomain(filePath, notesDir);

    notes.push({
      noteId,
      title: title || noteId,
      body,
      domain,
    });
  }

  insertAll(notes);

  log("INFO ", `Indexed ${notes.length} note(s) into search.db`);

  db.close();
}
