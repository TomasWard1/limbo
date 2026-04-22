// test/mcp-tools.test.js — Unit tests for MCP vault + workspace tools
'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-tools-test-'));
  const vault = path.join(root, 'vault');
  const db = path.join(root, 'db');
  fs.mkdirSync(path.join(vault, 'notes'), { recursive: true });
  fs.mkdirSync(path.join(vault, 'maps'), { recursive: true });
  fs.mkdirSync(path.join(vault, 'assets'), { recursive: true });
  fs.mkdirSync(db, { recursive: true });
  return { root, vault, db };
}

function makeTmpWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-ws-test-'));
  fs.writeFileSync(path.join(dir, 'USER.md'), '# User Preferences\n');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Agents Config\n');
  fs.writeFileSync(path.join(dir, 'TOOLS.md'), '# Tools List\n');
  return dir;
}

function cleanDir(dir) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Because the MCP modules are ESM with module-level const bindings that read
 * process.env at import time, we must set env vars BEFORE the first import.
 * Subsequent tests reuse the same module instances (Node caches ESM imports).
 *
 * vault-index.js also has a module-level `built` flag. To force a re-index
 * between test suites we call buildIndex() directly.
 */

// ── Shared state set once ────────────────────────────────────────────────────

let dirs;
let wsDirs;

// MCP modules (loaded once via dynamic import)
let vaultWriteNote, vaultRead, vaultSearch, vaultUpdateMap;
let vaultStoreFile, vaultGetFile;
let workspaceRead, workspaceWrite;
let buildIndex, ensureIndex, getNote;

// ── Top-level setup: set env vars before any ESM import ──────────────────────

before(async () => {
  dirs = makeTmpVault();
  wsDirs = makeTmpWorkspace();

  process.env.VAULT_PATH = dirs.vault;
  process.env.DB_PATH = dirs.db;
  process.env.OPENCLAW_WORKSPACE_DIR = wsDirs;

  // Dynamic imports — ESM modules read env at import time
  const [writeM, readM, searchM, mapM, storeM, getM, wsM, idxM] = await Promise.all([
    import('../mcp-server/tools/write.js'),
    import('../mcp-server/tools/read.js'),
    import('../mcp-server/tools/search.js'),
    import('../mcp-server/tools/update-map.js'),
    import('../mcp-server/tools/store-file.js'),
    import('../mcp-server/tools/get-file.js'),
    import('../mcp-server/tools/workspace.js'),
    import('../mcp-server/vault-index.js'),
  ]);

  vaultWriteNote = writeM.vaultWriteNote;
  vaultRead = readM.vaultRead;
  vaultSearch = searchM.vaultSearch;
  vaultUpdateMap = mapM.vaultUpdateMap;
  vaultStoreFile = storeM.vaultStoreFile;
  vaultGetFile = getM.vaultGetFile;
  workspaceRead = wsM.workspaceRead;
  workspaceWrite = wsM.workspaceWrite;
  buildIndex = idxM.buildIndex;
  ensureIndex = idxM.ensureIndex;
  getNote = idxM.getNote;
});

