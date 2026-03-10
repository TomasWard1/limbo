import { readFile } from "fs/promises";
import { join } from "path";

const VAULT_PATH = process.env.VAULT_PATH || "/data/vault";
const NOTES_DIR = join(VAULT_PATH, "notes");

/**
 * vault_read(noteId): reads full content of a note by ID.
 * Returns the raw markdown content including YAML frontmatter.
 * Returns null if the note doesn't exist.
 */
export async function vaultRead(noteId) {
  if (!noteId || typeof noteId !== "string") {
    throw new Error("noteId must be a non-empty string");
  }

  // Sanitize: only allow alphanumeric, dashes, underscores
  const safe = noteId.replace(/[^a-zA-Z0-9_\-]/g, "");
  if (safe !== noteId) {
    throw new Error("noteId contains invalid characters");
  }

  const filePath = join(NOTES_DIR, `${safe}.md`);
  try {
    return await readFile(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}
