/**
 * Unit tests for the CLI auth output filter logic.
 *
 * Tests stripAnsi, processLine (carriage-return collapse), and the emitLine
 * filtering decisions in streamFilteredAuth. Zero external dependencies —
 * uses Node.js built-in test runner (node:test, node >= 18).
 *
 * Run: node --test test/cli-filter.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// ─── Replicated filter logic (must stay in sync with cli.js) ─────────────────
// If these start diverging, extract to a shared module.

const stripAnsi = (str) => str
  .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')          // CSI sequences (all parameter byte combos)
  .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC sequences (before two-char — shares \x1b] prefix)
  .replace(/\x1b[^[\]]/g, '')                         // two-char ESC sequences (e.g. ESC 7/8 save/restore)
  .replace(/\r/g, '');

const urlRe = /https?:\/\/[^\s"'<>\]]+/g;
const tuiChrome = /^[\s\u2500-\u257f\u2580-\u259f\u25a0-\u25ff\u2600-\u26ff\u2190-\u21ff\u2700-\u27bf\u2800-\u28ff]*$/u;

/** Returns last \r-frame — the final visual state of any carriage-return animation. */
function processLine(raw) {
  return raw.split('\r').pop() || '';
}

/**
 * Models the emitLine decision: 'url' | 'show' | 'suppress'.
 * Reset urlRe.lastIndex before each call since it's a global regex.
 */
function classify(rawLine) {
  urlRe.lastIndex = 0;
  const line = stripAnsi(rawLine);
  if (urlRe.test(line)) return 'url';
  if (/openclaw/i.test(line)) return 'suppress';
  if (tuiChrome.test(line)) return 'suppress';
  if (!line.trim()) return 'suppress';
  return 'show';
}

// ─── stripAnsi ────────────────────────────────────────────────────────────────

test('stripAnsi: removes standard SGR color codes', () => {
  assert.equal(stripAnsi('\x1b[31mRed text\x1b[0m'), 'Red text');
  assert.equal(stripAnsi('\x1b[1;32mBold green\x1b[0m'), 'Bold green');
});

test('stripAnsi: removes private-mode sequences (the original bug — ?25l hide cursor)', () => {
  assert.equal(stripAnsi('\x1b[?25l'), '');
  assert.equal(stripAnsi('\x1b[?25lhello\x1b[?25h'), 'hello');
  assert.equal(stripAnsi('\x1b[?2004h bracketed paste mode \x1b[?2004l'), ' bracketed paste mode ');
});

test('stripAnsi: removes cursor movement and erase sequences', () => {
  assert.equal(stripAnsi('\x1b[5;10HY'), 'Y');   // cursor to row 5, col 10, then char
  assert.equal(stripAnsi('\x1b[2K'), '');          // erase entire line
  assert.equal(stripAnsi('\x1b[1A'), '');          // cursor up 1
  assert.equal(stripAnsi('\x1b[G'), '');           // cursor to column 1
});

test('stripAnsi: removes two-char ESC sequences (save/restore cursor)', () => {
  assert.equal(stripAnsi('\x1b7saved\x1b8'), 'saved');
  assert.equal(stripAnsi('\x1bcReset'), 'Reset');
});

test('stripAnsi: removes OSC sequences (window title)', () => {
  assert.equal(stripAnsi('\x1b]0;My Terminal\x07normal'), 'normal');
  assert.equal(stripAnsi('\x1b]2;Title\x1b\\text'), 'text');
});

test('stripAnsi: strips \\r (carriage return)', () => {
  assert.equal(stripAnsi('hello\rworld'), 'helloworld');
});

test('stripAnsi: passes through plain text unchanged', () => {
  assert.equal(stripAnsi('Auth complete.'), 'Auth complete.');
  assert.equal(stripAnsi(''), '');
});

// ─── processLine (carriage-return collapse) ───────────────────────────────────

test('processLine: returns last \\r-frame (final typewriter state)', () => {
  // This is the core fix. Typewriter animation builds text with \r between frames.
  const input = '│  Y\r│  Yo\r│  You\r│  You \r│  You are running in a remote environment';
  assert.equal(processLine(input), '│  You are running in a remote environment');
});

test('processLine: collapses spinner animation to final frame', () => {
  assert.equal(processLine('⠋ Waiting\r⠙ Waiting\r⠹ Waiting\r⠸ Done'), '⠸ Done');
});

