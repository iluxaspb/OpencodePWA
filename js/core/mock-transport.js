// mock-transport.js — имитатор сервера OpenCode c тем же интерфейсом,
// что и js/core/api-client.js (см. CONTRACT.md, раздел «Mock-режим»).
// Чисто локальный: не выполняет никаких сетевых операций и опасных действий.
// По таймеру выдаёт: session_id, поток content, done; поддерживает abort;
// эмитит error на специальное слово-триггер.
//
// Интерфейс транспорта (общий с api-client.js):
//   const t = createTransport({ mode: 'mock', delayMs });
//   t.on('open'|'authenticated'|'content'|'done'|'error'|'session_id'|'status'|'abort'|'close', cb);
//   await t.connect();
//   await t.authenticate({ login, password });
//   await t.createSession(input);
//   await t.sendInput(draft);
//   await t.abort();
//   await t.destroy();  // завершение сессии + сброс
//   await t.disconnect();
// Все события передают слушателю нормализованный объект { kind, text?, meta? }.

const DEFAULT_DELAY_MS = 120;

// Специальное слово-триггер ошибки (проверяемо в тестах и при отладке UI).
export const MOCK_ERROR_TRIGGER = 'danger';

import { parseSocketEvent } from './event-parser.js';

// Чистая функция: содержит ли текст слово-триггер.
export function hasErrorTrigger(text) {
  return typeof text === 'string' && text.includes(MOCK_ERROR_TRIGGER);
}

// Поток ответов по умолчанию.
const MOCK_REPLY_LINES = [
  'Привет! Это имитатор сервера OpenCode (mock-режим).',
  'Вы создали тестовую сессию; ответ приходит фрагментами по таймеру.',
  'Наберите слово "' + MOCK_ERROR_TRIGGER + '" — имитатор вернёт ошибку.',
  'Готово.',
];

function line(kind, extra) {
  return 'data: ' + JSON.stringify(Object.assign({ type: kind }, extra || {}));
}

class MockTransport {
  constructor(config = {}) {
    this.mode = 'mock';
    this.config = config || {};
    this.delayMs = Number(this.config.delayMs) > 0 ? Number(this.config.delayMs) : DEFAULT_DELAY_MS;
    this.sessionId = null;
    this.connected = false;
    this._timers = new Set();
    this._listeners = new Map();
  }

  on(type, fn) {
    if (typeof fn !== 'function') return this;
    let set = this._listeners.get(type);
    if (!set) {
      set = new Set();
      this._listeners.set(type, set);
    }
    set.add(fn);
    return this;
  }

  off(type, fn) {
    const set = this._listeners.get(type);
    if (set) set.delete(fn);
    return this;
  }

  emit(type, payload) {
    const set = this._listeners.get(type);
    if (!set || set.size === 0) return;
    for (const fn of set) {
      try {
        fn(payload, this);
      } catch (err) {
        // Не даём ошибке слушателя уронить транспорт.
        const es = this._listeners.get('error');
        if (es && es.size) {
          const msg = (err && err.message) ? String(err.message) : String(err);
          const evt = { kind: 'error', text: msg, meta: { message: msg } };
          for (const ef of es) {
            try { ef(evt, this); } catch { /* ignore */ }
          }
        }
      }
    }
  }

  schedule(fn, ms) {
    const timer = setTimeout(() => {
      this._timers.delete(timer);
      fn();
    }, ms);
    this._timers.add(timer);
    return this;
  }

  clearTimers() {
    for (const timer of this._timers) clearTimeout(timer);
    this._timers.clear();
  }

  // Внутренняя подача «строки с сервера» через тот же парсер, что и у реального
  // транспорта, чтобы mock и opencode вели себя одинаково.
  feed(line) {
    const event = parseSocketEvent(line);
    if (!event) return;
    this.emit(event.kind, event);
  }

  _emitError(message) {
    this.feed(line('error', { error: message }));
  }

  _startReply(replyLines) {
    const lines = replyLines || MOCK_REPLY_LINES;
    let delay = this.delayMs;
    for (const text of lines) {
      this.schedule(() => this.feed(line('content', { text })), delay);
      delay += this.delayMs;
    }
    this.schedule(() => this.feed(line('done', { stop_reason: 'end_turn' })), delay);
  }

  async connect() {
    this.connected = true;
    this.emit('open', { kind: 'status', meta: { type: 'open' } });
    return { ok: true };
  }

  async authenticate(_credentials) {
    // Пароль в mock не обрабатывается и не логируется.
    this.emit('authenticated', { kind: 'status', meta: { type: 'authenticated' }, text: 'mock' });
    return { ok: true, user: 'mock', display_name: 'Mock-пользователь' };
  }

  async createSession(input) {
    const text = typeof input === 'string' ? input : ((input && input.input) || '');
    this.sessionId = 'mock-' + Math.random().toString(36).slice(2, 10);
    this.feed(line('session_id', { session_id: this.sessionId }));
    if (text && hasErrorTrigger(text)) {
      this._emitError('Mock: обнаружен слово-триггер "' + MOCK_ERROR_TRIGGER + '"');
    } else {
      this._startReply(MOCK_REPLY_LINES);
    }
    return { ok: true, session_id: this.sessionId };
  }

  async sendInput(draft) {
    const text = String((draft && draft.draft) || draft || '');
    if (hasErrorTrigger(text)) {
      this._emitError('Mock: обнаружен слово-триггер "' + MOCK_ERROR_TRIGGER + '"');
      return { ok: true, error: true };
    }
    this._startReply(['Дополнительный ввод получен: «' + text + '».']);
    return { ok: true };
  }

  async abort() {
    this.clearTimers();
    this.feed(line('done', { stop_reason: 'aborted' }));
    this.emit('abort', { kind: 'status', meta: { type: 'abort' } });
    return { ok: true };
  }

  async destroy() {
    this.clearTimers();
    this.connected = false;
    this.sessionId = null;
    this.emit('close', { kind: 'status', meta: { type: 'close', reason: 'session.destroy' } });
    return { ok: true };
  }

  async disconnect() {
    this.clearTimers();
    this.connected = false;
    return { ok: true };
  }
}

export function createMockTransport(config) {
  return new MockTransport(config || {});
}
