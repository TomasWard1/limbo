'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { buildChannelsFromEnv } = require('../lib/build-channels');

test('buildChannelsFromEnv returns an empty object when no flags are set', () => {
  const channels = buildChannelsFromEnv({});
  assert.deepStrictEqual(channels, {});
});

test('buildChannelsFromEnv ignores explicitly-false flag', () => {
  const channels = buildChannelsFromEnv({
    CHANNEL_ADAPTER_WHATSAPP_KAPSO_ENABLED: 'false',
    KAPSO_API_KEY: 'x',
    KAPSO_PHONE_NUMBER_ID: 'y',
    GATEWAY_TOKEN: 'z',
  });
  assert.deepStrictEqual(channels, {});
});

test('buildChannelsFromEnv throws when flag is true but KAPSO_API_KEY is missing', () => {
  assert.throws(
    () => buildChannelsFromEnv({
      CHANNEL_ADAPTER_WHATSAPP_KAPSO_ENABLED: 'true',
      KAPSO_PHONE_NUMBER_ID: 'y',
      GATEWAY_TOKEN: 'z',
    }),
    /KAPSO_API_KEY/,
  );
});

test('buildChannelsFromEnv throws when KAPSO_PHONE_NUMBER_ID is missing', () => {
  assert.throws(
    () => buildChannelsFromEnv({
      CHANNEL_ADAPTER_WHATSAPP_KAPSO_ENABLED: 'true',
      KAPSO_API_KEY: 'x',
      GATEWAY_TOKEN: 'z',
    }),
    /KAPSO_PHONE_NUMBER_ID/,
  );
});

test('buildChannelsFromEnv throws when GATEWAY_TOKEN is missing', () => {
  assert.throws(
    () => buildChannelsFromEnv({
      CHANNEL_ADAPTER_WHATSAPP_KAPSO_ENABLED: 'true',
      KAPSO_API_KEY: 'x',
      KAPSO_PHONE_NUMBER_ID: 'y',
    }),
    /GATEWAY_TOKEN/,
  );
});

test('buildChannelsFromEnv returns a wired whatsapp channel when flag + vars are set', () => {
  const channels = buildChannelsFromEnv({
    CHANNEL_ADAPTER_WHATSAPP_KAPSO_ENABLED: 'true',
    KAPSO_API_KEY: 'k',
    KAPSO_PHONE_NUMBER_ID: 'p',
    GATEWAY_TOKEN: 't',
    LIMBO_PORT: '18900',
  });
  assert.ok(channels.whatsapp, 'whatsapp channel should be present');
  assert.strictEqual(typeof channels.whatsapp.onInbound, 'function');
  assert.strictEqual(typeof channels.whatsapp.onStop, 'function');
});

test('buildChannelsFromEnv onInbound forwards parsed events to the pipeline', async () => {
  const enqueued = [];
  const stubPipeline = {
    enqueue: (event) => enqueued.push(event),
    stop: async () => {},
  };
  const stubAdapter = {
    id: 'whatsapp-kapso',
    receive: async (payload) => {
      return payload && Array.isArray(payload.events) ? payload.events : [];
    },
    send: async () => ({ messageId: 'ok' }),
    capabilities: () => ({ supportsVoice: true, supportsProactive: true, proactiveCostUSD: 0, supportsMediaOut: true }),
  };

  const channels = buildChannelsFromEnv(
    {
      CHANNEL_ADAPTER_WHATSAPP_KAPSO_ENABLED: 'true',
      KAPSO_API_KEY: 'k',
      KAPSO_PHONE_NUMBER_ID: 'p',
      GATEWAY_TOKEN: 't',
    },
    {
      adapterFactory: () => stubAdapter,
      pipelineFactory: () => stubPipeline,
    },
  );

  await channels.whatsapp.onInbound({ events: [{ messageId: 'm1', from: '+1', timestamp: '2026-04-22T18:00:00Z', type: 'text', text: 'hi', channelId: 'whatsapp-kapso' }] }, {});
  assert.strictEqual(enqueued.length, 1);
  assert.strictEqual(enqueued[0].messageId, 'm1');
});
