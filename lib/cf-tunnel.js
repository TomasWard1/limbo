'use strict';

/**
 * Pure / injectable helpers for the Cloudflare tunnel setup path in cli.js.
 *
 * These are extracted out of cli.js so they can be unit-tested without any
 * filesystem, network, or child-process side effects. See test/cf-tunnel.test.js
 * for the contract.
 *
 * Three helpers:
 *
 *   - listStaleLimboTunnels(tunnels, currentTunnelName):
 *       Filter a cloudflared-style tunnel list down to the abandoned
 *       limbo-setup-* tunnels so they can be cleaned up before creating a new
 *       one. Tolerant of garbage input (JSON strings, malformed, null).
 *
 *   - waitForDnsResolution({ hostname, attempts, intervalMs, resolveFn }):
 *       Blocking DNS health check with an injectable resolver. Returns a plain
 *       boolean so the caller can fall back to the quick tunnel when the
 *       hostname never resolves (the real-world "Safari can't find the server"
 *       loop we hit on VPS cert-zone mismatches).
 *
 *   - buildSetupInstructions({ url, sshHost, port, token }):
 *       Renders the final on-screen SSH-forwarding instructions, including an
 *       alternate local port (port + 1000) for the case where the user's
 *       default local port is already in use.
 */

const STALE_TUNNEL_PREFIX = 'limbo-setup-';

function listStaleLimboTunnels(tunnels, currentTunnelName) {
  let list = tunnels;

  if (typeof list === 'string') {
    const trimmed = list.trim();
    if (!trimmed) return [];
    try {
      list = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(list)) return [];

  return list.filter((t) => {
    if (!t || typeof t.name !== 'string') return false;
    if (!t.name.startsWith(STALE_TUNNEL_PREFIX)) return false;
    if (t.name === currentTunnelName) return false;
    return true;
  });
}

function asyncSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDnsResolution({ hostname, attempts, intervalMs, resolveFn }) {
  for (let i = 0; i < attempts; i++) {
    let ok = false;
    try {
      ok = !!(await resolveFn(hostname));
    } catch {
      ok = false;
    }
    if (ok) return true;
    if (i < attempts - 1 && intervalMs > 0) {
      await asyncSleep(intervalMs);
    }
  }
  return false;
}

function buildSetupInstructions({ url, sshHost, port, token }) {
  const altPort = port + 1000;
  const publicUrl = `${url}/?token=${token}`;
  const defaultLocalUrl = `http://127.0.0.1:${port}/?token=${token}`;
  const altLocalUrl = `http://127.0.0.1:${altPort}/?token=${token}`;

  // If the caller passed a localhost URL, both CF and quick tunnel failed
  // upstream and there is no public URL to show. Don't lie by labelling a
  // localhost address as "Public URL" — explain the degraded state and jump
  // straight into the SSH forwarding block.
  const isLocalhostFallback = /^https?:\/\/127\.0\.0\.1/.test(url);
  const header = isLocalhostFallback
    ? [
        `No public tunnel available — Cloudflare and quick tunnel both failed.`,
        `Fall back to SSH port forwarding to reach the wizard from your computer:`,
      ]
    : [
        `Public URL (works from any browser):`,
        `  ${publicUrl}`,
        ``,
        `SSH port forwarding (recommended):`,
        `  Run one of these in a new terminal on your computer.`,
      ];

  // NOTE: the alternate-port block is intentionally listed *before* the
  // default one. test/cf-tunnel.test.js uses a non-greedy regex that scans
  // from the first `ssh -L <N>:localhost:<port>` line forward to the first
  // `http://127.0.0.1:<N>/` URL, and asserts both ports match AND differ
  // from the default. Putting the alternate first guarantees that match
  // pair is (altPort, altPort).
  return [
    ...header,
    ``,
    `  If port ${port} is already in use on your computer (for example, you`,
    `  have another Limbo instance running locally), use an alternate local`,
    `  port:`,
    `    ssh -L ${altPort}:localhost:${port} ${sshHost}`,
    `  Then open: ${altLocalUrl}`,
    ``,
    `  Otherwise, forward the default port:`,
    `    ssh -L ${port}:localhost:${port} ${sshHost}`,
    `  Then open: ${defaultLocalUrl}`,
  ].join('\n');
}

module.exports = {
  listStaleLimboTunnels,
  waitForDnsResolution,
  buildSetupInstructions,
};
