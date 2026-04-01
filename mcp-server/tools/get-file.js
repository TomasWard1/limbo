import { readFile, stat } from "fs/promises";
import { join, resolve, basename, extname } from "path";
import { getNote, ensureIndex } from "../vault-index.js";

const VAULT_PATH = process.env.VAULT_PATH || "/data/vault";

/**
 * Maximum base64 size (in bytes) for inline file responses.
 * 512 KB of base64 ≈ 384 KB raw file. Above this threshold, files are
 * returned as metadata references to prevent large payloads from entering
 * the LLM context — which triggers ZeroClaw's context compressor and
 * corrupts tool_result blocks (see issue #215).
 */
export const MAX_INLINE_SIZE = 512 * 1024;

const IMAGE_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/**
 * vault_get_file: retrieves a stored file by its linked note ID.
 *
 * Reads the note from the index, extracts asset_path from frontmatter,
 * reads the binary file, and returns a size-aware response:
 *
 *   - Images under MAX_INLINE_SIZE → { inline: true, data, mimeType, filename, size }
 *     (caller should return as MCP image content block)
 *   - Large files / non-inline types → { inline: false, filename, mimeType, size, assetPath }
 *     (caller should return metadata text only)
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

  const buffer = await readFile(fullPath);
  const base64 = buffer.toString("base64");

  // Small images → inline (MCP image content block is context-efficient)
  if (IMAGE_MIMES.has(mimeType) && base64.length <= MAX_INLINE_SIZE) {
    return {
      inline: true,
      data: base64,
      mimeType,
      filename,
      size: fileStats.size,
    };
  }

  // Large files or non-image types → metadata reference only
  return {
    inline: false,
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
