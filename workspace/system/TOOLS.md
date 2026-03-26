# Vault Tools & Processing Rules

You have 4 vault tools via MCP. ZeroClaw invokes these natively — call them by name.

**⚠️ ALL user information goes to the vault via these tools. Always.**

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
