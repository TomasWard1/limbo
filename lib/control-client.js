'use strict';

/**
 * Control-plane HTTP client for the wizard supervisor.
 *
 * Host-side counterpart to control-server. Speaks HTTP over a Unix Domain
 * Socket exposed by the container (via a bind-mount from
 * ~/.limbo/control/supervisor.sock → /data/control/supervisor.sock inside).
 *
 * All methods return parsed JSON on success. On non-2xx responses, they
 * throw an Error whose .status and .body carry the server's response for
 * the caller to inspect. Connection-level errors (no server, socket
 * missing) propagate as-is with their usual .code (ENOENT, ECONNREFUSED).
 *
 *     const client = createControlClient({ socketPath });
 *     const session = await client.requestWizard({ feature, timeoutMs });
 *     const status = await client.getWizard(session.id);
 *     await client.cancelWizard(session.id);
 *     const health = await client.health();
 */

const http = require('node:http');

function createControlClient({ socketPath }) {
  if (typeof socketPath !== 'string' || socketPath.length === 0) {
    throw new Error('createControlClient: socketPath is required');
  }

  async function requestWizard({ feature, timeoutMs }) {
    return jsonRequest({
      socketPath,
      method: 'POST',
      path: '/wizard',
      body: { feature, timeoutMs },
      expect: 201,
    });
  }

  async function getWizard(id) {
    return jsonRequest({
      socketPath,
      method: 'GET',
      path: `/wizard/${encodeURIComponent(id)}`,
      expect: 200,
    });
  }

  async function cancelWizard(id) {
    await jsonRequest({
      socketPath,
      method: 'DELETE',
      path: `/wizard/${encodeURIComponent(id)}`,
      expect: 204,
    });
  }

  async function health() {
    return jsonRequest({
      socketPath,
      method: 'GET',
      path: '/health',
      expect: 200,
    });
  }

  return { requestWizard, getWizard, cancelWizard, health };
}

function jsonRequest({ socketPath, method, path, body, expect }) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined || body === null ? '' : JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json' };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const req = http.request({ socketPath, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        if (raw.length > 0) {
          try { parsed = JSON.parse(raw); } catch { parsed = raw; }
        }

        if (res.statusCode !== expect) {
          const errMessage = (parsed && parsed.error) || `unexpected status ${res.statusCode}`;
          const err = new Error(errMessage);
          err.status = res.statusCode;
          err.body = parsed;
          reject(err);
          return;
        }

        resolve(parsed);
      });
    });

    req.on('error', (err) => reject(err));
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = { createControlClient };
