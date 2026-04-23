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
const DEFAULT_BASE_URL = 'https://api.kapso.ai';
const API_VERSION_PATH = '/meta/whatsapp/v24.0';
const WHATSAPP_TEXT_LIMIT = 4096; // Meta Cloud API hard limit per message

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

    // Kapso webhook schemas:
    //   v2 (current): message/conversation/phone_number_id at the root, one event per POST.
    //   legacy:       { type, data: [ {message, conversation?, phone_number_id}, ... ] }
    // We sniff the shape instead of relying on the header so the adapter works
    // in both replay/fixture tests and the live webhook path.
    const items = Array.isArray(rawPayload.data)
      ? rawPayload.data
      : (rawPayload.message ? [rawPayload] : null);
    if (items === null) {
      throw new Error('whatsapp-kapso: payload must contain either "data[]" or a root "message" object');
    }

    /** @type {import('./base').InboundEvent[]} */
    const events = [];
    for (const item of items) {
      const e = normalizeEvent(item);
      if (!e) continue;
      if (isValidInboundEvent(e)) events.push(e);
    }
    return events;
  }

  const baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const endpoint = `${baseUrl}${API_VERSION_PATH}/${encodeURIComponent(config.phoneNumberId)}/messages`;

  async function sendOnce(to, text) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.apiKey,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: text },
      }),
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new Error(`whatsapp-kapso: Kapso API ${res.status} — ${raw}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`whatsapp-kapso: non-JSON response from Kapso: ${raw}`);
    }
    const id = parsed.messages && parsed.messages[0] && parsed.messages[0].id;
    if (typeof id !== 'string' || !id) {
      throw new Error(`whatsapp-kapso: response missing messages[0].id: ${raw}`);
    }
    return id;
  }

  async function send(msg) {
    if (!msg || typeof msg !== 'object') {
      throw new Error('whatsapp-kapso: send() requires an OutboundMessage');
    }
    if (typeof msg.to !== 'string' || !msg.to) {
      throw new Error('whatsapp-kapso: send() requires "to"');
    }
    if (typeof msg.text !== 'string' || !msg.text) {
      throw new Error('whatsapp-kapso: send() requires non-empty "text"');
    }

    const chunks = splitForWhatsApp(msg.text, WHATSAPP_TEXT_LIMIT);
    let lastId = null;
    for (const chunk of chunks) {
      lastId = await sendOnce(msg.to, chunk);
    }
    return { messageId: /** @type {string} */ (lastId) };
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

  const rawFrom = typeof message.from === 'string' ? message.from : undefined;
  const from = rawFrom ? toE164(rawFrom) : undefined;
  const messageId = typeof message.id === 'string' ? message.id : undefined;
  const type = typeof message.type === 'string' ? message.type : 'unknown';
  const timestamp = normalizeTimestamp(message.timestamp);

  if (!from || !messageId || !timestamp) return null;

  let text;
  if (type === 'text' && message.text && typeof message.text.body === 'string') {
    text = message.text.body;
  } else if (kapso.transcript && typeof kapso.transcript.text === 'string' && kapso.transcript.text.length > 0) {
    text = kapso.transcript.text;
  } else if (typeof kapso.content === 'string' && kapso.content.length > 0) {
    // Kapso v2 surfaces text as kapso.content too; fall back for types other
    // than plain "text" that still carry a textual representation.
    text = kapso.content;
  }

  const mediaUrl = typeof kapso.media_url === 'string' ? kapso.media_url : undefined;
  // v2 puts contact_name on the conversation object; legacy puts it on kapso.
  const fromName = (item.conversation && typeof item.conversation.contact_name === 'string')
    ? item.conversation.contact_name
    : (typeof kapso.contact_name === 'string' ? kapso.contact_name : undefined);

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

/**
 * Split a string into chunks of at most `limit` code units. Splits on code-unit
 * boundaries (fine for WhatsApp — Meta enforces a 4096-char text limit).
 * @param {string} text
 * @param {number} limit
 * @returns {string[]}
 */
function splitForWhatsApp(text, limit) {
  if (text.length <= limit) return [text];
  const chunks = [];
  for (let i = 0; i < text.length; i += limit) {
    chunks.push(text.slice(i, i + limit));
  }
  return chunks;
}

/**
 * Kapso's v2 webhook omits the leading '+' on phone numbers; Meta's
 * send-message API and InboundEvent.from both expect proper E.164 with '+'.
 * Prepend it if the string starts with a digit and has no existing '+'.
 */
function toE164(raw) {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith('+')) return trimmed;
  if (/^\d+$/.test(trimmed)) return '+' + trimmed;
  return trimmed;
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
