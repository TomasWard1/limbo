/**
 * update_instance — MCP tool that triggers a Limbo self-update.
 *
 * All it does is create a flag file at /flags/update.flag.  A systemd path
 * unit on the host watches for this file and runs `limbo update` (pull new
 * image + restart container).  The container has zero Docker access.
 *
 * The pre-update Telegram message is sent here (deterministic, via Bot API)
 * so the user knows Limbo is going offline briefly.  The post-update message
 * is handled by the wakeup routine in entrypoint.sh on next boot.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const FLAGS_DIR = "/flags";
const FLAG_FILE = `${FLAGS_DIR}/update.flag`;

export async function updateInstance() {
  // Send "going offline" message before touching the flag
  try {
    const { sendMessage } = require("../../lib/telegram-notify.js");
    await sendMessage(
      "Me voy a actualizar. Vuelvo en un toque. \u23f3"
    );
  } catch (err) {
    // Non-fatal — update should proceed even if notification fails
    process.stderr.write(
      `[update_instance] telegram notify failed: ${err.message}\n`
    );
  }

  // Create the flag file — the host watcher does the rest
  try {
    mkdirSync(FLAGS_DIR, { recursive: true });
    writeFileSync(FLAG_FILE, new Date().toISOString(), { mode: 0o644 });
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Update failed: could not write flag file. Is /flags mounted? Error: ${err.message}`,
        },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: "Update requested. The host will pull the new image and restart the container. I'll message you when I'm back.",
      },
    ],
  };
}
