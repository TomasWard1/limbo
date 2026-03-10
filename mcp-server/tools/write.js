import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

const VAULT_PATH = process.env.VAULT_PATH || "/data/vault";
const NOTES_DIR = join(VAULT_PATH, "notes");

const REQUIRED_FIELDS = ["id", "title", "type", "description", "content"];

/**
 * Builds YAML frontmatter string from note metadata.
 */
function buildFrontmatter(note) {
  const lines = ["---"];
  lines.push(`id: ${note.id}`);
  lines.push(`title: "${note.title.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  lines.push(`type: ${note.type}`);
  lines.push(`description: "${note.description.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
  if (note.map) {
    lines.push(`map: ${note.map}`);
  }
  lines.push(`created: ${new Date().toISOString().split("T")[0]}`);
  lines.push("---");
  return lines.join("\n");
}

/**
 * vault_write_note(note): creates a markdown file with YAML frontmatter.
 * Input: {id, title, type, description, content, map?}
 * Writes to /data/vault/notes/{id}.md
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

  await mkdir(NOTES_DIR, { recursive: true });

  const frontmatter = buildFrontmatter(note);
  const fileContent = `${frontmatter}\n\n${note.content}\n`;
  const filePath = join(NOTES_DIR, `${safe}.md`);

  await writeFile(filePath, fileContent, "utf8");
  return { id: safe, path: filePath };
}
