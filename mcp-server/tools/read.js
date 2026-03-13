import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";

const VAULT_PATH = process.env.VAULT_PATH || "/data/vault";
const NOTES_DIR = join(VAULT_PATH, "notes");

/**
 * Recursively find a note file by ID. Checks flat first, then subdirectories.
 * Returns the file path or null.
 */
async function findNote(noteId) {
  // Fast path: check flat location first
  const flatPath = join(NOTES_DIR, `${noteId}.md`);
  try {
    await stat(flatPath);
    return flatPath;
  } catch {
    // Not in root — search subdirectories
  }

  return searchDir(NOTES_DIR, noteId);
}

async function searchDir(dir, noteId) {
  let items;
  try {
    items = await readdir(dir);
  } catch {
    return null;
  }

  for (const item of items) {
    if (item.startsWith(".") || item === "_meta") continue;

    const full = join(dir, item);
    let s;
    try {
      s = await stat(full);
    } catch {
      continue;
    }

    if (s.isDirectory()) {
      // Check if the note exists directly in this subdirectory
      const candidate = join(full, `${noteId}.md`);
      try {
        await stat(candidate);
        return candidate;
      } catch {
        // Recurse deeper
        const found = await searchDir(full, noteId);
        if (found) return found;
      }
    }
  }

  return null;
}

/**
 * vault_read(noteId): reads full content of a note by ID.
 * Searches recursively through subdirectories.
 * Returns the raw markdown content including YAML frontmatter.
 * Returns null if the note doesn't exist.
 */
export async function vaultRead(noteId) {
  if (!noteId || typeof noteId !== "string") {
    throw new Error("noteId must be a non-empty string");
  }

  // Sanitize: allow alphanumeric, dashes, underscores
  const safe = noteId.replace(/[^a-zA-Z0-9_\-]/g, "");
  if (safe !== noteId) {
    throw new Error("noteId contains invalid characters");
  }

  const filePath = await findNote(safe);
  if (!filePath) return null;

  try {
    return await readFile(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}
