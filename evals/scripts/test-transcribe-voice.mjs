#!/usr/bin/env node
// Isolated repro for Limbo's audio transcription regression.
//
// Calls OpenClaw's media-understanding runtime directly with a minimal cfg, bypassing
// Telegram, the gateway, the bot router, and the agent. This isolates whether
// transcription works at the OpenClaw provider layer, independent of Limbo's wiring.
//
// Inputs:
//   - GROQ_API_KEY in process.env
//   - An audio file path (first arg, or /tmp/voice-test.m4a by default)
//
// Steps performed (all logged):
//   1. normalizeMediaAttachments — does OpenClaw recognise the file as audio?
//   2. buildProviderRegistry    — are the bundled media-understanding providers loaded?
//   3. resolveAutoMediaKeyProviders — what order does the auto-resolver pick?
//   4. runCapability('audio')   — actually invoke the provider (this is the RED gate).
//
// Exit codes:
//   0 — transcription succeeded end-to-end (GREEN)
//   1 — transcription failed (RED); stderr includes the decision and reason
//   2 — precondition failed (missing key or audio file)
//
// Usage:
//   # Generate a short audio sample (macOS):
//   say -v Eddy "hola prueba" -o /tmp/voice-test.m4a --data-format=alac
//
//   # Run the probe:
//   GROQ_API_KEY=gsk_... node evals/scripts/test-transcribe-voice.mjs
//
// Requires the `openclaw` package to be resolvable from the script's location.
// Install it in an isolated dir if it isn't already a dep of the current project:
//   mkdir -p /tmp/voice-probe && cd /tmp/voice-probe && npm init -y \
//     && npm install openclaw && cp <this-file> ./probe.mjs \
//     && GROQ_API_KEY=... node probe.mjs /tmp/voice-test.m4a
//
// Related upstream bug: openclaw/openclaw#63851 (multipart/form-data header dropped
// by runtime fetch dispatcher; fix pending in PR #64349 as of 2026-04-10).

import {
  normalizeMediaAttachments,
  buildProviderRegistry,
  createMediaAttachmentCache,
  runCapability,
  resolveAutoMediaKeyProviders,
  transcribeFirstAudio,
} from 'openclaw/plugin-sdk/media-runtime';
import { setVerbose } from 'openclaw/plugin-sdk/runtime';
import path from 'node:path';
import fs from 'node:fs';

// Surface OpenClaw's verbose log lines (audio-preflight failures, provider skip reasons).
setVerbose(true);

const audioPath = process.argv[2] || '/tmp/voice-test.m4a';

if (!process.env.GROQ_API_KEY) {
  console.error('FAIL: GROQ_API_KEY is not set in env');
  process.exit(2);
}
if (!fs.existsSync(audioPath)) {
  console.error(`FAIL: audio file not found: ${audioPath}`);
  console.error('Generate one with: say -v Eddy "hola prueba" -o /tmp/voice-test.m4a --data-format=alac');
  process.exit(2);
}

const ext = path.extname(audioPath).toLowerCase();
const mimeByExt = {
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/opus',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
};
const contentType = mimeByExt[ext] || 'audio/mpeg';

// Minimal cfg — only the fields the audio runner actually reads.
// `tools.media.audio.enabled` is left undefined so the runner doesn't short-circuit;
// it defaults to enabled unless explicitly set to false.
const cfg = {
  agents: { defaults: {} },
  channels: {},
  tools: { media: { audio: {} } },
  plugins: {},
};

const ctx = {
  MediaPaths: [audioPath],
  MediaTypes: [contentType],
};

console.log('--- voice transcription RED probe ---');
console.log(`audio:        ${audioPath}`);
console.log(`mime:         ${contentType}`);
console.log(`size:         ${fs.statSync(audioPath).size} bytes`);
console.log(`GROQ_API_KEY: set (${process.env.GROQ_API_KEY.slice(0, 8)}...)`);
console.log('---');

// Step 1: confirm OpenClaw recognises the attachment as audio.
const attachments = normalizeMediaAttachments(ctx);
console.log(`step 1: normalizeMediaAttachments → ${attachments.length} attachment(s)`);
for (const att of attachments) {
  console.log(`         [${att.index}] kind=${att.kind} contentType=${att.contentType} path=${att.path}`);
}

