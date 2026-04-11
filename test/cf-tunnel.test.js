/**
 * Unit tests for Cloudflare tunnel setup helpers.
 *
 * Covers three pure / injectable helpers extracted from cli.js:
 *
 *   - listStaleLimboTunnels:  cleanup of abandoned limbo-setup-* tunnels
 *     (so `limbo connect-calendar` is self-healing and does not leak tunnels
 *     to Cloudflare on repeated runs)
 *
 *   - waitForDnsResolution:   blocking DNS health check with an injectable
 *     resolver, so the named-tunnel path can abort and fall back to the quick
 *     tunnel when the hostname never resolves (root cause of the "Safari can't
 *     find the server" loop on the real VPS)
 *
 *   - buildSetupInstructions: renders the final on-screen instructions,
 *     including an alternate local port for SSH forwarding when 18900 is
 *     already taken on the user's machine
 *
 * Run: node --test test/cf-tunnel.test.js
 */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  listStaleLimboTunnels,
  waitForDnsResolution,
  buildSetupInstructions,
} = require('../lib/cf-tunnel');

// ──────────────────────────────────────────────────────────────────────────
// listStaleLimboTunnels
// ──────────────────────────────────────────────────────────────────────────

test('listStaleLimboTunnels: returns all limbo-setup-* tunnels except current', () => {
  const tunnels = [
    { id: 'aaa', name: 'aios-bridge' },
    { id: 'bbb', name: 'comidas' },
    { id: 'ccc', name: 'limbo-setup-801ace6' },
    { id: 'ddd', name: 'limbo-setup-ee25198' },
    { id: 'eee', name: 'limbo-setup-current' },
  ];

  const stale = listStaleLimboTunnels(tunnels, 'limbo-setup-current');

  assert.equal(stale.length, 2);
  assert.deepEqual(stale.map(t => t.name).sort(), ['limbo-setup-801ace6', 'limbo-setup-ee25198']);
});

test('listStaleLimboTunnels: empty list returns empty', () => {
  assert.deepEqual(listStaleLimboTunnels([], 'limbo-setup-current'), []);
});

test('listStaleLimboTunnels: no limbo-setup-* tunnels returns empty', () => {
  const tunnels = [
    { id: 'aaa', name: 'aios-bridge' },
    { id: 'bbb', name: 'comidas' },
  ];
  assert.deepEqual(listStaleLimboTunnels(tunnels, 'limbo-setup-current'), []);
});

test('listStaleLimboTunnels: does NOT match tunnels that merely contain "limbo-setup"', () => {
  // Guard against false positives if someone names an unrelated tunnel with
  // "limbo-setup" as a substring. Only exact prefix should match.
  const tunnels = [
    { id: 'aaa', name: 'my-limbo-setup-custom' },
    { id: 'bbb', name: 'limbo-setup-real' },
  ];
  const stale = listStaleLimboTunnels(tunnels, 'limbo-setup-current');
  assert.deepEqual(stale.map(t => t.name), ['limbo-setup-real']);
});

test('listStaleLimboTunnels: accepts JSON string input', () => {
  // cloudflared tunnel list -o json returns a JSON array as a string
  const json = JSON.stringify([
    { id: 'aaa', name: 'limbo-setup-old' },
    { id: 'bbb', name: 'limbo-setup-current' },
  ]);
  const stale = listStaleLimboTunnels(json, 'limbo-setup-current');
  assert.deepEqual(stale.map(t => t.name), ['limbo-setup-old']);
});

test('listStaleLimboTunnels: malformed JSON returns empty (no throw)', () => {
  // cloudflared might be missing or its output might be garbage. We should
  // never crash the main flow just because cleanup couldn't parse a list.
  assert.deepEqual(listStaleLimboTunnels('not json at all', 'limbo-setup-current'), []);
  assert.deepEqual(listStaleLimboTunnels('', 'limbo-setup-current'), []);
  assert.deepEqual(listStaleLimboTunnels(null, 'limbo-setup-current'), []);
  assert.deepEqual(listStaleLimboTunnels(undefined, 'limbo-setup-current'), []);
});

