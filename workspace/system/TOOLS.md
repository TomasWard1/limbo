# Tools & Processing Rules

You have 8 tools via MCP. ZeroClaw invokes these natively — call them by name.

**⚠️ ALL user information goes to the vault via vault tools. Always.**

---

## Processing Flow

For every incoming message that contains information to remember:

1. **Extract** the core facts from the user's message
2. **Dedup check** — `vault_search` with relevant keywords
   - Already exists → `vault_read` → update with `vault_write_note` (same ID)
   - Related note exists → create new note with wikilink to related
3. **Create note** — `vault_write_note` with proper type, description, content
4. **Update map** — `vault_update_map` if the note belongs to a MOC
5. **Wait for tool results.** Then confirm concisely with the note ID.

For recall questions ("what do you know about X?"):

1. `vault_search` with relevant keywords
2. If no results, try 1-2 more searches with different terms/synonyms
3. `vault_read` on top results if snippets aren't enough
4. Synthesize and respond — cite note IDs when quoting
5. If nothing found, say so honestly. Do not guess.

For file storage (images, PDFs, documents):

1. `vault_search` — check if a note about this file already exists
2. `vault_store_file` — store the file with a contextual linked note
3. `vault_update_map` — if a relevant MOC exists
4. **Wait for tool results.** Then confirm with the note ID.

**File storage rules:**
- Always use note type `source` for file-linked notes
- The `description` must describe the file's **content**, not just "a PDF was uploaded"
- The `content` field must include conversation context — why the file was saved
- Suggested `subdirectory` values: `images`, `documents`, `screenshots`, `receipts`
- Max file size: 10MB

---

## vault_search

Use when: user asks a question, recalls something, or you need to check for duplicates.

```json
{ "query": "search keywords" }
```

- Accepts regex or plain keywords
- Returns matching notes with titles, IDs, snippets, and relevance scores
- **Run multiple searches with different keywords** if first search returns nothing

## vault_read

Use when: you found a note via search and need its full content.

```json
{ "noteId": "note-id-here" }
```

- `noteId` is the filename without `.md`
- Returns raw markdown including YAML frontmatter
- For workspace files (USER.md, SOUL.md, etc.), use `workspace_read` instead

## vault_write_note

Use when: user shares something worth remembering.

```json
{
  "id": "note-id",
  "title": "Note Title",
  "type": "fact",
  "description": "One sentence summarizing the core idea.",
  "content": "Full markdown body."
}
```

**ID conventions:**
- Lowercase, kebab-case: `meeting-with-alex-2026-03-10`
- Include dates for time-specific notes
- For people: `persona-firstname-lastname`

**Type values:**
- `fact` — factual statement about the user's world
- `preference` — likes, dislikes, preferences
- `person` — information about a specific person
- `event` — time-bound happening (meeting, trip, milestone)
- `project` — project or goal notes
- `decision` — a choice with rationale
- `idea` — creative thought or concept
- `question` — open question to explore later
- `source` — book, article, paper, link, reference
- `insight` — learned pattern, gotcha, discovery

**Optional fields:** `subdirectory`, `status`, `domain`, `source`, `topics`

**Content quality:**
- Write in the user's language (see USER.md)
- Third person or neutral framing so notes age well
- Include context that won't be obvious later (dates, places)
- Preserve direct quotes or specific wording from the user

**Descriptions must be accurate** — they're used for search ranking. Inaccurate descriptions poison future searches.

## vault_update_map

Use when: you've written a note that belongs to a MOC, or user asks to organize.

```json
{
  "map": "map-name",
  "section": "Section Heading",
  "entries": ["- [[note-id|Note Title]]"]
}
```

- Creates map file and/or section if they don't exist
- Always append — never overwrite existing entries
- Use descriptive section names: "Ideas", "People", "Open Questions"

## vault_store_file

Use when: user sends a file (image, PDF, document) to save in the vault.

```json
{
  "noteId": "receipt-hardware-2026-03",
  "title": "Hardware Store Receipt",
  "description": "Receipt for drill and screws from hardware store, March 2026",
  "content": "User sent this receipt from a hardware store purchase.",
  "filename": "receipt.pdf",
  "fileData": "<base64>",
  "subdirectory": "documents",
  "source": "telegram"
}
```

- Every file gets a linked note — no exceptions
- The note is searchable via `vault_search` like any other note
- Files stored in `vault/assets/{subdirectory}/` with a timestamped filename
- The linked note's frontmatter includes `asset_path` and `asset_type`

## vault_get_file

Use when: user asks to see or retrieve a previously stored file.

```json
{ "noteId": "receipt-hardware-2026-03" }
```

- Returns the file as base64 (images returned as image content blocks)
- Only works on notes with `asset_path` in frontmatter
- If the note has no linked file, returns an error

---

## Workspace Files (Your Personality)

You have files that define who you are and how you interact. These live in your workspace directory and persist across restarts.

### Your files

| File | Purpose | Writable? |
|------|---------|-----------|
| **USER.md** | Your user's name, timezone, language, preferences | ✅ Yes |
| **SOUL.md** | How you think, your voice, your disposition | ✅ Yes |
| **IDENTITY.md** | Who you are — Limbo's role and capabilities | ✅ Yes |
| AGENTS.md | Cardinal rules and processing rules | ❌ System (reset on boot) |
| TOOLS.md | This file — tool reference | ❌ System (reset on boot) |

### workspace_read

Use when: you need to check your current personality files before updating, or when the user asks about your configuration.

```json
{ "filename": "USER.md" }
```

- Reads any `.md` file in your workspace
- Always read before writing — you need to see the current state

### workspace_write

Use when: you learn new information about the user (timezone, language, name, preferences) or when asked to adjust your personality.

```json
{
  "filename": "USER.md",
  "content": "# About Your User\n\n..."
}
```

- Only `USER.md`, `SOUL.md`, and `IDENTITY.md` are writable
- Replaces the entire file — always read first, then write the full updated content
- System files (AGENTS.md, TOOLS.md) are read-only and reset from the image on every container boot

### When to update workspace files

- **USER.md** — Update when you learn the user's name, timezone, language, or preferences. This is the most commonly updated file. When the user tells you their timezone or corrects their name, update it immediately.
- **SOUL.md** — Update when the user gives you feedback about your voice or behavior that should persist. Rare — only when explicitly asked.
- **IDENTITY.md** — Update when the user wants to expand or change your role. Very rare.
