import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = (await readFile(new URL('../js/app.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\s*$/gm, '');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  const elements = new Map(), timers = new Map();
  let timerId = 0;
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: '', hidden: false, disabled: false, textContent: '', className: '',
      style: { setProperty() {} }, classList: { add() {}, remove() {} },
      addEventListener() {}, replaceChildren() { this.children = []; this.options = []; },
      append(child) { (this.children ||= []).push(child); if (this.id === 'session-select') (this.options ||= []).push(child); },
      scrollHeight: 0, scrollTop: 0, clientHeight: 0, options: [],
    });
    return elements.get(id);
  }
  element('messages').children = [];
  const context = {
    document: { getElementById: element, createElement: () => ({}) , documentElement: { style: { setProperty() {} } } },
    window: {}, navigator: {}, location: { protocol: 'file:' }, localStorage: { getItem: () => null, setItem() {} },
    setTimeout(fn) { const id = ++timerId; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    createV2Client: () => ({}), createMockTransport: () => ({}),
    createTts: () => ({ stop() {}, setOnEvent() {}, setRate: n => Number(n), setLang() {}, setReadCode() {}, voices: () => [], speak() {}, pause() {}, resume() {} }),
    createRecognizer: () => ({ destroy() {}, isRunning: () => false, stop() {}, start() {} }),
    isSpeechRecognitionSupported: () => false,
  };
  vm.runInNewContext(`${source}\nglobalThis.__test = { state, chooseSession, send, logout, poll, newSession };`, context);
  return { api: context.__test, elements, timers };
}

test('polling запускает следующий запрос только после завершения предыдущего', async () => {
  const { api, timers } = harness();
  let active = 0, maximum = 0, calls = 0;
  const waits = [];
  api.state.client = { listMessages: () => { active++; maximum = Math.max(maximum, active); calls++; const d = deferred(); waits.push(d); return d.promise.finally(() => active--); } };
  const choosing = api.chooseSession('s');
  await Promise.resolve();
  assert.equal(calls, 1);
  waits[0].resolve([]); await choosing;
  const [timerId, runTimer] = [...timers.entries()][0];
  timers.delete(timerId); const tick = runTimer(); await Promise.resolve();
  assert.equal(calls, 2);
  assert.equal(timers.size, 0, 'пока запрос в работе, следующий таймер не поставлен');
  waits[1].resolve([]); await tick;
  assert.equal(maximum, 1);
  assert.equal(timers.size, 1, 'следующий таймер поставлен после завершения запроса');
});

test('logout во время отложенного poll не возрождает таймер', async () => {
  const { api, timers } = harness(), wait = deferred();
  api.state.client = { listMessages: () => wait.promise, disconnect: async () => {} };
  api.state.session = 's';
  const choosing = api.chooseSession('s');
  await Promise.resolve();
  await api.logout();
  wait.resolve([]); await choosing;
  assert.equal(timers.size, 0);
  assert.equal(api.state.session, null);
});

test('send сохраняет новый draft после успеха и ошибки запроса', async t => {
  for (const reject of [false, true]) await t.test(reject ? 'ошибка' : 'успех', async () => {
    const { api, elements } = harness(), wait = deferred();
    const input = elements.get('chat-input'); input.value = ' исходный текст ';
    api.state.client = { prompt: () => wait.promise, listMessages: async () => [] };
    api.state.session = 's';
    const sending = api.send(); await Promise.resolve();
    input.value = 'новый draft';
    reject ? wait.reject(new Error('offline')) : wait.resolve();
    await sending;
    assert.equal(input.value, 'новый draft');
  });
});

test('смена сессии сбрасывает busy и поздний prompt не очищает draft', async () => {
  const { api, elements } = harness(), wait = deferred();
  const input = elements.get('chat-input'); input.value = 'отправка';
  api.state.client = { prompt: () => wait.promise, listMessages: async () => [] };
  api.state.session = 'old';
  const sending = api.send(); await Promise.resolve();
  api.state.client.listMessages = async () => [];
  await api.chooseSession('new');
  assert.equal(api.state.busy, false);
  assert.equal(elements.get('send-btn').hidden, false);
  input.value = 'черновик новой сессии';
  wait.resolve(); await sending;
  assert.equal(input.value, 'черновик новой сессии');
});

test('newSession во время busy блокирует немедленную отправку, сохраняет draft и разблокирует готовую сессию', async () => {
  const { api, elements } = harness();
  const interrupt = deferred(), creation = deferred();
  let prompts = 0;
  api.state.client = {
    interrupt: () => interrupt.promise,
    createSession: () => creation.promise,
    listMessages: async () => [],
    prompt: async () => { prompts++; },
  };
  api.state.session = 'old'; api.state.busy = true;
  elements.get('chat-input').value = 'сохранить меня';
  const starting = api.newSession(false);
  assert.equal(api.state.session, null);
  assert.equal(elements.get('send-btn').disabled, true);
  await api.send();
  assert.equal(prompts, 0);
  assert.equal(elements.get('chat-input').value, 'сохранить меня');
  interrupt.resolve(); await Promise.resolve();
  creation.resolve({ id: 'new' }); await starting;
  assert.equal(api.state.transitioning, false);
  assert.equal(elements.get('send-btn').disabled, false);
  await api.send();
  assert.equal(prompts, 1);
});
