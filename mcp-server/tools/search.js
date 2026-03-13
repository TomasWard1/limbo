import { readdir, readFile, stat } from "fs/promises";
import { join, basename, relative } from "path";

const VAULT_PATH = process.env.VAULT_PATH || "/data/vault";
const NOTES_DIR = join(VAULT_PATH, "notes");

/**
 * Recursively collects all .md files under a directory.
 * Returns array of { filePath, domain } where domain is the relative subdirectory.
 */
async function walkNotes(dir, base = dir) {
  const entries = [];
  let items;
  try {
    items = await readdir(dir);
  } catch {
    return entries;
  }

  for (const item of items) {
    // Skip hidden directories and _meta
    if (item.startsWith(".") || item === "_meta") continue;

    const full = join(dir, item);
    let s;
    try {
      s = await stat(full);
    } catch {
      continue;
    }

    if (s.isDirectory()) {
      const sub = await walkNotes(full, base);
      entries.push(...sub);
    } else if (item.endsWith(".md")) {
      const rel = relative(base, dir);
      entries.push({ filePath: full, domain: rel || null });
    }
  }
  return entries;
}

/**
 * Extracts the title from YAML frontmatter, falling back to description or first H1.
 */
function extractTitle(content) {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const titleMatch = fmMatch[1].match(/^title:\s*["']?(.+?)["']?\s*$/m);
    if (titleMatch) return titleMatch[1];
    // Fallback: use description if no title field
    const descMatch = fmMatch[1].match(/^description:\s*["']?(.+?)["']?\s*$/m);
    if (descMatch) return descMatch[1];
  }
  const h1Match = content.match(/^#\s+(.+)$/m);
  if (h1Match) return h1Match[1];
  return null;
}

/**
 * Finds a short snippet around the first match.
 */
function extractSnippet(content, regex, maxLen = 150) {
  regex.lastIndex = 0;
  const match = regex.exec(content);
  regex.lastIndex = 0;
  if (!match) return "";
  const start = Math.max(0, match.index - 60);
  const end = Math.min(content.length, match.index + maxLen);
  let snippet = content.slice(start, end).replace(/\n/g, " ").trim();
  if (start > 0) snippet = "..." + snippet;
  if (end < content.length) snippet += "...";
  return snippet;
}

/**
 * vault_search(query): recursive search across all .md files in vault/notes/.
 * Returns [{noteId, title, snippet, score, domain}] sorted by score desc.
 *
 * NOTE: Current implementation is a linear scan (O(n) per query). This is fine
 * for small vaults (hundreds of notes), but will need optimization at scale —
 * consider an inverted index (e.g. SQLite FTS5) when the vault grows large.
 */
export async function vaultSearch(query) {
  if (query.length > 200) {
    throw new Error("Search query too long (max 200 characters)");
  }

  const files = await walkNotes(NOTES_DIR);
  if (files.length === 0) return [];

  // Always escape user input to prevent ReDoS from pathological patterns
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "gi");

  const results = [];
  for (const { filePath, domain } of files) {
    let content;
    try {
      content = await readFile(filePath, "utf8");
    } catch {
      continue;
    }

    const matches = content.match(regex);
    if (!matches) continue;

    const noteId = basename(filePath, ".md");
    const title = extractTitle(content) || noteId;
    const score = matches.length;
    const snippet = extractSnippet(content, regex);

    results.push({ noteId, title, snippet, score, domain });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
