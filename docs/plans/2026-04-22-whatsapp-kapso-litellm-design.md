# WhatsApp (Kapso) + LiteLLM — design

> Status: proposed. Target: first paying-usable WhatsApp conversation against Tomas' number on the `aios` VPS, with LiteLLM as the LLM gateway.

## Goal

Replace the deprecated Telegram input path with a WhatsApp channel delivered via [Kapso](https://kapso.ai). Route all LLM calls through a **self-hosted LiteLLM** side-car so the instance can talk to any provider behind virtual keys, budgets, and unified usage tracking.

Success criteria: Tomas sends a WhatsApp message from his phone to the Kapso number → the Limbo instance on `aios` processes it → the agent replies via WhatsApp. All LLM calls pass through LiteLLM.

## Non-goals (this iteration)

- Multi-tenant routing. Single-tenant only: one Kapso number → one container on `aios`. Router (Kapso Functions or Express) is Phase 2 territory.
- Telegram parity. Telegram is deprecated — no refactor, no migration.
- Proactive WhatsApp messages from crons/wakeup. Deferred until the inbound path is proven.
- Voice transcription, image analysis. Text-only first.
- Multi-number, custom numbers per tier, template message registration. Out of scope.

## Context

The current `limbo` container boots into a supervisor that hosts OpenClaw on `127.0.0.1:LIMBO_PORT` with native Telegram integration configured through `openclaw.json`. The only internet-facing surface is `lib/public-server.js` on port `:80`, which proxies to the wizard when active or serves a static page otherwise. This is the surface a Kapso webhook will hit.

OpenClaw exposes an OpenAI-compatible HTTP API at `/v1/chat/completions` with session persistence via the standard `user` field. That's the transport we use to hand an inbound WhatsApp message to the agent and get a reply back.

There is an existing reference implementation in Go ([`Enriquefft/openclaw-kapso-whatsapp`](https://github.com/Enriquefft/openclaw-kapso-whatsapp)) that validates this architecture end-to-end, but it uses WebSocket JSON-RPC and runs as a separate binary. We re-implement in Node, inside the Limbo container, to preserve single-binary delivery.

## Architecture

```
 User's WhatsApp
        │
        ▼
┌───────────────────────┐
│ Kapso (+ number)      │
│ trigger=inbound_message│ webhook
└──────────┬────────────┘
           │ POST /channel/whatsapp
           │ X-Kapso-Signature: <hmac>
           ▼
┌─────────────────────────────────────────────────┐
│ aios VPS                                        │
│ ┌─────────────────────────────────────────────┐ │
│ │ limbo container                             │ │
│ │                                             │ │
│ │ public-server.js (:80)                      │ │
│ │   /channel/whatsapp  ─▶ WhatsAppKapsoAdapter│ │
│ │       │                                     │ │
│ │       │ 200 ACK immediately                 │ │
│ │       │ (pipeline runs async)               │ │
│ │       ▼                                     │ │
│ │  ChannelAdapter.receive(payload)            │ │
│ │       → InboundEvent{from, text, messageId} │ │
│ │       │                                     │ │
│ │       ▼                                     │ │
│ │  OpenClaw gateway (:LIMBO_PORT)             │ │
│ │   POST /v1/chat/completions                 │ │
│ │   Authorization: Bearer ${GATEWAY_TOKEN}    │ │
│ │   body: { user: sender_phone,               │ │
│ │           messages: [{role:user, ...}] }    │ │
│ │       │                                     │ │
│ │       ▼                                     │ │
│ │  LLM call via LiteLLM (see below)           │ │
│ │       │                                     │ │
│ │       ▼                                     │ │
│ │  reply text                                 │ │
│ │       │                                     │ │
│ │       ▼                                     │ │
│ │  ChannelAdapter.send({to, text})            │ │
│ │       │                                     │ │
│ └───────┼─────────────────────────────────────┘ │
│         │                                       │
│ ┌───────┼─────────────────────────────────────┐ │
│ │ litellm side-car (:4000, loopback)          │ │
│ │   config.yaml: model_list, virtual keys     │ │
│ │   routes to Anthropic / OpenAI / …          │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
           │
           ▼ POST /<phone_number_id>/messages
┌────────────────────────┐
│ Kapso API              │
│ X-API-Key: ${KAPSO_API_KEY}│
└──────────┬─────────────┘
           │
           ▼
  User's WhatsApp (reply)
```

## Components

### 1. `ChannelAdapter` interface (`lib/channel-adapters/base.js`)

JSDoc-typed contract every adapter implements. Inbound normalization + outbound send + capability flags.

```js
/**
 * @typedef {Object} InboundEvent
 * @property {string}  channelId    — stable id ("whatsapp-kapso", "telegram", …)
 * @property {string}  from         — sender identifier in channel-native form (E.164 phone for WhatsApp)
 * @property {string=} fromName     — display name if channel provides one
 * @property {string}  messageId    — channel-native message id (for idempotency)
 * @property {string}  timestamp    — ISO-8601
 * @property {'text'|'audio'|'image'|'video'|'document'|'sticker'|'location'|'unknown'} type
 * @property {string=} text         — text payload when type='text' or transcript available
 * @property {string=} mediaUrl     — URL to fetch media when present
 * @property {Object=} raw          — original payload (for debugging / replay)
 */

/**
 * @typedef {Object} OutboundMessage
 * @property {string}  to           — recipient identifier
 * @property {string}  text         — message body
 * @property {string=} replyToId    — optional original message id to reply-to (thread context)
 */

/**
 * @typedef {Object} AdapterCapabilities
 * @property {boolean} supportsVoice         — inbound audio → transcript
 * @property {boolean} supportsProactive     — can send without an incoming thread
 * @property {number}  proactiveCostUSD      — approx cost per proactive send (0 if free)
 * @property {boolean} supportsMediaOut      — can attach images/audio in replies
 */

/**
 * @typedef {Object} ChannelAdapter
 * @property {string} id
 * @property {(rawPayload: unknown, headers: Record<string,string>) => Promise<InboundEvent[]>} receive
 * @property {(msg: OutboundMessage) => Promise<{ messageId: string }>} send
 * @property {() => AdapterCapabilities} capabilities
 */
```

`receive()` returns **an array** because a single Kapso webhook can contain multiple events in the `data[]` envelope. `receive()` is responsible for idempotency signal — callers dedup by `InboundEvent.messageId`.

### 2. `WhatsAppKapsoAdapter` (`lib/channel-adapters/whatsapp-kapso.js`)

Concrete implementation targeting the Kapso-native webhook format:

```json
{
  "type": "message.received",
  "data": [
    {
      "message": {
        "from": "+549111...",
        "id": "wamid.HBgM...",
        "timestamp": "1746822000",
        "type": "text",
        "text": { "body": "hola limbo" },
        "kapso": { "contact_name": "Tomas", "direction": "inbound", "status": "received" }
      },
      "conversation": { "id": "conv_..." },
      "phone_number_id": "15556665544"
    }
  ]
}
```

The adapter also handles audio events when `kapso.transcript` is present (server-side transcribed by Kapso), surfacing the transcript as `text`. Other media types (image, document, video, location) are accepted but only the `mediaUrl` + type surface — the agent decides how to respond.

Outbound uses the Kapso WhatsApp send endpoint:

```
POST https://api.kapso.ai/meta/whatsapp/v24.0/{phone_number_id}/messages
X-API-Key: ${KAPSO_API_KEY}
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "<E.164>",
  "type": "text",
  "text": { "body": "<reply>" }
}
```

Long replies (>4096 chars) are split into multiple messages (WhatsApp limit). Unicode is passed through as-is.

### 3. Public-server route (`lib/public-server.js`)

Adds a `POST /channel/whatsapp` handler **before** the wizard-proxy / static-page fallthrough. Handler logic:

1. Verify signature header (Kapso HMAC — if Kapso signs webhooks; otherwise skip and rely on Cloudflare Access / allowlist later).
2. Parse JSON body.
3. `adapter.receive(body, headers)` → `InboundEvent[]`.
4. For each event: push a job into an in-process queue (bounded, drop-oldest on overflow).
5. Reply `200 OK` with an empty body immediately. **Do not block on agent response** — Kapso webhook timeout is aggressive (~10s) and agent calls can take 5–30s.

A background worker drains the queue: for each event it calls OpenClaw, receives the reply, and calls `adapter.send()`. Failures are logged but not retried in MVP (re-delivery would be a Kapso responsibility — they retry the webhook if we return 5xx).

The route is gated on `CHANNEL_ADAPTER_WHATSAPP_KAPSO_ENABLED=true`. When disabled, return 404. This mirrors the pattern used for other feature toggles (`TELEGRAM_ENABLED`, `VOICE_ENABLED`, etc.).

### 4. OpenClaw client (`lib/openclaw-client.js`)

Thin Node client for the OpenAI-compatible endpoint:

```js
async function sendChat({ gatewayUrl, token, user, text, model = 'openclaw/default' }) {
  const res = await fetch(`${gatewayUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      user,                              // session derivation
      messages: [{ role: 'user', content: text }],
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`OpenClaw ${res.status}: ${await res.text()}`);
  const json = await res.json();
  return json.choices[0].message.content;
}
```

Session persistence: OpenClaw derives a stable session key from the `user` string. We pass the sender's phone number (E.164 with `+`) — conversations automatically thread per user. No state stored by the adapter.

### 5. LiteLLM side-car

New service in `docker-compose.yml`:

```yaml
services:
  litellm:
    image: ghcr.io/berriai/litellm:main-latest
    restart: unless-stopped
    ports:
      - "127.0.0.1:4000:4000"
    volumes:
      - ./litellm-config.yaml:/app/config.yaml:ro
      - ./config:/secrets:ro
    command: --config /app/config.yaml --port 4000
    environment:
      ANTHROPIC_API_KEY_FILE: /secrets/anthropic_api_key
      LITELLM_MASTER_KEY_FILE: /secrets/litellm_master_key
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:4000/health/readiness"]
      interval: 30s
      timeout: 5s
```

`litellm-config.yaml` (generated at install / `limbo configure` time from a template):

```yaml
model_list:
  - model_name: limbo-default
    litellm_params:
      model: anthropic/claude-sonnet-4-6
      api_key: os.environ/ANTHROPIC_API_KEY

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
  # virtual keys generated via /key/generate endpoint, stored in sqlite
  database_url: sqlite:///app/litellm.db
```

Limbo's `openclaw.json` points `ANTHROPIC_API_KEY`-style env vars at a LiteLLM **virtual key** instead of the real provider key, and `LLM_API_BASE` at `http://litellm:4000`. The real provider key lives only in the LiteLLM process environment.

For Phase 3 (pool host multi-tenant), LiteLLM moves to its own VM and each tenant gets its own virtual key with its own budget. Until then, a single virtual key is fine.

### 6. Secrets wiring

- `KAPSO_API_KEY` — source of truth: 1Password `limbo/kapso-api`. Materialized on install to `~/.limbo/config/kapso_api_key` (host) → bind-mounted read-only to the container → sourced by the entrypoint into the env. Same pattern as the existing Brave/Groq keys.
- `KAPSO_PHONE_NUMBER_ID` — not a secret; can live in `.env` directly.
- `ANTHROPIC_API_KEY` — the real one moves out of Limbo's env and into LiteLLM's env. Limbo never sees it once LiteLLM is in the mix.
- `LITELLM_MASTER_KEY` — random 64-char token, generated at install time. Never rotated except by user.
- Virtual keys — generated via LiteLLM `/key/generate`, one per tenant in the future. Today: one for the whole instance, stored in LiteLLM's sqlite.

## Flow: inbound message

1. Kapso POSTs `{type, data: [{message, phone_number_id, conversation?}]}` to `https://<instance>.heylimbo.com/channel/whatsapp`.
2. Cloudflare terminates TLS, forwards to public-server on port 80.
3. Public-server validates signature (optional MVP), parses JSON.
4. `WhatsAppKapsoAdapter.receive()` normalizes to `InboundEvent[]`.
5. ACK 200 to Kapso.
6. Worker drains queue: `OpenClawClient.sendChat({ user: event.from, text: event.text })`.
7. OpenClaw calls LiteLLM (`POST http://litellm:4000/v1/chat/completions`).
8. LiteLLM calls Anthropic.
9. Reply flows back. Adapter posts to Kapso API.
10. Kapso delivers the WhatsApp message to the user.

Happy-path latency: ACK is <50ms. User-visible reply latency is dominated by the LLM call (2–10s).

## Flow: errors

- **Signature invalid** → 401, no event processed, log. (MVP: may skip signature check if Kapso doesn't sign or if we can't reliably test the shared secret.)
- **JSON parse failure** → 400, log, no event processed.
- **Event queue full** → drop oldest, log warning. (MVP queue size: 64.)
- **OpenClaw unreachable** → log, no Kapso send; Kapso does not re-deliver because we already ACK'd. For MVP this is acceptable; future hardening can persist the queue or hold the webhook until the pipeline settles.
- **Kapso send fails** → log + expose as a metric. No user-visible fallback in MVP.

## Testing strategy

Unit tests (TDD, `test/channel-adapters/`):

- `whatsapp-kapso.test.js`:
  - parses text message from Kapso-native format
  - parses audio message with Kapso transcript
  - handles multi-event `data[]` arrays
  - ignores outbound echo events (`kapso.direction === 'outbound'`)
  - throws on malformed payloads (no `data`, missing `message.from`, etc.)
  - `send()` builds correct body + headers for text
  - `send()` splits messages >4096 chars into multiple sends
  - `send()` surfaces non-2xx Kapso responses as errors

- `public-server.test.js` (extends existing file):
  - `POST /channel/whatsapp` returns 200 immediately, invokes adapter+pipeline async
  - returns 404 when feature flag disabled
  - returns 400 on invalid JSON
  - handles multiple concurrent requests without cross-talk

- `openclaw-client.test.js`:
  - sends correct body to `/v1/chat/completions`
  - carries auth header
  - handles SSE vs JSON responses correctly (JSON only in MVP)
  - surfaces non-2xx gateway errors

Integration (docker-compose.test.yml):

- Stub Kapso server on a loopback port, have the container POST back to it for outbound.
- Stub LLM provider (echo server) behind LiteLLM to avoid real spend in E2E runs.
- End-to-end: POST a Kapso-shaped webhook at the container's `:80`, assert stub Kapso received the reply within a timeout.

## Security

- The public server is still the only internet-facing surface. Kapso webhook adds one public route — `POST /channel/whatsapp`. All other routes continue to be wizard-proxy or static-page.
- Signature verification (HMAC on Kapso's shared secret) is a must-have once we confirm Kapso actually signs webhooks; documented as an open question below. Until verified, traffic is authorized by "nobody else knows this URL" which is insufficient for prod but acceptable for Tomas-only E2E.
- `KAPSO_API_KEY` never leaves the container's env. Adapter code reads it from `process.env` only, never logs it.
- LiteLLM listens on loopback only (`127.0.0.1:4000`). No external exposure.
- Rate limiting: relying on Kapso's upstream rate limits for MVP. Local per-sender limits are a follow-up.

## Open questions (resolve during implementation)

1. Does Kapso sign webhooks? If yes, with what header + algorithm? (Check skills docs / Kapso dashboard settings.)
2. What's the maximum payload size Kapso sends? (Set a body-size limit on public-server.)
3. Does LiteLLM's sqlite handle the virtual-key persistence reliably in a container restart scenario without corrupting on OOM? (Test.)
4. Should outbound messages from the agent use the Kapso "reply-to" (`context.message_id`) feature to thread? (Nice to have, not MVP.)

## References

- [OpenClaw OpenAI-compat API](https://docs.openclaw.ai/gateway/openai-http-api)
- [Kapso webhook payloads — reference in Go](https://github.com/Enriquefft/openclaw-kapso-whatsapp/blob/main/internal/kapso/types.go)
- [Kapso API — send message](https://github.com/Enriquefft/openclaw-kapso-whatsapp/blob/main/internal/kapso/client.go)
- [LiteLLM self-hosted](https://docs.litellm.ai/docs/proxy/quick_start)
- Vault: [[limbo-official-launch-phase-plan]], [[limbo-central-gateway-proxy-for-channel-sharing]]
