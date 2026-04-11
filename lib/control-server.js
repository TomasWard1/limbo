'use strict';

/**
 * HTTP control-plane server bound to a TCP loopback port.
 *
 * This is the thin I/O wrapper around control-router. It owns the HTTP
 * server lifecycle (create, listen, close), parses incoming JSON request
 * bodies with a size cap, calls the router, and writes the response back
 * as JSON.
 *
 * Design notes:
 *   - Body cap of 128 KB. Wizard requests are tiny; anything near this is
 *     abuse. On overflow we drain the request and respond 413 so the client
 *     gets a proper answer instead of a connection reset.
 *   - Bound to 127.0.0.1 (NOT 0.0.0.0). The container's loopback interface
 *     is the only reachable path from the host via Docker's port mapping;
 *     LAN peers can never see this server. No token auth — the loopback
 *     bind IS the boundary.
 *   - Host header validation: rejects requests whose Host header is not
 *     127.0.0.1 / localhost / <listeningPort>, blocking DNS rebinding
 *     attacks from browser JavaScript.
 *   - start() is not re-entrant; stop() is idempotent. These make the
 *     supervisor's startup and shutdown paths easier to reason about.
 *
 * Transport history: this used to bind to a Unix domain socket on a
 * bind-mounted host path, but Docker Desktop and OrbStack on macOS do NOT
 * proxy AF_UNIX sockets through their file-sharing layer — virtiofs/9p
 * marshals file ops but not socket connect(2). TCP on 127.0.0.1 with
 * Docker port mapping is the portable primitive that works on every host.
 */

const http = require('node:http');

const MAX_BODY_BYTES = 128 * 1024;

function createControlServer({ router, port, host = '127.0.0.1' }) {
  if (!router || typeof router.handle !== 'function') {
    throw new Error('createControlServer: router is required');
  }
  if (typeof port !== 'number' || port < 0 || port > 65535) {
    throw new Error('createControlServer: port must be a number in 0..65535 (0 = ephemeral)');
  }

  let httpServer = null;
  let listeningPort = null;
  let started = false;
  let stopped = false;

  async function start() {
    if (started) {
      throw new Error('createControlServer: start() already called on this instance');
    }
    started = true;

    httpServer = http.createServer(handleRequest);

    // Prevent bad clients from crashing the whole server.
    httpServer.on('clientError', (err, socket) => {
      try { socket.destroy(); } catch {}
    });

    await new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(port, host, () => {
        const addr = httpServer.address();
        listeningPort = addr && typeof addr === 'object' ? addr.port : port;
        resolve();
      });
    });
  }

  async function stop() {
    if (stopped) return;
    stopped = true;
    if (!httpServer) return;
    await new Promise((resolve) => httpServer.close(() => resolve()));
    httpServer = null;
  }

  function isAllowedHost(hostHeader) {
    if (typeof hostHeader !== 'string' || hostHeader.length === 0) return false;
    // Strip port suffix if present — we only care about the hostname part
    // matching a loopback alias. Browser DNS-rebinding attacks set
    // Host: attacker.com so the exact-match check catches them.
    const bare = hostHeader.split(':')[0].toLowerCase();
    return bare === '127.0.0.1' || bare === 'localhost' || bare === '[::1]' || bare === '::1';
  }

  async function handleRequest(req, res) {
    // Host header validation — cheap defence against DNS-rebinding attacks
    // from browser JavaScript. Any non-loopback Host header gets 403 before
    // we even parse the body.
    if (!isAllowedHost(req.headers.host)) {
      writeResponse(res, { status: 403, body: { error: 'invalid host header' } });
      return;
    }

    try {
      const body = await readJsonBody(req);
      const result = await router.handle({
        method: req.method,
        path: req.url,
        body,
      });
      writeResponse(res, result);
    } catch (err) {
      if (err && err.code === 'BODY_TOO_LARGE') {
        writeResponse(res, { status: 413, body: { error: 'request body too large' } });
        return;
      }
      if (err && err.code === 'INVALID_JSON') {
        writeResponse(res, { status: 400, body: { error: 'invalid JSON body' } });
        return;
      }
      writeResponse(res, {
        status: 500,
        body: { error: (err && err.message) || String(err) },
      });
    }
  }

  return {
    start,
    stop,
    get port() { return listeningPort; },
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    // GET / DELETE / HEAD: drain any incoming bytes, return null.
    if (req.method === 'GET' || req.method === 'DELETE' || req.method === 'HEAD') {
      req.resume();
      req.on('end', () => resolve(null));
      req.on('error', reject);
      return;
    }

    const chunks = [];
    let total = 0;
    let overLimit = false;

    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        overLimit = true;
        return; // stop buffering; drain the rest quietly
      }
      if (!overLimit) chunks.push(chunk);
    });
    req.on('end', () => {
      if (overLimit) {
        const err = new Error('body too large');
        err.code = 'BODY_TOO_LARGE';
        reject(err);
        return;
      }
      if (chunks.length === 0) {
        resolve(null);
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(JSON.parse(raw));
      } catch {
        const err = new Error('invalid JSON');
        err.code = 'INVALID_JSON';
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function writeResponse(res, { status, body }) {
  const payload = body === null || body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

module.exports = { createControlServer };
