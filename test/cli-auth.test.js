// test/cli-auth.test.js
// Unit tests for the streamFilteredAuth pure-logic functions exported from cli.js.
// Run with: node --test test/cli-auth.test.js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { stripAnsi, AUTH_URL_RE, TUI_CHROME_RE } = require('../cli.js');

// ─── stripAnsi ────────────────────────────────────────────────────────────────

test('stripAnsi: strips standard CSI sequences', () => {
  assert.equal(stripAnsi('\x1b[32mgreen\x1b[0m'), 'green');
  assert.equal(stripAnsi('\x1b[1;31mbold red\x1b[0m'), 'bold red');
  assert.equal(stripAnsi('\x1b[2Kclear line'), 'clear line');
});

test('stripAnsi: strips ?-prefixed private-mode CSI sequences', () => {
  // \x1b[?25l hide cursor, \x1b[?25h show cursor
  assert.equal(stripAnsi('\x1b[?25lhello\x1b[?25h'), 'hello');
  // \x1b[?2004h / \x1b[?2004l bracketed paste mode
  assert.equal(stripAnsi('\x1b[?2004htext\x1b[?2004l'), 'text');
});

test('stripAnsi: strips two-char ESC sequences (0x40-0x5F range)', () => {
  // ESC M (0x4D) — reverse index (cursor up with scroll)
  assert.equal(stripAnsi('\x1bMline'), 'line');
  // ESC E (0x45) — next line
  assert.equal(stripAnsi('text\x1bEafter'), 'textafter');
  // ESC ^ (0x5E) — privacy message (PM)
  assert.equal(stripAnsi('before\x1b^after'), 'beforeafter');
});

test('stripAnsi: strips OSC sequences (BEL-terminated)', () => {
  // OSC 0 ; title BEL — window title sequence
  assert.equal(stripAnsi('\x1b]0;My Terminal Title\x07visible'), 'visible');
});

test('stripAnsi: strips OSC sequences (ST-terminated)', () => {
  assert.equal(stripAnsi('\x1b]0;title\x1b\\visible'), 'visible');
});

test('stripAnsi: strips bare carriage returns', () => {
  assert.equal(stripAnsi('line1\rline2'), 'line1line2');
  assert.equal(stripAnsi('\r'), '');
});

test('stripAnsi: leaves plain text untouched', () => {
  const plain = 'Hello, world! 123 !@#';
  assert.equal(stripAnsi(plain), plain);
});

test('stripAnsi: handles empty string', () => {
  assert.equal(stripAnsi(''), '');
});

test('stripAnsi: strips mixed sequences in one pass', () => {
  // CSI (?25l hide cursor) + CSI (32m color) + OSC (window title) + bare CR
  const input = '\x1b[?25l\x1b[32mProcessing\x1b[0m...\x1b]0;term\x07done\r';
  assert.equal(stripAnsi(input), 'Processing...done');
  // CSI + two-char ESC (M) mixed with real text
  const input2 = '\x1b[1mbold\x1b[0m\x1bMnext';
  assert.equal(stripAnsi(input2), 'boldnext');
});

// ─── TUI_CHROME_RE ────────────────────────────────────────────────────────────

test('TUI_CHROME_RE: suppresses Braille spinner chars', () => {
  // Common clack/openclaw spinner frames
  for (const ch of ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']) {
    assert.equal(TUI_CHROME_RE.test(ch), true, `expected ${ch} to match TUI_CHROME_RE`);
  }
});

test('TUI_CHROME_RE: suppresses box-drawing chars', () => {
  assert.equal(TUI_CHROME_RE.test('─'), true);
  assert.equal(TUI_CHROME_RE.test('│'), true);
  assert.equal(TUI_CHROME_RE.test('┌┐└┘'), true);
  assert.equal(TUI_CHROME_RE.test('═══'), true);
});

test('TUI_CHROME_RE: suppresses clack decoration chars', () => {
  assert.equal(TUI_CHROME_RE.test('◇'), true);
  assert.equal(TUI_CHROME_RE.test('●'), true);
  assert.equal(TUI_CHROME_RE.test('◆'), true);
  assert.equal(TUI_CHROME_RE.test('○'), true);
});

