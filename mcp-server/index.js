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

const EVAL_MODE = process.env.LIMBO_EVAL === "true";

function evalLog(event) {
  if (!EVAL_MODE) return;
  process.stderr.write(JSON.stringify({ ...event, timestamp: new Date().toISOString() }) + "\n");
}

const server = new Server(
  {
    name: "limbo-vault",
    version: "1.2.0",
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
process.stderr.write(`[limbo-vault] Index built: ${noteCount} notes (FTS5 search active)\n`);

const transport = new StdioServerTransport();
await server.connect(transport);
