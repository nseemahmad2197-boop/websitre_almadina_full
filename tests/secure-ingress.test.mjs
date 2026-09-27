import assert from 'node:assert/strict';
import test from 'node:test';
import ingress from '../operations/secure-ingress-worker.mjs';
const env = { RENDER_ORIGIN: 'https://example.onrender.com', PUBLIC_ORIGIN: 'https://app.example.test', EDGE_TOKEN: 'a'.repeat(64) };

test('ingress pins every path to Render, strips forged geodata, preserves Origin and never follows redirects with credentials', async () => {
  const oldFetch = globalThis.fetch;
  try {
    let forwarded;
    globalThis.fetch = async request => { forwarded = request; return new Response(null, { status: 302, headers: { location: 'https://example.onrender.com//evil.example/p', 'x-almadina-edge-token': 'must not return' } }); };
    for (const path of ['/api/almadina/login', '//evil.example/steal', '/%2f%2fevil.example/a', '/%5c%5cevil.example/a', '///evil.example/a']) {
      const request = new Request(env.PUBLIC_ORIGIN + path, { method: 'POST', headers: { cookie: 'almadina_session=test', origin: 'https://attacker.example', 'cf-connecting-ip': '203.0.113.8', 'x-almadina-client-city': 'spoofed', 'x-almadina-client-country': 'US', 'x-almadina-edge-token': 'fake', 'x-forwarded-host': 'evil.example' }, body: '{}' });
      Object.defineProperty(request, 'cf', { value: { city: 'Nablus', region: 'West Bank', country: 'PS' } });
      const response = await ingress.fetch(request, env);
      assert.equal(new URL(forwarded.url).origin, env.RENDER_ORIGIN);
      assert.equal(forwarded.headers.get('x-almadina-edge-token'), env.EDGE_TOKEN);
      assert.equal(forwarded.headers.get('x-almadina-client-city'), 'Nablus');
      assert.equal(forwarded.headers.get('x-almadina-client-country'), 'PS');
      assert.equal(forwarded.headers.get('origin'), 'https://attacker.example');
      assert.equal(forwarded.redirect, 'manual');
      assert.equal(new URL(response.headers.get('location')).origin, env.PUBLIC_ORIGIN);
      assert.equal(response.headers.get('x-almadina-edge-token'), null);
    }
    assert.equal((await ingress.fetch(new Request('https://other.example/'), env)).status, 404);
    for (const bad of [{ ...env, RENDER_ORIGIN: 'https://evil.example' }, { ...env, EDGE_TOKEN: '' }, { ...env, PUBLIC_ORIGIN: 'http://app.example.test' }]) assert.equal((await ingress.fetch(new Request(env.PUBLIC_ORIGIN), bad)).status, 503);
  } finally { globalThis.fetch = oldFetch; }
});
