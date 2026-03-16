# Available Tools

You have access to the **limbo-vault** MCP server via **mcporter**. Call tools from the shell using the `mcporter call` command.

```sh
mcporter call limbo-vault.<tool_name> <key>=<value> ...
```

The `MCPORTER_CONFIG` environment variable is pre-set to `/app/mcporter.json`, which registers the limbo-vault server.

---

## vault_search

Search notes in the vault by keyword query. Recursively searches all subdirectories under `vault/notes/`.

**Shell call:**
```sh
mcporter call limbo-vault.vault_search query="your search term"
```

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | yes | Keyword query to search across all vault notes |

**Returns:** Matching notes with titles, IDs, snippets, relevance scores, and domain (subdirectory).

---

## vault_read

Read the full content of a vault note by ID. Searches recursively through subdirectories.

**Shell call:**
```sh
mcporter call limbo-vault.vault_read noteId="note-id-here"
```

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `noteId` | string | yes | The note ID (filename without `.md` extension). Searched recursively. |

**Returns:** Raw markdown including YAML frontmatter.

---

## vault_write_note

Create or overwrite a vault note with YAML frontmatter. Supports subdirectory organization — creates the subdirectory if it doesn't exist.

**Shell call:**
```sh
mcporter call limbo-vault.vault_write_note \
  id="note-id" \
  title="Note Title" \
  type="config-fact" \
  description="One-sentence falsifiable description." \
  content="Full markdown body of the note." \
  subdirectory="openclaw" \
  domain="openclaw" \
  source="limbo" \
  topics='["[[openclaw-map]]"]'
```

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique note identifier (alphanumeric, dashes, underscores) |
| `title` | string | yes | Human-readable note title |
| `type` | string | yes | Note type: `gotcha`, `decision`, `config-fact`, `pattern`, `tool-knowledge`, `research-finding`, `personal-fact` |
| `description` | string | yes | One-sentence falsifiable description of the note's claim |
| `content` | string | yes | Full markdown body of the note |
| `subdirectory` | string | no | Subdirectory under `notes/` (e.g. `openclaw`, `research`, `aios/infrastructure`). Created if it doesn't exist. |
| `status` | string | no | Note status: `current`, `outdated`, `superseded` |
| `domain` | string | no | Knowledge domain (e.g. `openclaw`, `aios`, `research`, `personal`) |
| `source` | string | no | Provenance (e.g. `limbo`, `claude-code`, `web`) |
| `topics` | string[] | no | Map references as wikilinks, e.g. `["[[openclaw-map]]"]` |

**Returns:** Confirmation with the note ID and path.

---

## vault_update_map

Append entries to a section in a Map of Content (MOC). Creates the map file (with frontmatter) and/or section if they don't exist. Maps live in `vault/maps/`.

**Shell call:**
```sh
mcporter call limbo-vault.vault_update_map \
  map="map-name" \
  section="Section Heading" \
  entries='["- [[note-id|Note Title]]"]'
```

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `map` | string | yes | Map filename without extension (e.g. `openclaw-map`, `ai-research-map`) |
| `section` | string | yes | Section heading text to append entries under |
| `entries` | string[] | yes | Markdown link strings to append, e.g. `["- [[note-id|Note Title]]"]` |

**Returns:** Confirmation with the map name and updated section.
