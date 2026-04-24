# WhatsApp (Kapso) + LiteLLM — implementation plan

> Companion to `2026-04-22-whatsapp-kapso-litellm-design.md`. Ordered steps with TDD checkpoints.

Each step ends with a commit. `npm test` must stay green across every commit. Rollback = revert the commit (all steps are additive except where noted).

## Step 0 — baseline (already done)

- Worktree at `.worktrees/kapso-integration` tracking `origin/staging`.
- `npm test` baseline: 516/516 pass.
- Design doc committed.

## Step 1 — `ChannelAdapter` interface

**Files:**
- `lib/channel-adapters/base.js` — JSDoc typedefs + a no-op base class, plus a tiny `validateEvent()` helper.
- `test/channel-adapters/base.test.js` — asserts typedef + helper shape.

**Approach:** Pure types + helper. No runtime dependencies. This sets the contract every future adapter (and the refactor of the current Telegram integration, if it ever happens) conforms to.

**Commit:** `feat(channels): add ChannelAdapter base interface and types`

## Step 2 — `WhatsAppKapsoAdapter.receive()`

**Files:**
- `lib/channel-adapters/whatsapp-kapso.js` — `receive()` only (throws on `send()` for now).
- `test/channel-adapters/whatsapp-kapso.receive.test.js` — fixtures from `Enriquefft/openclaw-kapso-whatsapp/internal/kapso/types.go` format.
- `test/fixtures/kapso-webhooks/` — JSON fixture files (text, audio-with-transcript, multi-event, outbound-echo, malformed).

**TDD order:**
1. parses text message from Kapso-native format
2. returns `InboundEvent[]` with `channelId='whatsapp-kapso'`, `from` in E.164, `messageId=message.id`, `timestamp` as ISO-8601
3. parses audio event with `kapso.transcript.text` surfaced as `text`
4. ignores events where `kapso.direction === 'outbound'` (echo of our own sends)
5. handles multi-event `data[]` arrays
6. throws on missing `data`, missing `message.from`, etc.

**Commit:** `feat(channels): implement WhatsAppKapsoAdapter.receive() with webhook parsing`

## Step 3 — `WhatsAppKapsoAdapter.send()` + Kapso API client

**Files:**
- `lib/channel-adapters/whatsapp-kapso.js` — `send()` implementation.
- `test/channel-adapters/whatsapp-kapso.send.test.js`.
- Uses `node:http`/`node:https` (no axios — we stay zero-dep in channel-adapters).

**TDD order:**
1. `send()` posts to `https://api.kapso.ai/meta/whatsapp/v24.0/{phone_number_id}/messages` with `X-API-Key` header
2. body schema matches Meta's whatsapp/v24 contract (`messaging_product`, `recipient_type`, `to`, `type`, `text.body`)
3. messages >4096 chars are split into multiple sends; each returns a messageId; the tuple is returned
4. non-2xx Kapso responses surface as thrown Errors with status + body
5. network errors thrown with actionable context

**Commit:** `feat(channels): implement WhatsAppKapsoAdapter.send() with Kapso API client`

## Step 4 — OpenClaw HTTP client

**Files:**
- `lib/openclaw-client.js`.
- `test/openclaw-client.test.js`.

**TDD order:**
1. `sendChat({ user, text })` posts to `{gatewayUrl}/v1/chat/completions` with `Authorization: Bearer <token>`
2. body uses `user` for session derivation, `model='openclaw/default'` default
3. parses `choices[0].message.content`
4. surfaces non-2xx as Error with gateway response body
5. timeout (45s default, configurable)

**Commit:** `feat(openclaw): add HTTP client for OpenAI-compatible chat completions`

## Step 5 — Pipeline worker

**Files:**
- `lib/channel-pipeline.js` — bounded queue + async drain loop, wiring `adapter.receive → openclaw.sendChat → adapter.send`.
- `test/channel-pipeline.test.js`.

**TDD order:**
1. `enqueue(event)` returns immediately; worker processes async
2. queue cap (64) drops oldest, logs warning
3. OpenClaw error does not kill worker; event logged and skipped
4. Kapso send error does not kill worker; logged
5. `stop()` drains in-flight, rejects new enqueues
6. idempotency: two events with the same `messageId` within a TTL are deduped

