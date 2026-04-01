#!/usr/bin/env node
'use strict';

const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');

const { snapshot, diff, snapshotAll, diffAll } = require('./lib/vault-diff');
// mcp-log.js is no longer used — MCP logs are parsed from sendMessage output
const { score } = require('./lib/scorer');
const { judge } = require('./lib/judge');

// ── Constants ────────────────────────────────────────────────────────────────

const CONTAINER = 'limbo-eval';
const EVAL_PORT = 18790;
const EVALS_DIR = __dirname;
const CASES_DIR = path.join(EVALS_DIR, 'cases');
const RESULTS_DIR = path.join(EVALS_DIR, 'results');
const HISTORY_DIR = path.join(RESULTS_DIR, 'history');
const BASELINE_PATH = path.join(RESULTS_DIR, 'baseline.json');
const BASELINES_DIR = path.join(RESULTS_DIR, 'baselines');
const BASELINES_INDEX_PATH = path.join(RESULTS_DIR, 'baselines-index.json');
const VAULT_SEED = path.join(EVALS_DIR, 'vault-seed');

// ── Message sending ─────────────────────────────────────────────────────────

function sendMessage(message, container, sessionStateFile = null) {
  const runtimeConfig = readZeroClawConfig(container);
  const dockerArgs = ['exec'];

  // Anthropic OAuth still needs the token exported explicitly for docker exec.
  if (runtimeConfig.provider === 'anthropic') {
    dockerArgs.push('-e', 'ANTHROPIC_OAUTH_TOKEN=' + readContainerSecret(container, 'llm_api_key'));
  }

  dockerArgs.push(
    container,
    'zeroclaw', 'agent',
    '--provider', runtimeConfig.provider,
    '--model', runtimeConfig.model,
  );

  if (sessionStateFile) {
    dockerArgs.push('--session-state-file', sessionStateFile);
  }

  dockerArgs.push('--message', message);

  const proc = spawnSync('docker', dockerArgs, { encoding: 'utf8', timeout: 130000 });

  if (proc.error) throw proc.error;
  if (proc.status !== 0) {
    throw new Error(`Command failed: ${(proc.stderr || proc.stdout || '').trim()}`);
  }

  // MCP eval logs may appear in stdout or stderr — check both
  const allOutput = (proc.stdout || '') + '\n' + (proc.stderr || '');
  const mcpLogs = [];
  const responseLines = [];

  for (const line of allOutput.split('\n')) {
    const stripped = stripAnsi(line);

    // Extract MCP eval log lines (JSON objects with type field)
    if (stripped.startsWith('{')) {
      try {
        const parsed = JSON.parse(stripped);
        if (parsed.type === 'tool_call' || parsed.type === 'tool_result') {
          mcpLogs.push(parsed);
          continue;
        }
      } catch {}
    }

    // Skip zeroclaw log lines
    if (/^\d{4}-\d{2}-\d{2}T/.test(stripped)) continue;
    if (/^zeroclaw::/.test(stripped)) continue;
    if (/^\s*(WARN|INFO|ERROR)\s/.test(stripped)) continue;
    if (/^\[limbo-vault\]/.test(stripped)) continue;

    responseLines.push(line);
  }

  return { text: stripAnsi(responseLines.join('\n').trim()), mcpLogs };
}

function listCronJobs(container) {
  try {
    const result = spawnSync('docker', [
      'exec', container, 'zeroclaw', 'cron', 'list',
    ], { encoding: 'utf8', timeout: 10000 });
    const output = stripAnsi((result.stdout || '') + '\n' + (result.stderr || ''));
    // Parse cron list output: "- <id> | <schedule> | next=... | last=...\n    prompt: ..."
    const jobs = [];
    const lines = output.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^- ([a-f0-9-]+) \| (.+)/);
      if (match) {
        const prompt = (lines[i + 1] || '').replace(/^\s*prompt:\s*/, '').trim();
        jobs.push({ id: match[1], schedule: match[2].trim(), prompt, raw: lines[i] + '\n' + (lines[i + 1] || '') });
      }
    }
    return jobs;
  } catch {
    return [];
  }
}

function clearCrons(container) {
  const jobs = listCronJobs(container);
  for (const job of jobs) {
    spawnSync('docker', ['exec', container, 'zeroclaw', 'cron', 'remove', job.id], { timeout: 5000 });
  }
}

function readUserProfile(container) {
  try {
    return execFileSync('docker', [
      'exec', container, 'cat', '/home/limbo/.zeroclaw/workspace/USER.md',
    ], { encoding: 'utf8', timeout: 5000 });
  } catch {
    return '';
  }
}

