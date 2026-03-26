'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { score } = require('../lib/scorer');

// ── Helpers ───────────────────────────────────────────────────────────────────

const baseLogs = [
  { type: 'tool_call', tool: 'vault_write_note', params: { type: 'event', id: 'dentist-123' }, timestamp: '2026-01-01T00:00:00Z' },
  { type: 'tool_result', tool: 'vault_write_note', success: true, timestamp: '2026-01-01T00:00:01Z' },
  { type: 'tool_call', tool: 'vault_search', params: { query: 'birthday' }, timestamp: '2026-01-01T00:00:02Z' },
];

const baseResponse = 'Listo, guardé la nota sobre tu dentista.';

const baseDiff = {
  created: [
    { path: 'notes/dentist-123.md', content: '---\ntitle: Dentist appointment\ntype: event\n---\nDentist at 10am Thursday' },
  ],
  modified: [],
  deleted: [],
};

// ── tool_called ──────────────────────────────────────────────────────────────

describe('tool_called', () => {
  it('passes when tool was called', () => {
    const results = score(
      [{ type: 'tool_called', tool: 'vault_write_note' }],
      { response: baseResponse, mcpLogs: baseLogs, vaultDiff: baseDiff }
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].pass, true);
  });

  it('fails when tool was NOT called', () => {
    const results = score(
      [{ type: 'tool_called', tool: 'vault_delete_note' }],
      { response: baseResponse, mcpLogs: baseLogs, vaultDiff: baseDiff }
    );
    assert.equal(results[0].pass, false);
  });
});

// ── param_match ──────────────────────────────────────────────────────────────

describe('param_match', () => {
  it('passes when param matches pattern', () => {
    const results = score(
      [{ type: 'param_match', tool: 'vault_write_note', key: 'type', pattern: 'event' }],
      { response: baseResponse, mcpLogs: baseLogs, vaultDiff: baseDiff }
    );
    assert.equal(results[0].pass, true);
  });

  it('fails when param does NOT match', () => {
    const results = score(
      [{ type: 'param_match', tool: 'vault_write_note', key: 'type', pattern: '^preference$' }],
      { response: baseResponse, mcpLogs: baseLogs, vaultDiff: baseDiff }
    );
    assert.equal(results[0].pass, false);
  });
});

// ── response_matches ─────────────────────────────────────────────────────────

describe('response_matches', () => {
  it('passes when response matches pattern', () => {
    const results = score(
      [{ type: 'response_matches', pattern: '(?i)(dentista|guardado|guardé)' }],
      { response: baseResponse, mcpLogs: baseLogs, vaultDiff: baseDiff }
    );
    assert.equal(results[0].pass, true);
  });

  it('fails when response does NOT match', () => {
    const results = score(
      [{ type: 'response_matches', pattern: 'dinosaurio' }],
      { response: baseResponse, mcpLogs: baseLogs, vaultDiff: baseDiff }
    );
    assert.equal(results[0].pass, false);
  });
});

// ── vault_note_created ──────────────────────────────────────────────────────

describe('vault_note_created', () => {
  it('passes when a created note matches pattern', () => {
    const results = score(
      [{ type: 'vault_note_created', pattern: 'dentist' }],
      { response: baseResponse, mcpLogs: baseLogs, vaultDiff: baseDiff }
    );
    assert.equal(results[0].pass, true);
  });

  it('fails when no created note matches', () => {
    const results = score(
      [{ type: 'vault_note_created', pattern: 'unicorn' }],
      { response: baseResponse, mcpLogs: baseLogs, vaultDiff: baseDiff }
    );
    assert.equal(results[0].pass, false);
  });
});

// ── vault_file_exists ───────────────────────────────────────────────────────

describe('vault_file_exists', () => {
  it('passes when a file path matches pattern', () => {
    const results = score(
      [{ type: 'vault_file_exists', pattern: 'dentist-123\\.md' }],
      { response: baseResponse, mcpLogs: baseLogs, vaultDiff: baseDiff }
    );
    assert.equal(results[0].pass, true);
  });

  it('fails when no file matches', () => {
    const results = score(
      [{ type: 'vault_file_exists', pattern: 'nonexistent\\.md' }],
      { response: baseResponse, mcpLogs: baseLogs, vaultDiff: baseDiff }
    );
    assert.equal(results[0].pass, false);
  });

  it('also matches modified files', () => {
    const diffWithMod = {
      created: [],
      modified: [{ path: 'maps/people.md', content: 'updated', previousContent: 'old' }],
      deleted: [],
    };
    const results = score(
      [{ type: 'vault_file_exists', pattern: 'people\\.md' }],
      { response: baseResponse, mcpLogs: baseLogs, vaultDiff: diffWithMod }
    );
    assert.equal(results[0].pass, true);
  });
});

// ── unknown type ────────────────────────────────────────────────────────────

describe('cron_created', () => {
  const cronJobs = [
    { id: 'abc-123', prompt: 'Recordatorio: llamar al banco', raw: 'abc-123 | At 2026-03-27T12:00:00Z' },
  ];

  it('passes when cron matches pattern', () => {
    const results = score(
      [{ type: 'cron_created', pattern: 'banco' }],
      { response: '', mcpLogs: [], vaultDiff: baseDiff, cronJobs }
    );
    assert.equal(results[0].pass, true);
  });

  it('fails when no cron matches', () => {
    const results = score(
      [{ type: 'cron_created', pattern: 'dentista' }],
      { response: '', mcpLogs: [], vaultDiff: baseDiff, cronJobs }
    );
    assert.equal(results[0].pass, false);
  });

  it('fails when cronJobs is empty', () => {
    const results = score(
      [{ type: 'cron_created', pattern: 'banco' }],
      { response: '', mcpLogs: [], vaultDiff: baseDiff, cronJobs: [] }
    );
    assert.equal(results[0].pass, false);
  });
});

describe('unknown assertion type', () => {
  it('fails with reason', () => {
    const results = score(
      [{ type: 'made_up_check' }],
      { response: baseResponse, mcpLogs: baseLogs, vaultDiff: baseDiff }
    );
    assert.equal(results[0].pass, false);
    assert.match(results[0].reason, /Unknown assertion type/);
  });
});
