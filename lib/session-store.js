'use strict';

/**
 * In-memory session store for the wizard supervisor's control plane.
 *
 * Backs the control-server's /wizard endpoints. Tracks active wizard sessions
 * with a state machine and TTL semantics. Pure data structure — no I/O, no
 * HTTP, no filesystem. Clock and id generator are injectable so every
 * behaviour can be tested deterministically.
 *
 * State machine:
 *
 *     pending → ready → active → done
 *                    ↘        ↘
 *                     error    timeout
 *
 * Rules:
 *   - `pending`, `ready`, `active` are live states
 *   - `done`, `error`, `timeout` are terminal
 *   - `done` and `error` are set explicitly via update()
 *   - `timeout` is never set via update — it is *surfaced* at read time when
 *     a live session is found past its expiresAt. This means terminal states
 *     set via update win over timeout (an already-done session cannot regress
 *     to timeout just because a slow poller caught up late).
 *   - Once internally terminal, update() throws — callers must not mutate a
 *     session after done/error.
 *
 * Reads return frozen copies so the caller cannot mutate the internal state
 * by mutating the returned object.
 */

const crypto = require('node:crypto');

const LIVE_STATUSES = new Set(['pending', 'ready', 'active']);
const TERMINAL_VIA_UPDATE = new Set(['done', 'error']);
const VALID_UPDATE_STATUSES = new Set(['pending', 'ready', 'active', 'done', 'error']);

function createSessionStore(opts = {}) {
  const clock = opts.clock || (() => Date.now());
  const idGenerator = opts.idGenerator || (() => crypto.randomUUID());

  /** @type {Map<string, object>} */
  const sessions = new Map();

  // ── Internal predicates ───────────────────────────────────────────────

  function isInternalTerminal(session) {
    return TERMINAL_VIA_UPDATE.has(session._status);
  }

  function isSurfacedTimeout(session, now) {
    return LIVE_STATUSES.has(session._status) && now > session.expiresAt;
  }

  // Build an immutable public view of a session, applying timeout surfacing
  // for live sessions past their expiresAt.
  function readView(session) {
    const now = clock();
    const status = isSurfacedTimeout(session, now) ? 'timeout' : session._status;
    const view = {
      id: session.id,
      feature: session.feature,
      timeoutMs: session.timeoutMs,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      status,
    };
    // Include any user-set fields (e.g. port, token, error) that were merged
    // in via update. Underscore-prefixed fields are internal and hidden.
    for (const [key, val] of Object.entries(session)) {
      if (key.startsWith('_')) continue;
      if (key in view) continue;
      view[key] = val;
    }
    return Object.freeze(view);
  }

  // ── Public API ────────────────────────────────────────────────────────

  function create({ feature, timeoutMs } = {}) {
    if (typeof feature !== 'string' || feature.length === 0) {
      throw new Error('create: feature is required and must be a non-empty string');
    }
    if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('create: timeoutMs must be a positive finite number');
    }
    const now = clock();
    const id = idGenerator();
    const session = {
      id,
      feature,
      timeoutMs,
      createdAt: now,
      expiresAt: now + timeoutMs,
      _status: 'pending',
      _terminatedAt: null,
    };
    sessions.set(id, session);
    return readView(session);
  }

  function get(id) {
    const session = sessions.get(id);
    if (!session) return null;
    return readView(session);
  }

  function update(id, patch = {}) {
    const session = sessions.get(id);
    if (!session) {
      throw new Error(`update: session ${id} not found`);
    }
    const now = clock();
    // Terminal-wins: once a session is internally terminal OR has surfaced
    // timeout, no further updates are allowed. This prevents races where a
    // watchdog marks a session timeout after the setup-server reported done.
    if (isInternalTerminal(session)) {
      throw new Error(`update: session ${id} is terminal (${session._status}), cannot update`);
    }
    if (isSurfacedTimeout(session, now)) {
      throw new Error(`update: session ${id} is terminal (timeout), cannot update`);
    }

    // Status transition
    if (patch.status !== undefined) {
      if (!VALID_UPDATE_STATUSES.has(patch.status)) {
        throw new Error(`update: invalid status "${patch.status}"`);
      }
      session._status = patch.status;
      if (TERMINAL_VIA_UPDATE.has(patch.status)) {
        session._terminatedAt = now;
      }
    }

    // Merge arbitrary fields (port, token, error, etc.). Internal fields
    // cannot be set via update.
    for (const [key, val] of Object.entries(patch)) {
      if (key === 'status') continue;
      if (key.startsWith('_')) continue;
      if (key === 'id' || key === 'createdAt' || key === 'expiresAt' || key === 'timeoutMs') continue;
      session[key] = val;
    }

    return readView(session);
  }

  function remove(id) {
    const session = sessions.get(id);
    if (!session) return null;
    const view = readView(session);
    sessions.delete(id);
    return view;
  }

  function list() {
    return Array.from(sessions.values()).map(readView);
  }

  function cleanup({ graceMs = 0 } = {}) {
    const now = clock();
    const removed = [];
    for (const [id, session] of sessions) {
      const internal = isInternalTerminal(session);
      const timedOut = isSurfacedTimeout(session, now);
      if (!internal && !timedOut) continue;

      const terminatedAt = internal ? session._terminatedAt : session.expiresAt;
      if (now - terminatedAt > graceMs) {
        removed.push(readView(session));
        sessions.delete(id);
      }
    }
    return removed;
  }

  return { create, get, update, remove, list, cleanup };
}

module.exports = { createSessionStore };
