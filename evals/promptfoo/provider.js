'use strict';

/**
 * Promptfoo custom provider for Limbo.
 *
 * Sends a message to the limbo-eval Docker container via `openclaw agent`
 * and returns the response text plus MCP logs as structured context.
 *
 * Reuses the same Docker exec approach as the legacy eval runner.
 */

const { execFileSync, spawnSync } = require('child_process');

const CONTAINER = process.env.LIMBO_EVAL_CONTAINER || 'limbo-eval';
const AGENT_BIN = 'openclaw';
const AGENT_HOME = `/home/limbo/.${AGENT_BIN}`;

// ── Helpers ────────────────────────────────────────────────────────────────

function stripAnsi(str) {
  return str
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
}

function listCronJobs() {
  try {
    const result = spawnSync('docker', [
      'exec', '-u', 'limbo', CONTAINER, AGENT_BIN, 'cron', 'list', '--json',
    ], { encoding: 'utf8', timeout: 10000 });
    const data = JSON.parse(result.stdout || '{}');
    return (data.jobs || []).map(j => ({ id: j.id, raw: JSON.stringify(j) }));
  } catch {
    return [];
  }
}

function readUserProfile() {
  try {
    return execFileSync('docker', [
      'exec', '-u', 'limbo', CONTAINER, 'cat', `${AGENT_HOME}/workspace/USER.md`,
    ], { encoding: 'utf8', timeout: 5000 });
  } catch {
    return '';
  }
}

// ── Message sending ────────────────────────────────────────────────────────

function countMcpLogLines() {
  try {
    const result = spawnSync('docker', [
      'exec', CONTAINER, 'sh', '-c', 'wc -l < /data/logs/mcp.log',
    ], { encoding: 'utf8', timeout: 5000 });
    return parseInt((result.stdout || '0').trim(), 10) || 0;
  } catch {
    return 0;
  }
}

function readMcpLogFrom(startLine) {
  try {
    const result = spawnSync('docker', [
      'exec', CONTAINER, 'tail', '-n', `+${startLine + 1}`, '/data/logs/mcp.log',
    ], { encoding: 'utf8', timeout: 5000 });
    return (result.stdout || '').split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function parseMcpLogLines(lines) {
  const logs = [];
  for (const line of lines) {
    // Format: [timestamp] [session] tool_call: <tool_name>[ params=<json>]
    // Format: [timestamp] [session] tool_result: <tool_name> success=<bool>
    const callMatch = line.match(/tool_call:\s*(\S+)(?:\s+params=(.*))?$/);
    if (callMatch) {
      const entry = { type: 'tool_call', tool: callMatch[1] };
      if (callMatch[2]) {
        try {
          entry.params = JSON.parse(callMatch[2]);
        } catch {
          // Ignore malformed params — assertions using paramMatch will just miss.
        }
      }
      logs.push(entry);
      continue;
    }
    const resultMatch = line.match(/tool_result:\s*(\S+)\s+success=(\S+)/);
    if (resultMatch) {
      logs.push({ type: 'tool_result', tool: resultMatch[1], success: resultMatch[2] === 'true' });
    }
  }
  return logs;
}

function listVaultNotes() {
  try {
    const result = spawnSync('docker', [
      'exec', CONTAINER, 'find', '/data/vault/notes', '-name', '*.md', '-type', 'f',
    ], { encoding: 'utf8', timeout: 5000 });
    return (result.stdout || '').trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function sendMessage(message, sessionStateFile) {
  const sessionId = sessionStateFile || `eval-${Date.now()}`;

  // Snapshot MCP log line count before the call
  const logLinesBefore = countMcpLogLines();

  // Snapshot vault notes before
  const notesBefore = listVaultNotes();

  const dockerArgs = [
    'exec', '-u', 'limbo', CONTAINER,
    AGENT_BIN, 'agent',
    '--session-id', sessionId,
    '--message', message,
  ];

  const proc = spawnSync('docker', dockerArgs, { encoding: 'utf8', timeout: 130000 });

  if (proc.error) throw proc.error;
  if (proc.status !== 0) {
    throw new Error(`${AGENT_BIN} agent failed: ${(proc.stderr || proc.stdout || '').trim().slice(0, 500)}`);
  }

  // Read only the new MCP log lines since before the call
  const newLogLines = readMcpLogFrom(logLinesBefore);
  const mcpLogs = parseMcpLogLines(newLogLines);

  // Snapshot vault notes after
  const notesAfter = listVaultNotes();

  // Extract response text from stdout (stderr is empty with openclaw agent)
  const text = stripAnsi((proc.stdout || '').trim());

  return { text, mcpLogs, notesBefore, notesAfter };
}

// ── Setup ──────────────────────────────────────────────────────────────────

const { beforeAll } = require('./hooks');

let _initialized = false;
const _runId = `eval-${Date.now()}`;
const _sessionGroups = {}; // maps group name → unique session ID for this run

// ── Provider interface ─────────────────────────────────────────────────────

class LimboProvider {
  constructor() {
    this._id = 'limbo-docker';
  }

  id() {
    return this._id;
  }

  toString() {
    return `Limbo (${CONTAINER})`;
  }

  async callApi(prompt, context) {
    // Reset once at the start of the eval run, not before each test.
    // Tests are ordered to avoid conflicts.
    if (!_initialized) {
      beforeAll();
      _initialized = true;
    }

    const vars = context.vars || {};
    // Multi-turn: tests in the same __sessionGroup share a session ID (unique per run)
    let sessionStateFile = null;
    if (vars.__sessionGroup) {
      if (!_sessionGroups[vars.__sessionGroup]) {
        _sessionGroups[vars.__sessionGroup] = `${_runId}-${vars.__sessionGroup}`;
      }
      sessionStateFile = _sessionGroups[vars.__sessionGroup];
    } else if (vars.__sessionStateFile) {
      sessionStateFile = vars.__sessionStateFile;
    }

    // Snapshot state before the call
    const cronJobsBefore = listCronJobs();

    const start = Date.now();
    const { text, mcpLogs, notesBefore, notesAfter } = sendMessage(prompt, sessionStateFile);
    const latencyMs = Date.now() - start;

    // Collect container state after the call
    const cronJobsAfter = listCronJobs();
    const userProfile = readUserProfile();

    return {
      output: text,
      metadata: {
        mcpLogs,
        notesBefore,
        notesAfter,
        cronJobsBefore,
        cronJobsAfter,
        userProfile,
        latencyMs,
      },
    };
  }
}

module.exports = LimboProvider;