**Commit:** `feat(channels): add async pipeline worker with bounded queue and dedup`

## Step 6 — Public-server integration

**Files:**
- `lib/public-server.js` — extend to accept a `routes` param and handle `POST /channel/whatsapp` before the wizard-proxy fallback.
- `test/public-server.test.js` — new cases for the WhatsApp route.

**TDD order:**
1. `POST /channel/whatsapp` with valid body returns 200 immediately
2. pipeline is invoked with parsed events
3. `POST /channel/whatsapp` with invalid JSON returns 400
4. `POST /channel/whatsapp` when feature-flag disabled returns 404
5. body size >1MB returns 413
6. all other paths still work (wizard-proxy + static page unaffected)

**Commit:** `feat(public-server): add /channel/whatsapp route wiring pipeline`

## Step 7 — Supervisor wiring + feature flag

**Files:**
- `scripts/regen-openclaw-config.sh` — **no channel-related changes**; LLM config changes land in Step 8.
- `scripts/entrypoint.sh` — if `CHANNEL_ADAPTER_WHATSAPP_KAPSO_ENABLED=true`, pass `KAPSO_API_KEY` / `KAPSO_PHONE_NUMBER_ID` to the supervisor env.
- `lib/supervisor.js` — construct `WhatsAppKapsoAdapter` + pipeline at boot when enabled, hand it to `public-server` via `routes` param.
- `test/supervisor.test.js` — boot with the flag on, assert adapter is wired.

**Commit:** `feat(supervisor): wire WhatsApp-Kapso adapter behind CHANNEL_ADAPTER_WHATSAPP_KAPSO_ENABLED flag`

## Step 8 — LiteLLM side-car + config

**Files:**
- `docker-compose.yml` + `docker-compose.dev.yml` + `docker-compose.test.yml` — add `litellm` service.
- `litellm-config.yaml.template` — committed template; CLI substitutes env at install time.
- `scripts/regen-openclaw-config.sh` — when `LITELLM_ENABLED=true`, inject `LLM_API_BASE=http://litellm:4000` into OpenClaw's `env` map alongside the virtual key as `ANTHROPIC_API_KEY` (or provider-appropriate env var).
- `cli.js` — at `limbo install` / `limbo configure`, generate `litellm-config.yaml`, generate a `LITELLM_MASTER_KEY`, and (one-shot) call `/key/generate` to mint the instance's virtual key. Persist the virtual key to the `.env`.
- `test/cli-compose.test.js` — regression: generated compose includes litellm when flag set.
- `test/entrypoint.test.js` — regression: `LLM_API_BASE` + virtual key land in `openclaw.json` when enabled.

**Commit:** `feat(litellm): add side-car LiteLLM service and wire OpenClaw to it`

## Step 9 — Secrets wiring (Kapso)

**Files:**
- `cli.js` — on `limbo install` or a new `limbo connect-whatsapp` wizard, prompt for or read from `op` the Kapso API key + phone number id, write the key file to `~/.limbo/config/kapso_api_key` (chmod 600) and the phone-number id to the `.env`.
- `scripts/entrypoint.sh` — source `KAPSO_API_KEY` into the env (already handled by `.env` sourcing if we put it there; using a file lets us keep the naming convention consistent).
- `docs/setup/connect-whatsapp.md` — user-facing doc: how to get the Kapso number id, what scopes the API key needs, how to register the webhook endpoint.

**Decision point:** a full interactive wizard (like `limbo connect-calendar`) is overkill for MVP. A non-interactive `limbo configure --whatsapp-api-key-file … --phone-number-id …` is enough. The wizard can come later.

**Commit:** `feat(cli): add --whatsapp-api-key-file / --phone-number-id configure flags`

## Step 10 — E2E docker-compose test

