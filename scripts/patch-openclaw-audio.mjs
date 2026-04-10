#!/usr/bin/env node
// Patches OpenClaw's `transcribeOpenAiCompatibleAudio` to serialize multipart
// bodies manually instead of relying on global FormData.
//
// Why: OpenClaw 2026.4.9 routes FormData through its guarded fetch dispatcher,
// which uses undici internally. Global FormData and undici's internal FormData
// live in different realms, so undici drops the multipart fields and never sets
// the Content-Type boundary header. Groq (and other OpenAI-compatible audio
// providers) then reject the request with HTTP 400.
//
// Upstream: https://github.com/openclaw/openclaw/issues/63851
// Fix PR:   https://github.com/openclaw/openclaw/pull/64349 (not yet merged)
//
// This script is run during the Docker build immediately after
// `npm install -g openclaw@...`. It is idempotent and fails loudly if:
//   - the openclaw install directory is missing
//   - no file under `dist/` contains the expected function signature
//   - the target string has already been replaced (treated as success)
//   - the target string doesn't match (openclaw changed shape → we need to
//     re-verify the patch against the new version before shipping)
//
// Remove this script and its Dockerfile step once upstream releases a version
// containing PR #64349.

import fs from 'node:fs';
import path from 'node:path';

const OPENCLAW_DIST = process.env.OPENCLAW_DIST_DIR ??
  '/usr/local/lib/node_modules/openclaw/dist';
const MARKER = 'LIMBO PATCH (openclaw#63851';
// Match the function *declaration*, not just references, so we find only the
// file containing the implementation body (not the extension shims that import
// the function by its transformed name).
const TARGET_DECLARATION = 'async function transcribeOpenAiCompatibleAudio(params)';

const ORIGINAL = `	const form = new FormData();
	const fileName = params.fileName?.trim() || path.basename(params.fileName) || "audio";
	const bytes = new Uint8Array(params.buffer);
	const blob = new Blob([bytes], { type: params.mime ?? "application/octet-stream" });
	form.append("file", blob, fileName);
	form.append("model", model);
	if (params.language?.trim()) form.append("language", params.language.trim());
	if (params.prompt?.trim()) form.append("prompt", params.prompt.trim());
	const { response: res, release } = await postTranscriptionRequest({
		url,
		headers,
		body: form,
		timeoutMs: params.timeoutMs,
		fetchFn,
		allowPrivateNetwork,
		dispatcherPolicy
	});`;

const REPLACEMENT = `	const fileName = params.fileName?.trim() || path.basename(params.fileName) || "audio";
	// LIMBO PATCH (openclaw#63851 / PR #64349): build multipart body manually
	// instead of using global FormData. The guarded fetch dispatcher drops FormData
	// fields when the body realm doesn't match undici's internal realm, which leaves
	// the Content-Type boundary header unset and causes HTTP 400 from Groq/OpenAI.
	const boundary = "----limbopatch" + Math.random().toString(36).slice(2) + Date.now().toString(36);
	const crlf = "\\r\\n";
	const encoder = new TextEncoder();
	const chunks = [];
	const pushText = (name, value) => {
		chunks.push(encoder.encode(
			"--" + boundary + crlf +
			"Content-Disposition: form-data; name=\\"" + name + "\\"" + crlf +
			crlf +
			value + crlf
		));
	};
	chunks.push(encoder.encode(
		"--" + boundary + crlf +
		"Content-Disposition: form-data; name=\\"file\\"; filename=\\"" + fileName + "\\"" + crlf +
		"Content-Type: " + (params.mime ?? "application/octet-stream") + crlf +
		crlf
	));
	chunks.push(new Uint8Array(params.buffer));
	chunks.push(encoder.encode(crlf));
	pushText("model", model);
	if (params.language?.trim()) pushText("language", params.language.trim());
	if (params.prompt?.trim()) pushText("prompt", params.prompt.trim());
	chunks.push(encoder.encode("--" + boundary + "--" + crlf));
	let totalLen = 0;
	for (const chunk of chunks) totalLen += chunk.byteLength;
	const body = new Uint8Array(totalLen);
	let offset = 0;
	for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
	headers.set("content-type", "multipart/form-data; boundary=" + boundary);
	headers.set("content-length", String(body.byteLength));
	const { response: res, release } = await postTranscriptionRequest({
		url,
		headers,
		body,
		timeoutMs: params.timeoutMs,
		fetchFn,
		allowPrivateNetwork,
		dispatcherPolicy
	});`;

function die(msg) {
  console.error(`patch-openclaw-audio: ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(OPENCLAW_DIST)) {
  die(`openclaw dist dir not found: ${OPENCLAW_DIST}`);
}

const files = fs.readdirSync(OPENCLAW_DIST)
  .filter((f) => f.startsWith('media-understanding-') && f.endsWith('.js'))
  .map((f) => path.join(OPENCLAW_DIST, f));

if (files.length === 0) {
  die(`no media-understanding-*.js files found in ${OPENCLAW_DIST}`);
}

let patched = 0;
let alreadyPatched = 0;
let inspected = 0;

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  if (!content.includes(TARGET_DECLARATION)) continue;
  inspected++;
  if (content.includes(MARKER)) {
    alreadyPatched++;
    console.log(`patch-openclaw-audio: already patched ${path.basename(file)}`);
    continue;
  }
  if (!content.includes(ORIGINAL)) {
    die(
      `target code not found in ${path.basename(file)}.\n` +
      `  The function declaration exists but its body no longer matches the\n` +
      `  expected shape. OpenClaw has probably been updated — re-verify the patch\n` +
      `  against the new version and update this script, or drop it if upstream\n` +
      `  PR #64349 has landed.`
    );
  }
  const patchedContent = content.replace(ORIGINAL, REPLACEMENT);
  if (patchedContent === content) {
    die(`string replacement was a no-op in ${path.basename(file)} — check ORIGINAL constant`);
  }
  fs.writeFileSync(file, patchedContent);
  patched++;
  console.log(`patch-openclaw-audio: patched ${path.basename(file)}`);
}

if (inspected === 0) {
  die(
    `no file under ${OPENCLAW_DIST} contained the declaration for\n` +
    `  ${TARGET_DECLARATION}.\n` +
    `  OpenClaw layout has changed. Update this script or drop the patch.`
  );
}

console.log(
  `patch-openclaw-audio: done (${patched} patched, ${alreadyPatched} already-patched, ${inspected} inspected)`
);
