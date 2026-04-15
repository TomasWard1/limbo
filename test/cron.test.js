// test/cron.test.js — Unit tests for MCP cron tools
'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function writeFakeOpenClaw(binPath) {
  const script = `#!/usr/bin/env node
const fs = require("node:fs");

const storePath = process.env.FAKE_OPENCLAW_STORE;
if (!storePath) {
  console.error("FAKE_OPENCLAW_STORE is required");
  process.exit(1);
}

function loadStore() {
  try {
    return JSON.parse(fs.readFileSync(storePath, "utf8"));
  } catch {
    return { version: 1, jobs: [] };
  }
}

function saveStore(store) {
  fs.mkdirSync(require("node:path").dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2) + "\\n");
}

const args = process.argv.slice(2);
if (args[0] !== "cron") {
  console.error("unsupported command");
  process.exit(1);
}

const sub = args[1];
const flags = args.slice(2);
const take = (flag) => {
  const idx = flags.indexOf(flag);
  if (idx === -1) return null;
  const val = flags[idx + 1];
  flags.splice(idx, 2);
  return val;
};
const has = (flag) => {
  const idx = flags.indexOf(flag);
  if (idx === -1) return false;
  flags.splice(idx, 1);
  return true;
};

if (sub === "list") {
  const includeDisabled = has("--all");
  has("--json");
  const store = loadStore();
  const jobs = includeDisabled ? store.jobs : store.jobs.filter((job) => job.enabled !== false);
  console.log(JSON.stringify({
    jobs,
    total: jobs.length,
    offset: 0,
    limit: jobs.length || 50,
    hasMore: false,
    nextOffset: null,
  }, null, 2));
  process.exit(0);
}

if (sub === "add") {
  has("--json");
  const name = take("--name");
  const at = take("--at");
  const every = take("--every");
  const expr = take("--cron");
  const tz = take("--tz");
  const session = take("--session") || "isolated";
  const message = take("--message");
  const systemEvent = take("--system-event");
  const channel = take("--channel") || "last";
  const to = take("--to");
  const accountId = take("--account");
  const announce = has("--announce");
  const noDeliver = has("--no-deliver");
  const deleteAfterRun = has("--delete-after-run");
  const keepAfterRun = has("--keep-after-run");
  const bestEffort = has("--best-effort-deliver");

  if (!name) {
    console.error("missing --name");
    process.exit(1);
  }

  const schedule = at ? { kind: "at", at } : every ? { kind: "every", everyMs: Number.parseInt(every, 10) } : { kind: "cron", expr };
  if (tz) schedule.tz = tz;

  const payload = systemEvent
    ? { kind: "systemEvent", text: systemEvent }
    : { kind: "agentTurn", message };

  const delivery = payload.kind === "agentTurn"
    ? {
      mode: noDeliver ? "none" : (announce ? "announce" : "announce"),
      channel,
    }
    : undefined;
  if (delivery && to) delivery.to = to;
  if (delivery && accountId) delivery.accountId = accountId;
  if (delivery && bestEffort) delivery.bestEffort = true;

  const now = Date.now();
  const id = "job-" + Math.random().toString(16).slice(2);
  const job = {
    id,
    name,
    enabled: true,
    createdAtMs: now,
    updatedAtMs: now,
    schedule,
    sessionTarget: payload.kind === "systemEvent" ? "main" : session,
    wakeMode: "now",
    payload,
    state: { nextRunAtMs: now + 60_000 },
  };
  if (delivery) job.delivery = delivery;
  if (deleteAfterRun) job.deleteAfterRun = true;
  if (keepAfterRun) job.deleteAfterRun = false;

  const store = loadStore();
  store.jobs.push(job);
  saveStore(store);
  console.log(JSON.stringify(job, null, 2));
  process.exit(0);
}

if (sub === "remove") {
  has("--json");
  const id = flags[0];
  const store = loadStore();
  const before = store.jobs.length;
  store.jobs = store.jobs.filter((job) => job.id !== id);
  saveStore(store);
  console.log(JSON.stringify({ ok: true, removed: store.jobs.length !== before }, null, 2));
  process.exit(0);
}

console.error("unsupported cron subcommand");
process.exit(1);
`;

  fs.writeFileSync(binPath, script, { mode: 0o755 });
}

