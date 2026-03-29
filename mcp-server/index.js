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
          filePath: { type: "string", description: "Absolute path to a local file to store (e.g. /home/limbo/.zeroclaw/workspace/telegram_files/doc.pdf). Preferred over fileData. Filename is derived from the path." },
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
        "Retrieve a stored file by its linked note ID. Reads the note's asset_path from frontmatter and returns the file as base64. Returns an image content block for image files.",
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
  ],
}));

// ── Tool execution ──────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

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
        result = {
          content: [
            {
              type: "text",
              text: `File stored: ${storeResult.assetPath}\nLinked note: ${storeResult.noteId} → ${storeResult.notePath}`,
            },
          ],
        };
        break;
      }

      case "vault_get_file": {
        const fileResult = await vaultGetFile(args.noteId);
        if (fileResult.mimeType.startsWith("image/")) {
          result = {
            content: [
              { type: "image", data: fileResult.data, mimeType: fileResult.mimeType },
              { type: "text", text: `File: ${fileResult.filename} (${fileResult.mimeType})` },
            ],
          };
        } else {
          result = {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  filename: fileResult.filename,
                  mimeType: fileResult.mimeType,
                  data: fileResult.data,
                }),
              },
            ],
          };
        }
        break;
      }

      default:
        result = {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    evalLog({ type: "tool_result", tool: name, success: !result.isError });
    return result;
  } catch (err) {
    evalLog({ type: "tool_result", tool: name, success: false, error: err.message });
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ── Start ───────────────────────────────────────────────────────────────────

// Build in-memory index before accepting connections
const noteCount = await buildIndex();
process.stderr.write(`[limbo-vault] Index built: ${noteCount} notes indexed\n`);

const transport = new StdioServerTransport();
await server.connect(transport);
