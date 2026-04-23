'use strict';

/**
 * Channel adapter base — Ports & Adapters contract for inbound/outbound messaging.
 *
 * Every channel (WhatsApp-Kapso, future Twilio, Discord, etc.) implements the
 * ChannelAdapter shape below. The rest of Limbo (public-server, pipeline,
 * OpenClaw client) works against this interface, so swapping the transport is
 * a local change to one file.
 *
 * This file is deliberately zero-dependency and runtime-only. The typedefs are
 * contract documentation; `isValidInboundEvent` is the runtime guard used by
 * concrete adapters after they normalize their channel-native payload.
 */

/**
 * @typedef {'text'|'audio'|'image'|'video'|'document'|'sticker'|'location'|'unknown'} InboundEventType
 */

/**
 * @typedef {Object} InboundEvent
 * @property {string}  channelId — stable id ("whatsapp-kapso", "telegram", …)
 * @property {string}  from — sender identifier in channel-native form (E.164 phone for WhatsApp)
 * @property {string=} fromName — display name if the channel provides one
 * @property {string}  messageId — channel-native message id (used for dedup)
 * @property {string}  timestamp — ISO-8601
 * @property {InboundEventType} type
 * @property {string=} text — text payload when type='text' or a transcript is available
 * @property {string=} mediaUrl — URL to fetch media when present
 * @property {Object=} raw — original payload (for debugging / replay)
 */

/**
 * @typedef {Object} OutboundMessage
 * @property {string}  to        — recipient identifier
 * @property {string}  text      — message body
 * @property {string=} replyToId — original message id to thread replies against
 */

/**
 * @typedef {Object} AdapterCapabilities
 * @property {boolean} supportsVoice
 * @property {boolean} supportsProactive
 * @property {number}  proactiveCostUSD
 * @property {boolean} supportsMediaOut
 */

/**
 * @typedef {Object} ChannelAdapter
 * @property {string} id
 * @property {(rawPayload: unknown, headers: Record<string,string>) => Promise<InboundEvent[]>} receive
 * @property {(msg: OutboundMessage) => Promise<{ messageId: string }>} send
 * @property {() => AdapterCapabilities} capabilities
 */

const INBOUND_EVENT_TYPES = new Set([
  'text', 'audio', 'image', 'video', 'document', 'sticker', 'location', 'unknown',
]);

const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * Runtime guard: returns true iff `event` satisfies the InboundEvent contract.
 * Used by concrete adapters to validate the output of their own receive() path
 * before handing events off to the pipeline.
 *
 * @param {unknown} event
 * @returns {boolean}
 */
function isValidInboundEvent(event) {
  if (event === null || typeof event !== 'object' || Array.isArray(event)) {
    return false;
  }
  const e = /** @type {Record<string, unknown>} */ (event);

  if (typeof e.channelId !== 'string' || e.channelId.length === 0) return false;
  if (typeof e.from !== 'string' || e.from.length === 0) return false;
  if (typeof e.messageId !== 'string' || e.messageId.length === 0) return false;
  if (typeof e.timestamp !== 'string' || !ISO_8601_RE.test(e.timestamp)) return false;
  if (typeof e.type !== 'string' || !INBOUND_EVENT_TYPES.has(e.type)) return false;
  if (e.type === 'text' && (typeof e.text !== 'string' || e.text.length === 0)) return false;

  return true;
}

module.exports = {
  isValidInboundEvent,
  INBOUND_EVENT_TYPES,
};
