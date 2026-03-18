/**
 * Migration 003: OpenClaw → ZeroClaw transition
 *
 * No data migration needed — vault data lives in /data/ volume which is unchanged.
 * The old limbo-openclaw-state volume is orphaned by the new docker-compose config.
 * This migration simply logs the transition and bumps the version.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

export const version = 3;

export async function up({ dataDir, log }) {
  log("INFO ", "Migrating from OpenClaw to ZeroClaw runtime");

  // Check for leftover OpenClaw config artifacts
  const oldConfig = join(dataDir, "config", "openclaw.json");
  if (existsSync(oldConfig)) {
    log("INFO ", "Found legacy openclaw.json — it will no longer be used (ZeroClaw uses config.toml)");
  }

  log("INFO ", "ZeroClaw migration complete — vault data is unchanged");
}
