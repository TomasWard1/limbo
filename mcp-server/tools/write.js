import { writeFile, mkdir } from "fs/promises";
import { join, resolve, relative } from "path";
import { updateEntry } from "../vault-index.js";
import { upsertNote } from "../fts.js";

const VAULT_PATH = process.env.VAULT_PATH || "/data/vault";
const NOTES_DIR = join(VAULT_PATH, "notes");

const REQUIRED_FIELDS = ["id", "title", "type", "description", "content"];
const VALID_TYPES = ['fact', 'preference', 'person', 'event', 'project', 'decision', 'idea', 'question', 'source', 'insight'];

function escapeYaml(str) {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Builds YAML frontmatter string from note metadata.
 * Supports the merged schema: id, title, description, type, status, domain,
 * created, source, topics.
 */
function buildFrontmatter(note) {
  const lines = ["---"];
  lines.push(`id: ${note.id}`);
  lines.push(`title: "${escapeYaml(note.title)}"`);
  lines.push(`description: "${escapeYaml(note.description)}"`);
  lines.push(`type: ${note.type}`);
  lines.push(`schema_version: 1`);
  if (note.status) {
    lines.push(`status: ${note.status}`);
  }
  if (note.domain) {
    lines.push(`domain: ${note.domain}`);
  }
  lines.push(`created: "${note.created || new Date().toISOString().split("T")[0]}"`);
  if (note.source) {
    lines.push(`source: ${note.source}`);
  }
  if (note.topics && note.topics.length > 0) {
    lines.push("topics:");
    for (const topic of note.topics) {
      lines.push(`  - "${escapeYaml(topic)}"`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}

/**
 * vault_write_note(note): creates a markdown file with YAML frontmatter.
 * Input: {id, title, type, description, content, subdirectory?, status?, domain?, source?, topics?}
 * Writes to /data/vault/notes/{subdirectory?}/{id}.md
 * Creates the subdirectory if it doesn't exist.
 */
export async function vaultWriteNote(note) {
  for (const field of REQUIRED_FIELDS) {
    if (!note[field] || typeof note[field] !== "string") {
      throw new Error(`Missing or invalid required field: ${field}`);
    }
  }

  if (!VALID_TYPES.includes(note.type)) {
    throw new Error(`Invalid note type: "${note.type}". Valid types: ${VALID_TYPES.join(', ')}`);
  }

  // Sanitize id
  const safe = note.id.replace(/[^a-zA-Z0-9_\-]/g, "");
  if (safe !== note.id) {
    throw new Error("note.id contains invalid characters");
  }

  // Determine target directory
  let targetDir = NOTES_DIR;
  if (note.subdirectory) {
    // Sanitize subdirectory: allow alphanumeric, dashes, underscores, forward slashes
    const safeSub = note.subdirectory.replace(/[^a-zA-Z0-9_\-/]/g, "");
    if (safeSub !== note.subdirectory) {
      throw new Error("subdirectory contains invalid characters");
    }
    // Prevent path traversal
    if (safeSub.includes("..")) {
      throw new Error("subdirectory cannot contain '..'");
    }
    targetDir = join(NOTES_DIR, safeSub);
  }

  await mkdir(targetDir, { recursive: true });

  const frontmatter = buildFrontmatter({ ...note, id: safe });
  const fileContent = `${frontmatter}\n\n${note.content}\n`;
  const filePath = resolve(targetDir, `${safe}.md`);
  if (!filePath.startsWith(resolve(NOTES_DIR) + "/")) {
    throw new Error("Path traversal detected");
  }

  await writeFile(filePath, fileContent, "utf8");

  // Update in-memory index immediately — no re-scan needed
  const domain = relative(NOTES_DIR, resolve(targetDir)) || null;
  updateEntry(safe, filePath, fileContent, domain);
  upsertNote(safe, note.title, note.content, domain);

  return { id: safe, path: filePath };
}
