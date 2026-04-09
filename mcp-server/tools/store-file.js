import { copyFile, readFile, writeFile, mkdir, stat, unlink } from "fs/promises";
import { join, resolve, extname, basename as pathBasename } from "path";
import { vaultWriteNote } from "./write.js";

const VAULT_PATH = process.env.VAULT_PATH || "/data/vault";
const ASSETS_DIR = join(VAULT_PATH, "assets");

const MAX_BASE64_LENGTH = 14_000_000; // ~10MB decoded
const MAX_FILE_SIZE = 10_000_000; // 10MB

const REQUIRED_FIELDS = ["noteId", "title", "description", "content"];

const MIME_MAP = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
};

function detectMimeType(filename) {
  const ext = extname(filename).toLowerCase();
  return MIME_MAP[ext] || "application/octet-stream";
}

function sanitizeFilename(raw) {
  // Strip path separators and traversal
  const base = raw.replace(/^.*[/\\]/, "").replace(/\.\./g, "");
  // Keep alphanumeric, dash, underscore, dot
  const safe = base.replace(/[^a-zA-Z0-9_\-\.]/g, "");
  if (!safe || !extname(safe)) {
    throw new Error("filename must have a valid extension (e.g. photo.jpg)");
  }
  return safe;
}

function timestampedFilename(filename) {
  const now = new Date();
  const ts = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${ts}-${filename}`;
}

/**
 * vault_store_file: stores a file in assets/ and creates a linked note.
 *
 * Primary mode (filePath): copies a local file into the vault.
 * Fallback mode (fileData): decodes base64 content into the vault.
 *
 * Input: { noteId, title, description, content,
 *          filePath | (filename + fileData),
 *          subdirectory?, noteSubdirectory?, mimeType?, domain?, source?, topics? }
 *
 * Returns: { noteId, notePath, assetPath }
 */
export async function vaultStoreFile(args) {
  // Validate required fields
  for (const field of REQUIRED_FIELDS) {
    if (!args[field] || typeof args[field] !== "string") {
      throw new Error(`Missing or invalid required field: ${field}`);
    }
  }

  if (!args.filePath && !args.fileData) {
    throw new Error("Either filePath or fileData is required");
  }

  // Sanitize noteId
  const safeNoteId = args.noteId.replace(/[^a-zA-Z0-9_\-]/g, "");
  if (safeNoteId !== args.noteId) {
    throw new Error("noteId contains invalid characters");
  }

  // Resolve filename — from args.filename, or derived from filePath
  const rawFilename = args.filename || (args.filePath ? pathBasename(args.filePath) : null);
  if (!rawFilename) {
    throw new Error("filename is required when using fileData (derived automatically from filePath)");
  }
  const safeFilename = sanitizeFilename(rawFilename);
  const finalFilename = timestampedFilename(safeFilename);

  // Determine asset directory
  let assetDir = ASSETS_DIR;
  if (args.subdirectory) {
    const safeSub = args.subdirectory.replace(/[^a-zA-Z0-9_\-/]/g, "");
    if (safeSub !== args.subdirectory) {
      throw new Error("subdirectory contains invalid characters");
    }
    if (safeSub.includes("..")) {
      throw new Error("subdirectory cannot contain '..'");
    }
    assetDir = join(ASSETS_DIR, safeSub);
  }

  await mkdir(assetDir, { recursive: true });

  const assetFilePath = resolve(assetDir, finalFilename);
  if (!assetFilePath.startsWith(resolve(ASSETS_DIR) + "/")) {
    throw new Error("Path traversal detected");
  }

  // Write file to vault — either by copying from filePath or decoding base64
  let sourcePath = null;
  if (args.filePath) {
    // filePath mode: copy local file to vault assets
    sourcePath = resolve(args.filePath);
    const fileStat = await stat(sourcePath);
    if (fileStat.size > MAX_FILE_SIZE) {
      throw new Error("File too large (max 10MB)");
    }
    await copyFile(sourcePath, assetFilePath);
  } else {
    // fileData mode: decode base64
    if (args.fileData.trim().length < 4) {
      throw new Error("fileData is empty or too short");
    }
    if (args.fileData.length > MAX_BASE64_LENGTH) {
      throw new Error("File too large (max 10MB)");
    }
    const buffer = Buffer.from(args.fileData, "base64");
    await writeFile(assetFilePath, buffer);
  }

  // Compute relative asset path from vault root
  const safeSub = args.subdirectory
    ? args.subdirectory.replace(/[^a-zA-Z0-9_\-/]/g, "")
    : null;
  const subPath = safeSub
    ? `assets/${safeSub}/${finalFilename}`
    : `assets/${finalFilename}`;

  // Detect MIME type
  const mimeType = args.mimeType || detectMimeType(safeFilename);
  const isImage = mimeType.startsWith("image/");

  // Build inline reference for the note body
  const inlineRef = isImage
    ? `![${args.title}](../${subPath})`
    : `[${args.title}](../${subPath})`;

  // Prepend the asset reference to the user-provided content
  const noteContent = `${inlineRef}\n\n${args.content}`;

  // Create the linked note via vaultWriteNote
  const writeResult = await vaultWriteNote({
    id: safeNoteId,
    title: args.title,
    type: "source",
    description: args.description,
    content: noteContent,
    subdirectory: args.noteSubdirectory,
    domain: args.domain,
    source: args.source,
    topics: args.topics,
    asset_path: subPath,
    asset_type: mimeType,
  });

  // Clean up source file after successful copy
  if (sourcePath) {
    try { await unlink(sourcePath); } catch {}
  }

  return {
    noteId: writeResult.id,
    notePath: writeResult.path,
    assetPath: subPath,
  };
}
