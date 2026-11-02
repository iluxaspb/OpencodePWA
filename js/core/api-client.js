// api-client.js — адаптер REST + WebSocket к серверу OpenCode.
// См. CONTRACT.md. Изменять протокол можно в этом единственном файле,
// не трогая UI. Чистый адаптер: не строит DOM, не управляет сессиями чата
// поверх транспорта — только транспорт.
//
// Единая фабрика createTransport(config):
//   mode: 'mock' | 'opencode' — выбирает транспорт.
// Для 'opencode':
//   host, port, scheme ('http'|'https'), requestImpl, wsImpl (инъекция для тестов)
// Интерфейс (общий с mock):
//   t.on(kind, callback) — события: 'open','authenticated','content','done',
//                            'error','session_id','status','abort','close'.
//   const evt = { kind, text?, meta? };
//   await t.connect();
//   await t.authenticate({ login, password });
//   await t.createSession(input);
//   await t.sendInput(draft);
//   await t.abort();
//   await t.destroy();   // + очищение sessionStorage (пароль)
//   await t.disconnect();
import { parseSocketEvent } from './event-parser.js';
import { createMockTransport } from './mock-transport.js';

export const MODE = Object.freeze({ MOCK: 'mock', OPENCODE: 'opencode' });

// Чистая функция: базовый адрес REST из конфигурации формы.
// scheme: 'http' | 'https' (или 'ws' для обратной совместимости).
export function buildBase(config) {
  const cfg = config || {};
  const { host, port } = cfg;
  const scheme = normalizeHttpScheme(cfg.scheme);
  const h = String(host || '').trim();
  if (!h) return '';
  return scheme + '://' + h + formatPort(port);
}

// Чистая функция: WebSocket URL из той же конфигурации (ws/wss).
export function buildWsUrl(config) {
  const cfg = config || {};
  const { host, port } = cfg;
  const scheme = normalizeHttpScheme(cfg.scheme) === 'https' ? 'wss' : 'ws';
  const h = String(host || '').trim();
  if (!h) return '';
  return scheme + '://' + h + formatPort(port);
}

function normalizeHttpScheme(scheme) {
  const s = String(scheme || 'http').toLowerCase().replace(':', '');
  if (s === 'https' || s === 'wss') return 'https';
  return 'http';
}

function formatPort(port) {
  if (port === undefined || port === null || port === '') return '';
  const p = Number(port);
  return Number.isInteger(p) && p > 0 ? ':' + p : '';
}

function makeEmitter() {
  const listeners = new Map();
  return {
    on(type, fn) {
      if (typeof fn !== 'function') return this;
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(fn);
      return this;
    },
    off(type, fn) {
      const set = listeners.get(type);
      if (set) set.delete(fn);
      return this;
    },
    emit(type, payload, self) {
      const set = listeners.get(type);
      if (!set || set.size === 0) return;
      for (const fn of set) {
        try {
          fn(payload, self);
        } catch (err) {
          const es = listeners.get('error');
          if (es && es.size) {
            const msg = (err && err.message) ? String(err.message) : String(err);
            const evt = { kind: 'error', text: msg, meta: { message: msg } };
            for (const ef of es) {
              try { ef(evt, self); } catch { /* ignore */ }
            }
          }
        }
      }
    },
  };
}

class OpenCodeTransport {
  constructor(config = {}) {
    this.mode = MODE.OPENCODE;
    this.config = config || {};
    this.base = buildBase(this.config);
    this.wsUrl = buildWsUrl(this.config);
    this.sessionId = null;
    this.ws = null;
    this.connected = false;
    this._auth = null;
    const emitter = makeEmitter();
    this.on = emitter.on.bind(emitter);
    this.off = emitter.off.bind(emitter);
    this._emit = emitter.emit;
  }

  _requireWs() {
    if (this.ws && this.ws.readyState === 1 /* OPEN */) return;
    throw new Error('Transport-адapter: WebSocket не подключён. Сначала connect().');
  }

