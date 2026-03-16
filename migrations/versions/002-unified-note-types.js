/**
 * migrations/versions/002-unified-note-types.js
 *
 * Unifies note type enum to schema v1:
 *   - Maps old types to new unified types
 *   - Adds schema_version: 1 to all notes
 *   - Preserves all other frontmatter and content
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const version = 2;

const TYPE_MAP = {
  'personal-fact': 'fact',
  'config-fact': 'fact',
  'claim': 'fact',
  'concept': 'idea',
  'gotcha': 'insight',
  'pattern': 'insight',
  'tool-knowledge': 'insight',
  'research-finding': 'insight',
  // These stay the same but list them for completeness
  'fact': 'fact',
  'preference': 'preference',
  'person': 'person',
  'event': 'event',
  'project': 'project',
  'decision': 'decision',
  'idea': 'idea',
  'question': 'question',
  'source': 'source',
  'insight': 'insight',
};

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Recursively find all .md files under a directory.
 */
async function findMarkdownFiles(dir) {
  const results = [];
  if (!existsSync(dir)) return results;

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...await findMarkdownFiles(fullPath));
    } else if (entry.name.endsWith('.md') && entry.name !== '.README') {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Parse YAML frontmatter from markdown content.
 * Returns { frontmatter: string, body: string, fields: Map<string, string> }
 */
function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;

  const frontmatterRaw = match[1];
  const body = match[2];
  const fields = new Map();

  for (const line of frontmatterRaw.split('\n')) {
    const kv = line.match(/^(\w[\w-]*?):\s*(.*)$/);
    if (kv) {
      fields.set(kv[1], kv[2]);
    }
  }

  return { frontmatterRaw, body, fields };
}

/**
 * @param {{ dataDir: string, dbDir: string, log: Function }} ctx
 */
export async function up({ dataDir, log }) {
  const notesDir = join(dataDir, "vault", "notes");
  const files = await findMarkdownFiles(notesDir);

  let migrated = 0;
  let skipped = 0;
  let errors = 0;

  for (const filePath of files) {
    try {
      const content = await readFile(filePath, "utf8");
      const parsed = parseFrontmatter(content);

      if (!parsed) {
        log("WARN ", `No frontmatter found in ${filePath} — skipping`);
        skipped++;
        continue;
      }

      let modified = false;
      let newContent = content;

      // 1. Map old type to new type
      const currentType = parsed.fields.get('type');
      if (currentType) {
        const cleanType = currentType.replace(/^["']|["']$/g, '').trim();
        const newType = TYPE_MAP[cleanType];
        if (newType && newType !== cleanType) {
          newContent = newContent.replace(
            new RegExp(`^type:\\s*${escapeRegExp(currentType)}$`, 'm'),
            `type: ${newType}`
          );
          modified = true;
          log("INFO ", `${filePath}: type ${cleanType} → ${newType}`);
        }
      }

      // 2. Add schema_version: 1 if not present
      if (!parsed.fields.has('schema_version')) {
        if (parsed.fields.has('type')) {
          // Insert schema_version after the type line
          newContent = newContent.replace(
            /^(type:\s*.+)$/m,
            '$1\nschema_version: 1'
          );
          modified = true;
        } else {
          log("WARN ", `${filePath}: no type field found — cannot insert schema_version`);
        }
      }

      if (modified) {
        await writeFile(filePath, newContent, "utf8");
        migrated++;
      } else {
        skipped++;
      }
    } catch (err) {
      log("ERROR", `Failed to migrate ${filePath}: ${err.message}`);
      errors++;
    }
  }

  log("INFO ", `Migration 002 complete: ${migrated} migrated, ${skipped} skipped, ${errors} errors (${files.length} total files)`);
}
