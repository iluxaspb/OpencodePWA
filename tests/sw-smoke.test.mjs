import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

function harness({ fail = false, responses = {} } = {}) {
  const listeners = {};
  const store = new Map();
  const calls = [];
  const cache = {
    async put(req, res) { store.set(typeof req === 'string' ? req : req.url, res); },
    async match(req) { return store.get(typeof req === 'string' ? req : req.url); },
  };
  const caches = {
    async open(name) { calls.push(['open', name]); return cache; },
    async keys() { return [...store.keys()]; },
    async delete(name) { calls.push(['delete', name]); return true; },
  };
  const context = {
    self: { registration: { scope: 'https://example.test/repo/opencode-mobile/' }, addEventListener: (n, fn) => { listeners[n] = fn; } },
    caches,
    URL,
    Request,
    Response,
    fetch: async (req) => {
      const url = typeof req === 'string' ? req : req.url;
      calls.push(['fetch', url]);
      if (fail) throw new Error('offline');
      const response = responses[url] ?? new Response(`body:${url}`, { status: 200 });
      return response;
    },
  };
  vm.runInNewContext(source, context);
  return { listeners, store, calls };
}

async function dispatchFetch(h, request) {
  let responsePromise;
  h.listeners.fetch({ request, respondWith(promise) { responsePromise = promise; } });
  return responsePromise ? responsePromise : undefined;
}

test('installs the actual scoped shell and awaits cloned cache writes', async () => {
  const h = harness();
  let done;
  h.listeners.install({ waitUntil(p) { done = p; } });
  await done;
  assert.equal(h.calls.filter(([kind]) => kind === 'fetch').length, 16);
  assert.equal(h.store.size, 16);
  assert.ok(h.store.has('https://example.test/repo/opencode-mobile/index.html'));
});

test('fetch ignores authorization, API, external, and non-GET requests', async () => {
  const h = harness();
  for (const request of [
    new Request('https://example.test/repo/opencode-mobile/js/app.js', { headers: { Authorization: 'Bearer secret' } }),
    new Request('https://example.test/api/data'),
    new Request('https://other.test/repo/opencode-mobile/js/app.js'),
    new Request('https://example.test/repo/opencode-mobile/js/app.js', { method: 'POST' }),
  ]) assert.equal(await dispatchFetch(h, request), undefined);
  assert.equal(h.calls.length, 0);
});

test('static fetch does not cache no-store or error responses', async () => {
  const url = 'https://example.test/repo/opencode-mobile/js/app.js';
  for (const response of [new Response('private', { headers: { 'Cache-Control': 'no-store' } }), new Response('oops', { status: 500 })]) {
    const h = harness({ responses: { [url]: response } });
    const result = await dispatchFetch(h, new Request(url));
    assert.ok(result);
    assert.equal(h.store.size, 0);
  }
});

test('navigation serves cached index offline', async () => {
  const online = harness();
  let install;
  online.listeners.install({ waitUntil(p) { install = p; } });
  await install;
  const offline = harness({ fail: true });
  offline.store.set('https://example.test/repo/opencode-mobile/index.html', new Response('offline shell'));
  const request = { url: 'https://example.test/repo/opencode-mobile/', method: 'GET', mode: 'navigate', headers: new Headers() };
  const response = await dispatchFetch(offline, request);
  assert.equal(await response.text(), 'offline shell');
});

test('activation only removes old caches in the same scope family', async () => {
  const h = harness();
  let activated;
  h.listeners.activate({ waitUntil(p) { activated = p; } });
  await activated;
  assert.equal(h.calls.filter(([kind]) => kind === 'delete').length, 0);
});
