import { resolve } from "path";
import { ensureIndex, getNote } from "../vault-index.js";
import { VAULT_PATH, sanitizeNoteId, assertWithinDir } from "./shared.js";

const NOTES_DIR = resolve(VAULT_PATH, "notes");

/**
 * vault_read(noteId): reads full content of a note by ID.
 * Uses in-memory index for O(1) path lookup — no recursive filesystem search.
 * Returns the raw markdown content including YAML frontmatter.
 * Returns null if the note doesn't exist.
 */
export async function vaultRead(noteId) {
  const safe = sanitizeNoteId(noteId);

  await ensureIndex();
  const entry = getNote(safe);
  if (!entry) return null;

  // Defense-in-depth: ensure resolved path stays within vault
  assertWithinDir(entry.path, NOTES_DIR);

  // Return content from index (already in memory)
  return entry.content;
}
