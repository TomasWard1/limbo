import { stat } from "fs/promises";
import { join, resolve, basename } from "path";
import { getNote, ensureIndex } from "../vault-index.js";
import { VAULT_PATH, sanitizeNoteId, assertWithinDir, detectMimeType } from "./shared.js";

/**
 * vault_get_file: retrieves a stored file by its linked note ID.
 *
 * Reads the note from the index, extracts asset_path from frontmatter,
 * checks that the binary exists, and returns metadata plus a path reference.
 *
 * Limbo's real user-facing channel is Telegram, which expects file attachments
 * to come from paths/documents rather than inline base64 image blocks.
 * Returning references also avoids large payloads entering the LLM context.
 */
export async function vaultGetFile(noteId) {
  const safe = sanitizeNoteId(noteId);

  await ensureIndex();
  const entry = getNote(safe);
  if (!entry) {
    throw new Error(`Note not found: ${safe}`);
  }

  // Parse asset_path from YAML frontmatter
  const fmMatch = entry.content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!fmMatch) {
    throw new Error("Note has no frontmatter");
  }

  const assetPathMatch = fmMatch[1].match(/^asset_path:\s*["']?(.+?)["']?\s*$/m);
  if (!assetPathMatch) {
    throw new Error("Note has no linked file (no asset_path in frontmatter)");
  }

  const assetTypeMatch = fmMatch[1].match(/^asset_type:\s*["']?(.+?)["']?\s*$/m);
  const assetPath = assetPathMatch[1];
  const fullPath = resolve(join(VAULT_PATH, assetPath));

  // Path traversal check
  assertWithinDir(fullPath, VAULT_PATH);

  // Size check before reading into memory (protect 256MB heap)
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
  let fileStats;
  try {
    fileStats = await stat(fullPath);
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`Linked file not found on disk: ${assetPath}`);
    }
    throw err;
  }
  if (fileStats.size > MAX_FILE_SIZE) {
    throw new Error(`File too large to retrieve (${Math.round(fileStats.size / 1024 / 1024)}MB, max 10MB)`);
  }

  const filename = basename(fullPath);
  const mimeType = assetTypeMatch
    ? assetTypeMatch[1]
    : detectMimeType(filename);

  return {
    filename,
    mimeType,
    size: fileStats.size,
    assetPath,
  };
}
