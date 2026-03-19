import { readdir, readFile, stat } from "fs/promises";
import { join, basename, relative } from "path";

const VAULT_PATH = process.env.VAULT_PATH || "/data/vault";
const NOTES_DIR = join(VAULT_PATH, "notes");

// In-memory index: noteId → { path, title, content, domain }
const index = new Map();
let built = false;

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
}

/**
 * Search all indexed notes by keyword. O(n) over in-memory strings — no disk I/O.
 */
export function search(query) {
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "gi");

  const results = [];
  for (const [noteId, entry] of index) {
    const matches = entry.content.match(regex);
    if (!matches) continue;

    const score = matches.length;

    // Extract snippet around first match
    regex.lastIndex = 0;
    const match = regex.exec(entry.content);
    regex.lastIndex = 0;
    let snippet = "";
    if (match) {
      const start = Math.max(0, match.index - 60);
      const end = Math.min(entry.content.length, match.index + 150);
      snippet = entry.content.slice(start, end).replace(/\n/g, " ").trim();
      if (start > 0) snippet = "..." + snippet;
      if (end < entry.content.length) snippet += "...";
    }

    results.push({ noteId, title: entry.title, snippet, score, domain: entry.domain });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
