import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createV2Client } from '../js/core/v2-client.js';

// ---- helpers ----

function makeResponse({ ok = true, status = 200, body = {} } = {}) {
  return {
    ok,
    status,
    async json() { return body; },
  };
}

function makeClient(requestImpl, opts = {}) {
  return createV2Client({
    baseUrl: 'http://server.local:9000',
    login: 'ivanov',
    password: 'S3cret__P@ss!',
    requestImpl,
    ...opts,
  });
}

// Подпись requestImpl: (url, options) => Response
const defaultImpl = async (url, options) => {
  return makeResponse({ body: {} });
};

const PASS = 'S3cret__P@ss!';

// ---- export / surface ----

test('export: createV2Client является функцией, модуль не имеет прочих exports', async () => {
  const mod = await import('../js/core/v2-client.js');
  assert.equal(typeof createV2Client, 'function');
  const keys = Object.keys(mod).sort();
  assert.deepEqual(keys, ['createV2Client'], 'должен быть только один export');
});

test('createV2Client: возвращает ожидаемый набор методов', () => {
  const c = createV2Client({ baseUrl: 'http://h' });
  for (const m of ['info', 'listSessions', 'createSession', 'listMessages', 'prompt', 'interrupt', 'disconnect']) {
    assert.equal(typeof c[m], 'function', `метод ${m} должен быть функцией`);
  }
});

// ---- базовый заголовок Basic + отсутствие секрета в URL/storage ----

test('Basic заголовок: отправляется Authorization Basic, пароль не в URL', async () => {
  let capturedUrl = null;
  let capturedAuth = null;
  const requestImpl = async (url, options) => {
    capturedUrl = url;
    capturedAuth = options.headers && options.headers.Authorization;
    return makeResponse({ body: { ok: 1 } });
  };
  const c = makeClient(requestImpl);
  await c.info();

  assert.equal(capturedAuth.startsWith('Basic '), true);
  const expected = 'Basic ' + Buffer.from('ivanov:' + PASS, 'utf8').toString('base64');
  assert.equal(capturedAuth, expected);
  // URL содержит только путь, без userinfo/query/секретов
  assert.equal(capturedUrl, 'http://server.local:9000/api/info');
  assert.equal(capturedUrl.includes(PASS), false, 'пароль не должен быть в URL');
  assert.equal(capturedUrl.includes('@'), false, 'в URL не должно быть userinfo');
});

test('Basic: UTF-8 работает без Buffer', async () => {
  const saved = globalThis.Buffer;
  try {
    globalThis.Buffer = undefined;
    let auth;
    const c = createV2Client({ baseUrl: 'http://h', login: 'юзер', password: 'пароль', requestImpl: async (u, o) => { auth = o.headers.Authorization; return makeResponse(); } });
    await c.info();
    assert.equal(auth, `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode('юзер:пароль')))}`);
  } finally { globalThis.Buffer = saved; }
});

test('без login/password: Authorization заголовок не отправляется', async () => {
  let sent = null;
  const requestImpl = async (url, options) => { sent = options.headers; return makeResponse({}); };
  const c = createV2Client({ baseUrl: 'http://h', requestImpl });
  await c.info();
  assert.equal(sent && sent.Authorization, undefined);
});

test('секрет не сохраняется на объекте клиента (только в памяти заголовка при запросе)', async () => {
  const c = makeClient(defaultImpl);
  await c.info();
  const dump = JSON.stringify(c);
  assert.equal(dump.includes(PASS), false, 'пароль не должен сохраняться на объекте клиента');
  assert.equal(dump.includes('password'), false, 'на объекте клиента не должно быть поля password');
});

// ---- assertBaseUrl ----

test('baseUrl: отклоняет не-http(s) схемы', () => {
  for (const bad of ['ftp://h', 'ws://h', 'file:///x', 'localhost:9000', 'h', '']) {
    assert.throws(
      () => createV2Client({ baseUrl: bad }),
      /http\(s\)/,
      `baseUrl "${bad}" должен быть отклонён как не-http(s)`
    );
  }
});

