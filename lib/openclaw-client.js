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
 * Typed error thrown when the LLM gateway rejects the call because the
 * caller's budget (LiteLLM virtual-key) is exhausted. Callers can catch
 * this specifically and surface a product-appropriate message instead of
 * the raw LiteLLM error text.
 */
class BudgetExceededError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'BudgetExceededError';
    this.code = 'budget_exceeded';
    this.details = details;
  }
}

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

  // Budget exhaustion can surface in two shapes depending on where it happens:
  //   (a) LiteLLM rejects before OpenClaw can forward — OpenClaw returns non-2xx
  //       with the raw LiteLLM body: {"error":{"type":"budget_exceeded",...}}
  //   (b) LiteLLM rejects during a mid-agent tool turn — OpenClaw may surface
  //       it as the assistant reply text "... Budget has been exceeded! ..."
  // Either way the caller probably wants to send an "upgrade your plan"
  // message, so we normalize to a dedicated error class.
  if (isBudgetExceededError(res.status, raw)) {
    throw new BudgetExceededError('LiteLLM virtual key budget exhausted', { status: res.status, body: raw });
  }

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

  // Mid-agent budget errors can show up embedded in the assistant content.
  if (isBudgetExceededError(200, content)) {
    throw new BudgetExceededError('LiteLLM virtual key budget exhausted', { status: 200, body: content });
  }
  return content;
}

function isBudgetExceededError(_status, body) {
  if (typeof body !== 'string' || !body) return false;
  if (body.includes('"type":"budget_exceeded"')) return true;
  if (/Budget has been exceeded/i.test(body)) return true;
  return false;
}

module.exports = { sendChat, DEFAULT_MODEL, DEFAULT_TIMEOUT_MS, BudgetExceededError };
