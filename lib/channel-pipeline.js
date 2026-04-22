'use strict';

/**
 * Channel pipeline — the async worker between an adapter's inbound events and
 * the agent + adapter's outbound send. Webhooks ACK 200 immediately; the
 * pipeline handles LLM latency without blocking HTTP.
 *
 * Responsibilities:
 *  - bounded queue with drop-oldest-on-overflow
 *  - messageId-based dedup with TTL (Kapso retries deliver the same webhook;
 *    we only want to answer once per inbound message)
 *  - per-event isolation: one failure does not poison siblings
 *  - graceful stop: drain in-flight, reject further enqueues
 *
 * Logging is structured enough that the pipeline stays quiet on happy path
 * and loud on errors / drops. The logger is injected so the supervisor can
 * route messages to the right place.
 */

const DEFAULT_QUEUE_CAP = 64;
const DEFAULT_DEDUP_TTL_MS = 5 * 60_000; // 5 minutes

/**
 * @param {Object} opts
 * @param {import('./channel-adapters/base').ChannelAdapter} opts.adapter
 * @param {{ sendChat: (args: { user: string, text: string }) => Promise<string> }} opts.openclaw
 * @param {{info: Function, warn: Function, error: Function}} [opts.logger]
 * @param {number} [opts.queueCap]
 * @param {number} [opts.dedupTtlMs]
 */
function createChannelPipeline(opts) {
  if (!opts || !opts.adapter) {
    throw new Error('channel-pipeline: adapter is required');
  }
  if (!opts.openclaw || typeof opts.openclaw.sendChat !== 'function') {
    throw new Error('channel-pipeline: openclaw.sendChat is required');
  }

  const adapter = opts.adapter;
  const openclaw = opts.openclaw;
  const logger = opts.logger || console;
  const queueCap = typeof opts.queueCap === 'number' && opts.queueCap > 0 ? opts.queueCap : DEFAULT_QUEUE_CAP;
  const dedupTtlMs = typeof opts.dedupTtlMs === 'number' && opts.dedupTtlMs > 0 ? opts.dedupTtlMs : DEFAULT_DEDUP_TTL_MS;

  /** @type {import('./channel-adapters/base').InboundEvent[]} */
  const queue = [];
  /** @type {Map<string, number>} */
  const seen = new Map();
  let stopped = false;
  let draining = false;
  /** @type {Promise<void> | null} */
  let drainPromise = null;

  function isDuplicate(event) {
    const now = Date.now();
    // Sweep expired entries opportunistically (cheap — O(n) where n is small).
    for (const [id, expiresAt] of seen) {
      if (expiresAt <= now) seen.delete(id);
    }
    if (seen.has(event.messageId)) return true;
    seen.set(event.messageId, now + dedupTtlMs);
    return false;
  }

  function enqueue(event) {
    if (stopped) {
      throw new Error('channel-pipeline: stopped; cannot enqueue');
    }
    if (!event || typeof event !== 'object' || typeof event.messageId !== 'string') {
      throw new Error('channel-pipeline: event.messageId is required');
    }
    if (isDuplicate(event)) {
      logger.info('channel-pipeline: duplicate event skipped', { messageId: event.messageId });
      return;
    }
    queue.push(event);
    while (queue.length > queueCap) {
      const dropped = queue.shift();
      logger.warn('channel-pipeline: queue full — drop oldest event', {
        messageId: dropped.messageId,
        queueCap,
      });
    }
    kickDrain();
  }

  function kickDrain() {
    if (draining) return;
    draining = true;
    drainPromise = drain()
      .catch((err) => logger.error('channel-pipeline: drain crashed', err))
      .finally(() => {
        draining = false;
        drainPromise = null;
      });
  }

  async function drain() {
    while (queue.length > 0) {
      const event = queue.shift();
      try {
        const text = event.text || '';
        if (!text) {
          logger.info('channel-pipeline: skip event without text', { messageId: event.messageId, type: event.type });
          continue;
        }
        const reply = await openclaw.sendChat({ user: event.from, text });
        await adapter.send({ to: event.from, text: reply, replyToId: event.messageId });
      } catch (err) {
        logger.error('channel-pipeline: event failed', {
          messageId: event.messageId,
          error: err && err.message ? err.message : String(err),
        });
      }
    }
  }

  async function stop() {
    stopped = true;
    if (drainPromise) {
      await drainPromise;
    }
  }

  return { enqueue, stop };
}

module.exports = { createChannelPipeline, DEFAULT_QUEUE_CAP, DEFAULT_DEDUP_TTL_MS };
