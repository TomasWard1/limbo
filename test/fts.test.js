// test/fts.test.js — FTS5 database module tests
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

let fts;
let tmpDir;

async function loadFts() {
  fts = await import('../mcp-server/fts.js');
}

function freshDb() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fts-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  fts.initFts(dbPath);
  return dbPath;
}

function cleanup() {
  try { fts.closeFts(); } catch {}
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  tmpDir = null;
}

describe('FTS5 module', () => {
  beforeEach(async () => {
    if (!fts) await loadFts();
    freshDb();
  });

  afterEach(() => {
    cleanup();
  });

  // 1. initFts creates DB file and FTS5 table
  it('initFts creates DB file and tables', () => {
    const dbFile = path.join(tmpDir, 'test.db');
    assert.ok(fs.existsSync(dbFile), 'DB file should exist');
    assert.strictEqual(fts.indexedCount(), 0, 'should start empty');
  });

  // 2. upsertNote + searchNotes returns BM25-scored results
  it('upsertNote + searchNotes returns scored results', () => {
    fts.upsertNote('note1', 'JavaScript Guide', 'Learn about closures and prototypes in JavaScript.', 'dev');
    fts.upsertNote('note2', 'Cooking Tips', 'How to make pasta from scratch.', 'life');

    const results = fts.searchNotes('javascript');
    assert.ok(results.length >= 1, 'should find at least one result');
    assert.strictEqual(results[0].noteId, 'note1');
    assert.ok(typeof results[0].score === 'number', 'score should be a number');
    assert.strictEqual(results[0].domain, 'dev');
  });

  // 3. upsertNote overwrites existing note
  it('upsertNote overwrites existing note', () => {
    fts.upsertNote('note1', 'Old Title', 'Old content about pandas.', 'animals');
    fts.upsertNote('note1', 'New Title', 'New content about rockets.', 'space');

    const oldResults = fts.searchNotes('pandas');
    assert.strictEqual(oldResults.length, 0, 'old content should not be found');

    const newResults = fts.searchNotes('rockets');
    assert.strictEqual(newResults.length, 1, 'new content should be found');
    assert.strictEqual(newResults[0].title, 'New Title');
    assert.strictEqual(newResults[0].domain, 'space');
    assert.strictEqual(fts.indexedCount(), 1, 'should still have only one note');
  });

  // 4. deleteNote removes from FTS index
  it('deleteNote removes note from index', () => {
    fts.upsertNote('note1', 'To Delete', 'This note will be deleted.', null);
    assert.strictEqual(fts.indexedCount(), 1);

    fts.deleteNote('note1');
    assert.strictEqual(fts.indexedCount(), 0);

    const results = fts.searchNotes('deleted');
    assert.strictEqual(results.length, 0, 'deleted note should not appear in search');
  });

  // 5. Porter stemming matches inflections
  it('Porter stemming matches inflections', () => {
    fts.upsertNote('note1', 'Exercise Log', 'I went running in the park this morning.', 'health');

    const results = fts.searchNotes('run');
    assert.ok(results.length >= 1, '"run" should match "running" via porter stemmer');
    assert.strictEqual(results[0].noteId, 'note1');
  });

  // 6. Title matches rank higher than body matches
  it('title matches rank higher than body matches', () => {
    // note-title has the keyword in title only
    fts.upsertNote('note-title', 'Kubernetes', 'This guide covers container orchestration basics.', 'devops');
    // note-body has the keyword in body only
    fts.upsertNote('note-body', 'Container Guide', 'Learn about kubernetes deployment strategies.', 'devops');

    const results = fts.searchNotes('kubernetes');
    assert.ok(results.length === 2, 'should find both notes');
    // BM25 with title weight 5x should rank title match first
    // bm25() returns negative scores — more negative = better match
    assert.strictEqual(results[0].noteId, 'note-title', 'title match should rank first');
  });

  // 7. Negative search returns empty array
  it('search for nonexistent term returns empty array', () => {
    fts.upsertNote('note1', 'Something', 'Content here.', null);
    const results = fts.searchNotes('xylophone');
    assert.ok(Array.isArray(results), 'should return an array');
    assert.strictEqual(results.length, 0, 'should be empty for nonexistent term');
  });

  it('search with empty query returns empty array', () => {
    fts.upsertNote('note1', 'Something', 'Content here.', null);
    const results = fts.searchNotes('   ');
    assert.strictEqual(results.length, 0);
  });

  it('search with special characters does not throw', () => {
    fts.upsertNote('note1', 'Test', 'Some content.', null);
    const results = fts.searchNotes('"hello" OR (world*)');
    assert.ok(Array.isArray(results), 'should return array even with special chars');
  });

  // 9. indexedIds returns all indexed note IDs
  it('indexedIds returns Set of all note IDs', () => {
    fts.upsertNote('alpha', 'Alpha', 'Content A.', null);
    fts.upsertNote('beta', 'Beta', 'Content B.', 'sub');
    const ids = fts.indexedIds();
    assert.ok(ids instanceof Set, 'should return a Set');
    assert.strictEqual(ids.size, 2);
    assert.ok(ids.has('alpha'));
    assert.ok(ids.has('beta'));
  });
});
