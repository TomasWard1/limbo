'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createChannelPipeline } = require('../lib/channel-pipeline');

/**
 * Make a deterministic test adapter + openclaw pair so the pipeline has
 * something to talk to. Both record calls; both accept overrides per-test.
 */
function makeHarness({ chat, send } = {}) {
  const sent = [];
  const chatCalls = [];
  const openclawFn = chat || (async ({ user, text }) => {
    chatCalls.push({ user, text });
    return `reply to: ${text}`;
  });
  const adapter = {
    id: 'test-adapter',
    receive: async () => [],
    send: send || (async (msg) => {
      sent.push(msg);
      return { messageId: `out-${sent.length}` };
    }),
    capabilities: () => ({ supportsVoice: true, supportsProactive: true, proactiveCostUSD: 0, supportsMediaOut: true }),
  };
  const logs = [];
  const logger = {
    info: (...args) => logs.push(['info', ...args]),
    warn: (...args) => logs.push(['warn', ...args]),
    error: (...args) => logs.push(['error', ...args]),
  };
  return { adapter, openclawFn, sent, chatCalls, logs, logger };
}

function event(overrides = {}) {
  return {
    channelId: 'whatsapp-kapso',
    from: '+5491123456789',
    messageId: 'wamid.001',
    timestamp: '2026-04-22T18:00:00Z',
    type: 'text',
    text: 'hola',
    ...overrides,
  };
}

