import { resolve } from "path";
import { ensureIndex, getNote } from "../vault-index.js";
import { VAULT_PATH, sanitizeNoteId, assertWithinDir } from "./shared.js";

const NOTES_DIR = resolve(VAULT_PATH, "notes");

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
