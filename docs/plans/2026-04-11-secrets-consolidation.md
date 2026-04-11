# Secrets Consolidation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the `secrets/` directories entirely. Store all tokens in `~/.limbo/config/.env`. Migrate legacy secrets from zeroclaw-state/.limbo-secrets into the .env automatically. Add pre-write backup of .env. Fix container write permissions for /data/config.

**Architecture:** One source of truth (`.env`). No Docker secrets feature. Entrypoint sources `.env` directly, no `read_secret()` function. Migration runs idempotently on every `limbo start` / `update`, per-file, not per-dir-empty. CONFIG_DIR is world-writable (0777) so uid 999 in the container can write `setup_token` next to the host-owned `.env`.

**Tech Stack:** Node.js (CLI + setup-server), bash (entrypoint), node --test (unit tests).

---

## Scope of changes

**Files to modify:**
- `cli.js` — remove SECRETS_DIR, writeSecretFile, readSecretFile, writeSecrets. Add migrateLegacySecretsToEnv, backup writer. Change writeEnv to include secret keys. Remove secrets blocks from compose generators. Update ensureComposeFile to drop secret placeholder creation and use 0777 for config dir.
- `setup-server/server.js` — remove SECRETS_DIR/writeSecretFile/readSecretFile. Write all tokens to .env directly. Use 0666 when writing .env (so host CLI can overwrite later).
- `scripts/entrypoint.sh` — remove `read_secret()`, remove the `cp /run/secrets/* → $OC_SECRETS/*` loop, remove OC_SECRETS mkdir. Source .env directly. Remove Docker secrets dependency.
- `docker-compose.yml` (committed reference) — drop `secrets:` block, drop container `secrets:` list.
- `docker-compose.test.yml` — drop `secrets:` block.
- `docker-compose.dev.yml` — verify state.
- `evals/docker-compose.eval.yml` — drop `secrets:` block.
- `test/cli-compose.test.js` — update tests to reflect new compose shape.
- `test/entrypoint.test.js` — update `readSecret` tests, remove secret-file fallback tests.
- `test/openclaw-migration.test.js` — may need tweaks if it covers secret migration.
- `test/setup-server.test.js` — update to expect secrets in .env, not in secrets files.

**New test file:**
- `test/cli-secrets-consolidation.test.js` — migrateLegacySecretsToEnv, .env.bak, dir perms.

---

## Task 1: Red tests — new test file for secrets consolidation

**Files:**
- Create: `test/cli-secrets-consolidation.test.js`

**Step 1: Write failing tests**

Create a new test file covering the new behavior. The tests extract the target functions from cli.js source and execute them in isolation using `--home` overrides. Minimum coverage:

1. **migrateLegacySecretsToEnv** migrates tokens from `~/.limbo/secrets/` to `.env`
2. **migrateLegacySecretsToEnv** migrates tokens from `~/.limbo/zeroclaw-state/secrets/` to `.env`
3. **migrateLegacySecretsToEnv** prefers `~/.limbo/secrets/` over `zeroclaw-state/secrets/` (newer path wins)
4. **migrateLegacySecretsToEnv** does NOT overwrite a value already present in `.env`
5. **migrateLegacySecretsToEnv** is idempotent (second call is a no-op)
6. **migrateLegacySecretsToEnv** handles missing source dirs gracefully
7. **writeEnv** creates `.env.bak` from the existing file before writing
8. **writeEnv** skips backup when no prior `.env` exists (no `.env.bak` created)
9. **writeEnv** overwrites an existing `.env.bak` on next write
10. **ensureComposeFile** creates `CONFIG_DIR` with mode 0777
11. **ensureComposeFile** does NOT create `~/.limbo/secrets/` anymore
12. **composeContent** output does NOT include a `secrets:` top-level block
13. **composeContent** output does NOT include a `secrets:` list under the `limbo` service
14. **SECRETS_DIR** is not a symbol in cli.js source
15. **writeSecretFile** is not a symbol in cli.js source
16. **readSecretFile** is not a symbol in cli.js source