async function waitFor(condition, { timeoutMs = 1000, intervalMs = 5 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('waitFor: condition not satisfied within timeout');
}

test('enqueue returns synchronously; processing happens asynchronously', async () => {
  const h = makeHarness();
  const pipeline = createChannelPipeline({
    adapter: h.adapter,
    openclaw: { sendChat: h.openclawFn },
    logger: h.logger,
  });

  const t0 = Date.now();
  pipeline.enqueue(event());
  const enqueueMs = Date.now() - t0;
  assert.ok(enqueueMs < 20, `enqueue should return immediately; took ${enqueueMs}ms`);

  await waitFor(() => h.sent.length === 1);
  assert.strictEqual(h.sent[0].to, '+5491123456789');
  assert.strictEqual(h.sent[0].text, 'reply to: hola');
  assert.strictEqual(h.chatCalls[0].user, '+5491123456789');
  assert.strictEqual(h.chatCalls[0].text, 'hola');

  await pipeline.stop();
});

test('queue caps at the configured size and logs a warning when dropping', async () => {
  const h = makeHarness({
    // Slow chat so the queue can back up.
    chat: async ({ text }) => {
      await new Promise((r) => setTimeout(r, 40));
      return `done ${text}`;
    },
  });
  const pipeline = createChannelPipeline({
    adapter: h.adapter,
    openclaw: { sendChat: h.openclawFn },
    logger: h.logger,
    queueCap: 3,
  });

  // Enqueue more than the cap; first one starts processing immediately,
  // so the queue holds (total - 1) pending items.
  for (let i = 0; i < 10; i++) {
    pipeline.enqueue(event({ messageId: `m${i}`, text: `t${i}` }));
  }

  // Let at least a few complete.
  await waitFor(() => h.sent.length >= 4);
  await pipeline.stop();

  const warns = h.logs.filter(([level]) => level === 'warn');
  assert.ok(warns.length > 0, 'expected at least one drop warning');
  assert.ok(
    warns.some(([, msg]) => /queue/i.test(String(msg)) && /drop/i.test(String(msg))),
    `expected warn to mention queue drop, got: ${JSON.stringify(warns)}`,
  );
});

test('openclaw errors do not kill the worker; next events still process', async () => {
  const chatCalls = [];
  const h = makeHarness({
    chat: async ({ text }) => {
      chatCalls.push(text);
      if (text === 'boom') throw new Error('simulated openclaw 500');
      return `ok ${text}`;
    },
  });
  const pipeline = createChannelPipeline({
    adapter: h.adapter,
    openclaw: { sendChat: h.openclawFn },
    logger: h.logger,
  });

  pipeline.enqueue(event({ messageId: 'a', text: 'boom' }));
  pipeline.enqueue(event({ messageId: 'b', text: 'ping' }));

  await waitFor(() => h.sent.length === 1);
  assert.strictEqual(h.sent[0].text, 'ok ping');

  const errors = h.logs.filter(([level]) => level === 'error');
  assert.ok(errors.length === 1, 'expected 1 error log for the failed event');

  await pipeline.stop();
});

test('adapter.send errors do not kill the worker', async () => {
  let sentCount = 0;
  const h = makeHarness({
    send: async (msg) => {
      sentCount++;
      if (msg.text === 'reply to: explode') throw new Error('kapso 503');
      return { messageId: `ok-${sentCount}` };
    },
  });
  const pipeline = createChannelPipeline({
    adapter: h.adapter,
    openclaw: { sendChat: h.openclawFn },
    logger: h.logger,
  });

  pipeline.enqueue(event({ messageId: 'x', text: 'explode' }));
  pipeline.enqueue(event({ messageId: 'y', text: 'fine' }));

  await waitFor(() => sentCount === 2);
  const errors = h.logs.filter(([level]) => level === 'error');
  assert.ok(errors.length === 1, 'expected 1 error log for the failed send');

  await pipeline.stop();
});

test('duplicate messageIds within the dedup window are dropped', async () => {
  const h = makeHarness();
  const pipeline = createChannelPipeline({
    adapter: h.adapter,
    openclaw: { sendChat: h.openclawFn },
    logger: h.logger,
    dedupTtlMs: 60_000,
  });

  pipeline.enqueue(event({ messageId: 'same' }));
  pipeline.enqueue(event({ messageId: 'same' }));
  pipeline.enqueue(event({ messageId: 'other' }));

  await waitFor(() => h.sent.length === 2);
  await new Promise((r) => setTimeout(r, 20));
  assert.strictEqual(h.sent.length, 2, 'duplicate should have been skipped');

  await pipeline.stop();
});

test('budget_exceeded error triggers the upgrade-plan message instead of a silent log', async () => {
  const sent = [];
  const logs = [];
  const chat = async () => {
    const err = new Error('LiteLLM virtual key budget exhausted');
    err.code = 'budget_exceeded';
    throw err;
  };
  const adapter = {
    id: 'test-adapter',
    receive: async () => [],
    send: async (msg) => { sent.push(msg); return { messageId: 'ok' }; },
    capabilities: () => ({ supportsVoice: false, supportsProactive: true, proactiveCostUSD: 0, supportsMediaOut: false }),
  };
  const logger = {
    info: (...a) => logs.push(['info', ...a]),
    warn: (...a) => logs.push(['warn', ...a]),
    error: (...a) => logs.push(['error', ...a]),
  };
  const pipeline = createChannelPipeline({
    adapter,
    openclaw: { sendChat: chat },
    logger,
  });
  pipeline.enqueue(event({ messageId: 'budget-test', text: 'hola' }));

  // Wait for the worker to process.
  for (let i = 0; i < 40 && sent.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }

  assert.strictEqual(sent.length, 1, 'adapter.send should have been called exactly once');
  assert.strictEqual(sent[0].to, '+5491123456789');
  assert.match(sent[0].text, /please upgrade plan/i);
  assert.ok(
    logs.some(([level, msg]) => level === 'warn' && /budget exhausted/i.test(String(msg))),
    'expected a warn log about budget exhaustion',
  );
  assert.ok(
    !logs.some(([level]) => level === 'error'),
    'error log should NOT fire — we handled the condition gracefully',
  );

  await pipeline.stop();
});

test('stop() drains in-flight work and rejects further enqueues', async () => {
  const h = makeHarness({
    chat: async ({ text }) => {
      await new Promise((r) => setTimeout(r, 30));
      return `done ${text}`;
    },
  });
  const pipeline = createChannelPipeline({
    adapter: h.adapter,
    openclaw: { sendChat: h.openclawFn },
    logger: h.logger,
  });

  pipeline.enqueue(event({ messageId: 'a', text: 'a' }));
  pipeline.enqueue(event({ messageId: 'b', text: 'b' }));

  await pipeline.stop();

  // All enqueued events should have finished (stop drains).
  assert.ok(h.sent.length >= 1, `expected drain; sent=${h.sent.length}`);

  assert.throws(() => pipeline.enqueue(event({ messageId: 'c' })), /stopped/i);
});
