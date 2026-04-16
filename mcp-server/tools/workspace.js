import { readFile, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { assertWithinDir } from "./shared.js";

// OpenClaw workspace: where the agent's personality/config files live at runtime.
// Entrypoint copies templates here on first run; the agent can modify them after.
const WORKSPACE_DIR = process.env.OPENCLAW_WORKSPACE_DIR
  || join(process.env.OPENCLAW_STATE_DIR || "/home/limbo/.openclaw", "workspace");

// Only these files are writable by the agent.
// System files (AGENTS.md, TOOLS.md, limbo-skill.md) are overwritten on every boot
// from the image — the agent cannot persist changes to them.
const WRITABLE_FILES = new Set(["USER.md"]);

// All workspace .md files are readable.
function isReadable(filename) {
  return filename.endsWith(".md") && !filename.includes("/") && !filename.includes("..");
}

/**
 * workspace_read(filename): read a workspace file's content.
 */
export async function workspaceRead(filename) {
  if (!isReadable(filename)) {
    throw new Error(`Cannot read "${filename}" — only .md files in the workspace root are accessible.`);
  }

  const filePath = resolve(WORKSPACE_DIR, filename);
  assertWithinDir(filePath, WORKSPACE_DIR);

  const content = await readFile(filePath, "utf8");
  return { filename, content };
}

/**
 * workspace_write(filename, content): overwrite a writable workspace file.
 */
export async function workspaceWrite(filename, content) {
  if (!WRITABLE_FILES.has(filename)) {
    const list = [...WRITABLE_FILES].join(", ");
    throw new Error(`Cannot write "${filename}" — only these files are writable: ${list}`);
  }

  if (typeof content !== "string" || content.trim().length === 0) {
    throw new Error("Content must be a non-empty string");
  }

  const filePath = resolve(WORKSPACE_DIR, filename);
  assertWithinDir(filePath, WORKSPACE_DIR);

  await writeFile(filePath, content, "utf8");
  return { filename, path: filePath, size: content.length };
}