// Step 2: inspect provider registry.
const providerRegistry = buildProviderRegistry(undefined, cfg);
const providerIds = [...providerRegistry.keys()];
console.log(`step 2: buildProviderRegistry → ${providerIds.length} provider(s): ${providerIds.join(', ') || '(none)'}`);

const audioCapableProviders = providerIds.filter((id) => {
  const p = providerRegistry.get(id);
  return p?.capabilities?.includes('audio') && typeof p.transcribeAudio === 'function';
});
console.log(`         audio-capable: ${audioCapableProviders.join(', ') || '(none)'}`);

// Step 3: inspect what the auto-key resolver would pick.
const autoOrder = resolveAutoMediaKeyProviders({ cfg, capability: 'audio', providerRegistry });
console.log(`step 3: resolveAutoMediaKeyProviders('audio') → ${autoOrder.join(', ') || '(none)'}`);

// Step 4: call runCapability directly so we can read the per-attempt decision.
// Pass the attachment dir as an allowed local root so the path-safety check accepts it.
// This bypasses the channel-inbound-roots resolution that the high-level preflight uses,
// and is the path that actually reaches the Groq HTTP request in OpenClaw 2026.4.9.
const allowedRoot = path.dirname(audioPath);
const cache = createMediaAttachmentCache(attachments, { localPathRoots: [allowedRoot] });
console.log(`step 4: runCapability('audio') (allowed root: ${allowedRoot})...`);
const runStart = Date.now();
let step4Outcome = 'unknown';
let step4Reason = '';
try {
  const result = await runCapability({
    capability: 'audio',
    cfg,
    ctx,
    media: attachments,
    attachments: cache,
    providerRegistry,
    config: cfg.tools?.media?.audio,
  });
  console.log(`         elapsed: ${Date.now() - runStart}ms`);
  console.log(`         decision: ${JSON.stringify(result.decision, null, 2)}`);
  step4Outcome = result.decision?.outcome ?? 'unknown';
  step4Reason = result.decision?.attachments?.[0]?.attempts?.[0]?.reason ?? '';
  if (result.outputs?.length > 0) {
    for (const output of result.outputs) {
      console.log(`         output: kind=${output.kind} text=${JSON.stringify(output.text)}`);
    }
  }
} catch (err) {
  console.error(`         THREW after ${Date.now() - runStart}ms: ${err?.message || err}`);
  console.error(err?.stack || '');
  step4Outcome = 'thrown';
  step4Reason = err?.message || String(err);
} finally {
  await cache.cleanup();
}

// Step 5: high-level transcribeFirstAudio — same entry point the telegram bot uses.
// This exercises the path-safety check and the channel-inbound-roots resolution, which
// can fail silently (verbose-only log) even if the low-level provider chain is fine.
console.log(`step 5: transcribeFirstAudio (high-level preflight path)...`);
const preflightStart = Date.now();
let step5Outcome = 'unknown';
try {
  // Use a fresh ctx so the preflight's `alreadyTranscribed` flag doesn't block it.
  const freshCtx = { MediaPaths: [audioPath], MediaTypes: [contentType] };
  const transcript = await transcribeFirstAudio({ ctx: freshCtx, cfg });
  console.log(`         elapsed: ${Date.now() - preflightStart}ms`);
  if (transcript === undefined) {
    console.error('         transcript: undefined (preflight returned without text)');
    step5Outcome = 'undefined';
  } else {
    console.log(`         transcript: ${JSON.stringify(transcript)}`);
    step5Outcome = 'success';
  }
} catch (err) {
  console.error(`         THREW after ${Date.now() - preflightStart}ms: ${err?.message || err}`);
  step5Outcome = 'thrown';
}

console.log('---');
if (step4Outcome === 'success' && step5Outcome === 'success') {
  console.log('RESULT: GREEN — both low-level and high-level preflight worked.');
  process.exit(0);
}
if (step4Outcome === 'success' && step5Outcome !== 'success') {
  console.error('RESULT: PARTIAL — low-level runCapability worked but high-level preflight did not.');
  console.error('        The bug is in the path-safety / channel-inbound-roots layer, not the provider.');
  process.exit(1);
}
console.error(`RESULT: RED — transcription path failed (step4=${step4Outcome}, step5=${step5Outcome}).`);
if (step4Reason) console.error(`        reason: ${step4Reason}`);
console.error('        If reason mentions "Content-Type isn\'t multipart/form-data":');
console.error('        known upstream bug openclaw/openclaw#63851 (fix pending in PR #64349).');
process.exit(1);
