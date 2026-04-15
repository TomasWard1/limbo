/**
 * Limbo OAuth Relay Worker
 *
 * Stateless redirect relay for Google OAuth.
 * Google's registered redirect_uri is https://auth.heylimbo.com/callback.
 * The Limbo wizard encodes the instance return URL + nonce into the OAuth
 * `state` parameter as base64url(JSON.stringify({ returnUrl, nonce })).
 *
 * GET /callback?code=X&state=Y
 *   Decodes state, extracts returnUrl and nonce, 302-redirects the browser to:
 *   {returnUrl}/auth/google/callback?code=X&state={nonce}
 *
 * GET /health — health check
 *
 * No auth needed — security comes from PKCE + the nonce in state.
 */

function base64urlDecode(str) {
  // Convert base64url to standard base64
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  // Pad to multiple of 4
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function badRequest(msg) {
  return new Response(JSON.stringify({ error: msg }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const { method, pathname } = Object.assign({}, { method: request.method, pathname: url.pathname });

    if (method === 'GET' && pathname === '/health') {
      return json({ ok: true });
    }

    if (method === 'GET' && pathname === '/callback') {
      const code = url.searchParams.get('code');
      const stateParam = url.searchParams.get('state');

      if (!stateParam) {
        return badRequest('Missing state parameter');
      }

      let returnUrl, nonce;
      try {
        const decoded = base64urlDecode(stateParam);
        const parsed = JSON.parse(decoded);
        returnUrl = parsed.returnUrl;
        nonce = parsed.nonce;
      } catch {
        return badRequest('Invalid state parameter: could not decode or parse');
      }

      if (!returnUrl || typeof returnUrl !== 'string') {
        return badRequest('Invalid state parameter: missing returnUrl');
      }

      // Validate returnUrl is a safe https URL to prevent open redirect
      let parsedReturn;
      try {
        parsedReturn = new URL(returnUrl);
      } catch {
        return badRequest('Invalid state parameter: returnUrl is not a valid URL');
      }

      if (parsedReturn.protocol !== 'https:') {
        return badRequest('Invalid state parameter: returnUrl must use https');
      }

      // Restrict to *.heylimbo.com or localhost (prevent open redirect)
      const host = parsedReturn.hostname;
      const isHeylimbo = host === 'heylimbo.com' || host.endsWith('.heylimbo.com');
      const isLocalhost = host === 'localhost' || host === '127.0.0.1';
      if (!isHeylimbo && !isLocalhost) {
        return badRequest('Invalid state parameter: returnUrl must be a heylimbo.com or localhost URL');
      }

      // Build redirect target — pass through code+nonce on success, or error params on failure
      const targetUrl = new URL(`${returnUrl}/auth/google/callback`);
      const errorParam = url.searchParams.get('error');
      if (errorParam) {
        targetUrl.searchParams.set('error', errorParam);
        const errorDesc = url.searchParams.get('error_description');
        if (errorDesc) targetUrl.searchParams.set('error_description', errorDesc);
        if (nonce) targetUrl.searchParams.set('state', nonce);
      } else {
        if (code) targetUrl.searchParams.set('code', code);
        if (nonce) targetUrl.searchParams.set('state', nonce);
      }

      return Response.redirect(targetUrl.toString(), 302);
    }

    return json({ error: 'Not found' }, 404);
  },
};