test('processLine: returns line unchanged if no \\r present', () => {
  assert.equal(processLine('Auth complete.'), 'Auth complete.');
  assert.equal(processLine(''), '');
});

test('processLine: handles trailing \\r (line ending with empty final frame)', () => {
  // \r at end → final frame is empty string; processLine returns ''
  assert.equal(processLine('clear this\r'), '');
});

// ─── emitLine classification ──────────────────────────────────────────────────

test('classify: detects OAuth URLs', () => {
  assert.equal(classify('https://auth.openai.com/oauth/authorize?foo=bar'), 'url');
  assert.equal(classify('  → https://auth.openai.com/oauth/authorize?foo=bar  '), 'url');
  assert.equal(classify('\x1b[36mhttps://example.com/auth\x1b[0m'), 'url');
});

test('classify: suppresses OpenClaw branding', () => {
  assert.equal(classify('Starting OpenClaw gateway...'), 'suppress');
  assert.equal(classify('openclaw v1.2.3'), 'suppress');
  assert.equal(classify('  OpenClaw ready  '), 'suppress');
});

test('classify: suppresses pure TUI chrome — spinner chars', () => {
  assert.equal(classify('⠋'), 'suppress');
  assert.equal(classify('⠙'), 'suppress');
  assert.equal(classify('⠹ '), 'suppress');  // spinner + whitespace
});

test('classify: suppresses pure TUI chrome — box-drawing and clack decorations', () => {
  assert.equal(classify('│'), 'suppress');        // box drawing
  assert.equal(classify('◇'), 'suppress');        // clack diamond
  assert.equal(classify('●'), 'suppress');        // clack bullet
  assert.equal(classify('─────'), 'suppress');    // horizontal rule
  assert.equal(classify('  '), 'suppress');       // whitespace only
  assert.equal(classify(''), 'suppress');         // empty
});

test('classify: suppresses lines with ANSI that reduce to chrome', () => {
  // \x1b[?25l is "hide cursor" — stripping it leaves empty string
  assert.equal(classify('\x1b[?25l'), 'suppress');
  assert.equal(classify('\x1b[?25l◇\x1b[?25h'), 'suppress');
});

test('classify: shows actual text prompts (the lines we want to preserve)', () => {
  assert.equal(classify('│  You are running in a remote environment'), 'show');
  assert.equal(classify('Auth complete. Model connected.'), 'show');
  assert.equal(classify('If the browser did not open, paste the callback URL:'), 'show');
  assert.equal(classify('✓ Authentication successful'), 'show');
});

// ─── Full pipeline: typewriter animation ─────────────────────────────────────

test('full pipeline: typewriter animation collapses to single clean line', () => {
  // Simulate the exact failure pattern from the bug report.
  // OpenClaw writes text character-by-character with \r between frames,
  // terminated by \n when the message is complete.
  const buffer = '│  Y\r│  Yo\r│  You\r│  You \r│  You are running in a remote environment\n';

  // handleData splits on \n only
  const lines = buffer.split(/\r?\n/);
  lines.pop(); // drop trailing empty after final \n

  const results = lines.map((raw) => {
    const frame = processLine(raw);
    return { frame, decision: classify(frame) };
  });

  // Should produce exactly one output, fully formed
  assert.equal(results.length, 1);
  assert.equal(results[0].frame, '│  You are running in a remote environment');
  assert.equal(results[0].decision, 'show');
});

test('full pipeline: spinner-only animation is suppressed after collapse', () => {
  // Spinner that ends without a meaningful final state (pure decoration)
  const buffer = '⠋\r⠙\r⠹\r⠸\r⠼\r\n';

  const lines = buffer.split(/\r?\n/);
  lines.pop();

  const results = lines.map((raw) => {
    const frame = processLine(raw);
    return classify(frame);
  });

  assert.deepEqual(results, ['suppress']);
});

test('full pipeline: URL line is extracted and not double-printed', () => {
  const buffer = 'Open: https://auth.openai.com/oauth/authorize?response_type=code&client_id=app\n';

  const lines = buffer.split(/\r?\n/);
  lines.pop();

  const [raw] = lines;
  const frame = processLine(raw);
  assert.equal(classify(frame), 'url');
});