let tmpDir;
let cronStorePath;
let fakeOpenClawPath;
let cronList, cronAdd, cronRemove;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cron-test-'));
  cronStorePath = path.join(tmpDir, 'cron-store.json');
  fakeOpenClawPath = path.join(tmpDir, 'openclaw');
  writeFakeOpenClaw(fakeOpenClawPath);

  process.env.OPENCLAW_BIN = fakeOpenClawPath;
  process.env.FAKE_OPENCLAW_STORE = cronStorePath;

  const mod = await import('../mcp-server/tools/cron.js');
  cronList = mod.cronList;
  cronAdd = mod.cronAdd;
  cronRemove = mod.cronRemove;
});

after(() => {
  delete process.env.OPENCLAW_BIN;
  delete process.env.FAKE_OPENCLAW_STORE;
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

beforeEach(() => {
  if (fs.existsSync(cronStorePath)) {
    fs.unlinkSync(cronStorePath);
  }
});

function readStore() {
  return JSON.parse(fs.readFileSync(cronStorePath, 'utf8'));
}

describe('cron_list', () => {
  it('returns empty array when no store exists', async () => {
    const jobs = await cronList();
    assert.deepEqual(jobs, []);
  });

  it('returns jobs from gateway list output', async () => {
    fs.writeFileSync(cronStorePath, JSON.stringify({
      version: 1,
      jobs: [{
        id: 'test-123',
        name: 'Test job',
        enabled: true,
        schedule: { kind: 'cron', expr: '0 8 * * *', tz: 'America/Argentina/Buenos_Aires' },
        payload: { kind: 'agentTurn', message: 'Hello' },
        delivery: { mode: 'announce', channel: 'telegram', to: '123' },
        state: { nextRunAtMs: 1700000000000, lastRunAtMs: 1699990000000, lastStatus: 'ok' },
      }],
    }));

    const jobs = await cronList();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, 'test-123');
    assert.equal(jobs[0].schedule.kind, 'cron');
    assert.equal(jobs[0].lastStatus, 'ok');
  });

  it('filters disabled jobs by default', async () => {
    fs.writeFileSync(cronStorePath, JSON.stringify({
      version: 1,
      jobs: [
        { id: 'a', name: 'Active', enabled: true, schedule: { kind: 'cron', expr: '0 8 * * *' }, payload: { kind: 'agentTurn', message: 'hi' } },
        { id: 'b', name: 'Disabled', enabled: false, schedule: { kind: 'cron', expr: '0 9 * * *' }, payload: { kind: 'agentTurn', message: 'bye' } },
      ],
    }));

    const jobs = await cronList();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, 'a');
  });

  it('includes disabled jobs when includeDisabled is true', async () => {
    fs.writeFileSync(cronStorePath, JSON.stringify({
      version: 1,
      jobs: [
        { id: 'a', name: 'Active', enabled: true, schedule: { kind: 'cron', expr: '0 8 * * *' }, payload: { kind: 'agentTurn', message: 'hi' } },
        { id: 'b', name: 'Disabled', enabled: false, schedule: { kind: 'cron', expr: '0 9 * * *' }, payload: { kind: 'agentTurn', message: 'bye' } },
      ],
    }));

    const jobs = await cronList({ includeDisabled: true });
    assert.equal(jobs.length, 2);
  });
});

