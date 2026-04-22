import { copyFile, readFile, writeFile, mkdir, stat, unlink } from "fs/promises";
import { join, resolve, extname, basename as pathBasename } from "path";
import { vaultWriteNote } from "./write.js";
import { VAULT_PATH, sanitizeNoteId, assertWithinDir, sanitizeSubdirectory, detectMimeType } from "./shared.js";

const ASSETS_DIR = join(VAULT_PATH, "assets");

const MAX_BASE64_LENGTH = 14_000_000; // ~10MB decoded
const MAX_FILE_SIZE = 10_000_000; // 10MB

const REQUIRED_FIELDS = ["noteId", "title", "description", "content"];

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

export async function vaultStoreFile(args) {
  for (const field of REQUIRED_FIELDS) {
    if (!args[field] || typeof args[field] !== "string") {
      throw new Error(`Missing or invalid required field: ${field}`);
    }
  }

  if (!args.filePath && !args.fileData) {
    throw new Error("Either filePath or fileData is required");
  }

  const safeNoteId = sanitizeNoteId(args.noteId);

  const rawFilename = args.filename || (args.filePath ? pathBasename(args.filePath) : null);
  if (!rawFilename) {
    throw new Error("filename is required when using fileData (derived automatically from filePath)");
  }
  const safeFilename = sanitizeFilename(rawFilename);
  const finalFilename = timestampedFilename(safeFilename);

  let assetDir = ASSETS_DIR;
  if (args.subdirectory) {
    const safeSub = sanitizeSubdirectory(args.subdirectory);
    assetDir = join(ASSETS_DIR, safeSub);
  }

  await mkdir(assetDir, { recursive: true });

  const assetFilePath = resolve(assetDir, finalFilename);
  assertWithinDir(assetFilePath, ASSETS_DIR);

  let sourcePath = null;
  if (args.filePath) {
    sourcePath = resolve(args.filePath);
    const fileStat = await stat(sourcePath);
    if (fileStat.size > MAX_FILE_SIZE) {
      throw new Error("File too large (max 10MB)");
    }
    await copyFile(sourcePath, assetFilePath);
  } else {
    if (args.fileData.trim().length < 4) {
      throw new Error("fileData is empty or too short");
    }
    if (args.fileData.length > MAX_BASE64_LENGTH) {
      throw new Error("File too large (max 10MB)");
    }
    const buffer = Buffer.from(args.fileData, "base64");
    await writeFile(assetFilePath, buffer);
  }

  const safeSub = args.subdirectory
    ? args.subdirectory.replace(/[^a-zA-Z0-9_\-/]/g, "")
    : null;
  const subPath = safeSub
    ? `assets/${safeSub}/${finalFilename}`
    : `assets/${finalFilename}`;

  const mimeType = args.mimeType || detectMimeType(safeFilename);
  const isImage = mimeType.startsWith("image/");

  const inlineRef = isImage
    ? `![${args.title}](../${subPath})`
    : `[${args.title}](../${subPath})`;

  const noteContent = `${inlineRef}\n\n${args.content}`;

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

  if (sourcePath) {
    try { await unlink(sourcePath); } catch {}
  }

  return {
    noteId: writeResult.id,
    notePath: writeResult.path,
    assetPath: subPath,
  };
}
