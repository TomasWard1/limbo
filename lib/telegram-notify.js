/**
 * telegram-notify.js — Deterministic Telegram messaging via Bot API.
 *
 * Sends messages directly through the Telegram HTTP API without depending on
 * OpenClaw or any agent runtime.  Used by the wakeup routine (entrypoint) and
 * the update_instance MCP tool for system-level notifications that MUST fire.
 *
 * Reads TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from the process environment.
 * The entrypoint sources /data/config/.env with `set -a` before spawning any
 * child process, so these env vars are always populated when Telegram is
 * configured. No filesystem access — the .env is the single source of truth.
 */

const https = require("node:https");

function readSecret(name) {
  // Back-compat for callers that passed the old lower_snake filenames.
  const envKey = name.toUpperCase();
  return (process.env[envKey] || "").trim();
}

/**
 * Send a Telegram message via the Bot API.
 *
 * @param {string} text        — Message text (supports MarkdownV2 if parse_mode set)
 * @param {{parse_mode?: string, reply_markup?: object, disable_notification?: boolean}} [options] — Extra sendMessage params
 * @returns {Promise<{ok: boolean, result: {message_id: number, chat: object, text: string}}>} — Telegram API response body
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
