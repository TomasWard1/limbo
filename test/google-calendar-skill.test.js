// test/google-calendar-skill.test.js
// RED phase — Tests for Google Calendar OpenClaw skill file.
// Run with: node --test test/google-calendar-skill.test.js
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILL_PATH = path.join(__dirname, '..', 'workspace', 'skills', 'google-calendar', 'SKILL.md');

describe('Google Calendar skill file', () => {
  test('SKILL.md exists in workspace/skills/google-calendar/', () => {
    assert.ok(fs.existsSync(SKILL_PATH), `Expected ${SKILL_PATH} to exist`);
  });

  test('SKILL.md is non-empty', () => {
    const content = fs.readFileSync(SKILL_PATH, 'utf8');
    assert.ok(content.trim().length > 100, 'SKILL.md should have substantial content');
  });

  test('SKILL.md has Trigger section', () => {
    const content = fs.readFileSync(SKILL_PATH, 'utf8');
    assert.ok(/##\s*Trigger/i.test(content), 'Should have a Trigger section');
  });

  test('SKILL.md has Steps or Tools section', () => {
    const content = fs.readFileSync(SKILL_PATH, 'utf8');
    assert.ok(/##\s*(Steps|Tools)/i.test(content), 'Should have Steps or Tools section');
  });

  test('SKILL.md has Rules section', () => {
    const content = fs.readFileSync(SKILL_PATH, 'utf8');
    assert.ok(/##\s*Rules/i.test(content), 'Should have a Rules section');
  });

  test('SKILL.md has Errors section', () => {
    const content = fs.readFileSync(SKILL_PATH, 'utf8');
    assert.ok(/##\s*Errors/i.test(content), 'Should have an Errors section');
  });

  test('SKILL.md mentions calendar_read tool', () => {
    const content = fs.readFileSync(SKILL_PATH, 'utf8');
    assert.ok(/calendar_read/i.test(content), 'Should reference calendar_read tool');
  });

  test('SKILL.md mentions calendar_create tool', () => {
    const content = fs.readFileSync(SKILL_PATH, 'utf8');
    assert.ok(/calendar_create/i.test(content), 'Should reference calendar_create tool');
  });

  test('SKILL.md mentions calendar_delete tool', () => {
    const content = fs.readFileSync(SKILL_PATH, 'utf8');
    assert.ok(/calendar_delete/i.test(content), 'Should reference calendar_delete tool');
  });

  test('SKILL.md mentions calendar_update tool', () => {
    const content = fs.readFileSync(SKILL_PATH, 'utf8');
    assert.ok(/calendar_update/i.test(content), 'Should reference calendar_update tool');
  });

  test('SKILL.md warns about irreversible delete', () => {
    const content = fs.readFileSync(SKILL_PATH, 'utf8');
    assert.ok(/irreversible|confirm/i.test(content), 'Should warn about confirming before delete');
  });

  test('SKILL.md mentions timeZone from USER.md', () => {
    const content = fs.readFileSync(SKILL_PATH, 'utf8');
    assert.ok(/USER\.md/.test(content) && /timeZone/.test(content), 'Should mention reading timeZone from USER.md');
  });
});