**Files:**
- `evals/whatsapp-kapso/` — new E2E harness:
  - `docker-compose.whatsapp-test.yml` with three services: `limbo`, `litellm`, `mock-kapso` (a tiny Node server that exposes `POST /meta/whatsapp/v24.0/:id/messages` as a recorder + fires inbound webhooks on demand).
  - `run.sh` — builds, starts, sends a fake inbound, asserts the reply arrives at the mock's message endpoint within 30s.
  - `mock-llm.js` — deterministic echo server pointed at by LiteLLM instead of Anthropic, for zero-spend E2E.
- `test/e2e-harness.test.js` — runs `run.sh` in CI if `LIMBO_E2E=1`; otherwise skipped.

**Commit:** `test(e2e): add WhatsApp-Kapso + LiteLLM end-to-end harness`

## Step 11 — Documentation + CLAUDE.md

**Files:**
- `CLAUDE.md` — new "Channels" section explaining the adapter pattern + how to add a new channel.
- `ARCHITECTURE.md` — update the high-level flow diagram: Telegram box is replaced by "WhatsApp (via Kapso) → public-server → pipeline → OpenClaw" and a LiteLLM side-car appears.
- `README.md` — public-facing blurb updated.
- Vault note: `notes/limbo/limbo-channel-adapter-pattern.md` — describe the pattern + link to this plan.

**Commit:** `docs: document ChannelAdapter pattern, WhatsApp-Kapso, and LiteLLM side-car`

## Step 12 — PR + release + aios rollout

1. `git push origin feature/kapso-integration`
2. `gh pr create --base staging` — attach design + plan docs, mention the success criteria.
3. Wait for CI green.
4. Merge to staging. Auto-promote PR to main updates.
5. Bump locally: `npx release-it` (picks next CalVer patch or minor based on commits).
6. Merge the auto-promote PR to main.
7. `publish.yml` publishes the new version, dual-pushes image to ghcr.io + gitlab.
8. `ssh aios` → `limbo update`. Verify the new version is running.
9. `limbo cloud activate` if not already (must be on for Kapso webhook to reach the instance).
10. In the Kapso dashboard: add an `inbound_message` trigger pointing at `https://<id>.heylimbo.com/channel/whatsapp`.
11. Set Kapso API key + phone_number_id on `aios`: `limbo configure --whatsapp-api-key-file=<op-read-target> --phone-number-id=<from-kapso-dashboard>`.
12. Restart the container: `limbo restart`.
13. Send a WhatsApp message from Tomas' phone to the Kapso number. Validate reply arrives.

## Commits list (target)

```
chore: design — whatsapp-kapso + litellm
chore: implementation plan
feat(channels): add ChannelAdapter base interface and types
feat(channels): implement WhatsAppKapsoAdapter.receive() with webhook parsing
feat(channels): implement WhatsAppKapsoAdapter.send() with Kapso API client
feat(openclaw): add HTTP client for OpenAI-compatible chat completions
feat(channels): add async pipeline worker with bounded queue and dedup
feat(public-server): add /channel/whatsapp route wiring pipeline
feat(supervisor): wire WhatsApp-Kapso adapter behind feature flag
feat(litellm): add side-car LiteLLM service and wire OpenClaw to it
feat(cli): add --whatsapp-api-key-file / --phone-number-id configure flags
test(e2e): add WhatsApp-Kapso + LiteLLM end-to-end harness
docs: document ChannelAdapter pattern, WhatsApp-Kapso, and LiteLLM side-car
```

~13 commits, each self-contained and reverting cleanly. Aim: one PR, conventional commits so the release workflow derives the correct bump (`feat` = minor).

## Risk + rollback

- **`node --test` fails at any step** → fix before committing; never commit red.
- **E2E fails on `aios` after release** → `limbo update` to the previous version (images tagged by CalVer stay pullable); Kapso trigger reverts to off in the dashboard.
- **LiteLLM bug or memory spike** → disable it by flipping `LITELLM_ENABLED=false` in `.env`; OpenClaw falls back to direct Anthropic.
- **Kapso outage** → inbound is dead; nothing to do from our side.
- **`op` lookups fail locally** → the Kapso API key file already exists from the previous manual `op item create` step; we don't regenerate on every boot.
