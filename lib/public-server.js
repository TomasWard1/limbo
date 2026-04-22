'use strict';

/**
 * Public-facing HTTP server for Limbo Cloud instances.
 *
 * When LIMBO_PUBLIC_URL is set, this server listens on a public port (default 80)
 * and dispatches requests in this order:
 *   1. POST /channel/<name> — inbound webhook for a configured channel adapter
 *   2. Wizard proxy — when a wizard target is set
 *   3. Static HTML page — fallback
 *
 * This is the only internet-facing port. The OpenClaw gateway and control plane
 * stay on loopback.
 */

const http = require('node:http');

const STATIC_PAGE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Limbo</title></head>
<body>
<h1>Limbo</h1>
<p>Your instance is running. Use WhatsApp to chat.</p>
</body>
</html>`;

const MAX_WEBHOOK_BODY_BYTES = 1_048_576; // 1 MiB — generous for WhatsApp payloads

/**
 * @param {Object} opts
 * @param {number} opts.port
 * @param {string} [opts.host]
 * @param {Record<string, { onInbound: (payload: unknown, headers: Record<string,string>) => Promise<void> | void }>} [opts.channels]
 */
function createPublicServer({ port, host = '0.0.0.0', channels = {} }) {
  if (typeof port !== 'number' || port < 0 || port > 65535) {
    throw new Error('createPublicServer: port must be a number in 0..65535 (0 = ephemeral)');
  }

  let httpServer = null;
  let listeningPort = null;
  let started = false;
  let stopped = false;

  // { host: '127.0.0.1', port: number } when wizard is active, null otherwise
  let wizardTarget = null;

  function setWizardTarget(wizardPort) {
    wizardTarget = { host: '127.0.0.1', port: wizardPort };
  }

  function clearWizardTarget() {
    wizardTarget = null;
  }

  async function start() {
    if (started) {
      throw new Error('createPublicServer: start() already called on this instance');
    }
    started = true;

    httpServer = http.createServer(handleRequest);

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

  function handleRequest(req, res) {
    const url = req.url || '/';
    const channelMatch = url.match(/^\/channel\/([a-z0-9-]+)(?:\?|$)/);
    if (channelMatch) {
      handleChannelRoute(req, res, channelMatch[1]);
      return;
    }

    const target = wizardTarget;
    if (target) {
      proxyToWizard(req, res, target);
    } else {
      serveStaticPage(res);
    }
  }

  function handleChannelRoute(req, res, channelName) {
    const channel = channels[channelName];
    if (!channel) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('channel not configured');
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain', 'Allow': 'POST' });
      res.end('method not allowed');
      return;
    }

    collectBody(req, MAX_WEBHOOK_BODY_BYTES)
      .then((raw) => {
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('invalid JSON');
          return;
        }

        // ACK immediately, then run the handler in the background. Webhook
        // senders (Kapso) enforce short timeouts; we don't block on LLM latency.
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');

        Promise.resolve()
          .then(() => channel.onInbound(parsed, req.headers))
          .catch((err) => {
            // We've already ACK'd; best we can do is log. Supervisor wires
            // this to the structured logger when creating the server.
            // eslint-disable-next-line no-console
            console.error('public-server channel handler failed', {
              channel: channelName,
              error: err && err.message ? err.message : String(err),
            });
          });
      })
      .catch((err) => {
        if (res.headersSent) {
          try { res.destroy(); } catch {}
          return;
        }
        if (err && err.code === 'PAYLOAD_TOO_LARGE') {
          res.writeHead(413, { 'Content-Type': 'text/plain' });
          res.end('payload too large');
        } else {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('bad request');
        }
      });
  }

  function serveStaticPage(res) {
    const payload = Buffer.from(STATIC_PAGE, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': payload.length,
    });
    res.end(payload);
  }

  function proxyToWizard(req, res, target) {
    const proxyReq = http.request(
      {
        host: target.host,
        port: target.port,
        path: req.url,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${target.port}` },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      }
    );

    proxyReq.on('error', () => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Bad Gateway');
      } else {
        try { res.destroy(); } catch {}
      }
    });

    req.pipe(proxyReq, { end: true });
  }

  return {
    start,
    stop,
    setWizardTarget,
    clearWizardTarget,
    get port() { return listeningPort; },
  };
}

/**
 * Read the full body from a request, rejecting if it exceeds maxBytes.
 * @returns {Promise<string>}
 */
function collectBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        const err = new Error('payload too large');
        err.code = 'PAYLOAD_TOO_LARGE';
        req.destroy();
        reject(err);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = { createPublicServer };
