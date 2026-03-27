/**
 * migrations/versions/004-assets-directory.js
 *
 * Creates /data/vault/assets/ for binary file storage (images, PDFs, documents).
 * Each stored file has a linked markdown note in /data/vault/notes/.
 */

import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const version = 4;

/**
 * @param {{ dataDir: string, log: Function }} ctx
 */
export async function up({ dataDir, log }) {
  const assetsDir = join(dataDir, "vault", "assets");
  if (!existsSync(assetsDir)) {
    await mkdir(assetsDir, { recursive: true });
    log("INFO ", `Created ${assetsDir}`);
  } else {
    log("INFO ", `Already exists: ${assetsDir}`);
  }
}
