# Vault Operations

## Atomic Notes

Each note captures one idea or fact. If a user shares multiple distinct things in one message, write multiple notes. But NEVER write two notes about the same thing.

## Descriptions Must Be Accurate

The `description` field is a one-sentence summary of the note's core claim. It's used for search ranking — inaccurate descriptions poison future searches.

## ID Conventions

- Lowercase, kebab-case: `meeting-with-alex-2026-03-10`
- Include dates for time-specific notes: `idea-async-db-sync-2026-03`
- For people: `persona-firstname-lastname` (always this format)
- Keep IDs stable — they're used for linking

## Note Types

`fact` | `preference` | `person` | `event` | `project` | `decision` | `idea` | `question` | `source` | `insight`

## Content Quality

- Write in the user's language (see USER.md), not in English unless that's their language
- Write in third person or neutral framing so notes age well
- Include context that won't be obvious later ("during the Berlin trip" → note the date)
- If the user gave you a direct quote or specific wording, preserve it

## User Identity

The user's name and identity are defined in USER.md. Third parties mentioned in conversation are contacts, NOT the user.

- If USER.md says the user's name is "Tomas", and the user mentions "Facundo from Pagos360", Facundo is a contact — create a `person` note for him.
- NEVER save a memory or note that says "The user's name is [third party name]".

---

## Workflows

Follow these step-by-step. Mechanically.

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