test('listStaleLimboTunnels: null currentTunnelName returns ALL limbo-setup-* tunnels', () => {
  // Unified cleanup path: when called from cleanupCfTunnel() (startup sweep),
  // there is no "current" tunnel to preserve — every limbo-setup-* is stale.
  const tunnels = [
    { id: 'aaa', name: 'aios-bridge' },
    { id: 'bbb', name: 'limbo-setup-801ace6' },
    { id: 'ccc', name: 'limbo-setup-ee25198' },
    { id: 'ddd', name: 'comidas' },
  ];
  const stale = listStaleLimboTunnels(tunnels, null);
  assert.deepEqual(
    stale.map(t => t.name).sort(),
    ['limbo-setup-801ace6', 'limbo-setup-ee25198'],
  );
});

test('listStaleLimboTunnels: undefined currentTunnelName returns ALL limbo-setup-* tunnels', () => {
  const tunnels = [
    { id: 'aaa', name: 'limbo-setup-801ace6' },
    { id: 'bbb', name: 'limbo-setup-ee25198' },
  ];
  const stale = listStaleLimboTunnels(tunnels, undefined);
  assert.deepEqual(
    stale.map(t => t.name).sort(),
    ['limbo-setup-801ace6', 'limbo-setup-ee25198'],
  );
});

test('listStaleLimboTunnels: missing currentTunnelName arg returns ALL limbo-setup-* tunnels', () => {
  // Unified helper must be safe to call with a single arg (no current name).
  const tunnels = [
    { id: 'aaa', name: 'limbo-setup-abcdef0' },
    { id: 'bbb', name: 'unrelated' },
    { id: 'ccc', name: 'limbo-setup-1234567' },
  ];
  const stale = listStaleLimboTunnels(tunnels);
  assert.deepEqual(
    stale.map(t => t.name).sort(),
    ['limbo-setup-1234567', 'limbo-setup-abcdef0'],
  );
});

test('listStaleLimboTunnels: null currentTunnelName still ignores non-prefix tunnels', () => {
  // Safety: the "cleanup all" path must still be anchored to the limbo-setup-
  // prefix. We must never sweep user tunnels just because currentTunnelName
  // is null.
  const tunnels = [
    { id: 'aaa', name: 'aios-bridge' },
    { id: 'bbb', name: 'my-limbo-setup-custom' },
    { id: 'ccc', name: 'comidas' },
  ];
  const stale = listStaleLimboTunnels(tunnels, null);
  assert.deepEqual(stale, []);
});

// ──────────────────────────────────────────────────────────────────────────
// waitForDnsResolution
// ──────────────────────────────────────────────────────────────────────────

test('waitForDnsResolution: resolves true on first successful attempt', async () => {
  let calls = 0;
  const result = await waitForDnsResolution({
    hostname: 'setup-abc.heylimbo.com',
    attempts: 5,
    intervalMs: 0,
    resolveFn: async () => { calls++; return true; },
  });

  assert.equal(result, true);
  assert.equal(calls, 1);
});

test('waitForDnsResolution: retries until success', async () => {
  let calls = 0;
  const result = await waitForDnsResolution({
    hostname: 'setup-abc.heylimbo.com',
    attempts: 10,
    intervalMs: 0,
    resolveFn: async () => { calls++; return calls >= 3; },
  });

  assert.equal(result, true);
  assert.equal(calls, 3);
});

test('waitForDnsResolution: returns false after exhausting attempts', async () => {
  let calls = 0;
  const result = await waitForDnsResolution({
    hostname: 'setup-abc.heylimbo.com',
    attempts: 4,
    intervalMs: 0,
    resolveFn: async () => { calls++; return false; },
  });

  assert.equal(result, false);
  assert.equal(calls, 4);
});

test('waitForDnsResolution: treats resolver errors as failed attempts', async () => {
  let calls = 0;
  const result = await waitForDnsResolution({
    hostname: 'setup-abc.heylimbo.com',
    attempts: 3,
    intervalMs: 0,
    resolveFn: async () => { calls++; throw new Error('ENOTFOUND'); },
  });

  assert.equal(result, false);
  assert.equal(calls, 3);
});

test('waitForDnsResolution: false result triggers fallback decision upstream', async () => {
  // This test exists to lock in the contract: when DNS never resolves,
  // the function returns false (not throws, not null). Callers rely on
  // boolean semantics to trigger the quick-tunnel fallback.
  const result = await waitForDnsResolution({
    hostname: 'setup-doesnotexist.heylimbo.com',
    attempts: 2,
    intervalMs: 0,
    resolveFn: async () => false,
  });
  assert.equal(typeof result, 'boolean');
  assert.equal(result, false);
});

// ──────────────────────────────────────────────────────────────────────────
// buildSetupInstructions
// ──────────────────────────────────────────────────────────────────────────

