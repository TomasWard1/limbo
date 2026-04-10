#!/usr/bin/env node
/**
 * wakeup.js — Deterministic startup routine.
 *
 * Runs in the entrypoint BEFORE OpenClaw starts.  Handles system-level
 * notifications that must always fire, independent of the LLM.
 *
 * Current checks:
 *   1. Post-update notification — tell the user we're back after an update
 *   2. Version check — notify if a newer version is available on npm
 *
 * Future checks can be added to the `checks` array below.
 */

const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { sendMessage } = require("./telegram-notify");

const FLAGS_DIR = "/flags";
const DATA_DIR = "/data";
const VERSION_FILE = path.join(DATA_DIR, ".limbo-version");
const LAST_CHECK_FILE = path.join(DATA_DIR, ".update-last-check");
const RELEASES_FILE = "/app/RELEASES.md";
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

function log(msg) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [wakeup] ${msg}`);
}

// ── Check 1: Post-update notification ──────────────────────────────────────

async function checkPostUpdate() {
  const flagPath = path.join(FLAGS_DIR, "updated.flag");
  if (!fs.existsSync(flagPath)) return;

  let previousVersion;
  try {
    previousVersion = fs.readFileSync(flagPath, "utf8").trim();
  } catch {
    previousVersion = "unknown";
  }

  const currentVersion = getCurrentVersion();
  const changelog = parseUserChangelog();

  let text;
  if (changelog) {
    text =
      `Ya volvi. Actualizado de v${previousVersion} a v${currentVersion}.\n\n` +
      `Que hay de nuevo:\n${changelog}`;
  } else {
    text = `Ya volvi. Actualizado a v${currentVersion}.`;
  }

  try {
    await sendMessage(text);
    log(`Post-update notification sent (${previousVersion} -> ${currentVersion})`);
  } catch (err) {
    log(`Post-update notification failed: ${err.message}`);
  }

  // Clean up flag and persist current version
  try { fs.unlinkSync(flagPath); } catch {}
  persistVersion(currentVersion);
}

// ── Check 2: New version available ─────────────────────────────────────────

async function checkNewVersion() {
  // Don't check more than once per day
  try {
    const lastCheck = fs.readFileSync(LAST_CHECK_FILE, "utf8").trim();
    if (Date.now() - Number(lastCheck) < CHECK_INTERVAL_MS) return;
  } catch {
    // No last-check file — proceed
  }

  const currentVersion = getCurrentVersion();
  let latestVersion;

  try {
    latestVersion = await fetchLatestVersion();
  } catch (err) {
    log(`Version check failed: ${err.message}`);
    return;
  }

  // Persist check timestamp regardless of result
  try { fs.writeFileSync(LAST_CHECK_FILE, String(Date.now())); } catch {}

  if (!latestVersion || latestVersion === currentVersion) return;
  if (!isNewer(latestVersion, currentVersion)) return;

  log(`New version available: ${currentVersion} -> ${latestVersion}`);

  try {
    await sendMessage(
      `Hay una nueva version de Limbo disponible: v${latestVersion}\n\n` +
        `Cuando quieras actualizar, pedimelo.`,
      {
        reply_markup: JSON.stringify({
          inline_keyboard: [
            [
              { text: "Actualizar", callback_data: "limbo_update_yes" },
              { text: "Ahora no", callback_data: "limbo_update_no" },
            ],
          ],
        }),
      }
    );
  } catch (err) {
    log(`Version notification failed: ${err.message}`);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getCurrentVersion() {
  try {
    const pkg = JSON.parse(
      fs.readFileSync("/app/package.json", "utf8")
    );
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

function persistVersion(version) {
  try {
    fs.writeFileSync(VERSION_FILE, version);
  } catch {}
}

function parseUserChangelog() {
  try {
    const content = fs.readFileSync(RELEASES_FILE, "utf8");
    // Extract everything between the first "## v" heading and the first "---"
    const match = content.match(/^## v[\d.]+\s*\n([\s\S]*?)(?=\n---)/m);
    if (!match) return null;
    return match[1].trim();
  } catch {
    return null;
  }
}

function fetchLatestVersion() {
  return new Promise((resolve, reject) => {
    const req = https.get(
      "https://registry.npmjs.org/limbo-ai/latest",
      { timeout: 10000 },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data).version);
          } catch {
            reject(new Error("Failed to parse npm response"));
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("npm registry timeout"));
    });
  });
}

function isNewer(latest, current) {
  const l = latest.split(".").map(Number);
  const c = current.split(".").map(Number);
  return (
    l[0] > c[0] ||
    (l[0] === c[0] && l[1] > c[1]) ||
    (l[0] === c[0] && l[1] === c[1] && l[2] > c[2])
  );
}

// ── Run all checks ─────────────────────────────────────────────────────────

async function main() {
  log("Wakeup routine starting");

  const checks = [checkPostUpdate, checkNewVersion];

  for (const check of checks) {
    try {
      await check();
    } catch (err) {
      log(`Check ${check.name} failed: ${err.message}`);
    }
  }

  log("Wakeup routine complete");
}

main().catch((err) => {
  log(`Wakeup fatal error: ${err.message}`);
  // Non-fatal — don't prevent OpenClaw from starting
  process.exit(0);
});
