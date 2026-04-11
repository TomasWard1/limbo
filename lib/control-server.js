'use strict';

/**
 * HTTP control-plane server bound to a Unix Domain Socket.
 *
 * This is the thin I/O wrapper around control-router. It owns the socket
 * lifecycle (create, bind, clean stale, unlink on stop), parses incoming
 * JSON request bodies with a size cap, calls the router, and writes the
 * response back as JSON.
 *
 * Design notes:
 *   - Body cap of 128 KB. Wizard requests are tiny; anything near this is
 *     abuse. On overflow we drain the request and respond 413 so the client
 *     gets a proper answer instead of a connection reset.
 *   - Stale-socket cleanup on start. If a previous supervisor crashed and
 *     left a file at the socket path, we unlink it before binding. Same
 *     pattern Docker's daemon uses.
 *   - Socket is chmod 0600 after bind so only the owner (uid 999 inside the
 *     container, or the user on the host side of the bind mount) can talk
 *     to it.
 *   - start() is not re-entrant; stop() is idempotent. These make the
 *     supervisor's startup and shutdown paths easier to reason about.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const MAX_BODY_BYTES = 128 * 1024;

function createControlServer({ router, socketPath }) {
  if (!router || typeof router.handle !== 'function') {
    throw new Error('createControlServer: router is required');
  }
  if (typeof socketPath !== 'string' || socketPath.length === 0) {
    throw new Error('createControlServer: socketPath is required');
  }

  let httpServer = null;
  let started = false;
  let stopped = false;

  async function start() {
    if (started) {
      throw new Error('createControlServer: start() already called on this instance');
    }
    started = true;

    // Clean up stale socket (or regular file) from a previous crashed run.
    try {
      fs.unlinkSync(socketPath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    // Ensure the parent directory exists (first run on a fresh container).
    try {
      fs.mkdirSync(path.dirname(socketPath), { recursive: true });
    } catch { /* non-fatal */ }

    httpServer = http.createServer(handleRequest);

    // Prevent bad clients from crashing the whole server.
    httpServer.on('clientError', (err, socket) => {
      try { socket.destroy(); } catch {}
    });

    await new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(socketPath, () => {
        try { fs.chmodSync(socketPath, 0o600); } catch {}
        resolve();
      });
    });
  }

  async function stop() {
    if (stopped) return;
    stopped = true;
    if (!httpServer) return;
    await new Promise((resolve) => httpServer.close(() => resolve()));
    try { fs.unlinkSync(socketPath); } catch {}
    httpServer = null;
  }

  async function handleRequest(req, res) {
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
    get socketPath() { return socketPath; },
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
