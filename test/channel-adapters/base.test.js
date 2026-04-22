'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { isValidInboundEvent } = require('../../lib/channel-adapters/base');

test('isValidInboundEvent accepts a complete text event', () => {
  const event = {
    channelId: 'whatsapp-kapso',
    from: '+5491123456789',
    messageId: 'wamid.HBgM123',
    timestamp: '2026-04-22T18:00:00Z',
    type: 'text',
    text: 'hola limbo',
  };
  assert.strictEqual(isValidInboundEvent(event), true);
});

test('isValidInboundEvent returns false for null / undefined / primitives', () => {
  assert.strictEqual(isValidInboundEvent(null), false);
  assert.strictEqual(isValidInboundEvent(undefined), false);
  assert.strictEqual(isValidInboundEvent('string'), false);
  assert.strictEqual(isValidInboundEvent(42), false);
  assert.strictEqual(isValidInboundEvent([]), false);
});

test('isValidInboundEvent returns false when required fields are missing', () => {
  const base = {
    channelId: 'whatsapp-kapso',
    from: '+5491123456789',
    messageId: 'wamid.HBgM123',
    timestamp: '2026-04-22T18:00:00Z',
    type: 'text',
    text: 'hola',
  };
  for (const key of ['channelId', 'from', 'messageId', 'timestamp', 'type']) {
    const broken = { ...base };
    delete broken[key];
    assert.strictEqual(
      isValidInboundEvent(broken),
      false,
      `expected false when ${key} is missing`,
    );
  }
});

test('isValidInboundEvent rejects unknown type values', () => {
  const event = {
    channelId: 'whatsapp-kapso',
    from: '+5491123456789',
    messageId: 'wamid.HBgM123',
    timestamp: '2026-04-22T18:00:00Z',
    type: 'explosion',
    text: 'boom',
  };
  assert.strictEqual(isValidInboundEvent(event), false);
});

test('isValidInboundEvent accepts all documented type values', () => {
  const types = ['text', 'audio', 'image', 'video', 'document', 'sticker', 'location', 'unknown'];
  for (const type of types) {
    const event = {
      channelId: 'whatsapp-kapso',
      from: '+5491123456789',
      messageId: 'wamid.HBgM123',
      timestamp: '2026-04-22T18:00:00Z',
      type,
      text: 'hola', // harmless for non-text types, required when type='text'
    };
    assert.strictEqual(
      isValidInboundEvent(event),
      true,
      `expected true for type=${type}`,
    );
  }
});

test('isValidInboundEvent requires text when type=text', () => {
  const event = {
    channelId: 'whatsapp-kapso',
    from: '+5491123456789',
    messageId: 'wamid.HBgM123',
    timestamp: '2026-04-22T18:00:00Z',
    type: 'text',
    // text missing
  };
  assert.strictEqual(isValidInboundEvent(event), false);
});

test('isValidInboundEvent rejects non-ISO-8601 timestamps', () => {
  const event = {
    channelId: 'whatsapp-kapso',
    from: '+5491123456789',
    messageId: 'wamid.HBgM123',
    timestamp: 'not-a-date',
    type: 'text',
    text: 'hola',
  };
  assert.strictEqual(isValidInboundEvent(event), false);
});
