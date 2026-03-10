#!/usr/bin/env node
/**
 * migrations/index.js — Limbo data migration runner
 *
 * Reads /data/db/.limbo-version, compares against CURRENT_DATA_VERSION,
 * and runs any pending migrations in order. Snapshots before each migration
 * and rolls back on failure.
 *
 * Called by entrypoint.sh on every container start.
 * Exit 0 = success. Exit 1 = fatal error.
 */

import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// ── Constants ─────────────────────────────────────────────────────────────────

const DATA_DIR = process.env.DATA_DIR || "/data";
const DB_DIR = join(DATA_DIR, "db");
const BACKUPS_DIR = join(DATA_DIR, "backups");
const VERSION_FILE = join(DB_DIR, ".limbo-version");
const VERSIONS_DIR = new URL("./versions/", import.meta.url);

/**
 * Bump this when a new migration is added. The runner uses it as the target
 * version and will run all migrations between stored version and this value.
 */
const CURRENT_DATA_VERSION = 1;

// ── Logging ───────────────────────────────────────────────────────────────────

function log(level, msg) {
  const ts = new Date().toISOString();
  process.stdout.write(`[${ts}] ${level.padEnd(5)} migrations: ${msg}\n`);
}

// ── Version file ──────────────────────────────────────────────────────────────

async function readStoredVersion() {
  if (!existsSync(VERSION_FILE)) return 0;
  const raw = (await readFile(VERSION_FILE, "utf8")).trim();
  const n = parseInt(raw, 10);
  if (isNaN(n)) throw new Error(`Corrupt version file: "${raw}"`);
  return n;
}

async function writeStoredVersion(version) {
  await mkdir(DB_DIR, { recursive: true });
  await writeFile(VERSION_FILE, String(version), "utf8");
}

// ── Snapshot / rollback ───────────────────────────────────────────────────────

/**
 * Creates a snapshot of /data/db and /data/vault before a migration.
 * Returns the snapshot path so it can be restored on failure.
 */
async function snapshot(fromVersion) {
  const ts = Date.now();
  const snapshotDir = join(BACKUPS_DIR, `snapshot-v${fromVersion}-${ts}`);
  await mkdir(snapshotDir, { recursive: true });

  for (const dir of ["db", "vault"]) {
    const src = join(DATA_DIR, dir);
    if (existsSync(src)) {
      await cp(src, join(snapshotDir, dir), { recursive: true });
    }
  }

  log("INFO ", `Snapshot created: ${snapshotDir}`);
  return snapshotDir;
}

/**
 * Restores /data/db and /data/vault from a snapshot directory.
 */
async function rollback(snapshotDir) {
  log("WARN ", `Rolling back from snapshot: ${snapshotDir}`);
  for (const dir of ["db", "vault"]) {
    const src = join(snapshotDir, dir);
    const dest = join(DATA_DIR, dir);
    if (existsSync(src)) {
      if (existsSync(dest)) await rm(dest, { recursive: true, force: true });
      await cp(src, dest, { recursive: true });
    }
  }
  log("INFO ", "Rollback complete");
}

// ── Migration discovery ───────────────────────────────────────────────────────

/**
 * Discovers all migration files in versions/ directory.
 * Returns them sorted by version number ascending.
 * Each file must be named NNN-description.js and export { version, up }.
 */
async function discoverMigrations() {
  let files;
  try {
    files = await readdir(VERSIONS_DIR);
  } catch {
    return [];
  }

  const migrations = [];
  for (const file of files.sort()) {
    if (!file.endsWith(".js")) continue;
    const versionNum = parseInt(file.split("-")[0], 10);
    if (isNaN(versionNum)) {
      log("WARN ", `Skipping non-numeric migration file: ${file}`);
      continue;
    }
    migrations.push({ file, versionNum });
  }

  return migrations.sort((a, b) => a.versionNum - b.versionNum);
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function run() {
  log("INFO ", `Starting — CURRENT_DATA_VERSION=${CURRENT_DATA_VERSION}`);

  // Ensure DB dir exists before reading version file
  await mkdir(DB_DIR, { recursive: true });
  await mkdir(BACKUPS_DIR, { recursive: true });

  const storedVersion = await readStoredVersion();
  log("INFO ", `Stored version: ${storedVersion}`);

  if (storedVersion === CURRENT_DATA_VERSION) {
    log("INFO ", "Schema up to date, no migrations needed");
    return;
  }

  if (storedVersion > CURRENT_DATA_VERSION) {
    throw new Error(
      `Stored version (${storedVersion}) is ahead of CURRENT_DATA_VERSION (${CURRENT_DATA_VERSION}). ` +
        "Downgrade not supported."
    );
  }

  const allMigrations = await discoverMigrations();
  const pending = allMigrations.filter(
    (m) => m.versionNum > storedVersion && m.versionNum <= CURRENT_DATA_VERSION
  );

  if (pending.length === 0) {
    log("WARN ", `No migration files found for versions ${storedVersion + 1}–${CURRENT_DATA_VERSION}`);
    await writeStoredVersion(CURRENT_DATA_VERSION);
    return;
  }

  log("INFO ", `Running ${pending.length} pending migration(s)`);

  let currentVersion = storedVersion;

  for (const { file, versionNum } of pending) {
    log("INFO ", `Running migration ${file} (v${currentVersion} → v${versionNum})`);

    const snapshotDir = await snapshot(currentVersion);

    let mod;
    try {
      mod = await import(new URL(file, VERSIONS_DIR).href);
    } catch (err) {
      log("ERROR", `Failed to load migration ${file}: ${err.message}`);
      throw err;
    }

    if (typeof mod.up !== "function") {
      throw new Error(`Migration ${file} must export an "up" function`);
    }

    try {
      await mod.up({ dataDir: DATA_DIR, dbDir: DB_DIR, log });
    } catch (err) {
      log("ERROR", `Migration ${file} failed: ${err.message}`);
      await rollback(snapshotDir);
      throw new Error(`Migration ${file} failed and was rolled back: ${err.message}`);
    }

    await writeStoredVersion(versionNum);
    currentVersion = versionNum;
    log("INFO ", `Migration ${file} complete — now at v${versionNum}`);
  }

  log("INFO ", `All migrations complete — at v${currentVersion}`);
}

// ── Entrypoint ────────────────────────────────────────────────────────────────

run().catch((err) => {
  log("ERROR", err.message);
  process.exit(1);
});
