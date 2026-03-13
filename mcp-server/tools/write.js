import { writeFile, mkdir } from "fs/promises";
import { join, resolve } from "path";

const VAULT_PATH = process.env.VAULT_PATH || "/data/vault";
const NOTES_DIR = join(VAULT_PATH, "notes");

const REQUIRED_FIELDS = ["id", "title", "type", "description", "content"];

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
  return { id: safe, path: filePath };
}