test('baseUrl: отклоняет userinfo', () => {
  assert.throws(() => createV2Client({ baseUrl: 'http://user:pass@h' }), /userinfo|[@?#]/);
});

test('baseUrl: отклоняет query и hash', () => {
  assert.throws(() => createV2Client({ baseUrl: 'http://h?a=1' }), /userinfo|[@?#]/);
  assert.throws(() => createV2Client({ baseUrl: 'http://h#frag' }), /userinfo|[@?#]/);
});

test('baseUrl: строгий URL запрещает userinfo, query и hash даже в необычной форме', () => {
  for (const bad of ['http://u@h', 'http://h/?x=1', 'http://h/#x'])
    assert.throws(() => createV2Client({ baseUrl: bad }));
});

test('baseUrl: принимает http и https, срезает завершающие слэши', async () => {
  let url = null;
  const requestImpl = async (u) => { url = u; return makeResponse({}); };
  const c = createV2Client({ baseUrl: 'https://example.com/', requestImpl });
  await c.info();
  assert.equal(url, 'https://example.com/api/info');
});

// ---- разбиение baseUrl+path (trailing slash корректность) ----

test('baseUrl без слэша + path: корректная конкатенация', async () => {
  let url = null;
  const requestImpl = async (u) => { url = u; return makeResponse({}); };
  const c = createV2Client({ baseUrl: 'http://h', requestImpl });
  await c.info();
  assert.equal(url, 'http://h/api/info');
});

// ---- методы и запросы ----

test('info: GET /api/info', async () => {
  let method = null, url = null;
  const requestImpl = async (u, o) => { method = o.method; url = u; return makeResponse({ body: { status: 'ok' } }); };
  const c = makeClient(requestImpl);
  const res = await c.info();
  assert.equal(method, 'GET');
  assert.equal(url, 'http://server.local:9000/api/info');
  assert.deepEqual(res, { status: 'ok' });
});

test('listSessions: GET /api/session', async () => {
  let method = null, url = null;
  const requestImpl = async (u, o) => { method = o.method; url = u; return makeResponse({ body: { sessions: [] } }); };
  const c = makeClient(requestImpl);
  const res = await c.listSessions();
  assert.equal(method, 'GET');
  assert.equal(url, 'http://server.local:9000/api/session');
  assert.deepEqual(res, { sessions: [] });
});

test('createSession: POST /api/session, тело { title }; пустой title -> {}', async () => {
  const calls = [];
  const requestImpl = async (u, o) => { calls.push({ u, o }); return makeResponse({ body: { id: 's1' } }); };
  const c = makeClient(requestImpl);

  await c.createSession({ title: 'мой чат' });
  assert.equal(calls[0].o.method, 'POST');
  assert.equal(calls[0].u, 'http://server.local:9000/api/session');
  assert.equal(JSON.parse(calls[0].o.body).title, 'мой чат');
  assert.deepEqual(JSON.parse(calls[0].o.body), { title: 'мой чат' });

  await c.createSession(undefined);
  assert.deepEqual(JSON.parse(calls[1].o.body), {}, 'createSession без options шлёт {}');
});

test('listMessages: GET /api/session/{id}/message, id кодируется', async () => {
  let url = null;
  const requestImpl = async (u) => { url = u; return makeResponse({ body: [] }); };
  const c = makeClient(requestImpl);
  await c.listMessages('a/b c?');
  assert.equal(url, 'http://server.local:9000/api/session/a%2Fb%20c%3F/message');
});

test('prompt: POST /api/session/{id}/prompt, тело { text }', async () => {
  let method = null, url = null, body = null;
  const requestImpl = async (u, o) => { method = o.method; url = u; body = o.body; return makeResponse({ body: {} }); };
  const c = makeClient(requestImpl);
  await c.prompt('s1', 'Привет');
  assert.equal(method, 'POST');
  assert.equal(url, 'http://server.local:9000/api/session/s1/prompt');
  assert.deepEqual(JSON.parse(body), { text: 'Привет' });
});

test('interrupt: POST /api/session/{id}/interrupt', async () => {
  let method = null, url = null;
  const requestImpl = async (u, o) => { method = o.method; url = u; return makeResponse({ body: {} }); };
  const c = makeClient(requestImpl);
  await c.interrupt('s1');
  assert.equal(method, 'POST');
  assert.equal(url, 'http://server.local:9000/api/session/s1/interrupt');
});

test('disconnect: без сайд-эффектов, ничего не отправляет', async () => {
  let called = 0;
  const requestImpl = async () => { called++; return makeResponse({}); };
  const c = makeClient(requestImpl);
  const r = c.disconnect();
  assert.equal(called, 0);
  // disconnect синхронный, возвращает undefined (или ничего не обещает)
  assert.ok(r === undefined || typeof r === 'object');
});

test('reply 204: возвращает undefined без обращения к json()', async () => {
  let jsonCalled = false;
  const res = {
    ok: true, status: 204,
    async json() { jsonCalled = true; return {}; },
  };
  const c = makeClient(async () => res);
  const out = await c.info();
  assert.equal(out, undefined);
  assert.equal(jsonCalled, false);
});

// ---- 401/500 errors ----

test('401: создаёт Error с кодом статуса', async () => {
  const c = makeClient(async () => makeResponse({ ok: false, status: 401 }));
  await assert.rejects(c.info(), /401/);
});

test('500: создаёт Error с кодом статуса и путём', async () => {
  const c = makeClient(async () => makeResponse({ ok: false, status: 500 }));
  await assert.rejects(c.listSessions(), /500/);
});

test('apply для метода prompt: 404 даёт Error', async () => {
  const c = makeClient(async () => makeResponse({ ok: false, status: 404 }));
  await assert.rejects(c.prompt('s', 'x'), /404/);
});

// ---- timeout / abort / disconnect ----

test('timeoutMs: таймер прерывает зависший запрос (fetch уважает signal)', async () => {
  // Честная эмуляция fetch: пока signal не прерван — висим, после abort — отклоняемся.
  const requestImpl = (url, opts) =>
    new Promise((resolve, reject) => {
      if (opts.signal.aborted) {
        reject(new Error('aborted'));
        return;
      }
      opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  const c = createV2Client({ baseUrl: 'http://h', requestImpl, timeoutMs: 10 });
  const start = Date.now();
  await assert.rejects(c.info(), /aborted/);
  assert.ok(Date.now() - start < 2000, 'таймаут должен сработать быстро');
});

test('request использует переданный signal и прерывает его по таймауту', async () => {
  let receivedSignal = null;
  const requestImpl = (url, opts) => {
    receivedSignal = opts.signal;
    return new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
  };
  const c = createV2Client({ baseUrl: 'http://h', requestImpl, timeoutMs: 10 });
  await assert.rejects(c.info(), /aborted/);
  assert.ok(receivedSignal, 'клиент должен передать signal в requestImpl');
  assert.equal(receivedSignal.aborted, true, 'signal должен быть прерван после таймаута');
});

test('таймер очищается после успешного ответа (нет утечки)', async () => {
  const c = makeClient(defaultImpl);
  await c.info();
  // Просто проверяем, что повторные вызовы работают без накопления таймеров/ошибок.
  await c.info();
  await c.info();
});

test('disconnect отменяет активные запросы и очищает auth для последующих запросов', async () => {
  const signals = [];
  const auths = [];
  const requestImpl = (url, opts) => {
    signals.push(opts.signal);
    auths.push(opts.headers.Authorization);
    return new Promise((resolve, reject) => opts.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  };
  const c = makeClient(requestImpl, { timeoutMs: 10000 });
  const pending = c.info();
  c.disconnect();
  await assert.rejects(pending, /aborted/);
  assert.equal(signals[0].aborted, true);
  // Следующий вызов уже не авторизован.
  const uncancellable = c.info();
  assert.equal(auths[1], undefined);
  c.disconnect();
  await assert.rejects(uncancellable, /aborted/);
});
