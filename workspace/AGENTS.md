# How to Use Your Tools

You have 4 vault tools. This document explains when and how to use each one correctly.

## General Rules

1. **Always search before answering** — Before responding to any question about past knowledge, run `vault_search` first. Never rely solely on your context window.
2. **Search before writing** — Before creating a new note, search to ensure it doesn't already exist. Update existing notes rather than creating duplicates.
3. **Use atomic notes** — Each note captures one idea or fact. If a user shares multiple distinct things in one message, write multiple notes.
4. **Keep descriptions honest** — The `description` field is a one-sentence summary of the note's core claim. It must be accurate — it's used for search ranking.

---

## vault_search

Use when: the user asks a question, recalls something, or you need to check if a note already exists.

```
vault_search(query: string)
```

- `query` accepts regex or plain keywords
- Returns matching notes with titles, IDs, and relevance snippets
- Scan results before reading individual notes — often the snippet is enough

**When to search:**
- "Do you remember when I told you about X?"
- "What do I know about Y?"
- "Show me everything on Z"
- Before writing a new note (dedup check)
- Before answering any factual recall question

---

## vault_read

Use when: you found a note via search and need its full content.

```
vault_read(noteId: string)
```

- `noteId` is the filename without the `.md` extension
- Returns raw markdown including YAML frontmatter
- Use this when the search snippet isn't enough context

---

## vault_write_note

Use when: the user shares something worth remembering, or asks you to capture/save something.

```
vault_write_note(
  id: string,         // unique, alphanumeric + dashes/underscores
  title: string,      // human-readable, descriptive
  type: string,       // claim | source | concept | question | person | project | event
  description: string, // one sentence summarizing the core idea
  content: string,    // full markdown body
  map?: string        // MOC this note belongs to (omit if unclear)
)
```

**ID conventions:**
- Use lowercase, kebab-case: `meeting-with-alex-2026-03-10`
- Include dates for time-specific notes: `idea-async-db-sync-2026-03`
- Keep IDs stable — they're used for linking

**Type values:**
- `claim` — a fact, assertion, or insight the user shares
- `source` — a book, article, paper, link, or reference
- `concept` — an abstract idea or mental model
- `question` — an open question to explore later
- `person` — information about a specific person
- `project` — notes related to a specific project or goal
- `event` — a meeting, call, or time-bound event

**Content quality:**
- Write in third person or neutral framing so notes age well
- Include context that won't be obvious later ("during the Berlin trip" → note the date)
- If the user gave you a direct quote or specific wording, preserve it

---

## vault_update_map

Use when: you've written a note that belongs to a Map of Content (MOC), or the user asks to organize notes.

```
vault_update_map(
  map: string,       // MOC filename without extension
  section: string,   // section heading to append under
  entries: string[]  // markdown link strings, e.g. ["[[note-id|Note Title]]"]
)
```

- Creates the map file and/or section if they don't exist
- Always append — never overwrite existing entries
- Use descriptive section names: "Ideas", "People", "Open Questions", "Projects"

**When to update maps:**
- After writing a note with a clear `map` assignment
- When the user asks to see all notes on a topic (create a map if none exists)
- During periodic organization passes

---

## Common Patterns

**Capture a new fact:**
1. `vault_search` to check for duplicates
2. `vault_write_note` with appropriate type and map
3. `vault_update_map` if a relevant MOC exists

**Answer a recall question:**
1. `vault_search` with relevant keywords
2. `vault_read` on top results if needed
3. Synthesize and respond — cite note IDs when quoting

**Organize a topic:**
1. `vault_search` to find all related notes
2. `vault_update_map` to collect them under a coherent section
3. Report what you found and organized
