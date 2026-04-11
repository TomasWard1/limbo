'use strict';

/**
 * Control-plane HTTP client for the wizard supervisor.
 *
 * Host-side counterpart to control-server. Speaks HTTP over a TCP
 * loopback port exposed by the container (via Docker port mapping,
 * 127.0.0.1:${LIMBO_CONTROL_PORT} → same port inside).
 *
 * All methods return parsed JSON on success. On non-2xx responses, they
 * throw an Error whose .status and .body carry the server's response for
 * the caller to inspect. Connection-level errors (no server, port closed)
 * propagate as-is with their usual .code (ECONNREFUSED).
 *
 *     const client = createControlClient({ port });
 *     const session = await client.requestWizard({ feature, timeoutMs });
 *     const status = await client.getWizard(session.id);
 *     await client.cancelWizard(session.id);
 *     const health = await client.health();
 */

const http = require('node:http');

function createControlClient({ port, host = '127.0.0.1' }) {
  if (typeof port !== 'number' || port <= 0 || port > 65535) {
    throw new Error('createControlClient: port must be a positive number in 1..65535');
  }

  async function requestWizard({ feature, timeoutMs }) {
    return jsonRequest({
      host, port,
      method: 'POST',
      path: '/wizard',
      body: { feature, timeoutMs },
      expect: 201,
    });
  }

  async function getWizard(id) {
    return jsonRequest({
      host, port,
      method: 'GET',
      path: `/wizard/${encodeURIComponent(id)}`,
      expect: 200,
    });
  }

  async function cancelWizard(id) {
    await jsonRequest({
      host, port,
      method: 'DELETE',
      path: `/wizard/${encodeURIComponent(id)}`,
      expect: 204,
    });
  }

  async function health() {
    return jsonRequest({
      host, port,
      method: 'GET',
      path: '/health',
      expect: 200,
    });
  }

  return { requestWizard, getWizard, cancelWizard, health };
}

function jsonRequest({ host, port, method, path, body, expect }) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined || body === null ? '' : JSON.stringify(body);
    // The Host header defaults to `${host}:${port}` which the server's
    // Host-header whitelist accepts (127.0.0.1, localhost, ::1). We set it
    // explicitly to make the contract obvious and the tests deterministic.
    const headers = {
      'Content-Type': 'application/json',
      Host: `${host}:${port}`,
    };
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const req = http.request({ host, port, path, method, headers }, (res) => {
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
