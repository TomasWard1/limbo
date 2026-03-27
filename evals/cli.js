#!/usr/bin/env node
'use strict';

const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');

const { snapshot, diff } = require('./lib/vault-diff');
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

function sendMessage(message, container) {
  // zeroclaw agent needs credentials in env — docker exec doesn't inherit
  // the entrypoint's exports, so we read the secret and pass it explicitly.
  const proc = spawnSync('docker', [
    'exec',
    '-e', 'ANTHROPIC_OAUTH_TOKEN=' + readContainerSecret(container, 'llm_api_key'),
    container, 'zeroclaw', 'agent',
    '--message', message,
  ], { encoding: 'utf8', timeout: 130000 });

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

function readRuntimeReasoning(container) {
  try {
    const cfg = execFileSync('docker', [
      'exec', container, 'cat', '/home/limbo/.zeroclaw/config.toml',
    ], { encoding: 'utf8', timeout: 10000 });
    const match = cfg.match(/reasoning_effort\s*=\s*"([^"]+)"/);
    return match ? match[1].trim() : null;
  } catch {
    return null;
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
  let provider = process.env.MODEL_PROVIDER || envEval.MODEL_PROVIDER || null;
  let model = process.env.MODEL_NAME || envEval.MODEL_NAME || null;
  let reasoningEffort = process.env.RUNTIME_REASONING_EFFORT || envEval.RUNTIME_REASONING_EFFORT || null;
  let authMode = process.env.AUTH_MODE || envEval.AUTH_MODE || null;
  let zeroclawVersion = null;

  try {
    const status = execFileSync('docker', [
      'exec', container, 'zeroclaw', 'status',
    ], { encoding: 'utf8', timeout: 10000 });
    provider = parseStatusField(status, 'Provider') || provider;
    model = parseStatusField(status, 'Model') || model;
    zeroclawVersion = parseStatusField(status, 'Version') || zeroclawVersion;
  } catch {}

  reasoningEffort = readRuntimeReasoning(container) || reasoningEffort;

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
  const notesDir = path.join(VAULT_SEED, 'notes');
  const mapsDir = path.join(VAULT_SEED, 'maps');

  // First run: save pristine copy
  try { await fs.access(pristineDir); } catch {
    await fs.cp(VAULT_SEED, pristineDir, { recursive: true });
  }

  // Restore from pristine
  await fs.rm(notesDir, { recursive: true, force: true });
  await fs.rm(mapsDir, { recursive: true, force: true });
  try {
    await fs.cp(path.join(pristineDir, 'notes'), notesDir, { recursive: true });
  } catch {
    await fs.mkdir(notesDir, { recursive: true });
  }
  try {
    await fs.cp(path.join(pristineDir, 'maps'), mapsDir, { recursive: true });
  } catch {
    await fs.mkdir(mapsDir, { recursive: true });
  }
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
  const runMeta = await readRuntimeMeta(CONTAINER);
  const runKind = resolveRunKind({ tag, caseName, difficulty });

  let cases = loadCases(caseName);
  if (tag) {
    cases = cases.filter(c => (c.tags || []).includes(tag));
  }
  if (difficulty) {
    cases = cases.filter(c => c.difficulty === difficulty);
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

      try {
        // Reset vault and clear leftover cron jobs
        await resetVault();
        clearCrons(CONTAINER);

        // Resolve steps: multi-step cases have steps[], single-step have input+assertions
        const steps = evalCase.steps || [{ input: evalCase.input, assertions: evalCase.assertions }];
        let allScoreResults = [];
        let lastResponse = '';
        let lastVaultDiff = { created: [], modified: [], deleted: [] };
        let totalMcpLogs = 0;
        let totalLatencyMs = 0;
        let allMcpLogs = [];

        for (let s = 0; s < steps.length; s++) {
          const step = steps[s];
          const stepLabel = steps.length > 1 ? ` [step ${s + 1}/${steps.length}]` : '';

          // Snapshot before
          const before = snapshot(VAULT_SEED);
          const cronsBefore = listCronJobs(CONTAINER);

          // Send message
          console.log(`  Sending${stepLabel}: "${step.input}"`);
          const startMs = Date.now();
          const { text: response, mcpLogs } = sendMessage(step.input, CONTAINER);
          const latencyMs = Date.now() - startMs;
          lastResponse = response;
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
          const stepScores = score(step.assertions, { response, mcpLogs, vaultDiff, cronJobs, latencyMs });
          allScoreResults = allScoreResults.concat(stepScores);

          const passed = stepScores.filter(r => r.pass).length;
          console.log(`  Score${stepLabel}: ${passed}/${stepScores.length} assertions passed`);
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

  const baseline = resolveBaselineForRun(latest);
  if (!baseline) {
    console.error('No baseline found. Run `limbo-eval promote` to create one.');
    process.exit(1);
  }

  console.log(`Comparing latest run (${latest.id}) vs baseline (${baseline.id}) for ${latest.meta?.profileLabel || 'unknown profile'}:\n`);

  const baseMap = new Map(baseline.results.map(r => [`${r.case}:${r.run}`, r]));
  let regressions = 0;
  let improvements = 0;

  for (const result of latest.results) {
    const key = `${result.case}:${result.run}`;
    const base = baseMap.get(key);
    if (!base) {
      console.log(`  [NEW]  ${result.case} — ${(result.passRate * 100).toFixed(0)}%`);
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

  console.log(`\n${improvements} improvement(s), ${regressions} regression(s)`);

  if (strict && regressions > 0) {
    console.error('Strict mode: regressions detected.');
    process.exit(1);
  }
}

async function cmdPromote() {
  let latest;
  try {
    latest = await fs.readFile(path.join(RESULTS_DIR, 'latest.json'), 'utf8');
  } catch {
    console.error('No latest results found. Run `limbo-eval run` first.');
    process.exit(1);
  }

  const parsed = JSON.parse(latest);
  await fs.mkdir(BASELINES_DIR, { recursive: true });
  const kind = parsed.kind || 'full';
  const profileKey = parsed.meta?.profileKey || buildProfileKey(parsed.meta || {});
  const baselineFile = path.join(BASELINES_DIR, `${profileKey}-${kind}.json`);

  await fs.writeFile(BASELINE_PATH, latest);
  await fs.writeFile(baselineFile, latest);
  await updateBaselinesIndex(parsed, baselineFile);
  console.log(`Promoted run ${parsed.id} as baseline for ${parsed.meta?.profileLabel || profileKey} (${kind}).`);
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

Options for 'compare':
  --strict        Exit with error code if regressions found

Examples:
  limbo-eval run
  limbo-eval run --case create-reminder
  limbo-eval run --difficulty medium
  limbo-eval run --tag vault_write_note --judge
  limbo-eval compare --strict
  limbo-eval promote
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
      await cmdPromote();
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
