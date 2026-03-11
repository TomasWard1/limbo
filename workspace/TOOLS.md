# Available Tools

You have access to the **limbo-vault** MCP server via **mcporter**. Call tools from the shell using the `mcporter call` command.

```sh
mcporter call limbo-vault.<tool_name> <key>=<value> ...
```

The `MCPORTER_CONFIG` environment variable is pre-set to `/app/mcporter.json`, which registers the limbo-vault server.

---

## vault_search

Search notes in the vault by regex or keyword query.

**Shell call:**
```sh
mcporter call limbo-vault.vault_search query="your search term"
```

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | string | yes | Regex or keyword query to search across all vault notes |

**Returns:** Matching notes with titles, IDs, snippets, and relevance scores.

---

## vault_read

Read the full content of a vault note by ID.

**Shell call:**
```sh
mcporter call limbo-vault.vault_read noteId="note-id-here"
```

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `noteId` | string | yes | The note ID (filename without `.md` extension) |

**Returns:** Raw markdown including YAML frontmatter.

---

## vault_write_note

Create or overwrite a vault note with YAML frontmatter.

**Shell call:**
```sh
mcporter call limbo-vault.vault_write_note \
  id="note-id" \
  title="Note Title" \
  type="claim" \
  description="One-sentence summary of the note's core claim." \
  content="Full markdown body of the note." \
  map="optional-moc-name"
```

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

**Shell call:**
```sh
mcporter call limbo-vault.vault_update_map \
  map="map-name" \
  section="Section Heading" \
  entries='["[[note-id|Note Title]]"]'
```

**Input:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `map` | string | yes | Map filename without extension (alphanumeric, dashes, underscores) |
| `section` | string | yes | Section heading text to append entries under |
| `entries` | string[] | yes | Markdown link strings to append, e.g. `["[[note-id|Note Title]]"]` |

**Returns:** Confirmation with the map path and updated section.
