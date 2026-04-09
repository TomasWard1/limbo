import { ensureIndex } from "../vault-index.js";
import { searchNotes } from "../fts.js";

export async function vaultSearch(query) {
  if (query.length > 200) {
    throw new Error("Search query too long (max 200 characters)");
  }

  await ensureIndex();
  return searchNotes(query);
}
