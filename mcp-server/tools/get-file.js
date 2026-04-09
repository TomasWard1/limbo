import { stat } from "fs/promises";
import { join, resolve, basename, extname } from "path";
import { getNote, ensureIndex } from "../vault-index.js";

const VAULT_PATH = process.env.VAULT_PATH || "/data/vault";

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
  if (!noteId || typeof noteId !== "string") {
    throw new Error("noteId must be a non-empty string");
  }

  const safe = noteId.replace(/[^a-zA-Z0-9_\-]/g, "");
  if (safe !== noteId) {
    throw new Error("noteId contains invalid characters");
  }

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
  if (!fullPath.startsWith(resolve(VAULT_PATH) + "/")) {
    throw new Error("Path traversal detected");
  }

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
  const ext = extname(fullPath).toLowerCase();
  const mimeType = assetTypeMatch
    ? assetTypeMatch[1]
    : guessMime(ext);

  return {
    filename,
    mimeType,
    size: fileStats.size,
    assetPath,
  };
}

function guessMime(ext) {
  const map = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".json": "application/json",
  };
  return map[ext] || "application/octet-stream";
}
