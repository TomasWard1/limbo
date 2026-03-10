/**
 * migrations/versions/001-initial-schema.js
 *
 * Initializes the /data directory structure for Limbo v1.
 *
 * Creates:
 *   /data/vault/     — markdown note files
 *   /data/db/        — version file and future SQLite databases
 *   /data/config/    — runtime config files (USER.md, etc.)
 *   /data/memory/    — ephemeral memory / session state
 *   /data/backups/   — migration snapshots and manual backups
 *   /data/logs/      — container and agent logs
 */

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const version = 1;

/**
 * @param {{ dataDir: string, dbDir: string, log: Function }} ctx
 */
export async function up({ dataDir, log }) {
  const dirs = ["vault", "db", "config", "memory", "backups", "logs"];

  for (const dir of dirs) {
    const fullPath = join(dataDir, dir);
    if (!existsSync(fullPath)) {
      await mkdir(fullPath, { recursive: true });
      log("INFO ", `Created ${fullPath}`);
    } else {
      log("INFO ", `Already exists: ${fullPath}`);
    }
  }

  // Write a vault README so the vault directory is never empty
  const vaultReadme = join(dataDir, "vault", ".README");
  if (!existsSync(vaultReadme)) {
    await writeFile(
      vaultReadme,
      "# Limbo Vault\n\nThis directory contains your personal knowledge vault.\nNotes are stored as markdown files with YAML frontmatter.\n",
      "utf8"
    );
    log("INFO ", "Wrote vault/.README");
  }
}
