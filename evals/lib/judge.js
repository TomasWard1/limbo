'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

const rubrics = require(path.join(__dirname, '..', 'judge', 'rubrics.json'));

/**
 * Run an LLM-as-judge evaluation using the claude CLI.
 *
 * @param {string} rubricName — key in rubrics.json (e.g. "note_quality")
 * @param {object} vars — template variables: { input, response, note_content }
 * @returns {{ pass: boolean, reason: string, raw: string }}
 */
function judge(rubricName, vars) {
  const rubric = rubrics[rubricName];
  if (!rubric) {
    throw new Error(`Unknown rubric: "${rubricName}". Available: ${Object.keys(rubrics).join(', ')}`);
  }

  // Template substitution
  let prompt = rubric.prompt;
  for (const [key, value] of Object.entries(vars)) {
    prompt = prompt.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
  }

  const timeout = rubric.timeout || 30000;

  let raw;
  try {
    raw = execFileSync('claude', ['-p', prompt], {
      encoding: 'utf8',
      timeout: timeout + 5000, // extra buffer for process overhead
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    return {
      pass: false,
      reason: `Judge failed to execute: ${err.message}`,
      raw: err.stdout || err.stderr || '',
    };
  }

  return parseJudgeOutput(raw.trim());
}

/**
 * Parse "PASS — reason" or "FAIL — reason" from LLM output.
 */
function parseJudgeOutput(raw) {
  // Look for PASS or FAIL at the start of any line
  const lines = raw.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    const passMatch = trimmed.match(/^PASS\s*[—–-]\s*(.+)/i);
    if (passMatch) {
      return { pass: true, reason: passMatch[1].trim(), raw };
    }
    const failMatch = trimmed.match(/^FAIL\s*[—–-]\s*(.+)/i);
    if (failMatch) {
      return { pass: false, reason: failMatch[1].trim(), raw };
    }
  }

  // If we can't parse the output, treat as failure
  return { pass: false, reason: `Could not parse judge output: ${raw.slice(0, 200)}`, raw };
}

module.exports = { judge, parseJudgeOutput };
