'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createWhatsAppKapsoAdapter } = require('../../lib/channel-adapters/whatsapp-kapso');

const baseConfig = {
  apiKey: 'test-kapso-api-key',
  phoneNumberId: '15556665544',
};

function makeAdapter() {
  return createWhatsAppKapsoAdapter(baseConfig);
}

test('adapter exposes the ChannelAdapter shape', () => {
  const a = makeAdapter();
  assert.strictEqual(a.id, 'whatsapp-kapso');
  assert.strictEqual(typeof a.receive, 'function');
  assert.strictEqual(typeof a.send, 'function');
  assert.strictEqual(typeof a.capabilities, 'function');
});

test('receive() parses a Kapso-native text message', async () => {
  const payload = {
    type: 'message.received',
    data: [
      {
        message: {
          from: '+5491123456789',
          id: 'wamid.HBgM001',
          timestamp: '1746822000',
          type: 'text',
          text: { body: 'hola limbo' },
          kapso: { direction: 'inbound', status: 'received', contact_name: 'Tomas' },
        },
        conversation: { id: 'conv_1' },
        phone_number_id: '15556665544',
      },
    ],
  };

  const events = await makeAdapter().receive(payload, {});
  assert.strictEqual(events.length, 1);
  const e = events[0];
  assert.strictEqual(e.channelId, 'whatsapp-kapso');
  assert.strictEqual(e.from, '+5491123456789');
  assert.strictEqual(e.fromName, 'Tomas');
  assert.strictEqual(e.messageId, 'wamid.HBgM001');
  assert.strictEqual(e.type, 'text');
  assert.strictEqual(e.text, 'hola limbo');
  // timestamp normalized from unix-seconds string to ISO-8601
  assert.match(e.timestamp, /^2025-05-09T/); // 1746822000 = 2025-05-09T22:20:00Z
});

test('receive() parses an audio message with Kapso server-side transcript', async () => {
  const payload = {
    type: 'message.received',
    data: [
      {
        message: {
          from: '+5491123456789',
          id: 'wamid.HBgM002',
          timestamp: '1746822100',
          type: 'audio',
          audio: { id: 'media_abc', mime_type: 'audio/ogg' },
          kapso: {
            direction: 'inbound',
            status: 'received',
            has_media: true,
            media_url: 'https://api.kapso.ai/media/media_abc',
            transcript: { text: 'pedile a limbo que me recuerde comprar leche' },
          },
        },
        phone_number_id: '15556665544',
      },
    ],
  };

  const events = await makeAdapter().receive(payload, {});
  assert.strictEqual(events.length, 1);
  const e = events[0];
  assert.strictEqual(e.type, 'audio');
  assert.strictEqual(e.text, 'pedile a limbo que me recuerde comprar leche');
  assert.strictEqual(e.mediaUrl, 'https://api.kapso.ai/media/media_abc');
});

test('receive() ignores events with kapso.direction === "outbound" (our own echoes)', async () => {
  const payload = {
    type: 'message.sent',
    data: [
      {
        message: {
          from: '15556665544',
          id: 'wamid.OUT001',
          timestamp: '1746822200',
          type: 'text',
          text: { body: 'reply from limbo' },
          kapso: { direction: 'outbound', status: 'sent' },
        },
        phone_number_id: '15556665544',
      },
    ],
  };

  const events = await makeAdapter().receive(payload, {});
  assert.strictEqual(events.length, 0);
});

test('receive() returns all events when data[] has multiple messages', async () => {
  const payload = {
    type: 'message.received',
    data: [
      {
        message: {
          from: '+5491100000001',
          id: 'wamid.M1',
          timestamp: '1746822000',
          type: 'text',
          text: { body: 'first' },
          kapso: { direction: 'inbound' },
        },
        phone_number_id: '15556665544',
      },
      {
        message: {
          from: '+5491100000002',
          id: 'wamid.M2',
          timestamp: '1746822010',
          type: 'text',
          text: { body: 'second' },
          kapso: { direction: 'inbound' },
        },
        phone_number_id: '15556665544',
      },
    ],
  };

  const events = await makeAdapter().receive(payload, {});
  assert.strictEqual(events.length, 2);
  assert.strictEqual(events[0].messageId, 'wamid.M1');
  assert.strictEqual(events[1].messageId, 'wamid.M2');
});

test('receive() throws on payload with no data array', async () => {
  await assert.rejects(
    () => makeAdapter().receive({ type: 'hello' }, {}),
    /data/i,
  );
});

test('receive() throws on null / non-object payload', async () => {
  await assert.rejects(() => makeAdapter().receive(null, {}), /payload/i);
  await assert.rejects(() => makeAdapter().receive('string', {}), /payload/i);
});

test('receive() skips individual events that fail validation but returns the valid ones', async () => {
  const payload = {
    type: 'message.received',
    data: [
      {
        // missing message.from — should be skipped
        message: {
          id: 'wamid.BAD',
          timestamp: '1746822000',
          type: 'text',
          text: { body: 'orphan' },
          kapso: { direction: 'inbound' },
        },
        phone_number_id: '15556665544',
      },
      {
        message: {
          from: '+5491123456789',
          id: 'wamid.GOOD',
          timestamp: '1746822010',
          type: 'text',
          text: { body: 'good one' },
          kapso: { direction: 'inbound' },
        },
        phone_number_id: '15556665544',
      },
    ],
  };

  const events = await makeAdapter().receive(payload, {});
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].messageId, 'wamid.GOOD');
});

test('receive() attaches the original raw event for debugging', async () => {
  const payload = {
    type: 'message.received',
    data: [
      {
        message: {
          from: '+5491123456789',
          id: 'wamid.HBgMRAW',
          timestamp: '1746822000',
          type: 'text',
          text: { body: 'raw' },
          kapso: { direction: 'inbound' },
        },
        phone_number_id: '15556665544',
      },
    ],
  };

  const [e] = await makeAdapter().receive(payload, {});
  assert.strictEqual(e.raw.message.id, 'wamid.HBgMRAW');
});

test('capabilities() reports WhatsApp-Kapso supports voice transcripts and proactive sends', () => {
  const c = makeAdapter().capabilities();
  assert.strictEqual(c.supportsVoice, true);
  assert.strictEqual(c.supportsProactive, true);
  assert.strictEqual(c.supportsMediaOut, true);
  assert.strictEqual(typeof c.proactiveCostUSD, 'number');
});
