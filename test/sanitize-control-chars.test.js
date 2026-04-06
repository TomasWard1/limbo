// test/sanitize-control-chars.test.js — Control character sanitization
// Verifies that MCP tool results have dangerous control chars stripped
// while preserving \t, \n, \r.  See issue #245.
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// The regex and function are defined inline in index.js (not exported),
// so we replicate the logic here to unit-test the sanitization contract.

const CONTROL_CHAR_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F]/g;

function sanitizeToolResult(result) {
  if (!result || !Array.isArray(result.content)) return result;
  for (const block of result.content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      block.text = block.text.replace(CONTROL_CHAR_RE, '');
    }
  }
  return result;
}

describe('sanitizeToolResult', () => {
  it('strips null bytes and other control chars', () => {
    const result = {
      content: [{ type: 'text', text: 'hello\x00world\x01!\x1F' }],
    };
    sanitizeToolResult(result);
    assert.equal(result.content[0].text, 'helloworld!');
  });

  it('preserves tab, newline, and carriage return', () => {
    const result = {
      content: [{ type: 'text', text: 'line1\nline2\ttab\r\n' }],
    };
    sanitizeToolResult(result);
    assert.equal(result.content[0].text, 'line1\nline2\ttab\r\n');
  });

  it('handles multiple content blocks', () => {
    const result = {
      content: [
        { type: 'text', text: 'a\x00b' },
        { type: 'image', data: 'base64data', mimeType: 'image/png' },
        { type: 'text', text: 'c\x07d' },
      ],
    };
    sanitizeToolResult(result);
    assert.equal(result.content[0].text, 'ab');
    assert.equal(result.content[1].data, 'base64data'); // untouched
    assert.equal(result.content[2].text, 'cd');
  });

  it('handles null/undefined result gracefully', () => {
    assert.equal(sanitizeToolResult(null), null);
    assert.equal(sanitizeToolResult(undefined), undefined);
  });

  it('handles result without content array', () => {
    const result = { isError: true };
    sanitizeToolResult(result);
    assert.deepEqual(result, { isError: true });
  });

  it('strips all control chars 0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F', () => {
    // Build a string with every control char
    let input = '';
    let expected = '';
    for (let i = 0; i < 32; i++) {
      input += String.fromCharCode(i);
      // Keep \t (9), \n (10), \r (13)
      if (i === 9 || i === 10 || i === 13) {
        expected += String.fromCharCode(i);
      }
    }
    const result = {
      content: [{ type: 'text', text: input }],
    };
    sanitizeToolResult(result);
    assert.equal(result.content[0].text, expected);
  });

  it('leaves clean strings untouched', () => {
    const text = 'Normal text with UTF-8: café, naïve, résumé 🎉';
    const result = {
      content: [{ type: 'text', text }],
    };
    sanitizeToolResult(result);
    assert.equal(result.content[0].text, text);
  });
});