after(() => {
  cleanDir(dirs?.root);
  cleanDir(wsDirs);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 1. vault_write_note + vault_read roundtrip
// ═══════════════════════════════════════════════════════════════════════════════

describe('vault_write_note + vault_read', () => {
  before(async () => {
    // buildIndex initializes FTS + in-memory index — required before any write
    await buildIndex();
  });

  it('writes a note and reads it back with correct frontmatter', async () => {
    const note = {
      id: 'test-roundtrip',
      title: 'Roundtrip Test',
      type: 'fact',
      description: 'A test note for roundtrip verification',
      content: 'This is the body of the note.',
      subdirectory: 'testing',
      topics: ['testing', 'ci'],
    };

    const result = await vaultWriteNote(note);
    assert.strictEqual(result.id, 'test-roundtrip');
    assert.ok(result.path.endsWith('test-roundtrip.md'));
    assert.ok(fs.existsSync(result.path), 'file should exist on disk');

    // Read it back via vault_read (uses in-memory index)
    const content = await vaultRead('test-roundtrip');
    assert.ok(content !== null, 'should return content');
    assert.ok(content.includes('title: "Roundtrip Test"'), 'frontmatter should have title');
    assert.ok(content.includes('type: fact'), 'frontmatter should have type');
    assert.ok(content.includes('description: "A test note for roundtrip verification"'));
    assert.ok(content.includes('- "testing"'), 'frontmatter should have topics');
    assert.ok(content.includes('- "ci"'));
    assert.ok(content.includes('This is the body of the note.'), 'body should be present');
  });

  it('overwrites an existing note with same id', async () => {
    await vaultWriteNote({
      id: 'overwrite-me',
      title: 'Version 1',
      type: 'fact',
      description: 'Original',
      content: 'Old body.',
    });

    await vaultWriteNote({
      id: 'overwrite-me',
      title: 'Version 2',
      type: 'fact',
      description: 'Updated',
      content: 'New body.',
    });

    const content = await vaultRead('overwrite-me');
    assert.ok(content.includes('title: "Version 2"'), 'title should be updated');
    assert.ok(content.includes('New body.'), 'body should be updated');
    assert.ok(!content.includes('Old body.'), 'old body should be gone');
  });

  it('rejects note with missing required fields', async () => {
    await assert.rejects(
      () => vaultWriteNote({ id: 'x', title: 'T', type: 'fact', description: 'D' }),
      /Missing or invalid required field: content/
    );
  });

  it('rejects invalid note type', async () => {
    await assert.rejects(
      () => vaultWriteNote({
        id: 'bad-type', title: 'T', type: 'banana',
        description: 'D', content: 'C',
      }),
      /Invalid note type/
    );
  });

  it('rejects note id with invalid characters', async () => {
    await assert.rejects(
      () => vaultWriteNote({
        id: 'bad/id', title: 'T', type: 'fact',
        description: 'D', content: 'C',
      }),
      /invalid characters/
    );
  });

  it('rejects subdirectory with path traversal', async () => {
    await assert.rejects(
      () => vaultWriteNote({
        id: 'traversal', title: 'T', type: 'fact',
        description: 'D', content: 'C', subdirectory: '../etc',
      }),
      /invalid characters|cannot contain/
    );
  });

  it('vault_read returns null for nonexistent note', async () => {
    const content = await vaultRead('does-not-exist-ever');
    assert.strictEqual(content, null);
  });

  it('vault_read rejects invalid noteId characters', async () => {
    await assert.rejects(() => vaultRead('bad/id'), /invalid characters/);
  });

  it('vault_read rejects empty noteId', async () => {
    await assert.rejects(() => vaultRead(''), /non-empty string/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. vault_search
// ═══════════════════════════════════════════════════════════════════════════════

describe('vault_search', () => {
  before(async () => {
    // Write several notes for search tests
    await vaultWriteNote({
      id: 'search-js', title: 'JavaScript Patterns',
      type: 'insight', description: 'Common JS patterns',
      content: 'Closures, prototypes, and modules are fundamental JavaScript patterns.',
    });
    await vaultWriteNote({
      id: 'search-rust', title: 'Rust Ownership',
      type: 'fact', description: 'How Rust manages memory',
      content: 'Rust uses ownership and borrowing to manage memory without a garbage collector.',
    });
    await vaultWriteNote({
      id: 'search-cooking', title: 'Pasta Recipe',
      type: 'fact', description: 'How to make fresh pasta',
      content: 'Mix flour and eggs, knead for ten minutes, then rest the dough.',
    });

    // Rebuild index so FTS picks up the new notes
    await buildIndex();
  });

  it('finds notes by keyword', async () => {
    const results = await vaultSearch('javascript');
    assert.ok(results.length >= 1, 'should find at least one result');
    const ids = results.map(r => r.noteId);
    assert.ok(ids.includes('search-js'), 'should find the JS note');
  });

  it('returns empty array for nonexistent term', async () => {
    const results = await vaultSearch('xylophone');
    assert.ok(Array.isArray(results));
    assert.strictEqual(results.length, 0);
  });

  it('returns results with expected shape', async () => {
    const results = await vaultSearch('rust ownership');
    assert.ok(results.length >= 1);
    const r = results[0];
    assert.ok('noteId' in r, 'should have noteId');
    assert.ok('title' in r, 'should have title');
    assert.ok('snippet' in r, 'should have snippet');
    assert.ok('score' in r, 'should have score');
  });

  it('does not crash on special characters', async () => {
    const results = await vaultSearch('"hello" OR (world*)');
    assert.ok(Array.isArray(results));
  });

  it('does not crash on empty/whitespace query', async () => {
    const results = await vaultSearch('   ');
    assert.strictEqual(results.length, 0);
  });

  it('rejects query longer than 200 characters', async () => {
    const longQuery = 'a'.repeat(201);
    await assert.rejects(() => vaultSearch(longQuery), /too long/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. vault_update_map
// ═══════════════════════════════════════════════════════════════════════════════

describe('vault_update_map', () => {
  it('creates a new map file with frontmatter and section', async () => {
    const result = await vaultUpdateMap('test-map', 'Resources', [
      '- [[search-js|JavaScript Patterns]]',
    ]);
    assert.strictEqual(result.map, 'test-map');
    assert.strictEqual(result.section, 'Resources');
    assert.strictEqual(result.added, 1);

    const filePath = path.join(dirs.vault, 'maps', 'test-map.md');
    assert.ok(fs.existsSync(filePath), 'map file should exist');

    const content = fs.readFileSync(filePath, 'utf8');
    assert.ok(content.includes('type: moc'), 'should have MOC frontmatter');
    assert.ok(content.includes('## Resources'), 'should have section header');
    assert.ok(content.includes('[[search-js|JavaScript Patterns]]'), 'should have entry');
  });

  it('appends entries to existing section', async () => {
    await vaultUpdateMap('test-map', 'Resources', [
      '- [[search-rust|Rust Ownership]]',
    ]);

    const content = fs.readFileSync(
      path.join(dirs.vault, 'maps', 'test-map.md'), 'utf8'
    );
    assert.ok(content.includes('[[search-js|JavaScript Patterns]]'), 'original entry preserved');
    assert.ok(content.includes('[[search-rust|Rust Ownership]]'), 'new entry appended');
  });

  it('deduplicates entries with same wikilink', async () => {
    const result = await vaultUpdateMap('test-map', 'Resources', [
      '- [[search-js|JavaScript Patterns]]',  // already exists
    ]);
    assert.strictEqual(result.added, 0, 'should not add duplicate');
  });

  it('creates a new section on existing map', async () => {
    const result = await vaultUpdateMap('test-map', 'Recipes', [
      '- [[search-cooking|Pasta Recipe]]',
    ]);
    assert.strictEqual(result.added, 1);

    const content = fs.readFileSync(
      path.join(dirs.vault, 'maps', 'test-map.md'), 'utf8'
    );
    assert.ok(content.includes('## Recipes'), 'new section should exist');
    assert.ok(content.includes('[[search-cooking|Pasta Recipe]]'));
  });

  it('rejects invalid map name', async () => {
    await assert.rejects(
      () => vaultUpdateMap('bad/name', 'S', ['- entry']),
      /invalid characters/i
    );
  });

  it('rejects empty entries array', async () => {
    await assert.rejects(
      () => vaultUpdateMap('valid', 'S', []),
      /non-empty array/
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. workspace_read + workspace_write
// ═══════════════════════════════════════════════════════════════════════════════

describe('workspace_read + workspace_write', () => {
  it('reads an existing workspace file', async () => {
    const result = await workspaceRead('USER.md');
    assert.strictEqual(result.filename, 'USER.md');
    assert.ok(result.content.includes('# User Preferences'));
  });

  it('reads AGENTS.md (read-only but readable)', async () => {
    const result = await workspaceRead('AGENTS.md');
    assert.ok(result.content.includes('# Agents Config'));
  });

  it('writes to USER.md (writable)', async () => {
    const result = await workspaceWrite('USER.md', '# Updated User Prefs\nNew content here.');
    assert.strictEqual(result.filename, 'USER.md');
    assert.ok(result.size > 0);

    // Verify on disk
    const onDisk = fs.readFileSync(path.join(wsDirs, 'USER.md'), 'utf8');
    assert.ok(onDisk.includes('New content here.'));
  });

  it('rejects write to AGENTS.md (read-only)', async () => {
    await assert.rejects(
      () => workspaceWrite('AGENTS.md', 'hacked'),
      /Cannot write.*AGENTS\.md/
    );
  });

  it('rejects write to TOOLS.md (read-only)', async () => {
    await assert.rejects(
      () => workspaceWrite('TOOLS.md', 'hacked'),
      /Cannot write.*TOOLS\.md/
    );
  });

  it('rejects read of non-.md file', async () => {
    await assert.rejects(
      () => workspaceRead('secrets.json'),
      /only .md files/
    );
  });

  it('rejects path traversal in read', async () => {
    await assert.rejects(
      () => workspaceRead('../../etc/passwd.md'),
      /Path traversal|only .md files/
    );
  });

  it('rejects path traversal with subdirectory in read', async () => {
    await assert.rejects(
      () => workspaceRead('sub/USER.md'),
      /only .md files/
    );
  });

  it('rejects read of non-existent file', async () => {
    await assert.rejects(
      () => workspaceRead('NONEXISTENT.md'),
      { code: 'ENOENT' }
    );
  });

  it('rejects write with empty content', async () => {
    await assert.rejects(
      () => workspaceWrite('USER.md', '   '),
      /non-empty string/
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. vault_store_file + vault_get_file
// ═══════════════════════════════════════════════════════════════════════════════

describe('vault_store_file + vault_get_file', () => {
  it('stores a file via filePath mode and creates linked note', async () => {
    // Create a temp source file
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'store-src-'));
    const srcFile = path.join(srcDir, 'photo.jpg');
    fs.writeFileSync(srcFile, Buffer.from('fake-jpeg-content'));

    const result = await vaultStoreFile({
      noteId: 'stored-photo',
      title: 'Test Photo',
      description: 'A test stored photo',
      content: 'This photo was taken during testing.',
      filePath: srcFile,
      subdirectory: 'photos',
      topics: ['testing'],
    });

    assert.strictEqual(result.noteId, 'stored-photo');
    assert.ok(result.assetPath.startsWith('assets/photos/'), 'asset should be in subdirectory');
    assert.ok(result.assetPath.endsWith('-photo.jpg'), 'asset filename should have timestamp prefix');

    // Source file should be deleted after copy
    assert.ok(!fs.existsSync(srcFile), 'source file should be deleted');

    // Asset file should exist in vault
    const fullAssetPath = path.join(dirs.vault, result.assetPath);
    assert.ok(fs.existsSync(fullAssetPath), 'asset file should exist in vault');
    const assetContent = fs.readFileSync(fullAssetPath);
    assert.strictEqual(assetContent.toString(), 'fake-jpeg-content');

    // Note should exist with asset_path in frontmatter
    const noteContent = await vaultRead('stored-photo');
    assert.ok(noteContent !== null);
    assert.ok(noteContent.includes('asset_path:'), 'should have asset_path in frontmatter');
    assert.ok(noteContent.includes('asset_type: "image/jpeg"'), 'should have asset_type');
    assert.ok(noteContent.includes('![Test Photo]'), 'should have image reference in body');

    // Cleanup
    cleanDir(srcDir);
  });

  it('stores a file via base64 fileData mode', async () => {
    const data = Buffer.from('hello world base64 test').toString('base64');

    const result = await vaultStoreFile({
      noteId: 'stored-b64',
      title: 'Base64 File',
      description: 'A base64-encoded file',
      content: 'Stored via base64.',
      filename: 'document.txt',
      fileData: data,
    });

    assert.strictEqual(result.noteId, 'stored-b64');
    assert.ok(result.assetPath.startsWith('assets/'));

    const fullAssetPath = path.join(dirs.vault, result.assetPath);
    const stored = fs.readFileSync(fullAssetPath, 'utf8');
    assert.strictEqual(stored, 'hello world base64 test');
  });

  it('gets a stored file back with correct metadata', async () => {
    // Rebuild index so get_file can find the note
    await buildIndex();

    const result = await vaultGetFile('stored-photo');
    assert.ok(result.filename.endsWith('-photo.jpg'));
    assert.strictEqual(result.mimeType, 'image/jpeg');
    assert.ok(result.size > 0);
    assert.ok(result.assetPath.startsWith('assets/photos/'));
  });

  it('get_file throws for note without asset_path', async () => {
    // search-js was written earlier without asset_path
    await assert.rejects(
      () => vaultGetFile('search-js'),
      /no asset_path|no linked file/i
    );
  });

  it('get_file throws for nonexistent note', async () => {
    await assert.rejects(
      () => vaultGetFile('ghost-note-404'),
      /not found/i
    );
  });

  it('store_file rejects missing required fields', async () => {
    await assert.rejects(
      () => vaultStoreFile({ noteId: 'x', title: 'T', description: 'D' }),
      /Missing or invalid required field: content/
    );
  });

  it('store_file rejects when neither filePath nor fileData provided', async () => {
    await assert.rejects(
      () => vaultStoreFile({
        noteId: 'x', title: 'T', description: 'D', content: 'C',
      }),
      /filePath or fileData/
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Edge cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('Edge cases', () => {
  it('handles empty content in notes', async () => {
    await assert.rejects(
      () => vaultWriteNote({
        id: 'empty-body', title: 'T', type: 'fact',
        description: 'D', content: '',
      }),
      /Missing or invalid required field: content/
    );
  });

  it('handles unicode content (emojis, CJK)', async () => {
    const result = await vaultWriteNote({
      id: 'unicode-test',
      title: 'Unicode Note 日本語',
      type: 'fact',
      description: 'Testing unicode: 你好世界 🌍',
      content: '# 多言語テスト\n\nEmojis: 🎉🚀💡\nArabic: مرحبا\nKorean: 안녕하세요',
    });

    assert.ok(fs.existsSync(result.path));
    const content = await vaultRead('unicode-test');
    assert.ok(content.includes('🎉🚀💡'), 'emojis should be preserved');
    assert.ok(content.includes('多言語テスト'), 'CJK should be preserved');
    assert.ok(content.includes('مرحبا'), 'Arabic should be preserved');
  });

  it('handles very long content (>100KB)', async () => {
    const bigContent = 'x'.repeat(120_000);
    const result = await vaultWriteNote({
      id: 'big-note',
      title: 'Big Note',
      type: 'fact',
      description: 'A very large note',
      content: bigContent,
    });

    assert.ok(fs.existsSync(result.path));
    const stat = fs.statSync(result.path);
    assert.ok(stat.size > 120_000, 'file should be large');
  });

  it('note id with spaces is rejected', async () => {
    await assert.rejects(
      () => vaultWriteNote({
        id: 'has spaces', title: 'T', type: 'fact',
        description: 'D', content: 'C',
      }),
      /invalid characters/
    );
  });

  it('note id with dots is rejected', async () => {
    await assert.rejects(
      () => vaultWriteNote({
        id: 'has.dots', title: 'T', type: 'fact',
        description: 'D', content: 'C',
      }),
      /invalid characters/
    );
  });

  it('YAML special characters in title are escaped', async () => {
    await vaultWriteNote({
      id: 'yaml-escape',
      title: 'Title with "quotes" and: colons',
      type: 'fact',
      description: 'Desc with "quotes"',
      content: 'Body.',
    });

    const content = await vaultRead('yaml-escape');
    // Quotes should be escaped inside the YAML value
    assert.ok(content.includes('\\"quotes\\"'), 'quotes should be escaped in frontmatter');
  });
});