**Step 2: Run tests, expect RED**

```bash
node --test test/cli-secrets-consolidation.test.js 2>&1 | tail -30
```

Expected: all tests fail (migrateLegacySecretsToEnv doesn't exist, SECRETS_DIR still in source, etc.)

**Step 3: Commit red tests**

```bash
git add test/cli-secrets-consolidation.test.js
git commit -m "test: add red tests for secrets consolidation"
```

---

## Task 2: CLI refactor — writeEnv includes secrets, backup pre-write

**Files:**
- Modify: `cli.js` (normalizeConfig, writeEnv, SECRET_KEYS removal, ensureComposeFile, compose generators)

**Step 1: Delete secret file helpers**

Remove from `cli.js`:
- `SECRETS_DIR` const (line 27)
- `writeSecretFile` function (line 777)
- `writeSecrets` function (line 786)
- `readSecretFile` function (line 1145)
- `SECRET_KEYS` Set (line 795)

**Step 2: Rewrite writeEnv to include all config**

```javascript
function writeEnv(cfg, existingEnv = {}) {
  const normalized = normalizeConfig(cfg, existingEnv);
  const content = Object.entries(normalized)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n') + '\n';
  // Backup existing .env before overwriting (idempotent — single-slot rotation)
  if (fs.existsSync(ENV_FILE)) {
    try { fs.copyFileSync(ENV_FILE, ENV_FILE + '.bak'); } catch { /* best effort */ }
  }
  fs.writeFileSync(ENV_FILE, content, { mode: 0o666 });
}
```

**Step 3: Extend normalizeConfig to include groq/brave tokens**

Update `normalizeConfig` so the returned object has `GROQ_API_KEY` and `BRAVE_API_KEY` fields (read from cfg with fallback to existingEnv).

**Step 4: Update ensureGatewayToken / writeMinimalEnv / feature toggle handler**

- `ensureGatewayToken` now reads/writes `GATEWAY_TOKEN` from the env object, no secret file.
- `writeMinimalEnv` no longer calls `writeSecretFile('gateway_token', ...)` — the token is already in `content`.
- Feature toggle handler (L2222+): set `existingEnv.GROQ_API_KEY`/`BRAVE_API_KEY` directly and write via writeEnv.

**Step 5: Update ensureComposeFile**

- Remove the `fs.mkdirSync(SECRETS_DIR, ...)` line.
- Remove the secret placeholder file loop.
- Change `CONFIG_DIR` creation mode from default to `0o777`.
- Change the `.env` creation fallback (`if (!fs.existsSync(ENV_FILE))`) to use `mode: 0o666`.

**Step 6: Remove secrets blocks from compose generators**

In `composeContent()` and `composeContentHardened()`:
- Remove the `secrets:` list under `limbo` service.
- Remove the top-level `secrets:` block.

**Step 7: Run relevant tests, expect some passes**

```bash
node --test test/cli-secrets-consolidation.test.js test/cli-compose.test.js 2>&1 | tail -30
```

Existing compose tests might fail because they assert on the secrets block — update them in Task 3 below.

**Step 8: Commit**

```bash
git add cli.js
git commit -m "refactor(cli): consolidate secrets into .env with pre-write backup"
```

---

## Task 3: Fix existing compose tests

**Files:**
- Modify: `test/cli-compose.test.js`

**Step 1: Update assertions**

Find tests that check for `secrets:` presence or secret list items. Flip them to assert **absence**. Add a test that asserts `env_file:` is still present.

**Step 2: Run**

```bash
node --test test/cli-compose.test.js
```

Expected: all green.

**Step 3: Commit**

```bash
git add test/cli-compose.test.js
git commit -m "test(compose): assert secrets blocks removed"
```

---

## Task 4: Setup-server refactor — write secrets into .env

**Files:**
- Modify: `setup-server/server.js`
- Modify: `test/setup-server.test.js`

**Step 1: Delete secret helpers**

Remove:
- `SECRETS_DIR` const
- `writeSecretFile`
- `readSecretFile`
- `ensureGatewayToken` currently reads/writes secret file — rewrite to read/write the env (or to a simple in-memory cached value written later).

**Step 2: Write all tokens to .env**

In the main POST handler, instead of calling `writeSecretFile('llm_api_key', ...)` etc., build the `envVars` object with:
- `LLM_API_KEY: data.apiKey || ''`
- `TELEGRAM_BOT_TOKEN: telegram.botToken || ''`
- `GROQ_API_KEY: features.voice?.apiKey || ''`
- `BRAVE_API_KEY: features.webSearch?.apiKey || ''`
- `GATEWAY_TOKEN: ensureGatewayToken()` — generates/caches in memory, written as part of envVars

Write the final `.env` with `mode: 0o666` (so the host CLI can overwrite later).

**Step 3: Update setup-server tests**

Any test that checks for secrets file writes — flip to check for env content.

**Step 4: Run**

```bash
node --test test/setup-server.test.js
```

**Step 5: Commit**

```bash
git add setup-server/server.js test/setup-server.test.js
git commit -m "refactor(setup-server): write tokens to .env instead of secrets files"
```

---

## Task 5: Entrypoint refactor — remove read_secret and cp loop

**Files:**
- Modify: `scripts/entrypoint.sh`
- Modify: `test/entrypoint.test.js`

**Step 1: Remove read_secret()**

Delete the `read_secret()` function (L21-31). Delete its callers:
- `_secret_llm`, `_secret_telegram` variables (L35-36)
- `_secret_gateway` (L304)
- `_secret_groq` (L359)
- `_secret_brave` (L380)

Replace each with direct env var usage — they're already sourced from `/data/config/.env` later. Just move the sourcing earlier if needed.

**Step 2: Remove secrets copy loop**

Delete L176-187 entirely (`OC_SECRETS=...`, `mkdir -p "$OC_SECRETS"`, the for loop).

**Step 3: Source .env earlier**

Make sure `set -a; . /data/config/.env; set +a` runs BEFORE any token access so that `LLM_API_KEY`, `TELEGRAM_BOT_TOKEN`, etc. are in the environment.

**Step 4: Update entrypoint tests**

In `test/entrypoint.test.js`, the `readSecret` helper and its tests are now obsolete. Remove them. Add tests that verify:
- Sourcing `.env` into the environment makes `LLM_API_KEY` available.
- Missing `.env` → setup mode.

**Step 5: Run**

```bash
node --test test/entrypoint.test.js
```

**Step 6: Commit**

```bash
git add scripts/entrypoint.sh test/entrypoint.test.js
git commit -m "refactor(entrypoint): remove read_secret fallback and secrets copy"
```

---

## Task 6: Migration function — zeroclaw-state/secrets → .env

**Files:**
- Modify: `cli.js` (new function, call from ensureComposeFile)

**Step 1: Write function**

```javascript
// Legacy secret paths from pre-consolidation installs.
// Migrates tokens from these files into .env, idempotent.
// Newer path (~/.limbo/secrets) takes precedence over older (~/.limbo/zeroclaw-state/secrets).
// Removable once all production instances are migrated (track via telemetry / release notes).
function migrateLegacySecretsToEnv() {
  const SECRET_TO_ENV = {
    llm_api_key: 'LLM_API_KEY',
    telegram_bot_token: 'TELEGRAM_BOT_TOKEN',
    gateway_token: 'GATEWAY_TOKEN',
    groq_api_key: 'GROQ_API_KEY',
    brave_api_key: 'BRAVE_API_KEY',
  };
  const legacyDirs = [
    path.join(LIMBO_DIR, 'secrets'),                            // newer legacy path
    path.join(LIMBO_DIR, 'zeroclaw-state', 'secrets'),           // older legacy path
    path.join(LIMBO_DIR, 'openclaw-state', 'secrets'),           // sibling path used by setup-server
  ];

  const existingEnv = parseEnvFile();
  let changed = false;

  for (const [secretName, envKey] of Object.entries(SECRET_TO_ENV)) {
    if (existingEnv[envKey]) continue; // don't overwrite
    for (const dir of legacyDirs) {
      const fp = path.join(dir, secretName);
      try {
        const value = fs.readFileSync(fp, 'utf8').trim();
        if (value) {
          existingEnv[envKey] = value;
          changed = true;
          break;
        }
      } catch { /* file doesn't exist or unreadable — try next */ }
    }
  }

  if (changed) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o777 });
    const content = Object.entries(existingEnv)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n') + '\n';
    if (fs.existsSync(ENV_FILE)) {
      try { fs.copyFileSync(ENV_FILE, ENV_FILE + '.bak'); } catch { /* best effort */ }
    }
    fs.writeFileSync(ENV_FILE, content, { mode: 0o666 });
    log('Migrated legacy secrets to .env');
  }
}
```

**Step 2: Call from ensureComposeFile**

After `migrateLegacyState()`, call `migrateLegacySecretsToEnv()`.

**Step 3: Run migration tests**

```bash
node --test test/cli-secrets-consolidation.test.js
```

Expected: migration tests pass.

**Step 4: Commit**

```bash
git add cli.js
git commit -m "feat(cli): migrate legacy secret files into .env on every start"
```

---

## Task 7: Update committed compose files

**Files:**
- Modify: `docker-compose.yml`
- Modify: `docker-compose.test.yml`
- Modify: `docker-compose.dev.yml` (if needed)
- Modify: `evals/docker-compose.eval.yml`

**Step 1: Strip secrets blocks**

From each file:
- Remove the `secrets:` list under the `limbo` service.
- Remove the top-level `secrets:` block at the bottom.

Leave `env_file:` intact.

**Step 2: Run all tests**

```bash
npm test 2>&1 | tail -20
```

Expected: all green.

**Step 3: Commit**

```bash
git add docker-compose*.yml evals/docker-compose.eval.yml
git commit -m "chore(compose): remove secrets blocks from committed compose files"
```

---

## Task 8: Verify end-to-end

**Step 1: Run full test suite**

```bash
npm test 2>&1 | tail -30
```

Expected: all green, same count or higher than baseline (76 tests).

**Step 2: Manual sanity check — grep for ghosts**

```bash
grep -rn 'SECRETS_DIR\|writeSecretFile\|readSecretFile\|/run/secrets' cli.js setup-server/ scripts/ test/
```

Expected: no matches in `cli.js` or `setup-server/server.js`. May still appear in tests if they validate absence.

**Step 3: Syntax check**

```bash
node --check cli.js
node --check setup-server/server.js
sh -n scripts/entrypoint.sh
```

All should exit 0.

**Step 4: Run tests one more time**

```bash
npm test
```

---

## Done criteria

- [ ] All unit tests green (≥76, at least the same count as baseline)
- [ ] `cli.js` has no references to SECRETS_DIR, writeSecretFile, readSecretFile
- [ ] `setup-server/server.js` writes all tokens to `.env`
- [ ] `scripts/entrypoint.sh` has no `read_secret()` or `cp /run/secrets` loop
- [ ] All committed compose files have no `secrets:` blocks
- [ ] `migrateLegacySecretsToEnv` is idempotent and per-file
- [ ] `writeEnv` creates `.env.bak` before overwriting
- [ ] `CONFIG_DIR` created with 0777, `.env` written with 0666
- [ ] `.env` field order in writeEnv preserves backward compat (existing tests still pass)

## Known risks / non-goals

- **Rollback of the migration:** the legacy files are left in place; a user can manually restore from them or from `.env.bak` if something goes wrong.
- **Perms trade-off:** `0666` on `.env` and `0777` on `config/` are permissive. Justified because `~/.limbo/` lives in the user's home (typically 0755 or 0700 at the home root), so world-writable at the subdirectory level does not expose to other system users any more than the home root already does.
- **Google Calendar secrets** (`google_client_id`, `google_client_secret`) are handled by the setup-server and stored as runtime env vars today (not in the main flow). The migration does NOT touch those — they stay out of scope.

## Post-review addendum

Code review surfaced findings not covered by the original plan. Fixes applied in the same MR by a team of four parallel agents:

**Critical:**

- **C1** — `setup-server/server.js` `handleConfigure` full-setup branch rebuilt `envVars` from scratch, clobbering `TELEGRAM_CHAT_ID` written earlier by `handleTelegramPair` (step-6 wizard). Fix: spread `existingEnv` first in the else branch, matching `SWITCH_BRAIN_MODE`/`CONNECT_CALENDAR_MODE`. Regression test added in `test/setup-server.test.js`.
- **C2** — Seven call sites in `cli.js` still wrote `.env` with `mode: 0o600` (`persistEnvVars`, `cmdStart` reconfigure + cleanup, `cmdSwitchBrain` write + cleanup, `cmdConnectCalendar` write + cleanup). This would lock out the container uid 999 from rewriting the file after any reconfigure. Fix: extracted `safeWriteEnvFile(content)` helper (mkdir 0o777 + backup + write 0o666 + chmod 0o666) and funneled every writer through it. Exactly one `fs.writeFileSync(ENV_FILE,...)` now remains in cli.js, inside the helper. Guarded by a single-call-site invariant test.
- **C3** — `evals/promptfoo/audio-provider.js` still read `/home/limbo/.openclaw/secrets/groq_api_key` from inside the eval container. Fix: replaced the file read with `docker exec <container> printenv GROQ_API_KEY` (the entrypoint sources `.env` with `set -a` so the var is always exported).
- **C4** — `migrateLegacySecretsToEnv` map only covered 5 secrets. Users upgrading with Google Calendar or mid-wizard Telegram pairing would lose `google_client_id`, `google_client_secret`, and `telegram_chat_id`. Fix: added all three to the `SECRET_TO_ENV` map. New tests cover each.

**Important:**

- **I1** — `entrypoint.sh` SETUP_MODE detection used `[ -z "${MODEL_PROVIDER:-}" ]` after the script sourced `.env` at the top. If `SWITCH_BRAIN_MODE` sed-stripped `MODEL_PROVIDER=` from the file, the in-memory var was still set — latent trap. Fix: re-grep the file with `grep -q '^MODEL_PROVIDER=' /data/config/.env`. Guard test added.
- **I2** — Two lying comments: `setup-server/server.js:228` said Google Calendar client credentials are read from secrets; `evals/.env.eval:2` said tokens come from the host's secrets dir. Both updated to reflect the new `.env`-only flow.
- **I3** — E2E state migration was undocumented. New section added to `handoff.md` (post-review migration steps) and a note in `CLAUDE.md` Local Development pointing at `/tmp/limbo-e2e-test/config/.env` (new path) with the one-shot `mv` command.
- **I4** — `writeMinimalEnv` wrote a 3-line `.env` from scratch, which would clobber any `LLM_API_KEY` / `TELEGRAM_BOT_TOKEN` that `migrateLegacySecretsToEnv` had just populated on a legacy upgrade path. Fix: merge-based — read existing .env, set only `CLI_LANGUAGE`/`LIMBO_PORT`/`GATEWAY_TOKEN`, preserve everything else.
- **I5** — Test gap for `cmdSwitchBrain`/`cmdConnectCalendar`/post-wizard cleanup paths (the exact call sites with `0o600`) and the pair-then-configure wizard flow. Tests added for all of these.
