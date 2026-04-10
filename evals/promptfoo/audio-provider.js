'use strict';

/**
 * Audio provider for promptfoo voice transcription regression test.
 *
 * Unlike provider.js (which invokes `openclaw agent` for text messages),
 * this provider invokes `openclaw infer audio transcribe` directly against
 * a fixture audio file that lives inside the eval container.
 *
 * It also reads the container's openclaw.json to surface whether
 * `tools.media.audio.models` is pinned to groq — that pin is the Limbo-side
 * workaround for the OpenClaw auto-resolver bug where audio routes to the
 * openai provider whenever an openai-codex OAuth profile is present, and
 * returns HTTP 429 because the subscription account has no standalone OpenAI
 * API credits.
 *
 * The output is a single JSON object combining:
 *   - pinnedProvider: provider id from tools.media.audio.models[0]
 *   - pinnedModel:    model id    from tools.media.audio.models[0]
 *   - transcribe:     raw JSON output of `openclaw infer audio transcribe --json`
 *
 * Assertions in promptfooconfig.yaml check:
 *   - pinnedProvider === "groq"                      → entrypoint pin still applied
 *   - pinnedModel    === "whisper-large-v3-turbo"    → pin targets correct model
 *   - transcribe.ok  === true                        → multipart patch still works
 *   - output does not contain "error" (case-insens.) → no failure surfaced anywhere
 *
 * The fixture is copied into the container on every invocation (idempotent
 * docker cp). This keeps the provider self-contained — it does not depend
 * on hooks.js beforeAll having run, so the audio test can be filtered and
 * executed in isolation via `promptfoo eval --filter-pattern voice`.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const CONTAINER = process.env.LIMBO_EVAL_CONTAINER || 'limbo-eval';
const OPENCLAW_CONFIG = '/home/limbo/.openclaw/openclaw.json';
const GROQ_SECRET = '/home/limbo/.openclaw/secrets/groq_api_key';

const FIXTURE_HOST_PATH = path.join(__dirname, '..', 'fixtures', 'voice-sample.m4a');
const FIXTURE_CONTAINER_PATH = '/home/limbo/.openclaw/media/inbound/eval-voice-sample.m4a';

function stripAnsi(str) {
  return str
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
}

function readFileInContainer(filePath) {
  const proc = spawnSync('docker', ['exec', CONTAINER, 'cat', filePath], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (proc.status !== 0) {
    throw new Error(`Failed to read ${filePath} in container: ${(proc.stderr || '').trim()}`);
  }
  return proc.stdout;
}

function resolveAudioPin() {
  try {
    const cfg = JSON.parse(readFileInContainer(OPENCLAW_CONFIG));
    const first = cfg && cfg.tools && cfg.tools.media && cfg.tools.media.audio
      && Array.isArray(cfg.tools.media.audio.models)
      ? cfg.tools.media.audio.models[0]
      : null;
    return {
      pinnedProvider: (first && first.provider) || null,
      pinnedModel: (first && first.model) || null,
    };
  } catch (err) {
    return {
      pinnedProvider: null,
      pinnedModel: null,
      pinReadFailure: err.message,
    };
  }
}

function ensureFixtureInContainer() {
  // On a fresh image openclaw creates media/inbound lazily — on the first
  // inbound message — so the directory may not exist yet at eval time.
  // Create it defensively before copying so the test works against any
  // clean container state.
  const mkdir = spawnSync('docker', [
    'exec', CONTAINER, 'mkdir', '-p', path.dirname(FIXTURE_CONTAINER_PATH),
  ], { encoding: 'utf8', timeout: 5000 });
  if (mkdir.status !== 0) {
    throw new Error(`Failed to mkdir in ${CONTAINER}: ${(mkdir.stderr || '').trim()}`);
  }
  const cp = spawnSync('docker', [
    'cp', FIXTURE_HOST_PATH, `${CONTAINER}:${FIXTURE_CONTAINER_PATH}`,
  ], { encoding: 'utf8', timeout: 10000 });
  if (cp.status !== 0) {
    throw new Error(`Failed to copy fixture into ${CONTAINER}: ${(cp.stderr || '').trim()}`);
  }
}

function runTranscribe(audioPath, groqKey) {
  const proc = spawnSync('docker', [
    'exec',
    '-e', `GROQ_API_KEY=${groqKey}`,
    CONTAINER,
    'openclaw', 'infer', 'audio', 'transcribe',
    '--file', audioPath,
    '--json',
  ], { encoding: 'utf8', timeout: 30000 });

  const stdout = stripAnsi(proc.stdout || '');
  const stderr = stripAnsi(proc.stderr || '');

  // Parse JSON on success; on parse failure, fall through with a sentinel
  // object so assertions still see a meaningful output instead of crashing
  // the whole eval run with an unhandled exception.
  try {
    return { result: JSON.parse(stdout), exitCode: proc.status, stderr };
  } catch (err) {
    return {
      result: {
        ok: false,
        parseFailure: err.message,
        rawStdoutHead: stdout.slice(0, 500),
        stderrHead: stderr.slice(0, 500),
      },
      exitCode: proc.status,
      stderr,
    };
  }
}

class LimboAudioProvider {
  constructor() {
    this._id = 'limbo-audio-probe';
  }

  id() {
    return this._id;
  }

  toString() {
    return `Limbo audio probe (${CONTAINER})`;
  }

  async callApi(_prompt, _context) {
    const start = Date.now();

    // 1. Read current pin from openclaw.json inside the container.
    const pin = resolveAudioPin();

    // 2. Ensure the fixture is present at the expected path inside the container.
    try {
      ensureFixtureInContainer();
    } catch (err) {
      return {
        output: JSON.stringify({
          ...pin,
          transcribe: { ok: false, fixtureCopyFailure: err.message },
        }, null, 2),
      };
    }

    // 3. Read the groq secret from the container so the exec inherits auth.
    let groqKey;
    try {
      groqKey = readFileInContainer(GROQ_SECRET).trim();
    } catch (err) {
      return {
        output: JSON.stringify({
          ...pin,
          transcribe: { ok: false, groqSecretFailure: err.message },
        }, null, 2),
      };
    }

    // 4. Run the transcribe command against the fixture.
    const { result, exitCode, stderr } = runTranscribe(FIXTURE_CONTAINER_PATH, groqKey);

    const output = {
      ...pin,
      transcribe: result,
    };

    return {
      output: JSON.stringify(output, null, 2),
      metadata: {
        exitCode,
        stderr,
        latencyMs: Date.now() - start,
      },
    };
  }
}

module.exports = LimboAudioProvider;
