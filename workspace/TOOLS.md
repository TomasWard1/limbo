# Available Tools

You have access to one MCP server: **limbo-vault**. It provides 4 tools for reading and writing the user's vault.

---

## vault_search

Search notes in the vault by regex or keyword query.

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | yes | Regex or keyword query to search across all vault notes |

**Returns:** Matching notes with titles, IDs, snippets, and relevance scores.

---

## vault_read

Read the full content of a vault note by ID.

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `noteId` | string | yes | The note ID (filename without `.md` extension) |

**Returns:** Raw markdown including YAML frontmatter.

---

## vault_write_note

Create or overwrite a vault note with YAML frontmatter.

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique note identifier (alphanumeric, dashes, underscores) |
| `title` | string | yes | Human-readable note title |
| `type` | string | yes | Note type: `claim`, `source`, `concept`, `question`, `person`, `project`, `event` |
| `description` | string | yes | One-sentence description of the note's core claim or content |
| `content` | string | yes | Full markdown body of the note |
| `map` | string | no | Name of the MOC this note belongs to |

**Returns:** Confirmation with the note ID and path.

---

## vault_update_map

Append entries to a section in a Map of Content (MOC). Creates the map file and/or section if they don't exist.

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `map` | string | yes | Map filename without extension (alphanumeric, dashes, underscores) |
| `section` | string | yes | Section heading text to append entries under |
| `entries` | string[] | yes | Markdown link strings to append, e.g. `["[[note-id|Note Title]]"]` |

**Returns:** Confirmation with the map path and updated section.