function resetUserProfile(container) {
  spawnSync('docker', [
    'exec',
    container,
    'sh',
    '-lc',
    [
      'mkdir -p /home/limbo/.zeroclaw/workspace',
      'cat > /home/limbo/.zeroclaw/workspace/USER.md <<\'EOF\'',
      '# About Your User',
      '',
      'This file was generated at first run from environment variables. It personalizes how you interact with your user.',
      '',
      '## Identity',
      '',
      '- **Name:** Tomas',
      '- **Timezone:** ',
      '- **Language:** Spanish',
      '',
      '## Communication Preferences',
      '',
      'Respond in **Spanish**. Keep responses concise by default unless the user asks for more detail.',
      '',
      'Address the user as **Tomas** when it feels natural, but don\'t overdo it.',
      '',
      '## Additional Context',
      '',
      'No additional context provided.',
      'EOF',
    ].join('\n'),
  ], { timeout: 5000 });
}

function extractTimezoneFromMessage(message) {
  if (!message) return null;
  const trimmed = String(message).trim();
  const ianaMatch = trimmed.match(/\b([A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)\b/);
  if (ianaMatch) return ianaMatch[1];
  const argentinaMatch = trimmed.match(/\b(argentina|buenos aires|gmt-?3|utc-?3)\b/i);
  if (argentinaMatch) return 'America/Buenos_Aires';
  return null;
}

function persistUserTimezone(container, timezone) {
  if (!timezone) return;
  spawnSync('docker', [
    'exec',
    container,
    'sh',
    '-lc',
    `perl -0pi -e 's/- \\*\\*Timezone:\\*\\* .*/- **Timezone:** ${timezone.replace(/\//g, '\\/')}/m' /home/limbo/.zeroclaw/workspace/USER.md`,
  ], { timeout: 5000 });
}

function extractSearchTime(mcpLogs) {
  // Find vault_search call/result pairs and sum their execution times
  let totalMs = 0;
  const calls = mcpLogs.filter(l => l.type === 'tool_call' && l.tool === 'vault_search');
  for (const call of calls) {
    const result = mcpLogs.find(l =>
      l.type === 'tool_result' && l.tool === 'vault_search' &&
      new Date(l.timestamp) >= new Date(call.timestamp)
    );
    if (result) {
      const delta = new Date(result.timestamp) - new Date(call.timestamp);
      totalMs += delta;
    }
  }
  return totalMs || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get MCP eval logs from docker container logs since a given timestamp.
 */
function getContainerMcpLogs(container, sinceIso) {
  const result = spawnSync('docker', [
    'logs', '--since', sinceIso, container,
  ], { encoding: 'utf8', timeout: 10000 });

  const allOutput = (result.stdout || '') + '\n' + (result.stderr || '');
  const mcpLogs = [];
  const responseLines = [];

  for (const line of allOutput.split('\n')) {
    const stripped = stripAnsi(line);
    if (stripped.startsWith('{')) {
      try {
        const parsed = JSON.parse(stripped);
        if (parsed.type === 'tool_call' || parsed.type === 'tool_result') {
          mcpLogs.push(parsed);
          continue;
        }
      } catch {}
    }
    // Capture non-log lines as potential response text
    if (/^\d{4}-\d{2}-\d{2}T/.test(stripped)) continue;
    if (/^zeroclaw::/.test(stripped)) continue;
    if (/^\s*(WARN|INFO|ERROR)\s/.test(stripped)) continue;
    if (/^\[limbo-vault\]/.test(stripped)) continue;
    if (stripped.trim()) responseLines.push(stripped);
  }

  return { mcpLogs, responseText: responseLines.join('\n').trim() };
}

/**
 * Poll for Telegram processing completion.
 * Watches vault for new files and docker logs for MCP activity.
 * Returns { vaultDiff, allFilesDiff, mcpLogs, responseText } or null on timeout.
 */
async function waitForTelegramProcessing(container, vaultDir, beforeSnapshot, beforeAllSnapshot, sinceIso, timeoutMs = 90000) {
  const pollMs = 3000;
  const start = Date.now();
  let sawProcessing = false;

  while (Date.now() - start < timeoutMs) {
    await sleep(pollMs);

    // Get all container output since we started
    const logResult = spawnSync('docker', [
      'logs', '--since', sinceIso, container,
    ], { encoding: 'utf8', timeout: 10000 });
    const allOutput = (logResult.stdout || '') + '\n' + (logResult.stderr || '');

    const elapsed = Math.round((Date.now() - start) / 1000);

    // Check for "⏳ Processing" — means bot received the message
    if (!sawProcessing && allOutput.includes('Processing message')) {
      sawProcessing = true;
      process.stdout.write(`\r  Message received, processing... ${elapsed}s`);
    }

    // Check for "🤖 Reply" — means agent finished (success or error)
    const replyMatch = allOutput.match(/Reply \((\d+)ms\):/);
    if (replyMatch) {
      process.stdout.write(`\r  Reply received (${replyMatch[1]}ms), collecting results...\n`);
      // Give vault a moment to flush writes
      await sleep(2000);

      const { mcpLogs, responseText } = getContainerMcpLogs(container, sinceIso);
      const finalSnapshot = snapshot(vaultDir);
      const finalAll = snapshotAll(vaultDir);
      return {
        vaultDiff: diff(beforeSnapshot, finalSnapshot),
        allFilesDiff: diffAll(beforeAllSnapshot, finalAll),
        mcpLogs,
        responseText,
      };
    }

    // Check for "❌ LLM error" — agent failed
    if (allOutput.includes('LLM error')) {
      process.stdout.write(`\r  Agent error detected at ${elapsed}s\n`);
      const { mcpLogs, responseText } = getContainerMcpLogs(container, sinceIso);
      const finalSnapshot = snapshot(vaultDir);
      const finalAll = snapshotAll(vaultDir);
      return {
        vaultDiff: diff(beforeSnapshot, finalSnapshot),
        allFilesDiff: diffAll(beforeAllSnapshot, finalAll),
        mcpLogs,
        responseText: responseText || 'LLM error',
      };
    }

    if (sawProcessing) {
      process.stdout.write(`\r  Processing... ${elapsed}s / ${timeoutMs / 1000}s`);
    } else {
      process.stdout.write(`\r  Waiting... ${elapsed}s / ${timeoutMs / 1000}s`);
    }
  }

  process.stdout.write('\n');
  return null;
}

function buildStepMessage(stepInput, transcriptTurns) {
  if (!Array.isArray(transcriptTurns) || transcriptTurns.length === 0) {
    return stepInput;
  }

  const transcript = transcriptTurns
    .map(turn => `${turn.role === 'assistant' ? 'Assistant' : 'User'}: ${turn.content}`)
    .join('\n\n');

  return [
    'Continue this conversation naturally.',
    '',
    transcript,
    '',
    `User: ${stepInput}`,
  ].join('\n');
}

function buildProfileKey({ provider, model, reasoningEffort }) {
  const raw = [provider || 'unknown', model || 'unknown', reasoningEffort || 'default'].join('__');
  return raw.replace(/[^a-zA-Z0-9._-]+/g, '-');
}

function buildProfileLabel({ provider, model, reasoningEffort }) {
  const modelLabel = model || 'unknown-model';
  const effortLabel = reasoningEffort || 'default';
  const providerLabel = provider || 'unknown-provider';
  return `${modelLabel} · ${effortLabel} · ${providerLabel}`;
}

function parseEnvFile(filePath) {
  try {
    const content = fsSync.readFileSync(filePath, 'utf8');
    const out = {};
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function parseStatusField(output, label) {
  const match = output.match(new RegExp(`${label}:\\s*(.+)`));
  return match ? match[1].trim() : null;
}

function readZeroClawConfig(container) {
  try {
    const cfg = execFileSync('docker', [
      'exec', container, 'cat', '/home/limbo/.zeroclaw/config.toml',
    ], { encoding: 'utf8', timeout: 10000 });
    const providerMatch = cfg.match(/default_provider\s*=\s*"([^"]+)"/);
    const modelMatch = cfg.match(/default_model\s*=\s*"([^"]+)"/);
    const reasoningMatch = cfg.match(/reasoning_effort\s*=\s*"([^"]+)"/);
    return {
      provider: providerMatch ? providerMatch[1].trim() : null,
      model: modelMatch ? modelMatch[1].trim() : null,
      reasoningEffort: reasoningMatch ? reasoningMatch[1].trim() : null,
    };
  } catch {
    return { provider: null, model: null, reasoningEffort: null };
  }
}

function resolveRunKind({ tag, caseName, difficulty }) {
  if (tag === 'speed') return 'speed';
  if (caseName || tag || difficulty) return 'subset';
  return 'full';
}

function readJSON(filePath, fallback) {
  try {
    return JSON.parse(fsSync.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function readRuntimeMeta(container) {
  const envEval = parseEnvFile(path.join(EVALS_DIR, '.env.eval'));
  const runtimeConfig = readZeroClawConfig(container);
  let provider = runtimeConfig.provider || process.env.MODEL_PROVIDER || envEval.MODEL_PROVIDER || null;
  let model = runtimeConfig.model || process.env.MODEL_NAME || envEval.MODEL_NAME || null;
  let reasoningEffort = runtimeConfig.reasoningEffort || process.env.RUNTIME_REASONING_EFFORT || envEval.RUNTIME_REASONING_EFFORT || null;
  let authMode = process.env.AUTH_MODE || envEval.AUTH_MODE || null;
  let zeroclawVersion = null;

  try {
    const status = execFileSync('docker', [
      'exec', container, 'zeroclaw', 'status',
    ], { encoding: 'utf8', timeout: 10000 });
    zeroclawVersion = parseStatusField(status, 'Version') || zeroclawVersion;
  } catch {}

  const meta = {
    provider,
    model,
    reasoningEffort,
    authMode,
    zeroclawVersion,
  };
  meta.profileKey = buildProfileKey(meta);
  meta.profileLabel = buildProfileLabel(meta);
  return meta;
}

async function updateBaselinesIndex(runData, baselineFile) {
  const profileKey = runData.meta?.profileKey || buildProfileKey({});
  const kind = runData.kind || 'full';
  const index = readJSON(BASELINES_INDEX_PATH, {});
  if (!index[profileKey]) index[profileKey] = {};
  index[profileKey][kind] = {
    id: runData.id,
    file: path.basename(baselineFile),
    profileKey,
    profileLabel: runData.meta?.profileLabel || buildProfileLabel({}),
    kind,
    timestamp: runData.timestamp,
  };
  index[profileKey].any = {
    id: runData.id,
    file: path.basename(baselineFile),
    profileKey,
    profileLabel: runData.meta?.profileLabel || buildProfileLabel({}),
    kind,
    timestamp: runData.timestamp,
  };
  await fs.writeFile(BASELINES_INDEX_PATH, JSON.stringify(index, null, 2));
}

function resolveBaselineForRun(runData) {
  const profileKey = runData.meta?.profileKey;
  const kind = runData.kind || 'full';
  const index = readJSON(BASELINES_INDEX_PATH, {});
  const entry = profileKey && index[profileKey] ? (index[profileKey][kind] || index[profileKey].any) : null;
  if (entry && entry.file) {
    const pathForProfile = path.join(BASELINES_DIR, entry.file);
    try {
      return JSON.parse(fsSync.readFileSync(pathForProfile, 'utf8'));
    } catch {}
  }
  try {
    return JSON.parse(fsSync.readFileSync(BASELINE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function resolveBaselineForCase(caseName, runNum, runData) {
  const profileKey = runData.meta?.profileKey || buildProfileKey({});
  // Try per-case baseline first
  const caseFile = path.join(BASELINES_DIR, profileKey, `${caseName}.json`);
  try {
    return JSON.parse(fsSync.readFileSync(caseFile, 'utf8'));
  } catch {}
  // Fallback: extract from monolithic baseline
  const monolithic = resolveBaselineForRun(runData);
  if (monolithic && monolithic.results) {
    return monolithic.results.find(r => r.case === caseName && r.run === runNum) || null;
  }
  return null;
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
}

let _cachedSecret = null;
function readContainerSecret(container, name) {
  if (_cachedSecret) return _cachedSecret;
  _cachedSecret = execFileSync('docker', [
    'exec', container, 'cat', `/run/secrets/${name}`,
  ], { encoding: 'utf8' }).trim();
  return _cachedSecret;
}

// ── Vault reset ─────────────────────────────────────────────────────────────

async function resetVault() {
  const pristineDir = path.join(EVALS_DIR, '.vault-pristine');

  // First run: save pristine copy
  try { await fs.access(pristineDir); } catch {
    await fs.cp(VAULT_SEED, pristineDir, { recursive: true });
  }

  // Clean vault-seed contents without deleting the directory itself
  // (deleting it breaks the Docker bind mount).
  for (const entry of await fs.readdir(VAULT_SEED)) {
    if (entry.startsWith('.')) continue;
    await fs.rm(path.join(VAULT_SEED, entry), { recursive: true, force: true });
  }
  // Copy pristine contents back (includes assets/)
  for (const entry of await fs.readdir(pristineDir)) {
    if (entry.startsWith('.')) continue;
    await fs.cp(path.join(pristineDir, entry), path.join(VAULT_SEED, entry), { recursive: true });
  }
}

function resetContainerRuntime(container) {
  spawnSync('docker', [
    'exec',
    container,
    'sh',
    '-lc',
    [
      'rm -rf /data/db/*',
      'rm -rf /data/logs/*',
      'rm -rf /data/backups/*',
      'rm -rf /data/memory/*',
      'rm -f /data/.force-setup-done',
      'rm -f /home/limbo/.zeroclaw/workspace/USER.md',
    ].join(' && '),
  ], { timeout: 10000 });
}

// ── Case loading ────────────────────────────────────────────────────────────

function loadCases(filterName) {
  const files = fsSync.readdirSync(CASES_DIR).filter(f => f.endsWith('.json'));
  const cases = files.map(f => {
    const content = fsSync.readFileSync(path.join(CASES_DIR, f), 'utf8');
    return JSON.parse(content);
  });
  if (filterName) {
    return cases.filter(c => c.name === filterName);
  }
  return cases;
}

// ── Commands ────────────────────────────────────────────────────────────────

async function cmdRun(args) {
  const caseName = args['--case'] || null;
  const tag = args['--tag'] || null;
  const useJudge = args['--judge'] || false;
  const difficulty = args['--difficulty'] || null;
  const includeManual = args['--include-manual'] || false;
  const runMeta = await readRuntimeMeta(CONTAINER);
  const runKind = resolveRunKind({ tag, caseName, difficulty });

  let cases = loadCases(caseName);
  if (tag) {
    cases = cases.filter(c => (c.tags || []).includes(tag));
  }
  if (difficulty) {
    cases = cases.filter(c => c.difficulty === difficulty);
  }
  // Exclude manual/interactive cases unless explicitly requested
  if (!includeManual && tag !== 'manual') {
    cases = cases.filter(c => !(c.tags || []).includes('manual'));
  }

  if (cases.length === 0) {
    console.error('No cases found.');
    process.exit(1);
  }

  console.log(`Running ${cases.length} eval case(s)...\n`);

  const runId = `run-${Date.now()}`;
  const results = [];

  for (const evalCase of cases) {
    const runs = evalCase.runs || 1;
    for (let i = 0; i < runs; i++) {
      console.log(`── ${evalCase.name} (run ${i + 1}/${runs}) ──`);
      const sessionStateFile = `/tmp/limbo-eval-${evalCase.name}-${Date.now()}-${i + 1}.json`;

      try {
        // Reset vault and clear leftover cron jobs
        await resetVault();
        resetContainerRuntime(CONTAINER);
        clearCrons(CONTAINER);
        resetUserProfile(CONTAINER);
        spawnSync('docker', ['exec', CONTAINER, 'rm', '-f', sessionStateFile], { timeout: 5000 });

        // Resolve steps: multi-step cases have steps[], single-step have input+assertions
        const steps = evalCase.steps || [{ input: evalCase.input, assertions: evalCase.assertions }];
        const transcriptTurns = [];
        let allScoreResults = [];
        let stepResults = [];
        let lastResponse = '';
        let lastVaultDiff = { created: [], modified: [], deleted: [] };
        let totalMcpLogs = 0;
        let totalLatencyMs = 0;
        let allMcpLogs = [];

        for (let s = 0; s < steps.length; s++) {
          const step = steps[s];
          const stepLabel = steps.length > 1 ? ` [step ${s + 1}/${steps.length}]` : '';

          if (step.type === 'command') {
            // Simulate ZeroClaw commands (e.g. /new) without sending a message
            console.log(`  Command${stepLabel}: "${step.content}"`);
            if (step.content === '/new') {
              // /new clears conversation history but NOT the vault
              spawnSync('docker', ['exec', CONTAINER, 'rm', '-f', sessionStateFile], { timeout: 5000 });
              transcriptTurns.length = 0;
              console.log('  Session state cleared (simulated /new)');
            } else {
              console.log(`  ⚠ Unknown command "${step.content}" — skipped`);
            }
            continue;
          }

          if (step.type === 'telegram_manual') {
            // Snapshot before (both .md and all files)
            const before = snapshot(VAULT_SEED);
            const beforeAll = snapshotAll(VAULT_SEED);
            const sinceIso = new Date().toISOString();

            // Prompt user
            console.log(`\n  >>> ACTION REQUIRED: ${step.prompt}`);
            if (step.fixture_hint) {
              console.log(`      Hint: ${step.fixture_hint}`);
            }
            console.log(`      Waiting up to ${(step.timeout_ms || 90000) / 1000}s...\n`);

            const result = await waitForTelegramProcessing(
              CONTAINER, VAULT_SEED, before, beforeAll, sinceIso, step.timeout_ms || 90000
            );

            if (!result) {
              console.log('  TIMEOUT — no processing detected');
              const failResults = step.assertions.map((a) => ({
                assertion: a, pass: false, reason: 'Timeout waiting for Telegram processing',
              }));
              allScoreResults = allScoreResults.concat(failResults);
              continue;
            }

            console.log(`  Processing detected!`);
            console.log(`    MCP logs: ${result.mcpLogs.length}`);
            console.log(`    New files: ${result.allFilesDiff.created.map((f) => f.path).join(', ') || 'none'}`);
            console.log(`    New notes: ${result.vaultDiff.created.map((f) => f.path).join(', ') || 'none'}`);
            if (result.responseText) {
              console.log(`    Response: "${result.responseText.slice(0, 120)}..."`);
            }

            // Merge allFilesDiff into vaultDiff for assertion compatibility
            const mergedVaultDiff = {
              created: [...result.vaultDiff.created, ...result.allFilesDiff.created],
              modified: result.vaultDiff.modified || [],
              deleted: [...(result.vaultDiff.deleted || []), ...result.allFilesDiff.deleted],
            };

            lastResponse = result.responseText;
            lastVaultDiff = mergedVaultDiff;
            totalMcpLogs += result.mcpLogs.length;
            allMcpLogs = allMcpLogs.concat(result.mcpLogs);
            const telegramLatencyMs = Date.now() - new Date(sinceIso).getTime();
            totalLatencyMs += telegramLatencyMs;

            const stepScores = score(step.assertions, {
              response: result.responseText,
              mcpLogs: result.mcpLogs,
              vaultDiff: mergedVaultDiff,
              cronJobs: [],
              latencyMs: telegramLatencyMs,
            });
            allScoreResults = allScoreResults.concat(stepScores);
            const passed = stepScores.filter((r) => r.pass).length;
            console.log(`  Score${stepLabel}: ${passed}/${stepScores.length} assertions passed`);

          } else {
            // Snapshot before
            const before = snapshot(VAULT_SEED);
            const cronsBefore = listCronJobs(CONTAINER);

            // Send message
            console.log(`  Sending${stepLabel}: "${step.input}"`);
            const startMs = Date.now();
            const message = buildStepMessage(step.input, transcriptTurns);
            const { text: response, mcpLogs } = sendMessage(message, CONTAINER, sessionStateFile);
            const latencyMs = Date.now() - startMs;
            const timezone = extractTimezoneFromMessage(step.input);
            if (timezone) {
              persistUserTimezone(CONTAINER, timezone);
            }
            const userProfile = readUserProfile(CONTAINER);
            lastResponse = response;
            transcriptTurns.push({ role: 'user', content: step.input });
            transcriptTurns.push({ role: 'assistant', content: response });
            console.log(`  Response: "${response.slice(0, 120)}${response.length > 120 ? '...' : ''}"`);
            console.log(`  Latency: ${latencyMs}ms`);

            // Snapshot after
            const after = snapshot(VAULT_SEED);
            const vaultDiff = diff(before, after);
            lastVaultDiff = vaultDiff;

            // Cron diff — new jobs created during this step
            const cronsAfter = listCronJobs(CONTAINER);
            const beforeIds = new Set(cronsBefore.map(j => j.id));
            const cronJobs = cronsAfter.filter(j => !beforeIds.has(j.id));

            totalMcpLogs += mcpLogs.length;
            allMcpLogs = allMcpLogs.concat(mcpLogs);
            totalLatencyMs += latencyMs;

            // Score assertions for this step
            const stepScores = score(step.assertions, { response, mcpLogs, vaultDiff, cronJobs, latencyMs, userProfile });
            allScoreResults = allScoreResults.concat(stepScores);
            stepResults.push({
              index: s + 1,
              input: step.input,
              response,
              latencyMs,
              userProfile,
              mcpLogCount: mcpLogs.length,
              mcpLogs,
              assertions: step.assertions,
              scoreResults: stepScores,
              vaultDiff: {
                created: vaultDiff.created.length,
                modified: vaultDiff.modified.length,
                deleted: vaultDiff.deleted.length,
              },
              cronJobs: cronJobs.map(job => ({
                id: job.id,
                schedule: job.schedule,
                task: job.task,
                timezone: job.timezone,
              })),
            });

            const passed = stepScores.filter(r => r.pass).length;
            console.log(`  Score${stepLabel}: ${passed}/${stepScores.length} assertions passed`);
          }
        }

        const passed = allScoreResults.filter(r => r.pass).length;
        const total = allScoreResults.length;
        const passRate = total > 0 ? passed / total : 0;

        // Optional judge (runs on final response)
        let judgeResults = null;
        if (useJudge) {
          judgeResults = {};
          const createdNote = (lastVaultDiff.created[0] || {}).content || '';
          const judgeInput = evalCase.input || (evalCase.steps && evalCase.steps[0].input) || '';
          try {
            judgeResults.note_quality = judge('note_quality', {
              input: judgeInput, response: lastResponse, note_content: createdNote,
            });
            console.log(`  Judge (note_quality): ${judgeResults.note_quality.pass ? 'PASS' : 'FAIL'} — ${judgeResults.note_quality.reason}`);
          } catch (err) {
            judgeResults.note_quality = { pass: false, reason: err.message, raw: '' };
          }
          try {
            judgeResults.response_quality = judge('response_quality', {
              input: judgeInput, response: lastResponse, note_content: createdNote,
            });
            console.log(`  Judge (response_quality): ${judgeResults.response_quality.pass ? 'PASS' : 'FAIL'} — ${judgeResults.response_quality.reason}`);
          } catch (err) {
            judgeResults.response_quality = { pass: false, reason: err.message, raw: '' };
          }
        }

        results.push({
          case: evalCase.name,
          run: i + 1,
          passRate,
          passed,
          total,
          scoreResults: allScoreResults,
          judgeResults,
          response: lastResponse.slice(0, 500),
          steps: stepResults,
          vaultDiff: {
            created: lastVaultDiff.created.length,
            modified: lastVaultDiff.modified.length,
            deleted: lastVaultDiff.deleted.length,
          },
          mcpLogCount: totalMcpLogs,
          mcpLogs: allMcpLogs,
          searchTimeMs: extractSearchTime(allMcpLogs),
          latencyMs: totalLatencyMs,
          timestamp: new Date().toISOString(),
        });
      } catch (err) {
        console.error(`  ERROR: ${err.message}`);
        const totalAssertions = evalCase.assertions
          ? evalCase.assertions.length
          : (evalCase.steps || []).reduce((n, s) => n + s.assertions.length, 0);
        results.push({
          case: evalCase.name,
          run: i + 1,
          passRate: 0,
          passed: 0,
          total: totalAssertions,
          scoreResults: [],
          judgeResults: null,
          error: err.message,
          timestamp: new Date().toISOString(),
        });
      }

      console.log('');
    }
  }

  // Save results
  const resultFile = path.join(HISTORY_DIR, `${runId}.json`);
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  const runData = {
    id: runId,
    timestamp: new Date().toISOString(),
    meta: runMeta,
    kind: runKind,
    scope: {
      case: caseName,
      tag,
      difficulty,
      judge: Boolean(useJudge),
    },
    results,
  };
  await fs.writeFile(resultFile, JSON.stringify(runData, null, 2));
  await fs.writeFile(path.join(RESULTS_DIR, 'latest.json'), JSON.stringify(runData, null, 2));

  // Summary
  const totalPassed = results.reduce((s, r) => s + r.passed, 0);
  const totalAssertions = results.reduce((s, r) => s + r.total, 0);
  const overallRate = totalAssertions > 0 ? ((totalPassed / totalAssertions) * 100).toFixed(1) : 0;
  console.log(`═══ Summary: ${totalPassed}/${totalAssertions} assertions passed (${overallRate}%) ═══`);
  console.log(`Results saved: ${resultFile}`);
}

async function cmdCompare(args) {
  const strict = args['--strict'] || false;

  let latest;
  try {
    latest = JSON.parse(await fs.readFile(path.join(RESULTS_DIR, 'latest.json'), 'utf8'));
  } catch {
    console.error('No latest results found. Run `limbo-eval run` first.');
    process.exit(1);
  }

  const profileLabel = latest.meta?.profileLabel || 'unknown profile';
  console.log(`Comparing latest run (${latest.id}) for ${profileLabel}:\n`);

  let regressions = 0;
  let improvements = 0;
  let newCases = 0;

  for (const result of latest.results) {
    const base = resolveBaselineForCase(result.case, result.run, latest);
    if (!base) {
      console.log(`  [NEW]  ${result.case} — ${(result.passRate * 100).toFixed(0)}%`);
      newCases++;
      continue;
    }
    const diff = result.passRate - base.passRate;
    if (diff > 0) {
      console.log(`  [UP]   ${result.case} — ${(base.passRate * 100).toFixed(0)}% → ${(result.passRate * 100).toFixed(0)}%`);
      improvements++;
    } else if (diff < 0) {
      console.log(`  [DOWN] ${result.case} — ${(base.passRate * 100).toFixed(0)}% → ${(result.passRate * 100).toFixed(0)}%`);
      regressions++;
    } else {
      console.log(`  [=]    ${result.case} — ${(result.passRate * 100).toFixed(0)}%`);
    }
  }

  console.log(`\n${improvements} improvement(s), ${regressions} regression(s), ${newCases} new case(s)`);

  if (strict && regressions > 0) {
    console.error('Strict mode: regressions detected.');
    process.exit(1);
  }
}

async function cmdPromote(args) {
  const filterCase = args['--case'] || null;

  let latest;
  try {
    latest = await fs.readFile(path.join(RESULTS_DIR, 'latest.json'), 'utf8');
  } catch {
    console.error('No latest results found. Run `limbo-eval run` first.');
    process.exit(1);
  }

  const parsed = JSON.parse(latest);
  const profileKey = parsed.meta?.profileKey || buildProfileKey(parsed.meta || {});
  const profileDir = path.join(BASELINES_DIR, profileKey);
  await fs.mkdir(profileDir, { recursive: true });

  // Save per-case baselines
  const results = filterCase
    ? parsed.results.filter(r => r.case === filterCase)
    : parsed.results;

  if (results.length === 0) {
    console.error(filterCase ? `Case "${filterCase}" not found in latest run.` : 'No results to promote.');
    process.exit(1);
  }

  for (const result of results) {
    const caseFile = path.join(profileDir, `${result.case}.json`);
    await fs.writeFile(caseFile, JSON.stringify(result, null, 2));
  }

  // Also update monolithic baseline + index for backward compat (full runs only)
  if (!filterCase) {
    await fs.mkdir(BASELINES_DIR, { recursive: true });
    const kind = parsed.kind || 'full';
    const baselineFile = path.join(BASELINES_DIR, `${profileKey}-${kind}.json`);
    await fs.writeFile(BASELINE_PATH, latest);
    await fs.writeFile(baselineFile, latest);
    await updateBaselinesIndex(parsed, baselineFile);
  }

  const scope = filterCase ? `case "${filterCase}"` : `${results.length} case(s)`;
  console.log(`Promoted ${scope} from run ${parsed.id} as baseline for ${parsed.meta?.profileLabel || profileKey}.`);
}

async function cmdReport() {
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  const files = (await fs.readdir(HISTORY_DIR))
    .filter(f => f.endsWith('.json'))
    .sort()
    .slice(-10);

  if (files.length === 0) {
    console.log('No run history found.');
    return;
  }

  console.log('Last 10 runs:\n');
  console.log('  Run ID                    Cases   Pass Rate   Profile');
  console.log('  ─────────────────────────────────────────────────────────────────────────');

  for (const file of files) {
    const data = JSON.parse(await fs.readFile(path.join(HISTORY_DIR, file), 'utf8'));
    const totalPassed = data.results.reduce((s, r) => s + r.passed, 0);
    const totalAssertions = data.results.reduce((s, r) => s + r.total, 0);
    const rate = totalAssertions > 0 ? ((totalPassed / totalAssertions) * 100).toFixed(1) : '0.0';
    const profileLabel = data.meta?.profileLabel || 'unknown-model';
    console.log(`  ${data.id.padEnd(28)} ${String(data.results.length).padEnd(8)} ${String(rate + '%').padEnd(11)} ${profileLabel}`);
  }
}

// ── Argument parsing ────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i];
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[key] = argv[i + 1];
        i++;
      } else {
        args[key] = true;
      }
    } else {
      positional.push(argv[i]);
    }
  }
  return { command: positional[0], args };
}

function showHelp() {
  console.log(`limbo-eval — End-to-end evaluation runner for Limbo

Usage:
  limbo-eval <command> [options]

Commands:
  run       Run eval cases against a live Limbo container
  compare   Compare latest results against baseline
  promote   Promote latest results as the new baseline
  report    Show pass rates for the last 10 runs

Options for 'run':
  --case <name>       Run only a specific case by name
  --tag <tag>         Run only cases with a given tag
  --difficulty <tier> Run only cases of a given difficulty (easy|medium|hard)
  --judge             Enable LLM-as-judge evaluation
  --include-manual    Include interactive/manual cases (excluded by default)

Options for 'compare':
  --strict        Exit with error code if regressions found

Options for 'promote':
  --case <name>   Promote only a specific case (default: all cases)

Examples:
  limbo-eval run
  limbo-eval run --case create-reminder
  limbo-eval run --difficulty medium
  limbo-eval run --tag vault_write_note --judge
  limbo-eval run --tag manual              # run only manual Telegram tests
  limbo-eval run --include-manual          # run all cases including manual
  limbo-eval compare --strict
  limbo-eval promote
  limbo-eval promote --case remember-fact
  limbo-eval report`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));

  switch (command) {
    case 'run':
      await cmdRun(args);
      break;
    case 'compare':
      await cmdCompare(args);
      break;
    case 'promote':
      await cmdPromote(args);
      break;
    case 'report':
      await cmdReport();
      break;
    default:
      showHelp();
      break;
  }
}

main().catch(err => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