test('buildSetupInstructions: includes the public tunnel URL', () => {
  const out = buildSetupInstructions({
    url: 'https://setup-abc.heylimbo.com',
    sshHost: 'aios@100.114.123.103',
    port: 18900,
    token: 'tok_xyz',
  });
  assert.ok(out.includes('https://setup-abc.heylimbo.com/?token=tok_xyz'),
    'output should contain the full tunnel URL with token');
});

test('buildSetupInstructions: includes SSH forwarding with default port', () => {
  const out = buildSetupInstructions({
    url: 'https://setup-abc.heylimbo.com',
    sshHost: 'aios@100.114.123.103',
    port: 18900,
    token: 'tok_xyz',
  });
  assert.ok(out.includes('ssh -L 18900:localhost:18900 aios@100.114.123.103'),
    'should include default SSH forward command');
  assert.ok(out.includes('http://127.0.0.1:18900/?token=tok_xyz'),
    'should include default local URL');
});

test('buildSetupInstructions: includes alternate port hint when default is taken', () => {
  // The whole point of this helper: if 18900 is already in use on the user's
  // computer (e.g. because they have limbo-e2e-test running), they should not
  // be stuck. The instructions must show them an alternate local port.
  const out = buildSetupInstructions({
    url: 'https://setup-abc.heylimbo.com',
    sshHost: 'aios@100.114.123.103',
    port: 18900,
    token: 'tok_xyz',
  });
  assert.ok(/already in use/i.test(out),
    'should mention that the port may be in use');
  // Must show an alternate local port that's not 18900
  assert.ok(/ssh -L (\d+):localhost:18900/.test(out),
    'should include an alternate -L mapping');
  const match = out.match(/ssh -L (\d+):localhost:18900 aios@100\.114\.123\.103[\s\S]*?http:\/\/127\.0\.0\.1:(\d+)\//);
  assert.ok(match, 'alternate port in -L and in open-in-browser URL should both be present');
  assert.equal(match[1], match[2], 'alternate local port in -L must match the one in the browser URL');
  assert.notEqual(match[1], '18900', 'alternate port must differ from 18900');
});

test('buildSetupInstructions: works with a custom container port (not 18900)', () => {
  // Limbo supports non-default ports. The helper should not hardcode 18900.
  const out = buildSetupInstructions({
    url: 'https://setup-abc.heylimbo.com',
    sshHost: 'aios@vps',
    port: 18901,
    token: 'tok_xyz',
  });
  assert.ok(out.includes('ssh -L 18901:localhost:18901 aios@vps'),
    'default forward should use the custom container port on both sides');
  assert.ok(out.includes('http://127.0.0.1:18901/?token=tok_xyz'));
});

test('buildSetupInstructions: localhost url does NOT claim to be a Public URL', () => {
  // When both the named CF tunnel and the quick tunnel fail, the caller falls
  // back to passing url = http://127.0.0.1:${PORT}. That URL is NOT a public
  // URL — printing "Public URL (works from any browser)" above a localhost
  // address is misleading. The helper must detect this and degrade the label.
  const out = buildSetupInstructions({
    url: 'http://127.0.0.1:18900',
    sshHost: 'aios@100.114.123.103',
    port: 18900,
    token: 'tok_xyz',
  });
  assert.ok(!/public url/i.test(out),
    'localhost fallback must not use the "Public URL" label');
  assert.ok(!/works from any browser/i.test(out),
    'localhost fallback must not claim the URL works from any browser');
  // It should still render the SSH forwarding instructions (default + alternate).
  assert.ok(out.includes('ssh -L 18900:localhost:18900 aios@100.114.123.103'));
  assert.ok(out.includes('ssh -L 19900:localhost:18900 aios@100.114.123.103'));
  assert.ok(/already in use/i.test(out));
});

test('buildSetupInstructions: localhost fallback mentions the tunnel failure context', () => {
  // Give the user a breadcrumb so they understand why they're seeing SSH
  // forwarding instructions instead of a public URL.
  const out = buildSetupInstructions({
    url: 'http://127.0.0.1:18900',
    sshHost: 'aios@vps',
    port: 18900,
    token: 'tok_xyz',
  });
  // Must acknowledge that the tunnel path didn't succeed. Exact wording is
  // flexible, but SOMETHING must indicate "no public tunnel".
  assert.ok(/tunnel/i.test(out) && (/fail|unavailable|not available|no public/i.test(out)),
    'localhost fallback must explain tunnel is unavailable');
});
