import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { vaultSearch } from "./tools/search.js";
import { vaultRead } from "./tools/read.js";
import { vaultWriteNote } from "./tools/write.js";
import { vaultUpdateMap } from "./tools/update-map.js";

const server = new Server(
  {
    name: "limbo-vault",
    version: "1.0.0",
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
        "Search notes in the vault by regex query. Returns matching notes with titles, snippets, and relevance scores.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Regex or keyword query to search across all vault notes",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "vault_read",
      description:
        "Read the full content of a vault note by ID. Returns raw markdown including YAML frontmatter.",
      inputSchema: {
        type: "object",
        properties: {
          noteId: {
            type: "string",
            description: "The note ID (filename without .md extension)",
          },
        },
        required: ["noteId"],
      },
    },
    {
      name: "vault_write_note",
      description:
        "Create or overwrite a vault note with YAML frontmatter. Required fields: id, title, type, description, content. Optional: map.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Unique note identifier (alphanumeric, dashes, underscores)" },
          title: { type: "string", description: "Human-readable note title" },
          type: { type: "string", description: "Note type, e.g. claim, source, concept, question" },
          description: { type: "string", description: "One-sentence description of the note's claim or content" },
          content: { type: "string", description: "Full markdown body of the note" },
          map: { type: "string", description: "Optional: name of the MOC this note belongs to" },
        },
        required: ["id", "title", "type", "description", "content"],
      },
    },
    {
      name: "vault_update_map",
      description:
        "Append entries to a section in a Map of Content (MOC). Creates the map file and/or section if they don't exist.",
      inputSchema: {
        type: "object",
        properties: {
          map: {
            type: "string",
            description: "Map filename without extension (alphanumeric, dashes, underscores)",
          },
          section: {
            type: "string",
            description: "Section heading text to append entries under",
          },
          entries: {
            type: "array",
            items: { type: "string" },
            description: "Markdown link strings to append, e.g. [\"[[note-id|Note Title]]\"]",
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

  try {
    switch (name) {
      case "vault_search": {
        const results = await vaultSearch(args.query);
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
      }

      case "vault_read": {
        const content = await vaultRead(args.noteId);
        if (content === null) {
          return {
            content: [{ type: "text", text: `Note not found: ${args.noteId}` }],
            isError: true,
          };
        }
        return { content: [{ type: "text", text: content }] };
      }

      case "vault_write_note": {
        const result = await vaultWriteNote(args);
        return {
          content: [{ type: "text", text: `Note written: ${result.id}` }],
        };
      }

      case "vault_update_map": {
        const result = await vaultUpdateMap(args.map, args.section, args.entries);
        return {
          content: [
            {
              type: "text",
              text: `Map updated: ${result.map} — added ${result.added} entries to "${result.section}"`,
            },
          ],
        };
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ── Start ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
