/**
 * telegram-notify.js — Deterministic Telegram messaging via Bot API.
 *
 * Sends messages directly through the Telegram HTTP API without depending on
 * OpenClaw or any agent runtime.  Used by the wakeup routine (entrypoint) and
 * the update_instance MCP tool for system-level notifications that MUST fire.
 *
 * Requires two secrets:
 *   - telegram_bot_token
 *   - telegram_chat_id
 *
 * Both are written by the setup wizard (setup-server/server.js) during initial
 * Telegram pairing and persisted in the OpenClaw secrets directory.
 */

const https = require("node:https");
const fs = require("node:fs");
const path = require("node:path");

const STATE_DIR =
  process.env.OPENCLAW_STATE_DIR || "/home/limbo/.openclaw";
const SECRETS_DIR = path.join(STATE_DIR, "secrets");

function readSecret(name) {
  // Docker secrets take priority, then OpenClaw secrets dir
  for (const dir of ["/run/secrets", SECRETS_DIR]) {
    const p = path.join(dir, name);
    try {
      const v = fs.readFileSync(p, "utf8").trim();
      if (v) return v;
    } catch {
      // not found — try next
    }
  }
  return "";
}

/**
 * Send a Telegram message via the Bot API.
 *
 * @param {string} text        — Message text (supports MarkdownV2 if parse_mode set)
 * @param {object} [options]   — Extra sendMessage params (parse_mode, reply_markup, etc.)
 * @returns {Promise<object>}  — Telegram API response body
 */
function sendMessage(text, options = {}) {
  const token = readSecret("telegram_bot_token");
  const chatId = readSecret("telegram_chat_id");

  if (!token || !chatId) {
    return Promise.reject(
      new Error("telegram-notify: missing bot_token or chat_id in secrets")
    );
  }

  const body = JSON.stringify({
    chat_id: chatId,
    text,
    ...options,
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${token}/sendMessage`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 10000,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.ok) resolve(parsed);
            else reject(new Error(`Telegram API error: ${data}`));
          } catch {
            reject(new Error(`Telegram API parse error: ${data}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("telegram-notify: request timed out"));
    });
    req.write(body);
    req.end();
  });
}

module.exports = { sendMessage, readSecret };
