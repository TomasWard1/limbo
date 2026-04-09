import { readFile } from "fs/promises";
import { resolve } from "path";
import { ensureIndex, getNote } from "../vault-index.js";

const VAULT_PATH = process.env.VAULT_PATH || "/data/vault";
const NOTES_DIR = resolve(VAULT_PATH, "notes");

/**
 * vault_read(noteId): reads full content of a note by ID.
 * Uses in-memory index for O(1) path lookup — no recursive filesystem search.
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

  await ensureIndex();
  const entry = getNote(safe);
  if (!entry) return null;

  // Defense-in-depth: ensure resolved path stays within vault
  const resolved = resolve(entry.path);
  if (!resolved.startsWith(NOTES_DIR + "/")) {
    throw new Error("Path traversal detected");
  }

  // Return content from index (already in memory)
  return entry.content;
}
