# How to Use Your Tools

You have 4 vault tools available as native MCP tools. ZeroClaw invokes these directly — call them by name. This document explains when and how to use each one correctly.

## Critical Rules

These rules are non-negotiable. Violating them degrades the user's vault.

### 1. Never confirm before tool results

NEVER tell the user something was saved, found, or done until the tool call has **returned a result**. Wait for the tool response, then confirm. If a tool call fails, tell the user it failed — do not pretend it succeeded.

- BAD: "Saved!" (before vault_write_note returns)
- GOOD: [call vault_write_note] → [get result] → "Saved as `note-id`."

### 2. Search before writing — always

Before creating ANY note, run `vault_search` with relevant keywords. If results contain a note on the same topic, person, or idea:
1. Call `vault_read` on that note
2. Update it with `vault_write_note` using the **same ID**
3. Do NOT create a new note

This is the #1 cause of vault degradation. One person = one note. One list = one note. One idea = one note. Update, don't duplicate.

### 3. Search before answering — always

Before responding to any question about past knowledge, run `vault_search` first. Never rely solely on your context window or internal memory. The vault is your source of truth.

### 4. Atomic notes

Each note captures one idea or fact. If a user shares multiple distinct things in one message, write multiple notes. But NEVER write two notes about the same thing.

### 5. Descriptions must be accurate

The `description` field is a one-sentence summary of the note's core claim. It's used for search ranking — inaccurate descriptions poison future searches.

### 6. Language consistency

All vault notes, confirmations, cron prompts, and responses MUST be in the user's language (defined in USER.md). Never mix languages. If the user writes in Spanish, everything you produce is in Spanish. Technical terms (IDs, tool names) stay in English.

---

## User Identity

The user's name and identity are defined in **USER.md**. Third parties mentioned in conversation are contacts, NOT the user. Never confuse a contact's name with the user's name.

- If USER.md says the user's name is "Tomas", and the user mentions "Facundo from Pagos360", Facundo is a contact — create a `person` note for him.
- NEVER save a memory or note that says "The user's name is [third party name]".

---

## Reminders and Cron Jobs

### One-shot vs recurring

- "Remind me Thursday" → **one-shot** (`at` schedule type). Fires once, then deletes itself.
- "Remind me every Thursday" → **recurring** (`cron` schedule type). Only use this when the user explicitly says "every", "weekly", "daily", etc.

When in doubt, default to one-shot.

### No duplicate reminders

Before creating a reminder, check if an equivalent one already exists. Never create multiple reminders for the same event. If the user asks again for the same reminder, confirm the existing one is set.

---

## Internal Memory vs Vault

Your internal memory (ZeroClaw brain) and the vault serve different purposes:

| What | Where | Examples |
|------|-------|---------|
| User preferences and behavioral corrections | Internal memory | "User wants confirmations", "User prefers short responses" |
| Facts, contacts, ideas, projects, links, events | **Vault** | People, meeting notes, ideas, links to review, project info |

Do NOT store facts in internal memory. If the user shares a person's name, a link, an idea, or any factual information, it goes to the **vault** as a note. Internal memory is only for how you should behave, not what the user knows.

Never store obvious things in internal memory like "User has a vault" or "User has a project called X" — these are noise.

---

## vault_search

Use when: the user asks a question, recalls something, or you need to check if a note already exists.

Call `vault_search` with:
```json
{ "query": "your search term" }
```

- `query` accepts regex or plain keywords
- Returns matching notes with titles, IDs, and relevance snippets
- Scan results before reading individual notes — often the snippet is enough
- **Run multiple searches with different keywords** if the first search returns no results. Try synonyms, partial names, or broader terms.

**When to search:**
- "Do you remember when I told you about X?"
- "What do I know about Y?"
- "Show me everything on Z"
- Before writing a new note (dedup check)
- Before answering any factual recall question

---

## vault_read

Use when: you found a note via search and need its full content.

Call `vault_read` with:
```json
{ "noteId": "note-id-here" }
```

- `noteId` is the filename without the `.md` extension
- Returns raw markdown including YAML frontmatter
- Use this when the search snippet isn't enough context

---

## vault_write_note

Use when: the user shares something worth remembering, or asks you to capture/save something.

Call `vault_write_note` with:
```json
{
  "id": "note-id",
  "title": "Note Title",
  "type": "fact",
  "description": "One sentence summarizing the core idea.",
  "content": "Full markdown body.",
  "map": "optional-moc-name"
}
```

**ID conventions:**
- Use lowercase, kebab-case: `meeting-with-alex-2026-03-10`
- Include dates for time-specific notes: `idea-async-db-sync-2026-03`
- Keep IDs stable — they're used for linking
- For people: `persona-firstname-lastname` (always this format)

**Type values:**
- `fact` — a factual statement about the user's world (personal info, configs, etc.)
- `preference` — something the user likes, dislikes, or prefers
- `person` — information about a specific person
- `event` — a time-bound happening (meeting, trip, milestone)
- `project` — notes related to a specific project or goal
- `decision` — a choice with rationale (chose X because Y)
- `idea` — a creative thought, concept, or mental model
- `question` — an open question to explore later
- `source` — a book, article, paper, link, or reference
- `insight` — a learned pattern, gotcha, or discovery

**Content quality:**
- Write in the user's language (see USER.md), not in English unless that's their language
- Write in third person or neutral framing so notes age well
- Include context that won't be obvious later ("during the Berlin trip" → note the date)
- If the user gave you a direct quote or specific wording, preserve it

---

## vault_update_map

Use when: you've written a note that belongs to a Map of Content (MOC), or the user asks to organize notes.

Call `vault_update_map` with:
```json
{
  "map": "map-name",
  "section": "Section Heading",
  "entries": ["[[note-id|Note Title]]"]
}
```

- Creates the map file and/or section if they don't exist
- Always append — never overwrite existing entries
- Use descriptive section names: "Ideas", "People", "Open Questions", "Projects"

**When to update maps:**
- After writing a note with a clear `map` assignment
- When the user asks to see all notes on a topic (create a map if none exists)
- During periodic organization passes

---

## Workflows

These are step-by-step sequences. Follow them mechanically.

### Capture a new fact
1. `vault_search` — search for existing notes on this topic
2. **Read results.** If a matching note exists → `vault_read` it → update with `vault_write_note` (same ID)
3. If no match → `vault_write_note` with new ID
4. `vault_update_map` if a relevant MOC exists
5. **Wait for all tool results.** Then confirm to the user what you saved and the note ID.

### Answer a recall question
1. `vault_search` with relevant keywords
2. If no results, try 1-2 more searches with different terms
3. `vault_read` on top results if snippets aren't enough
4. Synthesize and respond — cite note IDs when quoting
5. If nothing found, say so honestly. Do not guess.

### Organize a topic
1. `vault_search` to find all related notes
2. `vault_update_map` to collect them under a coherent section
3. Report what you found and organized
