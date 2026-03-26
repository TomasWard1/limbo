'use strict';

const { execFileSync } = require('child_process');

/**
 * Parse MCP eval log lines from Docker container stderr.
 * Each eval log line is a JSON object written by evalLog() in mcp-server/index.js.
 *
 * @param {string} containerName — Docker container name
 * @returns {Array<{type: string, tool?: string, params?: object, success?: boolean, error?: string, timestamp: string}>}
 */
function parseLogs(containerName) {
  let raw;
  try {
    raw = execFileSync('docker', ['logs', containerName, '--timestamps'], {
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    // docker logs sends output to both stdout and stderr; combine them
    raw = (err.stdout || '') + '\n' + (err.stderr || '');
  }

  const logs = [];
  const lines = raw.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Eval log lines are JSON objects. Try to find JSON in each line.
    const jsonStart = trimmed.indexOf('{');
    if (jsonStart === -1) continue;

    try {
      const parsed = JSON.parse(trimmed.slice(jsonStart));
      // Only include eval-related log entries (they have a timestamp from evalLog)
      if (parsed.timestamp) {
        logs.push(parsed);
      }
    } catch {
      // Not a JSON line, skip
    }
  }

  return logs;
}

/**
 * Filter logs to those after a given timestamp.
 * @param {string} since — ISO timestamp
 * @param {string} containerName
 * @returns {Array}
 */
function logsSince(since, containerName) {
  const all = parseLogs(containerName);
  const sinceDate = new Date(since);
  return all.filter((log) => new Date(log.timestamp) >= sinceDate);
}

module.exports = { parseLogs, logsSince };
