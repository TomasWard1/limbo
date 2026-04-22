'use strict';

/**
 * WhatsApp channel adapter backed by the Kapso Cloud API.
 *
 * Inbound: parses the Kapso-native webhook envelope
 *   { type, data: [{ message, conversation?, phone_number_id }] }
 * into the internal InboundEvent shape. Messages tagged
 * `kapso.direction === 'outbound'` are our own echoes and are dropped.
 *
 * Outbound: posts to the Kapso WhatsApp send endpoint
 *   POST https://api.kapso.ai/meta/whatsapp/v24.0/{phone_number_id}/messages
 * with header `X-API-Key`. (Implemented in a later step.)
 */

const { isValidInboundEvent } = require('./base');

const CHANNEL_ID = 'whatsapp-kapso';

/**
 * @param {{apiKey: string, phoneNumberId: string, baseUrl?: string}} config
 * @returns {import('./base').ChannelAdapter}
 */
function createWhatsAppKapsoAdapter(config) {
  if (!config || typeof config.apiKey !== 'string' || !config.apiKey) {
    throw new Error('whatsapp-kapso: apiKey is required');
  }
  if (typeof config.phoneNumberId !== 'string' || !config.phoneNumberId) {
    throw new Error('whatsapp-kapso: phoneNumberId is required');
  }

  async function receive(rawPayload, _headers) {
    if (rawPayload === null || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
      throw new Error('whatsapp-kapso: payload must be an object');
    }
    const data = rawPayload.data;
    if (!Array.isArray(data)) {
      throw new Error('whatsapp-kapso: payload.data must be an array');
    }

    /** @type {import('./base').InboundEvent[]} */
    const events = [];
    for (const item of data) {
      const e = normalizeEvent(item);
      if (!e) continue;
      if (isValidInboundEvent(e)) events.push(e);
    }
    return events;
  }

  async function send(_msg) {
    throw new Error('whatsapp-kapso: send() not implemented yet');
  }

  function capabilities() {
    return {
      supportsVoice: true,          // Kapso transcribes audio server-side
      supportsProactive: true,      // templates via Meta Cloud API (gated by cost caps at the app layer)
      proactiveCostUSD: 0.03,       // rough mid-point of Meta's regional template pricing — tune later
      supportsMediaOut: true,       // images/audio/video supported by the WhatsApp Cloud API
    };
  }

  return { id: CHANNEL_ID, receive, send, capabilities };
}

/**
 * Translate one entry of the Kapso `data[]` array into an InboundEvent.
 * Returns null for events we want to ignore (outbound echoes, missing message, etc.).
 */
function normalizeEvent(item) {
  if (!item || typeof item !== 'object') return null;
  const message = item.message;
  if (!message || typeof message !== 'object') return null;

  const kapso = message.kapso || {};
  if (kapso.direction === 'outbound') return null;

  const from = typeof message.from === 'string' ? message.from : undefined;
  const messageId = typeof message.id === 'string' ? message.id : undefined;
  const type = typeof message.type === 'string' ? message.type : 'unknown';
  const timestamp = normalizeTimestamp(message.timestamp);

  if (!from || !messageId || !timestamp) return null;

  let text;
  if (type === 'text' && message.text && typeof message.text.body === 'string') {
    text = message.text.body;
  } else if (kapso.transcript && typeof kapso.transcript.text === 'string' && kapso.transcript.text.length > 0) {
    text = kapso.transcript.text;
  }

  const mediaUrl = typeof kapso.media_url === 'string' ? kapso.media_url : undefined;
  const fromName = typeof kapso.contact_name === 'string' ? kapso.contact_name : undefined;

  /** @type {import('./base').InboundEvent} */
  const event = {
    channelId: CHANNEL_ID,
    from,
    messageId,
    timestamp,
    type: normalizeType(type),
    raw: item,
  };
  if (text !== undefined) event.text = text;
  if (fromName !== undefined) event.fromName = fromName;
  if (mediaUrl !== undefined) event.mediaUrl = mediaUrl;
  return event;
}

function normalizeType(type) {
  const known = ['text', 'audio', 'image', 'video', 'document', 'sticker', 'location'];
  return known.includes(type) ? type : 'unknown';
}

/**
 * Kapso (like Meta) sends timestamps as unix-seconds strings. Convert to ISO-8601.
 * Returns undefined for garbage input.
 */
function normalizeTimestamp(ts) {
  if (typeof ts !== 'string' && typeof ts !== 'number') return undefined;
  const asNumber = typeof ts === 'string' ? Number(ts) : ts;
  if (!Number.isFinite(asNumber) || asNumber <= 0) return undefined;
  const d = new Date(asNumber * 1000);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

module.exports = { createWhatsAppKapsoAdapter };
