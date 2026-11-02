import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenCodeTransport } from '../js/core/api-client.js';

function makeResponse({ ok = true, status = 200, body = {} } = {}) {
  return {
    ok,
    status,
    async text() { return JSON.stringify(body); },
    async json() { return body; },
  };
}

test('authenticate: запрос идёт в /me, пароль не в URL, не в query, не в заголовках, не сохраняется', async () => {
  const password = 'S3cret__P@ss!';
  const login = 'ivanov';
  let capturedUrl = null;
  let capturedOptions = null;
  const requestImpl = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return makeResponse({ body: { user: login, display_name: 'Иванов' } });
  };

  const t = createOpenCodeTransport({ mode: 'opencode', host: 'server.local', port: 9000, requestImpl });
  const res = await t.authenticate({ login, password });

  assert.equal(res.ok, true);
  assert.equal(res.user, login);

  // URL
  assert.equal(capturedUrl, 'http://server.local:9000/me');
  assert.equal(capturedUrl.includes(password), false, 'пароль не должен быть в URL');
  assert.equal(capturedUrl.includes(encodeURIComponent(password)), false, 'пароль не должен быть в URL в закодированном виде');

  // options: body — JSON, не form-urlencoded
  assert.equal(capturedOptions.method, 'POST');
  const bodyText = typeof capturedOptions.body === 'string' ? capturedOptions.body : JSON.stringify(capturedOptions.body);
  const parsedBody = JSON.parse(bodyText);
  assert.equal(parsedBody.login, login);
  assert.equal(parsedBody.password, password);
  // Пароль не должен быть в url-encoded виде (как query string)
  assert.equal(bodyText.includes('password=' + encodeURIComponent(password)), false);

  // headers не содержат пароль
  const headersText = JSON.stringify(capturedOptions.headers || {});
  assert.equal(headersText.includes(password), false);

  // В транспорте не сохраняется пароль
  assert.ok(t._auth);
  assert.equal(Object.keys(t._auth).includes('password'), false, 'пароль не должен храниться в _auth');
  assert.equal(JSON.stringify(t._auth).includes(password), false);
});

test('authenticate: при ошибке /me возвращает { ok:false } и эмитит error', async () => {
  const password = 'another-secret';
  const errors = [];
  const requestImpl = async () => makeResponse({ ok: false, status: 401, body: { error: 'Unauthorized' } });
  const t = createOpenCodeTransport({ host: 'h', requestImpl });
  t.on('error', (evt) => errors.push(evt));
  const res = await t.authenticate({ login: 'l', password });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'Unauthorized');
  assert.ok(errors.length > 0);
  assert.equal(JSON.stringify(errors).includes(password), false);
});

test('authenticate: без логина/пароля не делает запрос', async () => {
  let called = 0;
  const requestImpl = async () => { called++; return makeResponse({}); };
  const t = createOpenCodeTransport({ host: 'h', requestImpl });
  const res = await t.authenticate({ login: '', password: '' });
  assert.equal(res.ok, false);
  assert.equal(called, 0);
});
