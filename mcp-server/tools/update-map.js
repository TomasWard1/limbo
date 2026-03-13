import { readFile, writeFile, mkdir } from "fs/promises";
import { join, resolve } from "path";

const VAULT_PATH = process.env.VAULT_PATH || "/data/vault";
const MAPS_DIR = join(VAULT_PATH, "maps");

/**
 * Sanitizes a map name (filename without extension).
 */
function sanitizeName(name) {
  const safe = name.replace(/[^a-zA-Z0-9_\-]/g, "");
  if (safe !== name) throw new Error(`Invalid characters in name: ${name}`);
  return safe;
}

/**
 * Builds frontmatter for a new map file.
 */
function buildMapFrontmatter(name) {
  const lines = [
    "---",
    `description: "${name.replace(/-/g, " ")}"`,
    "type: moc",
    "---",
  ];
  return lines.join("\n");
}

/**
 * Finds or creates a section in markdown content.
 * Returns the updated content string.
 */
function upsertSection(content, section, entries) {
  const sectionHeader = `## ${section}`;
  const lines = content.split("\n");

  const sectionIdx = lines.findIndex((l) => l.trim() === sectionHeader);

  if (sectionIdx === -1) {
    // Section doesn't exist — append it
    const toAdd = ["", sectionHeader, "", ...entries, ""];
    return lines.concat(toAdd).join("\n");
  }

  // Find where the section ends (next ## or EOF)
  let insertIdx = sectionIdx + 1;
  while (insertIdx < lines.length && !lines[insertIdx].startsWith("## ")) {
    insertIdx++;
  }

  // Insert entries before the next section (or EOF)
  lines.splice(insertIdx, 0, ...entries);
  return lines.join("\n");
}

/**
 * vault_update_map(map, section, entries): appends entries to a MOC section.
 * Creates the map file and/or section if they don't exist.
 * New maps are created with proper YAML frontmatter.
 * Entries are markdown link strings, e.g. ["- [[note-id|Note Title]]"]
 *
 * @param {string} map - map filename without extension
 * @param {string} section - section heading text
 * @param {string[]} entries - array of markdown link strings to append
 */
export async function vaultUpdateMap(map, section, entries) {
  if (!map || typeof map !== "string") throw new Error("map must be a non-empty string");
  if (!section || typeof section !== "string") throw new Error("section must be a non-empty string");
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("entries must be a non-empty array");

  const safeMap = sanitizeName(map);
  await mkdir(MAPS_DIR, { recursive: true });

  const filePath = resolve(MAPS_DIR, `${safeMap}.md`);
  if (!filePath.startsWith(resolve(MAPS_DIR) + "/")) {
    throw new Error("Path traversal detected");
  }

  let existing = "";
  try {
    existing = await readFile(filePath, "utf8");
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    // New map — start with frontmatter and title
    existing = `${buildMapFrontmatter(map)}\n\n# ${map}\n`;
  }

  const updated = upsertSection(existing, section, entries);
  await writeFile(filePath, updated, "utf8");
  return { map: safeMap, section, added: entries.length };
}