  async connect() {
    const WebSocketImpl = this.config.wsImpl || globalThis.WebSocket;
    if (typeof WebSocketImpl !== 'function') {
      throw new Error('WebSocket недоступно в этом окружении — передайте wsImpl в конфигурацию.');
    }
    await this.disconnect();
    const ws = new WebSocketImpl(this.wsUrl);
    this.ws = ws;
    this.connected = false;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('WebSocket: таймаут подключения к ' + this.wsUrl));
      }, this.wsTimeoutMs() || 8000);
      const cleanup = () => { clearTimeout(timeout); };
      ws.addEventListener('open', () => {
        cleanup();
        this.connected = true;
        this._emit('open', { kind: 'status', meta: { type: 'open' } }, this);
        resolve();
      }, { once: true });
      ws.addEventListener('error', (evt) => {
        cleanup();
        const msg = 'WebSocket: ошибка соединения с ' + this.wsUrl;
        this._emit('error', { kind: 'error', text: msg, meta: { message: msg } }, this);
        reject(new Error(msg));
      }, { once: true });
    });
    ws.addEventListener('message', (evt) => this._onmessage(evt.data));
    ws.addEventListener('close', () => this._onclose());
    return { ok: true };
  }

  wsTimeoutMs() {
    const t = Number(this.config.wsTimeoutMs);
    return Number.isFinite(t) && t > 0 ? t : 8000;
  }

  async _onmessage(data) {
    const raw = typeof data === 'string' ? data : (data && data.data) || '';
    const chunks = String(raw).split('\n');
    for (const chunk of chunks) {
      const evt = parseSocketEvent(chunk);
      if (!evt) continue;
      if (evt.kind === 'session_id' || (evt.kind === 'session_id' && evt.text)) {
        const id = (evt.meta && evt.meta.session_id) || evt.text;
        if (id) this.sessionId = id;
      } else if (evt.kind === 'done') {
        // Пакет завершения также обрабатываем как done.
        this._emit('done', evt, this);
        continue;
      } else if (evt.kind === 'error') {
        this._emit('error', evt, this);
        continue;
      }
      if (evt.kind === 'session_id') {
        this._emit('session_id', evt, this);
      } else if (evt.kind === 'content') {
        this._emit('content', evt, this);
      } else if (evt.kind === 'status') {
        this._emit('status', evt, this);
      } else {
        this._emit(evt.kind, evt, this);
      }
    }
  }

  _onclose() {
    const wasConnected = this.connected;
    this.connected = false;
    if (wasConnected) {
      // Разрыв соединения → текущее сообщение помечается прерванным.
      this._emit('close', { kind: 'status', meta: { type: 'close' } }, this);
      this._emit('done', { kind: 'done', meta: { stop_reason: 'connection_closed' } }, this);
    }
  }

  async authenticate(credentials) {
    const { login, password } = credentials || {};
    if (!login || !password) {
      const msg = 'Не заданы логин или пароль';
      this._emit('error', { kind: 'error', text: msg, meta: { message: msg } }, this);
      return { ok: false, error: msg };
    }
    const url = this.base + '/me';
    // Пароль никогда не логируется и не попадает в URL/заголовки.
    const body = JSON.stringify({ login, password });
    const resp = await this._send({ method: 'POST', url, body });
    if (!resp.ok) {
      const text = await this._readText(resp);
      const message = this._errorFromResponse(text, resp.status);
      this._emit('error', { kind: 'error', text: message, meta: { message } }, this);
      return { ok: false, error: message };
    }
    const data = await this._readJson(resp);
    if (data && data.error) {
      this._emit('error', { kind: 'error', text: data.error, meta: { message: data.error } }, this);
      return { ok: false, error: data.error };
    }
    const user = (data && (data.user || data.login)) || login;
    const displayName = (data && data.display_name) || user;
    this._auth = { user, display_name: displayName };
    this._emit('authenticated', { kind: 'status', meta: { type: 'authenticated' }, text: user }, this);
    return { ok: true, user, display_name: displayName };
  }

  async _send({ method, url, body }) {
    const fetchImpl = this.config.requestImpl || globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new Error('fetch недоступно в этом окружении — передайте requestImpl.');
    }
    return await fetchImpl(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  }

  async _readText(resp) {
    try { return await resp.text(); } catch { return ''; }
  }

  async _readJson(resp) {
    try { return await resp.json(); } catch { return null; }
  }

  _errorFromResponse(text, status) {
    try {
      const obj = JSON.parse(text);
      if (obj && typeof obj.error === 'string' && obj.error) return obj.error;
    } catch { /* fallthrough */ }
    return 'Сервер вернул ошибку (HTTP ' + status + ')';
  }

  async createSession(input) {
    this._requireWs();
    const text = String((input && input.input) || input || '');
    const msg = { type: 'session.create', payload: { input: text } };
    this.ws.send(JSON.stringify(msg));
    return { ok: true };
  }

  async sendInput(draft) {
    this._requireWs();
    const text = String((draft && draft.draft) || draft || '');
    const msg = { type: 'session.input', payload: { draft: text } };
    this.ws.send(JSON.stringify(msg));
    return { ok: true };
  }

  async abort() {
    this._requireWs();
    this.ws.send(JSON.stringify({ type: 'session.abort' }));
    return { ok: true };
  }

  async destroy() {
    let sent = false;
    if (this.ws && this.ws.readyState === 1) {
      try {
        this.ws.send(JSON.stringify({ type: 'session.destroy' }));
        sent = true;
      } catch { /* ignore */ }
    }
    this._clearSessionStorage();
    this.sessionId = null;
    this._emit('close', { kind: 'status', meta: { type: 'close', reason: 'session.destroy' } }, this);
    return { ok: true, sent };
  }

  async disconnect() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch { /* ignore */ }
      this.ws = null;
    }
    this.connected = false;
    return { ok: true };
  }

  _clearSessionStorage() {
    // Очищение пароля и состояния подключения из sessionStorage (только наш ключ).
    const storage = this.config.sessionStorageImpl || globalThis.sessionStorage;
    if (storage) {
      try {
        storage.removeItem('opencode.password');
        storage.removeItem('opencode.session');
      } catch { /* ignore */ }
    }
  }
}

export function createOpenCodeTransport(config) {
  return new OpenCodeTransport(config || {});
}

// Единая фабрика: выбирает mock или реальный транспорт по config.mode.
export function createTransport(config) {
  const cfg = config || {};
  if (cfg.mode === MODE.MOCK) return createMockTransport(cfg);
  return createOpenCodeTransport(cfg);
}
