import { readdir, readFile } from "fs/promises";
import { join, basename } from "path";

const VAULT_PATH = process.env.VAULT_PATH || "/data/vault";
const NOTES_DIR = join(VAULT_PATH, "notes");

/**
 * Extracts the title from YAML frontmatter or first H1 heading.
 */
function extractTitle(content) {
  const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const titleMatch = fmMatch[1].match(/^title:\s*["']?(.+?)["']?\s*$/m);
    if (titleMatch) return titleMatch[1];
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
 * vault_search(query): regex search across all .md files in /data/vault/notes/.
 * Returns [{noteId, title, snippet, score}] sorted by score desc.
 */
export async function vaultSearch(query) {
  let files;
  try {
    files = await readdir(NOTES_DIR);
  } catch {
    return [];
  }

  const mdFiles = files.filter((f) => f.endsWith(".md"));
  let regex;
  try {
    regex = new RegExp(query, "gi");
  } catch {
    // Fallback to literal search if invalid regex
    regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  }

  const results = [];
  for (const file of mdFiles) {
    const filePath = join(NOTES_DIR, file);
    let content;
    try {
      content = await readFile(filePath, "utf8");
    } catch {
      continue;
    }

    const matches = content.match(regex);
    if (!matches) continue;

    const noteId = basename(file, ".md");
    const title = extractTitle(content) || noteId;
    const score = matches.length;
    const snippet = extractSnippet(content, regex);

    results.push({ noteId, title, snippet, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
