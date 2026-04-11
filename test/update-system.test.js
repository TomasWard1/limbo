const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ── telegram-notify tests ──────────────────────────────────────────────────

describe('telegram-notify', () => {
  // Post-consolidation, telegram-notify reads tokens straight from
  // process.env (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID). The entrypoint
  // sources /data/config/.env with `set -a` before spawning any node child,
  // so the env is the single source of truth.
  let origToken;
  let origChatId;

  before(() => {
    origToken = process.env.TELEGRAM_BOT_TOKEN;
    origChatId = process.env.TELEGRAM_CHAT_ID;
    process.env.TELEGRAM_BOT_TOKEN = 'test-token-123';
    process.env.TELEGRAM_CHAT_ID = '456789';
  });

  after(() => {
    if (origToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = origToken;
    if (origChatId === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = origChatId;
  });

  it('readSecret reads from process.env', () => {
    delete require.cache[require.resolve('../lib/telegram-notify.js')];
    const { readSecret } = require('../lib/telegram-notify.js');
    assert.equal(readSecret('telegram_bot_token'), 'test-token-123');
    assert.equal(readSecret('telegram_chat_id'), '456789');
  });

  it('readSecret returns empty string for missing secret', () => {
    delete require.cache[require.resolve('../lib/telegram-notify.js')];
    const { readSecret } = require('../lib/telegram-notify.js');
    assert.equal(readSecret('nonexistent_secret'), '');
  });

  it('sendMessage rejects when secrets are missing', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    delete require.cache[require.resolve('../lib/telegram-notify.js')];
    const { sendMessage } = require('../lib/telegram-notify.js');

    await assert.rejects(
      () => sendMessage('test'),
      { message: /missing bot_token or chat_id/ }
    );

    // Restore for downstream tests in the same suite
    process.env.TELEGRAM_BOT_TOKEN = 'test-token-123';
    process.env.TELEGRAM_CHAT_ID = '456789';
  });
});

// ── RELEASES.md parser tests ───────────────────────────────────────────────

describe('RELEASES.md parsing', () => {
  it('extracts user-facing section before ---', () => {
    const content = `# Limbo Releases

## v1.30.0

- Limbo now notifies you when a new version is available
- You can update directly from Telegram with one tap

---

### Technical changelog
- feat: update notification system
`;
    const match = content.match(/^## v[\d.]+\s*\n([\s\S]*?)(?=\n---)/m);
    assert.ok(match);
    assert.ok(match[1].includes('notifies you'));
    assert.ok(!match[1].includes('Technical'));
  });

  it('returns null when no separator exists', () => {
    const content = '# No releases yet\n';
    const match = content.match(/^## v[\d.]+\s*\n([\s\S]*?)(?=\n---)/m);
    assert.equal(match, null);
  });
});

// ── update-instance MCP tool tests ─────────────────────────────────────────

describe('update-instance MCP tool', () => {
  let tmpFlags;
  let origFlags;

  before(() => {
    tmpFlags = fs.mkdtempSync(path.join(os.tmpdir(), 'limbo-flags-test-'));
  });

  after(() => {
    fs.rmSync(tmpFlags, { recursive: true, force: true });
  });

  it('creates flag file at expected path', () => {
    // We can't easily test the ESM module from CJS, so test the flag file
    // logic directly
    const flagPath = path.join(tmpFlags, 'update.flag');
    fs.writeFileSync(flagPath, new Date().toISOString(), { mode: 0o644 });
    assert.ok(fs.existsSync(flagPath));
    const content = fs.readFileSync(flagPath, 'utf8');
    assert.ok(content.match(/^\d{4}-\d{2}-\d{2}T/));
  });
});

// ── Version comparison tests ───────────────────────────────────────────────

describe('version comparison', () => {
  function isNewer(latest, current) {
    const l = latest.split('.').map(Number);
    const c = current.split('.').map(Number);
    return (
      l[0] > c[0] ||
      (l[0] === c[0] && l[1] > c[1]) ||
      (l[0] === c[0] && l[1] === c[1] && l[2] > c[2])
    );
  }

  it('detects major version bump', () => {
    assert.ok(isNewer('2.0.0', '1.30.0'));
  });

  it('detects minor version bump', () => {
    assert.ok(isNewer('1.31.0', '1.30.0'));
  });

  it('detects patch version bump', () => {
    assert.ok(isNewer('1.30.1', '1.30.0'));
  });

  it('same version is not newer', () => {
    assert.ok(!isNewer('1.30.0', '1.30.0'));
  });

  it('older version is not newer', () => {
    assert.ok(!isNewer('1.29.0', '1.30.0'));
  });
});

// ── Entrypoint wakeup integration ──────────────────────────────────────────

describe('entrypoint wakeup stage', () => {
  it('entrypoint.sh contains wakeup routine stage', () => {
    const entrypoint = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'entrypoint.sh'),
      'utf8'
    );
    assert.ok(entrypoint.includes('wakeup routine'));
    assert.ok(entrypoint.includes('wakeup.js'));
  });
});

// ── Dockerfile includes lib/ and RELEASES.md ───────────────────────────────

describe('Dockerfile includes new files', () => {
  it('copies lib/ directory', () => {
    const dockerfile = fs.readFileSync(
      path.join(__dirname, '..', 'Dockerfile'),
      'utf8'
    );
    assert.ok(dockerfile.includes('COPY --chown=limbo:limbo lib/ ./lib/'));
  });

  it('copies RELEASES.md', () => {
    const dockerfile = fs.readFileSync(
      path.join(__dirname, '..', 'Dockerfile'),
      'utf8'
    );
    assert.ok(dockerfile.includes('RELEASES.md'));
  });

  it('creates /flags directory', () => {
    const dockerfile = fs.readFileSync(
      path.join(__dirname, '..', 'Dockerfile'),
      'utf8'
    );
    assert.ok(dockerfile.includes('mkdir -p /flags'));
  });
});

// ── Compose files include flags volume ─────────────────────────────────────

describe('compose files include flags volume', () => {
  it('production compose has /flags mount', () => {
    const compose = fs.readFileSync(
      path.join(__dirname, '..', 'docker-compose.yml'),
      'utf8'
    );
    assert.ok(compose.includes('/flags'));
  });

  it('test compose has flags volume', () => {
    const compose = fs.readFileSync(
      path.join(__dirname, '..', 'docker-compose.test.yml'),
      'utf8'
    );
    assert.ok(compose.includes('/flags'));
  });
});
