import { appendFileSync, mkdirSync, statSync, renameSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { buildIndex } from "./vault-index.js";
import { vaultSearch } from "./tools/search.js";
import { vaultRead } from "./tools/read.js";
import { vaultWriteNote } from "./tools/write.js";
import { vaultUpdateMap } from "./tools/update-map.js";
import { vaultStoreFile } from "./tools/store-file.js";
import { vaultGetFile } from "./tools/get-file.js";
import { workspaceRead, workspaceWrite } from "./tools/workspace.js";
import { calendarRead, calendarCreate, calendarDelete, calendarUpdate } from "./tools/google-calendar.js";
import { updateInstance } from "./tools/update-instance.js";
import { cronList, cronAdd, cronRemove } from "./tools/cron.js";
import { getCurrentTime } from "./tools/current-time.js";

/**
 * General response size guard. Any tool_result text content exceeding this
 * threshold is truncated with a warning. Prevents accidental context bloat
 * from any tool — not just vault_get_file. (512 KB of text ≈ ~128K tokens)
 */
const MAX_RESPONSE_TEXT_SIZE = 512 * 1024;

// ── Logging ────────────────────────────────────────────────────────────────

const LOG_PATH = "/data/logs/mcp.log";
const LOG_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const SESSION_ID = randomBytes(4).toString("hex");

// Ensure log directory exists on startup
try {
  mkdirSync("/data/logs", { recursive: true });
} catch (err) {
  process.stderr.write(`[mcp] Failed to create log directory: ${err.message}\n`);
}

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${SESSION_ID}] ${msg}\n`;
  try {
    // Rotate if file exceeds max size
    try {
      const st = statSync(LOG_PATH);
      if (st.size >= LOG_MAX_BYTES) {
        renameSync(LOG_PATH, LOG_PATH + ".1");
      }
    } catch {
      // File doesn't exist yet — that's fine
    }
    appendFileSync(LOG_PATH, line);
  } catch (err) {
    process.stderr.write(`[mcp] Log write failed: ${err.message}\n`);
  }
}

log(`MCP server starting — PID=${process.pid} session=${SESSION_ID}`);

// ── Control-char sanitization ─────────────────────────────────────────────
// Strip ASCII control characters (0x00-0x1F) except \t (0x09), \n (0x0A),
// \r (0x0D) from tool result text.  These chars cause JSON parse failures
// in downstream consumers (e.g. OpenAI Codex serialization in ZeroClaw).
// See: https://github.com/TomasWard1/limbo/issues/245

const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

function sanitizeToolResult(result) {
  if (!result || !Array.isArray(result.content)) return result;
  for (const block of result.content) {
    if (block.type === "text" && typeof block.text === "string") {
      block.text = block.text.replace(CONTROL_CHAR_RE, "");
    }
  }
  return result;
}

const EVAL_MODE = process.env.LIMBO_EVAL === "true";

function evalLog(event) {
  if (!EVAL_MODE) return;
  process.stderr.write(JSON.stringify({ ...event, timestamp: new Date().toISOString() }) + "\n");
}

const server = new Server(
  {
    name: "limbo-vault",
    version: "1.3.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ── Tool definitions ────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "vault_search",
      description:
        "Search notes in the vault by keyword query. Recursively searches all subdirectories. Returns matching notes with titles, snippets, relevance scores, and domain (subdirectory).",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Keyword query to search across all vault notes",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "vault_read",
      description:
        "Read the full content of a vault note by ID. Searches recursively through subdirectories. Returns raw markdown including YAML frontmatter.",
      inputSchema: {
        type: "object",
        properties: {
          noteId: {
            type: "string",
            description: "The note ID (filename without .md extension). Searched recursively across all subdirectories.",
          },
        },
        required: ["noteId"],
      },
    },
    {
      name: "vault_write_note",
      description:
        "Create or overwrite a vault note with YAML frontmatter. Supports subdirectory organization — creates the subdirectory if it doesn't exist.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Unique note identifier (alphanumeric, dashes, underscores)" },
          title: { type: "string", description: "Human-readable note title" },
          type: {
            type: "string",
            enum: ["fact", "preference", "person", "event", "project", "decision", "idea", "question", "source", "insight"],
            description: "Note type: fact, preference, person, event, project, decision, idea, question, source, insight",
          },
          description: { type: "string", description: "One-sentence falsifiable description of the note's claim" },
          content: { type: "string", description: "Full markdown body of the note" },
          subdirectory: { type: "string", description: "Optional subdirectory under notes/ (e.g. 'limbo', 'research', 'aios/infrastructure'). Created if it doesn't exist." },
          status: { type: "string", description: "Optional: current, outdated, superseded. Defaults to none." },
          domain: { type: "string", description: "Optional: knowledge domain (e.g. limbo, aios, research, personal)" },
          source: { type: "string", description: "Optional: provenance (e.g. limbo, claude-code, web)" },
          topics: {
            type: "array",
            items: { type: "string" },
            description: "Optional: map references as wikilinks, e.g. [\"[[limbo-map]]\"]",
          },
        },
        required: ["id", "title", "type", "description", "content"],
      },
    },
    {
      name: "vault_update_map",
      description:
        "Append entries to a section in a Map of Content (MOC). Creates the map file (with frontmatter) and/or section if they don't exist. Maps live in vault/maps/.",
      inputSchema: {
        type: "object",
        properties: {
          map: {
            type: "string",
            description: "Map filename without extension (e.g. 'limbo-map', 'ai-research-map')",
          },
          section: {
            type: "string",
            description: "Section heading text to append entries under",
          },
          entries: {
            type: "array",
            items: { type: "string" },
            description: "Markdown link strings to append, e.g. [\"- [[note-id|Note Title]]\"]",
          },
        },
        required: ["map", "section", "entries"],
      },
    },
    {
      name: "vault_store_file",
      description:
        "Store a file (image, PDF, document) in the vault and create a linked note. Preferred: pass filePath to copy a local file (e.g. from telegram_files/). Fallback: pass filename + fileData as base64. The source file is deleted after a successful copy.",
      inputSchema: {
        type: "object",
        properties: {
          noteId: { type: "string", description: "Unique ID for the linked note (alphanumeric, dashes, underscores)" },
          title: { type: "string", description: "Human-readable title for the linked note" },
          description: { type: "string", description: "One-sentence description of the file's content or purpose" },
          content: { type: "string", description: "Markdown body for the linked note — include context from the conversation about why this file was saved" },
          filePath: { type: "string", description: "Absolute path to a local file to store (e.g. /home/limbo/.openclaw/workspace/telegram_files/doc.pdf). Preferred over fileData. Filename is derived from the path." },
          filename: { type: "string", description: "Original filename with extension — required with fileData, optional with filePath (auto-derived)" },
          fileData: { type: "string", description: "Base64-encoded file content (max 10MB) — fallback when filePath is not available" },
          subdirectory: { type: "string", description: "Optional subdirectory under assets/ (e.g. 'images', 'documents', 'screenshots')" },
          noteSubdirectory: { type: "string", description: "Optional subdirectory under notes/ for the linked note" },
          mimeType: { type: "string", description: "Optional MIME type (auto-detected from extension if omitted)" },
          domain: { type: "string", description: "Optional: knowledge domain" },
          source: { type: "string", description: "Optional: provenance (e.g. 'limbo', 'telegram')" },
          topics: {
            type: "array",
            items: { type: "string" },
            description: "Optional: map references as wikilinks, e.g. [\"[[documents-map]]\"]",
          },
        },
        required: ["noteId", "title", "description", "content"],
      },
    },
    {
      name: "vault_get_file",
      description:
        "Retrieve a stored file by its linked note ID. Reads the note's asset_path from frontmatter and returns metadata plus an absolute path reference so Telegram responses can send it as a real attachment.",
      inputSchema: {
        type: "object",
        properties: {
          noteId: {
            type: "string",
            description: "The note ID of the linked note (the note that references the file via asset_path)",
          },
        },
        required: ["noteId"],
      },
    },
    {
      name: "workspace_read",
      description:
        "Read one of your workspace personality/config files. Use this to check your current USER.md before updating it. Also readable: SOUL.md, IDENTITY.md, AGENTS.md, TOOLS.md (all read-only).",
      inputSchema: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "Filename to read (e.g. 'USER.md', 'SOUL.md', 'IDENTITY.md')",
          },
        },
        required: ["filename"],
      },
    },
    {
      name: "workspace_write",
      description:
        "Update USER.md with user profile information (name, timezone, language, preferences). Read the file first with workspace_read, then write the full updated content. Only USER.md is writable — all other workspace files are read-only.",
      inputSchema: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            enum: ["USER.md"],
            description: "Which file to update (only USER.md is writable)",
          },
          content: {
            type: "string",
            description: "Complete file content (replaces the entire file)",
          },
        },
        required: ["filename", "content"],
      },
    },
    {
      name: "calendar_read",
      description:
        "List upcoming Google Calendar events. Returns events within a date range. Defaults to today if no range specified. Use when the user asks about their schedule, meetings, or availability.",
      inputSchema: {
        type: "object",
        properties: {
          startDate: {
            type: "string",
            description:
              "Start of range in ISO 8601 date format (e.g. '2026-04-09'). Defaults to today.",
          },
          endDate: {
            type: "string",
            description:
              "End of range in ISO 8601 date format (e.g. '2026-04-10'). Defaults to end of startDate.",
          },
          maxResults: {
            type: "number",
            description:
              "Maximum number of events to return. Default: 25, max: 100.",
          },
        },
        required: [],
      },
    },
    {
      name: "calendar_create",
      description:
        "Create a new Google Calendar event. Requires a title and start time. Duration defaults to 60 minutes. Always confirm details with the user before creating. IMPORTANT: pass the user's timeZone (read from USER.md) so the event lands at the correct local time.",
      inputSchema: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Event title/summary",
          },
          startTime: {
            type: "string",
            description:
              "Event start time. Either ISO 8601 without offset (e.g. '2026-04-09T14:00:00') — in which case pass timeZone — or with offset (e.g. '2026-04-09T14:00:00-03:00').",
          },
          duration: {
            type: "number",
            description: "Duration in minutes. Default: 60.",
          },
          description: {
            type: "string",
            description: "Optional event description/notes",
          },
          location: {
            type: "string",
            description: "Optional event location",
          },
          timeZone: {
            type: "string",
            description:
              "IANA timezone identifier (e.g. 'America/Argentina/Buenos_Aires'). Read from USER.md. Required when startTime has no offset.",
          },
        },
        required: ["title", "startTime"],
      },
    },
    {
      name: "calendar_delete",
      description:
        "Delete a Google Calendar event by its id. Get the id first via calendar_read. Always confirm with the user before deleting — this is irreversible.",
      inputSchema: {
        type: "object",
        properties: {
          eventId: {
            type: "string",
            description: "Google Calendar event id (from calendar_read results)",
          },
        },
        required: ["eventId"],
      },
    },
    {
      name: "calendar_update",
      description:
        "Update an existing Google Calendar event. Only the provided fields are changed (PATCH). Get the event id first via calendar_read. Always confirm changes with the user before applying.",
      inputSchema: {
        type: "object",
        properties: {
          eventId: {
            type: "string",
            description: "Google Calendar event id (from calendar_read results)",
          },
          title: {
            type: "string",
            description: "New event title/summary",
          },
          startTime: {
            type: "string",
            description:
              "New event start time. ISO 8601, with or without offset. When changing the time, pass timeZone too.",
          },
          duration: {
            type: "number",
            description:
              "New duration in minutes. Must be passed together with startTime (duration-only updates not supported).",
          },
          description: {
            type: "string",
            description: "New event description",
          },
          location: {
            type: "string",
            description: "New event location",
          },
          timeZone: {
            type: "string",
            description:
              "IANA timezone (e.g. 'America/Argentina/Buenos_Aires'). Read from USER.md. Required when startTime has no offset.",
          },
        },
        required: ["eventId"],
      },
    },
    {
      name: "update_instance",
      description:
        "Trigger a Limbo self-update. Notifies the user that Limbo is going offline briefly, then signals the host to pull the latest image and restart. Use when the user wants to update Limbo.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "get_current_time",
      description:
        "Get the current date, time, and timezone. Returns ISO 8601 with offset, UTC ISO, IANA timezone, unix timestamp, and weekday name. ALWAYS call this before creating time-sensitive cron jobs or calendar events — never guess the current date.",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "cron_list",
      description:
        "List all scheduled cron jobs (reminders). Returns each job's ID, name, schedule, delivery target, and last/next run times. Use when the user asks 'what reminders do I have?'",
      inputSchema: {
        type: "object",
        properties: {
          includeDisabled: {
            type: "boolean",
            description: "Include disabled jobs in the list. Default: false.",
          },
        },
        required: [],
      },
    },
    {
      name: "cron_add",
      description:
        "Create a scheduled cron job (reminder). Supports one-shot (kind='at'), recurring interval (kind='every'), and cron expressions (kind='cron'). Use for ANY request involving 'remind me', 'every day at', 'schedule', 'in X minutes'.",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Short description of the reminder (e.g. 'Recordatorio: llamar al banco')",
          },
          prompt: {
            type: "string",
            description: "The message the agent will send when the job fires (e.g. 'Recordatorio — llamar al banco')",
          },
          schedule: {
            type: "object",
            description: "Schedule config. Must include 'kind' ('at', 'every', or 'cron'). For 'at': include 'at' (ISO-8601 UTC timestamp). For 'every': include 'everyMs' (interval in ms). For 'cron': include 'expr' (cron expression) and 'tz' (IANA timezone).",
            properties: {
              kind: {
                type: "string",
                enum: ["at", "every", "cron"],
                description: "Schedule type",
              },
              at: {
                type: "string",
                description: "ISO-8601 UTC timestamp for one-shot schedules (kind='at')",
              },
              everyMs: {
                type: "number",
                description: "Interval in milliseconds for recurring schedules (kind='every', min 1000)",
              },
              expr: {
                type: "string",
                description: "Cron expression for recurring schedules (kind='cron'), e.g. '0 9 * * *'",
              },
              tz: {
                type: "string",
                description: "IANA timezone for cron expressions (kind='cron'), e.g. 'America/Argentina/Buenos_Aires'",
              },
            },
            required: ["kind"],
          },
          delivery: {
            type: "object",
            description: "Optional delivery config for isolated agent reminders. For Telegram reminders: { mode: 'announce', channel: 'telegram', to: '<chat_id>' }. mode='none' suppresses announcement delivery.",
            properties: {
              mode: { type: "string", enum: ["none", "announce"], description: "Delivery mode" },
              channel: { type: "string", description: "Channel type: 'telegram', 'slack', 'discord'" },
              to: { type: "string", description: "Chat/channel ID to deliver to" },
              accountId: { type: "string", description: "Account ID for multi-account channels" },
            },
          },
          sessionTarget: {
            type: "string",
            enum: ["main", "isolated"],
            description: "Session target for the job. Default: 'isolated'. Use 'main' only when you want to inject the prompt as a main-session system event instead of running an isolated agent turn.",
          },
          deleteAfterRun: {
            type: "boolean",
            description: "Delete job after first run. Default: true for one-shot ('at'), false for recurring.",
          },
        },
        required: ["name", "prompt", "schedule"],
      },
    },
    {
      name: "cron_remove",
      description:
        "Remove a scheduled cron job by ID. Get the job ID from cron_list first. Use when the user asks to cancel or delete a reminder.",
      inputSchema: {
        type: "object",
        properties: {
          jobId: {
            type: "string",
            description: "The job ID to remove (UUID from cron_list)",
          },
        },
        required: ["jobId"],
      },
    },
  ],
}));

// ── Tool execution ──────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Include params as JSON in the log line so eval assertions can verify
  // tool arguments (e.g. calendar_create was called with the right timeZone).
  // The provider's parser matches `tool_call: <name>` first — the trailing
  // JSON is ignored by the existing regex, so this is backwards compatible.
  const paramsStr = args && Object.keys(args).length ? ` params=${JSON.stringify(args)}` : "";
  log(`tool_call: ${name}${paramsStr}`);
  evalLog({ type: "tool_call", tool: name, params: args });

  try {
    let result;

    switch (name) {
      case "vault_search": {
        const results = await vaultSearch(args.query);
        result = {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
        break;
      }

      case "vault_read": {
        const content = await vaultRead(args.noteId);
        if (content === null) {
          result = {
            content: [{ type: "text", text: `Note not found: ${args.noteId}` }],
            isError: true,
          };
          break;
        }
        result = { content: [{ type: "text", text: content }] };
        break;
      }

      case "vault_write_note": {
        const writeResult = await vaultWriteNote(args);
        result = {
          content: [{ type: "text", text: `Note written: ${writeResult.id} → ${writeResult.path}` }],
        };
        break;
      }

      case "vault_update_map": {
        const mapResult = await vaultUpdateMap(args.map, args.section, args.entries);
        result = {
          content: [
            {
              type: "text",
              text: `Map updated: ${mapResult.map} — added ${mapResult.added} entries to "${mapResult.section}"`,
            },
          ],
        };
        break;
      }

      case "vault_store_file": {
        const storeResult = await vaultStoreFile(args);
        const absoluteAssetPath = `${process.env.VAULT_PATH || "/data/vault"}/${storeResult.assetPath}`;
        result = {
          content: [
            {
              type: "text",
              text: `File stored successfully.\nAsset path (absolute): ${absoluteAssetPath}\nAsset path (relative): ${storeResult.assetPath}\nLinked note: ${storeResult.noteId} → ${storeResult.notePath}\n\nTo send this file to the user, reply with: [DOCUMENT:${absoluteAssetPath}]`,
            },
          ],
        };
        break;
      }

      case "vault_get_file": {
        const fileResult = await vaultGetFile(args.noteId);
        const vaultBase = process.env.VAULT_PATH || "/data/vault";
        const absolutePath = `${vaultBase}/${fileResult.assetPath}`;
        result = {
          content: [
            {
              type: "text",
              text: [
                `File: ${fileResult.filename}`,
                `Type: ${fileResult.mimeType}`,
                `Size: ${formatSize(fileResult.size)}`,
                `Path: ${fileResult.assetPath}`,
                `Absolute path: ${absolutePath}`,
                "",
                `This file should be sent to the user as a real attachment.`,
                `Reply with exactly: [DOCUMENT:${absolutePath}]`,
                `Do NOT inline file contents, base64 data, or markdown excerpts from the note.`,
              ].join("\n"),
            },
          ],
        };
        break;
      }

      case "workspace_read": {
        const wsRead = await workspaceRead(args.filename);
        result = {
          content: [{ type: "text", text: wsRead.content }],
        };
        break;
      }

      case "workspace_write": {
        const wsWrite = await workspaceWrite(args.filename, args.content);
        result = {
          content: [{ type: "text", text: `Updated ${wsWrite.filename} (${wsWrite.size} bytes)` }],
        };
        break;
      }

      case "calendar_read": {
        const events = await calendarRead(args);
        result = {
          content: [{ type: "text", text: JSON.stringify(events, null, 2) }],
        };
        break;
      }

      case "calendar_create": {
        const event = await calendarCreate(args);
        result = {
          content: [{ type: "text", text: JSON.stringify(event, null, 2) }],
        };
        break;
      }

      case "calendar_delete": {
        const deleted = await calendarDelete(args);
        result = {
          content: [{ type: "text", text: JSON.stringify(deleted, null, 2) }],
        };
        break;
      }

      case "calendar_update": {
        const updated = await calendarUpdate(args);
        result = {
          content: [{ type: "text", text: JSON.stringify(updated, null, 2) }],
        };
        break;
      }

      case "update_instance": {
        result = await updateInstance();
        break;
      }

      case "get_current_time": {
        result = await getCurrentTime();
        break;
      }

      case "cron_list": {
        const jobs = await cronList(args);
        result = {
          content: [{ type: "text", text: JSON.stringify(jobs, null, 2) }],
        };
        break;
      }

      case "cron_add": {
        const added = await cronAdd(args);
        result = {
          content: [{ type: "text", text: `Cron job created: ${added.name} (${added.id})\nSchedule: ${JSON.stringify(added.schedule)}` }],
        };
        break;
      }

      case "cron_remove": {
        const removed = await cronRemove(args);
        result = {
          content: [{ type: "text", text: `Cron job removed: ${removed.name || removed.id}` }],
        };
        break;
      }

      default:
        result = {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    // General response size guard — truncate any text content that would
    // bloat the LLM context and risk compressor corruption (issue #215)
    if (result.content) {
      for (const block of result.content) {
        if (block.type === "text" && block.text.length > MAX_RESPONSE_TEXT_SIZE) {
          const originalSize = block.text.length;
          block.text =
            block.text.slice(0, MAX_RESPONSE_TEXT_SIZE) +
            `\n\n[TRUNCATED — response was ${formatSize(originalSize)}, max ${formatSize(MAX_RESPONSE_TEXT_SIZE)}]`;
        }
      }
    }

    sanitizeToolResult(result);
    log(`tool_result: ${name} success=${!result.isError}`);
    evalLog({ type: "tool_result", tool: name, success: !result.isError });
    return result;
  } catch (err) {
    log(`tool_error: ${name} error=${err.message}`);
    evalLog({ type: "tool_result", tool: name, success: false, error: err.message });
    const errResult = {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
    return sanitizeToolResult(errResult);
  }
});

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Start ───────────────────────────────────────────────────────────────────

// Build in-memory index before accepting connections
const noteCount = await buildIndex();
log(`Index built: ${noteCount} notes (FTS5 search active)`);
process.stderr.write(`[limbo-vault] Index built: ${noteCount} notes (FTS5 search active)\n`);

const transport = new StdioServerTransport();
await server.connect(transport);
log("Transport connected — ready to accept requests");
