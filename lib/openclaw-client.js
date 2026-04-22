'use strict';

/**
 * OpenClaw HTTP client — OpenAI-compatible chat completions.
 *
 * Used by the channel pipeline to hand an inbound user message to the agent
 * and retrieve a reply. Session continuity comes from the OpenAI `user` field;
 * the gateway derives a stable session key from it per request.
 *
 * Zero external deps — built on Node 22's native `fetch` and AbortSignal.
 */

const DEFAULT_MODEL = 'openclaw/default';
// Agentic responses can take up to a couple of minutes when the agent chains
// multiple MCP tool calls (vault search, file read, etc.) before replying.
// Webhook-driven callers should configure their own timeout if they need
// tighter SLAs; here we pick a ceiling generous enough for normal agent work.
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Send a single user message to OpenClaw and return the assistant reply text.
 *
 * @param {Object} opts
 * @param {string} opts.gatewayUrl — e.g. `http://127.0.0.1:18789`
 * @param {string} opts.token      — bearer token (Limbo's GATEWAY_TOKEN)
 * @param {string} opts.user       — stable user id (phone E.164) for session derivation
 * @param {string} opts.text       — message content
 * @param {string} [opts.model]    — defaults to 'openclaw/default'
 * @param {number} [opts.timeoutMs] — per-request timeout (ms), default 45000
 * @returns {Promise<string>} — the assistant's reply content
 */
async function sendChat(opts) {
  if (!opts || typeof opts !== 'object') {
    throw new Error('openclaw-client: opts object required');
  }
  if (typeof opts.gatewayUrl !== 'string' || !opts.gatewayUrl) {
    throw new Error('openclaw-client: gatewayUrl is required');
  }
  if (typeof opts.token !== 'string' || !opts.token) {
    throw new Error('openclaw-client: token is required');
  }
  if (typeof opts.user !== 'string' || !opts.user) {
    throw new Error('openclaw-client: user is required');
  }
  if (typeof opts.text !== 'string' || !opts.text) {
    throw new Error('openclaw-client: text is required');
  }

  const model = opts.model || DEFAULT_MODEL;
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;

  const url = opts.gatewayUrl.replace(/\/+$/, '') + '/v1/chat/completions';
  const body = {
    model,
    user: opts.user,
    messages: [{ role: 'user', content: opts.text }],
    stream: false,
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // AbortError → timeout; everything else → network failure. Keep the
    // cause but give a recognizable prefix so callers can grep logs.
    const name = err && err.name ? err.name : 'Error';
    throw new Error(`openclaw-client: request failed (${name}): ${err && err.message ? err.message : err}`);
  }

  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`openclaw-client: gateway ${res.status} — ${raw}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`openclaw-client: non-JSON response from gateway: ${raw}`);
  }

  const content = parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content;
  if (typeof content !== 'string' || !content) {
    throw new Error(`openclaw-client: response missing choices[0].message.content: ${raw}`);
  }
  return content;
}

module.exports = { sendChat, DEFAULT_MODEL, DEFAULT_TIMEOUT_MS };
