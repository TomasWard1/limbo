import { ensureIndex, search } from "../vault-index.js";

/**
 * vault_search(query): searches all notes via in-memory index.
 * Returns [{noteId, title, snippet, score, domain}] sorted by score desc.
 * No disk I/O after initial index build.
 */
export async function vaultSearch(query) {
  if (query.length > 200) {
    throw new Error("Search query too long (max 200 characters)");
  }

  await ensureIndex();
  return search(query);
}
