/**
 * Limbo Provisioning Worker
 *
 * Manages DNS A records on heylimbo.com for new Limbo instances.
 * POST /provision  — create a subdomain pointing to a given IP
 * DELETE /provision/:id — remove a subdomain
 * GET /health — health check
 *
 * Required secrets (set via `wrangler secret put`):
 *   CF_API_TOKEN    — Cloudflare API token with DNS edit permissions
 *   CF_ZONE_ID      — Cloudflare zone ID for heylimbo.com
 *   PROVISION_SECRET — Bearer token clients must send
 */

const CF_API = 'https://api.cloudflare.com/client/v4';

function generateId() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 6);
}

function unauthorized() {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

function badRequest(msg) {
  return new Response(JSON.stringify({ error: msg }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

function notFound(msg = 'Not found') {
  return new Response(JSON.stringify({ error: msg }), {
    status: 404,
    headers: { 'Content-Type': 'application/json' },
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function checkAuth(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  return token === env.PROVISION_SECRET;
}

/**
 * Returns true if the IP string is a valid public IPv4 address.
 * Rejects private/loopback/link-local ranges.
 */
function isValidPublicIPv4(ip) {
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return false;
  const octets = ip.split('.').map(Number);
  if (octets.some(o => o < 0 || o > 255)) return false;
  const [a, b] = octets;
  // 0.x — "this" network
  if (a === 0) return false;
  // 10.x — private class A
  if (a === 10) return false;
  // 127.x — loopback
  if (a === 127) return false;
  // 169.254.x — link-local
  if (a === 169 && b === 254) return false;
  // 172.16-31.x — private class B
  if (a === 172 && b >= 16 && b <= 31) return false;
  // 192.168.x — private class C
  if (a === 192 && b === 168) return false;
  return true;
}

async function handleProvision(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  const { ip } = body;
  if (!ip || typeof ip !== 'string') {
    return badRequest('Missing or invalid "ip" field');
  }

  if (!isValidPublicIPv4(ip)) {
    return badRequest('Invalid IP address: must be a public IPv4 address');
  }

  const id = generateId();
  const name = `${id}.heylimbo.com`;

  const cfRes = await fetch(`${CF_API}/zones/${env.CF_ZONE_ID}/dns_records`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.CF_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'A',
      name,
      content: ip,
      proxied: true,
      ttl: 1,
    }),
  });

  const cfData = await cfRes.json();

  if (!cfData.success) {
    const errors = cfData.errors?.map(e => e.message).join(', ') || 'Cloudflare API error';
    return json({ error: errors }, 502);
  }

  return json({ id, url: `https://${name}` }, 201);
}

async function handleDeleteProvision(id, env) {
  // Find the DNS record for {id}.heylimbo.com
  const listRes = await fetch(
    `${CF_API}/zones/${env.CF_ZONE_ID}/dns_records?type=A&name=${id}.heylimbo.com`,
    {
      headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}` },
    }
  );

  const listData = await listRes.json();

  if (!listData.success) {
    const errors = listData.errors?.map(e => e.message).join(', ') || 'Cloudflare API error';
    return json({ error: errors }, 502);
  }

  if (!listData.result || listData.result.length === 0) {
    return notFound(`No DNS record found for ${id}.heylimbo.com`);
  }

  const recordId = listData.result[0].id;

  const delRes = await fetch(
    `${CF_API}/zones/${env.CF_ZONE_ID}/dns_records/${recordId}`,
    {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${env.CF_API_TOKEN}` },
    }
  );

  const delData = await delRes.json();

  if (!delData.success) {
    const errors = delData.errors?.map(e => e.message).join(', ') || 'Cloudflare API error';
    return json({ error: errors }, 502);
  }

  return new Response(null, { status: 204 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { method, pathname } = Object.assign({}, { method: request.method, pathname: url.pathname });

    // Health check — no auth required
    if (method === 'GET' && pathname === '/health') {
      return json({ ok: true });
    }

    // Auth required for all other routes
    if (!checkAuth(request, env)) {
      return unauthorized();
    }

    if (method === 'POST' && pathname === '/provision') {
      return handleProvision(request, env);
    }

    const deleteMatch = pathname.match(/^\/provision\/([a-f0-9]{6})$/);
    if (method === 'DELETE' && deleteMatch) {
      return handleDeleteProvision(deleteMatch[1], env);
    }

    return notFound();
  },
};
