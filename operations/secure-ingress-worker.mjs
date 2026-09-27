/** Cloudflare ingress for a fixed Render origin. Configure the two origins and
 * keep EDGE_TOKEN in Cloudflare Secrets. This file contains no credentials. */
function configuredOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('invalid origin');
  return url.origin;
}
export default {
  async fetch(request, env) {
    let origin, publicOrigin;
    try {
      origin = configuredOrigin(env.RENDER_ORIGIN);
      publicOrigin = configuredOrigin(env.PUBLIC_ORIGIN);
      if (origin === publicOrigin || !new URL(origin).hostname.endsWith('.onrender.com') || typeof env.EDGE_TOKEN !== 'string' || env.EDGE_TOKEN.length < 32) throw new Error('invalid config');
    } catch { return new Response('Ingress configuration unavailable', { status: 503 }); }
    const source = new URL(request.url);
    if (source.origin !== publicOrigin) return new Response('Not found', { status: 404 });
    const target = new URL(origin);
    target.pathname = source.pathname; target.search = source.search;
    if (target.origin !== origin) return new Response('Invalid target', { status: 400 });
    const headers = new Headers(request.headers);
    // Never pass caller-provided identity/location/origin trust hints through.
    for (const name of [...headers.keys()]) if (name.startsWith('x-almadina-client-') || name === 'x-almadina-edge-token' || name === 'x-almadina-public-origin' || name === 'forwarded' || name.startsWith('x-forwarded-')) headers.delete(name);
    headers.set('x-almadina-edge-token', env.EDGE_TOKEN);
    headers.set('x-almadina-client-ip', request.headers.get('cf-connecting-ip') || '');
    for (const [field, suffix] of [['city', 'city'], ['region', 'region'], ['country', 'country']]) {
      const value = request.cf?.[field];
      headers.set(`x-almadina-client-${suffix}`, typeof value === 'string' ? encodeURIComponent(value.slice(0, 100)) : '');
    }
    headers.set('x-forwarded-host', source.host);
    headers.set('x-forwarded-proto', 'https');
    // Origin is deliberately preserved: backend rejects cross-site mutations.
    const response = await fetch(new Request(target, { method: request.method, headers,
      ...(request.method === 'GET' || request.method === 'HEAD' ? {} : { body: request.body, duplex: 'half' }),
      redirect: 'manual',
    }));
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('x-almadina-edge-token');
    const location = responseHeaders.get('location');
    if (location) {
      const redirect = new URL(location, origin);
      if (redirect.origin === origin) {
        const publicRedirect = new URL(publicOrigin);
        publicRedirect.pathname = redirect.pathname; publicRedirect.search = redirect.search; publicRedirect.hash = redirect.hash;
        responseHeaders.set('location', publicRedirect.href);
      }
    }
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
  },
};
