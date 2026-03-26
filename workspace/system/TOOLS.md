# Available Tools

You have access to the **limbo-vault** MCP server. ZeroClaw invokes these tools natively — call them directly by name.

---

## vault_search

Search notes in the vault by keyword query. Recursively searches all subdirectories under `vault/notes/`.

Call `vault_search` with:
```json
{ "query": "your search term" }
```

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | yes | Keyword query to search across all vault notes |

**Returns:** Matching notes with titles, IDs, snippets, relevance scores, and domain (subdirectory).

---

## vault_read

Read the full content of a vault note by ID. Searches recursively through subdirectories.

Call `vault_read` with:
```json
{ "noteId": "note-id-here" }
```

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `noteId` | string | yes | The note ID (filename without `.md` extension). Searched recursively. |

**Returns:** Raw markdown including YAML frontmatter.

---

## vault_write_note

Create or overwrite a vault note with YAML frontmatter. Supports subdirectory organization — creates the subdirectory if it doesn't exist.

Call `vault_write_note` with:
```json
{
  "id": "note-id",
  "title": "Note Title",
  "type": "fact",
  "description": "One-sentence falsifiable description.",
  "content": "Full markdown body of the note.",
  "subdirectory": "zeroclaw",
  "domain": "zeroclaw",
  "source": "limbo",
  "topics": ["[[zeroclaw-map]]"]
}
```

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique note identifier (alphanumeric, dashes, underscores) |
| `title` | string | yes | Human-readable note title |
| `type` | string | yes | Note type: `fact`, `preference`, `person`, `event`, `project`, `decision`, `idea`, `question`, `source`, `insight` |
| `description` | string | yes | One-sentence falsifiable description of the note's claim |
| `content` | string | yes | Full markdown body of the note |
| `subdirectory` | string | no | Subdirectory under `notes/` (e.g. `zeroclaw`, `research`, `aios/infrastructure`). Created if it doesn't exist. |
| `status` | string | no | Note status: `current`, `outdated`, `superseded` |
| `domain` | string | no | Knowledge domain (e.g. `zeroclaw`, `aios`, `research`, `personal`) |
| `source` | string | no | Provenance (e.g. `limbo`, `claude-code`, `web`) |
| `topics` | string[] | no | Map references as wikilinks, e.g. `["[[zeroclaw-map]]"]` |

**Returns:** Confirmation with the note ID and path.

---

## vault_update_map

Append entries to a section in a Map of Content (MOC). Creates the map file (with frontmatter) and/or section if they don't exist. Maps live in `vault/maps/`.

Call `vault_update_map` with:
```json
{
  "map": "map-name",
  "section": "Section Heading",
  "entries": ["- [[note-id|Note Title]]"]
}
```

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `map` | string | yes | Map filename without extension (e.g. `zeroclaw-map`, `ai-research-map`) |
| `section` | string | yes | Section heading text to append entries under |
| `entries` | string[] | yes | Markdown link strings to append, e.g. `["- [[note-id|Note Title]]"]` |

**Returns:** Confirmation with the map name and updated section.

---

## vault_store_file

Store a binary file (image, PDF, document) in the vault and create a linked note with metadata. The file is saved to `vault/assets/` and a markdown note is created in `vault/notes/` referencing it.

Call `vault_store_file` with:
```json
{
  "noteId": "receipt-hardware-store-2026-03",
  "title": "Hardware Store Receipt March 2026",
  "description": "Receipt for drill and screws purchased March 26, 2026",
  "content": "Purchased at the hardware store on March 26. Total: $45.",
  "filename": "receipt.pdf",
  "fileData": "<base64-encoded-content>",
  "subdirectory": "documents",
  "source": "telegram"
}
```

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `noteId` | string | yes | Unique ID for the linked note (alphanumeric, dashes, underscores) |
| `title` | string | yes | Human-readable title for the linked note |
| `description` | string | yes | One-sentence description of the file's content or purpose |
| `content` | string | yes | Markdown body — include context from the conversation about why this file was saved |
| `filename` | string | yes | Original filename with extension (e.g. `photo.jpg`, `report.pdf`) |
| `fileData` | string | yes | Base64-encoded file content (max 10MB) |
| `subdirectory` | string | no | Subdirectory under `assets/` (e.g. `images`, `documents`, `screenshots`) |
| `noteSubdirectory` | string | no | Subdirectory under `notes/` for the linked note |
| `mimeType` | string | no | MIME type (auto-detected from extension if omitted) |
| `domain` | string | no | Knowledge domain |
| `source` | string | no | Provenance (e.g. `limbo`, `telegram`) |
| `topics` | string[] | no | Map references as wikilinks |

**Returns:** Confirmation with the note ID, note path, and asset path.

---

## vault_get_file

Retrieve a stored file by its linked note ID. Reads the `asset_path` from the note's frontmatter and returns the file as base64.

Call `vault_get_file` with:
```json
{ "noteId": "receipt-hardware-store-2026-03" }
```

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `noteId` | string | yes | The note ID of the linked note (must have `asset_path` in frontmatter) |

**Returns:** For images: an image content block. For other files: JSON with `filename`, `mimeType`, and `data` (base64).
