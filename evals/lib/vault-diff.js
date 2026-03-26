'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Recursively snapshot all .md files under a directory.
 * @param {string} baseDir — absolute path to vault root
 * @returns {Map<string, string>} relativePath → content
 */
function snapshot(baseDir) {
  const map = new Map();
  if (!fs.existsSync(baseDir)) return map;
  _walk(baseDir, baseDir, map);
  return map;
}

function _walk(dir, baseDir, map) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      _walk(full, baseDir, map);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const rel = path.relative(baseDir, full);
      map.set(rel, fs.readFileSync(full, 'utf8'));
    }
  }
}

/**
 * Diff two snapshots.
 * @param {Map<string, string>} before
 * @param {Map<string, string>} after
 * @returns {{ created: Array, modified: Array, deleted: Array }}
 */
function diff(before, after) {
  const created = [];
  const modified = [];
  const deleted = [];

  for (const [p, content] of after) {
    if (!before.has(p)) {
      created.push({ path: p, content });
    } else if (before.get(p) !== content) {
      modified.push({ path: p, content, previousContent: before.get(p) });
    }
  }

  for (const [p] of before) {
    if (!after.has(p)) {
      deleted.push({ path: p });
    }
  }

  return { created, modified, deleted };
}

module.exports = { snapshot, diff };
