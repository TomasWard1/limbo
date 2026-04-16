import { readFile, writeFile, mkdir } from "fs/promises";
import { join, resolve } from "path";
import { VAULT_PATH, sanitizeNoteId, assertWithinDir } from "./shared.js";

const MAPS_DIR = join(VAULT_PATH, "maps");

function buildMapFrontmatter(name) {
  const lines = [
    "---",
    `description: "${name.replace(/-/g, " ")}"`,
    "type: moc",
    "---",
  ];
  return lines.join("\n");
}

// Matches [[noteId]] and [[noteId|Display Title]]
function extractWikilinks(text) {
  const regex = /\[\[([^\]|]+)/g;
  const ids = new Set();
  let match;
  while ((match = regex.exec(text)) !== null) {
    ids.add(match[1].trim());
  }
  return ids;
}

function upsertSection(content, section, entries) {
  const sectionHeader = `## ${section}`;
  const lines = content.split("\n");

  const sectionIdx = lines.findIndex((l) => l.trim() === sectionHeader);

  if (sectionIdx === -1) {
    // Section doesn't exist — append it (all entries are new)
    const toAdd = ["", sectionHeader, "", ...entries, ""];
    return { content: lines.concat(toAdd).join("\n"), added: entries.length };
  }

  // Find where the section ends (next ## or EOF)
  let endIdx = sectionIdx + 1;
  while (endIdx < lines.length && !lines[endIdx].startsWith("## ")) {
    endIdx++;
  }

  // Collect existing wikilinks in this section
  const sectionText = lines.slice(sectionIdx, endIdx).join("\n");
  const existing = extractWikilinks(sectionText);

  // Filter out entries whose noteId is already present
  const newEntries = entries.filter((entry) => {
    const entryIds = extractWikilinks(entry);
    for (const id of entryIds) {
      if (existing.has(id)) return false;
    }
    return true;
  });

  if (newEntries.length === 0) {
    return { content: content, added: 0 };
  }

  // Insert new entries before the next section (or EOF)
  lines.splice(endIdx, 0, ...newEntries);
  return { content: lines.join("\n"), added: newEntries.length };
}

export async function vaultUpdateMap(map, section, entries) {
  if (!map || typeof map !== "string") throw new Error("map must be a non-empty string");
  if (!section || typeof section !== "string") throw new Error("section must be a non-empty string");
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("entries must be a non-empty array");

  const safeMap = sanitizeNoteId(map);
  await mkdir(MAPS_DIR, { recursive: true });

  const filePath = resolve(MAPS_DIR, `${safeMap}.md`);
  assertWithinDir(filePath, MAPS_DIR);

  let existing = "";
  try {
    existing = await readFile(filePath, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    // New map — start with frontmatter and title
    existing = `${buildMapFrontmatter(map)}\n\n# ${map}\n`;
  }

  const { content: updated, added } = upsertSection(existing, section, entries);

  if (added > 0) {
    await writeFile(filePath, updated, "utf8");
  }

  return { map: safeMap, section, added };
}
