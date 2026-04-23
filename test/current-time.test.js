// test/current-time.test.js — Unit tests for get_current_time MCP tool
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

let getCurrentTime;
let originalTZ;

before(async () => {
  originalTZ = process.env.TZ;
  const mod = await import('../mcp-server/tools/current-time.js');
  getCurrentTime = mod.getCurrentTime;
});

after(() => {
  if (originalTZ === undefined) delete process.env.TZ;
  else process.env.TZ = originalTZ;
});

describe('get_current_time', () => {
  it('returns a result with ISO, timezone, unix and weekday fields', async () => {
    process.env.TZ = 'America/Argentina/Buenos_Aires';
    const result = await getCurrentTime();
    assert.equal(result.content[0].type, 'text');
    const payload = JSON.parse(result.content[0].text);
    assert.ok(payload.iso);
    assert.ok(payload.isoUtc);
    assert.equal(payload.timezone, 'America/Argentina/Buenos_Aires');
    assert.ok(typeof payload.unix === 'number');
    assert.ok(payload.weekday);
  });

  it('returns ISO with the correct offset for Buenos Aires (-03:00)', async () => {
    process.env.TZ = 'America/Argentina/Buenos_Aires';
    const result = await getCurrentTime();
    const payload = JSON.parse(result.content[0].text);
    assert.match(payload.iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/);
  });

  it('returns ISO with Z-style UTC offset when TZ is UTC', async () => {
    process.env.TZ = 'UTC';
    const result = await getCurrentTime();
    const payload = JSON.parse(result.content[0].text);
    assert.match(payload.iso, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+00:00$/);
    assert.equal(payload.timezone, 'UTC');
  });

  it('isoUtc is a valid ISO string matching Date.toISOString()', async () => {
    process.env.TZ = 'UTC';
    const before = Date.now();
    const result = await getCurrentTime();
    const after = Date.now();
    const payload = JSON.parse(result.content[0].text);
    const parsed = new Date(payload.isoUtc).getTime();
    assert.ok(parsed >= before - 1000 && parsed <= after + 1000);
  });
});
