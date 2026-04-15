// test/google-calendar-mcp.test.js
// RED phase — Tests for Google Calendar MCP tools (gws CLI wrappers).
// Run with: node --test test/google-calendar-mcp.test.js
'use strict';

const { test, describe, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Set env vars BEFORE importing ESM modules (they read at import time)
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gcal-mcp-test-'));
process.env.GOOGLE_CALENDAR_ENABLED = 'true';
process.env.OPENCLAW_STATE_DIR = tmpDir;

let calendarRead, calendarCreate;

before(async () => {
  // Dynamic import — ESM module
  const mod = await import('../mcp-server/tools/google-calendar.js');
  calendarRead = mod.calendarRead;
  calendarCreate = mod.calendarCreate;
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('calendarRead', () => {
  test('is exported as a function', () => {
    assert.equal(typeof calendarRead, 'function');
  });

  test('throws when GOOGLE_CALENDAR_ENABLED is not true', async () => {
    const orig = process.env.GOOGLE_CALENDAR_ENABLED;
    process.env.GOOGLE_CALENDAR_ENABLED = 'false';
    try {
      await assert.rejects(
        () => calendarRead({}),
        (err) => {
          assert.ok(err.message.includes('not connected') || err.message.includes('not enabled'),
            `Error should mention calendar not connected/enabled, got: ${err.message}`);
          return true;
        },
      );
    } finally {
      process.env.GOOGLE_CALENDAR_ENABLED = orig;
    }
  });

  test('returns an array of events (requires gws auth — skipped without credentials)', async (t) => {
    // Integration test — needs real gws credentials
    if (!process.env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE) {
      t.skip('No GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE — skipping integration test');
      return;
    }
    const result = await calendarRead({ startDate: '2026-04-09' });
    assert.ok(Array.isArray(result), 'Should return an array');
  });
});

describe('calendarCreate', () => {
  test('is exported as a function', () => {
    assert.equal(typeof calendarCreate, 'function');
  });

  test('throws when GOOGLE_CALENDAR_ENABLED is not true', async () => {
    const orig = process.env.GOOGLE_CALENDAR_ENABLED;
    process.env.GOOGLE_CALENDAR_ENABLED = 'false';
    try {
      await assert.rejects(
        () => calendarCreate({ title: 'Test', startTime: '2026-04-09T10:00:00' }),
        (err) => {
          assert.ok(err.message.includes('not connected') || err.message.includes('not enabled'),
            `Error should mention calendar not connected/enabled, got: ${err.message}`);
          return true;
        },
      );
    } finally {
      process.env.GOOGLE_CALENDAR_ENABLED = orig;
    }
  });

  test('requires title parameter', async () => {
    await assert.rejects(
      () => calendarCreate({ startTime: '2026-04-09T10:00:00' }),
      (err) => {
        assert.ok(err.message.includes('title'), `Should require title, got: ${err.message}`);
        return true;
      },
    );
  });

  test('requires startTime parameter', async () => {
    await assert.rejects(
      () => calendarCreate({ title: 'Test Event' }),
      (err) => {
        assert.ok(err.message.includes('startTime') || err.message.includes('start'),
          `Should require startTime, got: ${err.message}`);
        return true;
      },
    );
  });

  test('returns an object with id and htmlLink (requires gws auth — skipped without credentials)', async (t) => {
    // Integration test — needs real gws credentials
    if (!process.env.GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE) {
      t.skip('No GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE — skipping integration test');
      return;
    }
    const result = await calendarCreate({
      title: 'Test Meeting',
      startTime: '2026-04-09T14:00:00',
      duration: 30,
    });
    assert.ok(result && typeof result === 'object', 'Should return an object');
    assert.ok(result.id, 'Should have an id');
  });
});

describe('calendarDelete', () => {
  let calendarDelete;
  before(async () => {
    const mod = await import('../mcp-server/tools/google-calendar.js');
    calendarDelete = mod.calendarDelete;
  });

  test('is exported as a function', () => {
    assert.equal(typeof calendarDelete, 'function');
  });

  test('throws when GOOGLE_CALENDAR_ENABLED is not true', async () => {
    const orig = process.env.GOOGLE_CALENDAR_ENABLED;
    process.env.GOOGLE_CALENDAR_ENABLED = 'false';
    try {
      await assert.rejects(
        () => calendarDelete({ eventId: 'abc' }),
        (err) => {
          assert.ok(err.message.includes('not connected') || err.message.includes('not enabled'));
          return true;
        },
      );
    } finally {
      process.env.GOOGLE_CALENDAR_ENABLED = orig;
    }
  });

  test('requires eventId parameter', async () => {
    await assert.rejects(
      () => calendarDelete({}),
      (err) => {
        assert.ok(err.message.includes('eventId'), `Should require eventId, got: ${err.message}`);
        return true;
      },
    );
  });
});

describe('calendarUpdate', () => {
  let calendarUpdate;
  before(async () => {
    const mod = await import('../mcp-server/tools/google-calendar.js');
    calendarUpdate = mod.calendarUpdate;
  });

  test('is exported as a function', () => {
    assert.equal(typeof calendarUpdate, 'function');
  });

  test('throws when GOOGLE_CALENDAR_ENABLED is not true', async () => {
    const orig = process.env.GOOGLE_CALENDAR_ENABLED;
    process.env.GOOGLE_CALENDAR_ENABLED = 'false';
    try {
      await assert.rejects(
        () => calendarUpdate({ eventId: 'abc', title: 'New' }),
        (err) => {
          assert.ok(err.message.includes('not connected') || err.message.includes('not enabled'));
          return true;
        },
      );
    } finally {
      process.env.GOOGLE_CALENDAR_ENABLED = orig;
    }
  });

  test('requires eventId parameter', async () => {
    await assert.rejects(
      () => calendarUpdate({ title: 'New' }),
      (err) => {
        assert.ok(err.message.includes('eventId'));
        return true;
      },
    );
  });

  test('rejects empty patch (no fields to update)', async () => {
    await assert.rejects(
      () => calendarUpdate({ eventId: 'abc' }),
      (err) => {
        assert.ok(err.message.includes('No fields') || err.message.includes('update'));
        return true;
      },
    );
  });

  test('rejects duration-only updates (require startTime too)', async () => {
    await assert.rejects(
      () => calendarUpdate({ eventId: 'abc', duration: 30 }),
      (err) => {
        assert.ok(err.message.includes('duration') || err.message.includes('startTime'));
        return true;
      },
    );
  });
});

describe('MCP tool registration', () => {
  test('Dockerfile pins @googleworkspace/cli to a known-compatible version', () => {
    const dockerfile = fs.readFileSync(
      path.join(__dirname, '..', 'Dockerfile'), 'utf8',
    );
    assert.match(
      dockerfile,
      /@googleworkspace\/cli@0\.22\.3/,
      'Dockerfile should pin @googleworkspace/cli to 0.22.3',
    );
  });

  test('calendar_read is registered in index.js tool list', async () => {
    const indexSrc = fs.readFileSync(
      path.join(__dirname, '..', 'mcp-server', 'index.js'), 'utf8',
    );
    assert.ok(indexSrc.includes('calendar_read'), 'index.js should register calendar_read tool');
  });

  test('calendar_create is registered in index.js tool list', async () => {
    const indexSrc = fs.readFileSync(
      path.join(__dirname, '..', 'mcp-server', 'index.js'), 'utf8',
    );
    assert.ok(indexSrc.includes('calendar_create'), 'index.js should register calendar_create tool');
  });

  test('calendar_delete is registered in index.js tool list', async () => {
    const indexSrc = fs.readFileSync(
      path.join(__dirname, '..', 'mcp-server', 'index.js'), 'utf8',
    );
    assert.ok(indexSrc.includes('calendar_delete'), 'index.js should register calendar_delete tool');
  });

  test('calendar_update is registered in index.js tool list', async () => {
    const indexSrc = fs.readFileSync(
      path.join(__dirname, '..', 'mcp-server', 'index.js'), 'utf8',
    );
    assert.ok(indexSrc.includes('calendar_update'), 'index.js should register calendar_update tool');
  });

  test('calendar tools are imported from google-calendar.js', async () => {
    const indexSrc = fs.readFileSync(
      path.join(__dirname, '..', 'mcp-server', 'index.js'), 'utf8',
    );
    assert.ok(
      indexSrc.includes('google-calendar') || indexSrc.includes('googleCalendar'),
      'index.js should import from google-calendar module',
    );
  });
});
