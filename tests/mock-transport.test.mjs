import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOCK_ERROR_TRIGGER, hasErrorTrigger, createMockTransport } from '../js/core/mock-transport.js';

test('MOCK_ERROR_TRIGGER и hasErrorTrigger', () => {
  assert.equal(MOCK_ERROR_TRIGGER, 'danger');
  assert.equal(hasErrorTrigger('слово danger тут'), true);
  assert.equal(hasErrorTrigger('нет опасности'), false);
  assert.equal(hasErrorTrigger(undefined), false);
});

test('createMockTransport: connect эмитит open', async () => {
  const t = createMockTransport({ delayMs: 1 });
  let open = 0;
  t.on('open', () => open++);
  const res = await t.connect();
  assert.equal(res.ok, true);
  assert.equal(open, 1);
  await t.disconnect();
});

test('createMockTransport: authenticate эмитит authenticated, пароль не сохраняется', async () => {
  const t = createMockTransport({ delayMs: 1 });
  let authenticated = 0, authPayload = null;
  t.on('authenticated', (evt) => { authenticated++; authPayload = evt; });
  const res = await t.authenticate({ login: 'user', password: 'supersecret' });
  assert.equal(res.ok, true);
  assert.equal(authenticated, 1);
  assert.equal(jsonHas(res, 'supersecret'), false, 'пароль не должен попадать в ответ');
  assert.equal(jsonHas(authPayload, 'supersecret'), false, 'пароль не должен попадать в событие');
  await t.disconnect();
});

function jsonHas(obj, needle) {
  return JSON.stringify(obj).includes(needle);
}

test('createMockTransport: createSession даёт session_id и поток content + done', async () => {
  const t = createMockTransport({ delayMs: 1 });
  const kinds = [];
  t.on('session_id', () => kinds.push('session_id'));
  t.on('content', () => kinds.push('content'));
  t.on('done', () => kinds.push('done'));
  await t.connect();
  const res = await t.createSession('тест');
  assert.equal(res.ok, true);
  assert.ok(res.session_id && res.session_id.startsWith('mock-'));
  await waitFor(() => kinds.includes('done'));
  assert.ok(kinds.includes('session_id'), 'должен прийти session_id');
  assert.ok(kinds.filter((k) => k === 'content').length > 0, 'должен прийти хотя бы один content');
  await t.disconnect();
});

test('createMockTransport: слово-триггер в createSession даёт error', async () => {
  const t = createMockTransport({ delayMs: 1 });
  const errors = [];
  t.on('error', (evt) => errors.push(evt));
  await t.connect();
  await t.createSession('опасный ' + MOCK_ERROR_TRIGGER);
  await waitFor(() => errors.length > 0);
  assert.ok(errors.some((e) => (e.meta && e.meta.message || '').includes(MOCK_ERROR_TRIGGER)));
  await t.disconnect();
});

test('createMockTransport: sendInput с триггером эмитит error', async () => {
  const t = createMockTransport({ delayMs: 1 });
  const errors = [];
  t.on('error', (evt) => errors.push(evt));
  await t.connect();
  const res = await t.sendInput({ draft: 'содержит ' + MOCK_ERROR_TRIGGER });
  assert.equal(res.error, true);
  await waitFor(() => errors.length > 0);
  assert.ok(errors.length > 0);
  await t.disconnect();
});

test('createMockTransport: abort даёт abort + done со stop_reason aborted', async () => {
  const t = createMockTransport({ delayMs: 1 });
  let aborted = 0, doneReason = null;
  t.on('abort', () => aborted++);
  t.on('done', (evt) => { doneReason = evt.meta && evt.meta.stop_reason; });
  await t.connect();
  await t.abort();
  assert.equal(aborted, 1);
  assert.equal(doneReason, 'aborted');
  await t.disconnect();
});

test('createMockTransport: abort не завершает следующий ответ', async () => {
  const t = createMockTransport({ delayMs: 15 });
  const events = [];
  t.on('content', (evt) => events.push({ kind: 'content', text: evt.text }));
  t.on('done', (evt) => events.push({ kind: 'done', reason: evt.meta && evt.meta.stop_reason }));
  await t.connect();

  await t.abort();
  assert.deepEqual(events, [{ kind: 'done', reason: 'aborted' }]);

  await t.sendInput('новый ответ');
  await waitFor(() => events.some((event) => event.kind === 'done' && event.reason === 'end_turn'));
  assert.deepEqual(events, [
    { kind: 'done', reason: 'aborted' },
    { kind: 'content', text: 'Дополнительный ввод получен: «новый ответ».' },
    { kind: 'done', reason: 'end_turn' },
  ]);
  await t.disconnect();
});

test('createMockTransport: destroy эмитит close и сбрасывает сессию', async () => {
  const t = createMockTransport({ delayMs: 1 });
  let closed = 0;
  t.on('close', () => closed++);
  await t.connect();
  await t.createSession('x');
  assert.ok(t.sessionId);
  const res = await t.destroy();
  assert.equal(res.ok, true);
  assert.equal(closed, 1);
  assert.equal(t.sessionId, null);
  assert.equal(t.connected, false);
});

test('createMockTransport: событие с осторожностью — слушатель не валит транспорт', async () => {
  const t = createMockTransport({ delayMs: 1 });
  const errors = [];
  t.on('content', () => { throw new Error('listener boom'); });
  t.on('error', (evt) => errors.push(evt));
  await t.connect();
  await t.createSession('x');
  await waitFor(() => errors.length > 0);
  assert.ok(errors.some((e) => (e.meta && e.meta.message || '').includes('listener boom')));
  await t.disconnect();
});

function waitFor(predicate, timeout = 2000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (predicate()) { clearInterval(timer); resolve(); }
      else if (Date.now() - start > timeout) { clearInterval(timer); reject(new Error('timeout')); }
    }, 5);
  });
}
