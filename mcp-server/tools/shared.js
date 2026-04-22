// mcp-server/tools/shared.js — Shared constants and utilities for MCP tools.
//
// Centralises patterns that were duplicated across 5+ tool files:
// VAULT_PATH, sanitizeNoteId, assertWithinDir, sanitizeSubdirectory,
// MIME_MAP + detectMimeType.

import { resolve } from "path";

export const VAULT_PATH = process.env.VAULT_PATH || "/data/vault";

/**
 * Extension → MIME type map.
 * Superset of the old store-file MIME_MAP (12 entries) and get-file guessMime (10 entries).
 */
export const MIME_MAP = {
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

/**
 * Detect MIME type from a filename's extension.
 * @param {string} filename
 * @returns {string} MIME type or "application/octet-stream"
 */
export function detectMimeType(filename) {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase();
  return MIME_MAP[ext] || "application/octet-stream";
}

/**
 * Sanitize a noteId to alphanumeric, dashes, and underscores.
 * Throws if the input contains anything else.
 * @param {string} noteId
 * @returns {string} sanitized noteId (unchanged if already valid)
 */
export function sanitizeNoteId(noteId) {
  if (!noteId || typeof noteId !== "string") {
    throw new Error("noteId must be a non-empty string");
  }
  const safe = noteId.replace(/[^a-zA-Z0-9_\-]/g, "");
  if (safe !== noteId) {
    throw new Error("noteId contains invalid characters");
  }
  return safe;
}

/**
 * Assert that `filePath` is inside `baseDir`.
 * Both paths are resolved before comparison. Throws on traversal.
 * @param {string} filePath
 * @param {string} baseDir
 */
export function assertWithinDir(filePath, baseDir) {
  const resolved = resolve(filePath);
  if (!resolved.startsWith(resolve(baseDir) + "/")) {
    throw new Error("Path traversal detected");
  }
}

/**
 * Sanitize a subdirectory path segment.
 * Allows alphanumeric, dashes, underscores, and forward slashes.
 * Blocks path traversal via "..".
 * @param {string} subdirectory
 * @returns {string} sanitized subdirectory
 */
export function sanitizeSubdirectory(subdirectory) {
  const safe = subdirectory.replace(/[^a-zA-Z0-9_\-/]/g, "");
  if (safe !== subdirectory) {
    throw new Error("subdirectory contains invalid characters");
  }
  if (safe.includes("..")) {
    throw new Error("subdirectory cannot contain '..'");
  }
  return safe;
}