test('TUI_CHROME_RE: suppresses whitespace-only lines', () => {
  assert.equal(TUI_CHROME_RE.test('   '), true);
  assert.equal(TUI_CHROME_RE.test(''), true);
  assert.equal(TUI_CHROME_RE.test('\t'), true);
});

test('TUI_CHROME_RE: suppresses mixed chrome lines (spinner + whitespace)', () => {
  assert.equal(TUI_CHROME_RE.test('  ⠋  '), true);
  assert.equal(TUI_CHROME_RE.test('◇  ─  ◇'), true);
});

test('TUI_CHROME_RE: passes lines with real text content', () => {
  assert.equal(TUI_CHROME_RE.test('Please open this URL'), false);
  assert.equal(TUI_CHROME_RE.test('Authenticating...'), false);
  assert.equal(TUI_CHROME_RE.test('Press Enter to continue'), false);
  assert.equal(TUI_CHROME_RE.test('Error: invalid token'), false);
});

test('TUI_CHROME_RE: passes lines starting with decoration but containing text', () => {
  // clack prompts often have a leading decoration glyph followed by text
  assert.equal(TUI_CHROME_RE.test('◇ Enter your API key'), false);
  assert.equal(TUI_CHROME_RE.test('● Model selected: claude-opus-4-6'), false);
});

// ─── AUTH_URL_RE (URL extraction) ─────────────────────────────────────────────

test('AUTH_URL_RE: detects http OAuth URLs', () => {
  const line = 'Open this URL to authenticate: http://localhost:3000/oauth/callback?code=abc123';
  const matches = line.match(AUTH_URL_RE);
  assert.ok(matches, 'expected URL match');
  assert.equal(matches[0], 'http://localhost:3000/oauth/callback?code=abc123');
});

test('AUTH_URL_RE: detects https OAuth URLs', () => {
  const line = 'Visit https://auth.anthropic.com/oauth2/authorize?client_id=limbo&state=xyz to login';
  const matches = line.match(AUTH_URL_RE);
  assert.ok(matches, 'expected URL match');
  assert.equal(matches[0], 'https://auth.anthropic.com/oauth2/authorize?client_id=limbo&state=xyz');
});

test('AUTH_URL_RE: does not match plain text without URL', () => {
  const line = 'Waiting for authentication...';
  const matches = line.match(AUTH_URL_RE);
  assert.equal(matches, null);
});

test('AUTH_URL_RE: stops URL at whitespace', () => {
  const line = 'URL: https://example.com/auth and then some text';
  const matches = line.match(AUTH_URL_RE);
  assert.ok(matches);
  assert.equal(matches[0], 'https://example.com/auth');
});

test('AUTH_URL_RE: stops URL at angle bracket', () => {
  const line = 'Go to <https://example.com/auth>';
  const matches = line.match(AUTH_URL_RE);
  assert.ok(matches);
  assert.equal(matches[0], 'https://example.com/auth');
});

test('AUTH_URL_RE: extracts multiple URLs from a single line', () => {
  const line = 'Primary: https://example.com/a Fallback: https://example.com/b';
  const matches = line.match(AUTH_URL_RE);
  assert.ok(matches);
  assert.equal(matches.length, 2);
  assert.equal(matches[0], 'https://example.com/a');
  assert.equal(matches[1], 'https://example.com/b');
});

test('AUTH_URL_RE: URL deduplication — same URL seen twice is emitted once', () => {
  // This tests the seenUrls Set logic conceptually — we verify that running AUTH_URL_RE
  // against the same URL twice and filtering via a Set yields a single emission.
  const url = 'https://auth.openai.com/oauth/callback?code=abc';
  const lines = [
    `Open: ${url}`,
    `Retry: ${url}`,
    'Different: https://example.com/other',
  ];

  const emitted = [];
  const seenUrls = new Set();

  for (const line of lines) {
    const urls = line.match(AUTH_URL_RE) || [];
    for (const u of urls) {
      if (!seenUrls.has(u)) {
        seenUrls.add(u);
        emitted.push(u);
      }
    }
  }

  assert.equal(emitted.length, 2, 'duplicate URL should only be emitted once');
  assert.equal(emitted[0], url);
  assert.equal(emitted[1], 'https://example.com/other');
});
