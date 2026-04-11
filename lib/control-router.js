'use strict';

/**
 * Control-plane router for the wizard supervisor.
 *
 * Pure function that maps a parsed HTTP request to a response:
 *
 *     router.handle({ method, path, body }) → { status, body }
 *
 * The router owns no I/O. The HTTP wrapper (control-server) parses the
 * request, calls handle(), and writes the response back. The router talks
 * to an injected session store and to injected side-effect handlers that
 * the real supervisor wires to spawn/kill the setup-server process.
 *
 * Routes:
 *
 *     POST   /wizard         create session, call onWizardRequested
 *     GET    /wizard/:id     read session state
 *     DELETE /wizard/:id     call onWizardCancelled, remove session
 *     GET    /health         supervisor health snapshot
 *
 * Response bodies are JSON objects (or null for 204). Errors come back as
 * { error: string } with the appropriate status code.
 *
 * Concurrency: only ONE live (pending/ready/active) wizard session is
 * allowed at a time. A second POST /wizard while another is live returns
 * 409 Conflict with the active session id so the caller can decide to
 * cancel it or wait. This prevents the port collision that used to happen
 * when the wizard spawner tried to bind LIMBO_PORT+1 a second time.
 */

const LIVE_STATUSES = new Set(['pending', 'ready', 'active']);

function createControlRouter({ store, handlers }) {
  if (!store) throw new Error('createControlRouter: store is required');
  if (!handlers || typeof handlers.onWizardRequested !== 'function' || typeof handlers.onWizardCancelled !== 'function') {
    throw new Error('createControlRouter: handlers.onWizardRequested and handlers.onWizardCancelled are required');
  }

  async function handle({ method, path, body }) {
    const route = matchRoute(path);
    if (!route) {
      return notFound(`unknown route: ${path}`);
    }
    switch (route.name) {
      case 'wizard_root': return handleWizardRoot(method, body);
      case 'wizard_by_id': return handleWizardById(method, route.id);
      case 'health': return handleHealth(method);
      default: return notFound(`unknown route: ${path}`);
    }
  }

  async function handleWizardRoot(method, body) {
    if (method !== 'POST') return methodNotAllowed();

    if (!body || typeof body !== 'object') {
      return badRequest('body must be a JSON object');
    }

    // Concurrency guard: reject if there is already a live wizard session.
    // `store.list()` applies timeout surfacing at read time, so sessions
    // past their expiresAt will show up as `timeout` and NOT block a new
    // request. Only truly-live (pending/ready/active) sessions block.
    const active = store.list().find((s) => LIVE_STATUSES.has(s.status));
    if (active) {
      return {
        status: 409,
        body: {
          error: 'a wizard is already active',
          activeSessionId: active.id,
          activeSessionFeature: active.feature,
          activeSessionStatus: active.status,
        },
      };
    }

    // Step 1: create the session. store.create validates feature + timeoutMs
    // and throws on invalid input, which becomes a 400.
    let session;
    try {
      session = store.create({ feature: body.feature, timeoutMs: body.timeoutMs });
    } catch (err) {
      return badRequest(err.message || String(err));
    }

    // Step 2: invoke the side-effect handler (spawn the setup-server).
    // On success, transition the session to ready and return it.
    // On failure, transition to error for debuggability and return 500.
    try {
      const result = await handlers.onWizardRequested({
        feature: session.feature,
        timeoutMs: session.timeoutMs,
        session,
      });
      const updated = store.update(session.id, {
        status: 'ready',
        ...(result || {}),
      });
      return { status: 201, body: updated };
    } catch (err) {
      try {
        store.update(session.id, { status: 'error', error: err.message || String(err) });
      } catch { /* session may have been reaped; ignore */ }
      return { status: 500, body: { error: err.message || String(err) } };
    }
  }

  async function handleWizardById(method, id) {
    if (method === 'GET') {
      const session = store.get(id);
      if (!session) return notFound(`session ${id} not found`);
      return { status: 200, body: session };
    }

    if (method === 'DELETE') {
      const session = store.get(id);
      if (!session) return notFound(`session ${id} not found`);
      let handlerError = null;
      try {
        await handlers.onWizardCancelled(session);
      } catch (err) {
        handlerError = err;
      }
      // Always remove the session even if the cancel handler threw,
      // we must not leak state. A zombie session in the store would block
      // future DELETEs and confuse polling clients.
      store.remove(id);
      if (handlerError) {
        return { status: 500, body: { error: handlerError.message || String(handlerError) } };
      }
      return { status: 204, body: null };
    }

    return methodNotAllowed();
  }

  function handleHealth(method) {
    if (method !== 'GET') return methodNotAllowed();
    return {
      status: 200,
      body: { ok: true, activeSessions: store.list().length },
    };
  }

  return { handle };
}

function matchRoute(path) {
  if (path === '/wizard') return { name: 'wizard_root' };
  if (path === '/health') return { name: 'health' };
  const m = /^\/wizard\/([^/]+)$/.exec(path);
  if (m) return { name: 'wizard_by_id', id: m[1] };
  return null;
}

function notFound(error) {
  return { status: 404, body: { error } };
}

function methodNotAllowed() {
  return { status: 405, body: { error: 'method not allowed' } };
}

function badRequest(error) {
  return { status: 400, body: { error } };
}

module.exports = { createControlRouter };
