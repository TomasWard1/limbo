import { readdir, readFile, stat } from "fs/promises";
import { join, basename, relative } from "path";
import { initFts, upsertNote as ftsUpsert, deleteNote as ftsDelete, indexedCount, indexedIds } from "./fts.js";

const VAULT_PATH = process.env.VAULT_PATH || "/data/vault";
const NOTES_DIR = join(VAULT_PATH, "notes");
const DB_PATH = process.env.DB_PATH || "/data/db";

// In-memory index: noteId → { path, title, content, domain }
const index = new Map();
let built = false;

function stripFrontmatter(content) {
  const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  return match ? content.slice(match[0].length).trim() : content;
}

function extractTitle(content) {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const titleMatch = fmMatch[1].match(/^title:\s*["']?(.+?)["']?\s*$/m);
    if (titleMatch) return titleMatch[1];
    const descMatch = fmMatch[1].match(/^description:\s*["']?(.+?)["']?\s*$/m);
    if (descMatch) return descMatch[1];
  }
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1];
  return null;
}

/**
 * Recursively walks notes/ and indexes all .md files in parallel.
 * Uses Promise.all for concurrent I/O instead of sequential await.
 */
async function walkAndIndex(dir, base = dir) {
  let items;
  try {
    items = await readdir(dir);
  } catch {
    return;
  }

  const promises = [];
  for (const item of items) {
    if (item.startsWith(".") || item === "_meta") continue;
    const full = join(dir, item);
    promises.push(
      stat(full)
        .then((s) => {
          if (s.isDirectory()) {
            return walkAndIndex(full, base);
          }
          if (item.endsWith(".md")) {
            return readFile(full, "utf8")
              .then((content) => {
                const noteId = basename(full, ".md");
                const domain = relative(base, dir) || null;
                const title = extractTitle(content) || noteId;
                index.set(noteId, { path: full, title, content, domain });
              })
              .catch(() => {});
          }
        })
        .catch(() => {})
    );
  }
  await Promise.all(promises);
}

/**
 * Build (or rebuild) the full in-memory index from disk.
 */
export async function buildIndex() {
  index.clear();
  await walkAndIndex(NOTES_DIR);
  built = true;

  // Initialize FTS and sync with filesystem
  const searchDbPath = join(DB_PATH, "search.db");
  initFts(searchDbPath);
  const ftsIds = indexedIds();
  const memIds = new Set(index.keys());

  // Upsert notes that are on disk but missing/stale in FTS
  for (const [noteId, entry] of index) {
    if (!ftsIds.has(noteId)) {
      const body = stripFrontmatter(entry.content);
      ftsUpsert(noteId, entry.title, body, entry.domain);
    }
  }

  // Remove notes from FTS that no longer exist on disk
  for (const id of ftsIds) {
    if (!memIds.has(id)) {
      ftsDelete(id);
    }
  }

  return index.size;
}

/**
 * Ensure the index is built before use.
 */
export async function ensureIndex() {
  if (!built) await buildIndex();
}

/**
 * O(1) lookup by noteId. Returns { path, title, content, domain } or null.
 */
export function getNote(noteId) {
  return index.get(noteId) || null;
}

/**
 * Update a single entry in the index (called after vault_write_note).
 */
export function updateEntry(noteId, path, content, domain) {
  const title = extractTitle(content) || noteId;
  index.set(noteId, { path, title, content, domain });
  const body = stripFrontmatter(content);
  ftsUpsert(noteId, title, body, domain);
}