describe('cron_add', () => {
  it('creates a one-shot isolated agentTurn job by default', async () => {
    const result = await cronAdd({
      name: 'Test reminder',
      prompt: 'Recordatorio: test',
      schedule: { kind: 'at', at: '2026-04-14T12:00:00Z' },
    });

    assert.ok(result.id);
    assert.equal(result.name, 'Test reminder');
    assert.equal(result.schedule.kind, 'at');

    const store = readStore();
    assert.equal(store.jobs.length, 1);
    assert.equal(store.jobs[0].id, result.id);
    assert.equal(store.jobs[0].deleteAfterRun, true);
    assert.equal(store.jobs[0].payload.kind, 'agentTurn');
    assert.equal(store.jobs[0].payload.message, 'Recordatorio: test');
    assert.equal(store.jobs[0].sessionTarget, 'isolated');
  });

  it('creates a recurring cron job with announce delivery', async () => {
    const result = await cronAdd({
      name: 'Daily reminder',
      prompt: 'Buenos días',
      schedule: { kind: 'cron', expr: '0 8 * * *', tz: 'America/Argentina/Buenos_Aires' },
      delivery: { mode: 'announce', channel: 'telegram', to: '12345', accountId: 'acct-1' },
    });

    assert.ok(result.id);
    const store = readStore();
    const job = store.jobs[0];
    assert.equal(job.schedule.expr, '0 8 * * *');
    assert.equal(job.schedule.tz, 'America/Argentina/Buenos_Aires');
    assert.equal(job.delivery.channel, 'telegram');
    assert.equal(job.delivery.to, '12345');
    assert.equal(job.delivery.accountId, 'acct-1');
    assert.equal(job.deleteAfterRun, undefined);
  });

  it('creates a main-session systemEvent job when requested', async () => {
    const result = await cronAdd({
      name: 'Heartbeat nudge',
      prompt: 'Acordate de revisar el banco',
      schedule: { kind: 'at', at: '2026-04-14T12:00:00Z' },
      sessionTarget: 'main',
    });

    assert.ok(result.id);
    const store = readStore();
    assert.equal(store.jobs[0].sessionTarget, 'main');
    assert.equal(store.jobs[0].payload.kind, 'systemEvent');
    assert.equal(store.jobs[0].payload.text, 'Acordate de revisar el banco');
    assert.equal(store.jobs[0].delivery, undefined);
  });

  it('creates an interval job', async () => {
    const result = await cronAdd({
      name: 'Interval check',
      prompt: 'Checking...',
      schedule: { kind: 'every', everyMs: 60000 },
    });

    assert.ok(result.id);
    const store = readStore();
    assert.equal(store.jobs[0].schedule.everyMs, 60000);
  });

  it('rejects missing name', async () => {
    await assert.rejects(
      () => cronAdd({ prompt: 'test', schedule: { kind: 'at', at: '2026-04-14T12:00:00Z' } }),
      /name/
    );
  });

  it('rejects missing schedule', async () => {
    await assert.rejects(
      () => cronAdd({ name: 'test', prompt: 'test' }),
      /schedule/
    );
  });

  it('rejects invalid schedule kind', async () => {
    await assert.rejects(
      () => cronAdd({ name: 'test', prompt: 'test', schedule: { kind: 'invalid' } }),
      /kind/
    );
  });

  it('rejects "at" without timestamp', async () => {
    await assert.rejects(
      () => cronAdd({ name: 'test', prompt: 'test', schedule: { kind: 'at' } }),
      /at/
    );
  });

  it('rejects "every" with everyMs below 1000', async () => {
    await assert.rejects(
      () => cronAdd({ name: 'test', prompt: 'test', schedule: { kind: 'every', everyMs: 500 } }),
      /everyMs/
    );
  });

  it('rejects "cron" without expr', async () => {
    await assert.rejects(
      () => cronAdd({ name: 'test', prompt: 'test', schedule: { kind: 'cron' } }),
      /expr/
    );
  });

  it('rejects unsupported webhook delivery', async () => {
    await assert.rejects(
      () => cronAdd({
        name: 'test',
        prompt: 'test',
        schedule: { kind: 'at', at: '2026-04-14T12:00:00Z' },
        delivery: { mode: 'webhook' },
      }),
      /Unsupported delivery.mode/
    );
  });
});

describe('cron_remove', () => {
  it('removes a job by ID', async () => {
    const added = await cronAdd({
      name: 'To remove',
      prompt: 'test',
      schedule: { kind: 'at', at: '2026-04-14T12:00:00Z' },
    });

    const result = await cronRemove({ jobId: added.id });
    assert.equal(result.removed, true);

    const store = readStore();
    assert.equal(store.jobs.length, 0);
  });

  it('throws when job not found', async () => {
    await assert.rejects(
      () => cronRemove({ jobId: 'nonexistent-id' }),
      /not found/
    );
  });

  it('throws when jobId is missing', async () => {
    await assert.rejects(
      () => cronRemove({}),
      /jobId/
    );
  });
});
