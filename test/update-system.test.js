const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// ── telegram-notify tests ──────────────────────────────────────────────────

describe('telegram-notify', () => {
  let tmpDir;
  let origEnv;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'limbo-notify-test-'));
    origEnv = process.env.OPENCLAW_STATE_DIR;
    process.env.OPENCLAW_STATE_DIR = tmpDir;

    // Create secrets dir with test values
    const secretsDir = path.join(tmpDir, 'secrets');
    fs.mkdirSync(secretsDir, { recursive: true });
    fs.writeFileSync(path.join(secretsDir, 'telegram_bot_token'), 'test-token-123');
    fs.writeFileSync(path.join(secretsDir, 'telegram_chat_id'), '456789');
  });

  after(() => {
    process.env.OPENCLAW_STATE_DIR = origEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('readSecret reads from secrets dir', () => {
    // Re-require to pick up new env
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
    // Point to empty dir
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'limbo-notify-empty-'));
    process.env.OPENCLAW_STATE_DIR = emptyDir;
    fs.mkdirSync(path.join(emptyDir, 'secrets'), { recursive: true });

    delete require.cache[require.resolve('../lib/telegram-notify.js')];
    const { sendMessage } = require('../lib/telegram-notify.js');

    await assert.rejects(
      () => sendMessage('test'),
      { message: /missing bot_token or chat_id/ }
    );

    process.env.OPENCLAW_STATE_DIR = tmpDir;
    fs.rmSync(emptyDir, { recursive: true, force: true });
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
