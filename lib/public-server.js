'use strict';

/**
 * Public-facing HTTP server for Limbo Cloud instances.
 *
 * When LIMBO_PUBLIC_URL is set, this server listens on a public port (default 80)
 * and dispatches requests in this order:
 *   1. Wizard proxy — when a wizard target is set
 *   2. Static HTML page — fallback
 *
 * This is the only internet-facing port. The OpenClaw gateway and control plane
 * stay on loopback. Channel webhooks (WhatsApp, etc.) are handled by OpenClaw
 * plugins mounted on the gateway's HTTP host, not by this server.
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

/**
 * @param {Object} opts
 * @param {number} opts.port
 * @param {string} [opts.host]
 */
function createPublicServer({ port, host = '0.0.0.0' }) {
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
    const target = wizardTarget;
    if (target) {
      proxyToWizard(req, res, target);
    } else {
      serveStaticPage(res);
    }
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

module.exports = { createPublicServer };

