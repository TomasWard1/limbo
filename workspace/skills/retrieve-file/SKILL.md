# Retrieve File

When the user asks for a file they previously stored, follow this exact sequence. Do not skip steps. Do not browse the filesystem.

## Trigger

Any message requesting a previously stored file. Examples:
- "pasame el PDF de X"
- "mandame el archivo de Y"
- "necesito el documento que te di"
- "tenés el brief de Z?"

## Steps

1. **Search** — Call `vault_search` with keywords from the user's request. Try 2-3 different keyword combinations if the first returns no results.
2. **Identify** — From the search results, find the note with `type: source` and an `asset_path` in its frontmatter. If multiple candidates exist, pick the best match. If none found, tell the user honestly.
3. **Get path** — Call `vault_get_file` with the noteId. This returns the absolute file path on disk.
4. **Send** — Reply with ONLY the `[DOCUMENT:]` tag. No greeting, no description, no extra text.

## Output format

Your entire reply must be exactly one line:

```
[DOCUMENT:/data/vault/assets/documents/20260315-120000-filename.pdf]
```

Any text outside the `[DOCUMENT:]` tag becomes a separate Telegram message before the file. Do not add any text.

## Errors

- If `vault_search` returns nothing after 2-3 attempts: "No encontré ese archivo en el vault. Podés reenviármelo y lo guardo."
- If `vault_get_file` fails: "El archivo está registrado pero no se encuentra en disco. Podés reenviármelo."

## Rules

- Files are stored in `vault/assets/` and accessed ONLY through vault tools.
- NEVER look in `telegram_files/` — those are temporary downloads that get deleted.
- NEVER guess file paths. NEVER fabricate filenames.
- NEVER return base64 content. NEVER use data URIs.
- Always call `vault_search` first. Always call `vault_get_file` second. Always reply with only `[DOCUMENT:]` third.
