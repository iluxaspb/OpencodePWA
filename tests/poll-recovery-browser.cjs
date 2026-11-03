'use strict';
// Автономный browser regression для восстановления статуса polling (без Playwright).
// Поднимает собственный HTTP-сервер статики и mock OpenCode REST на динамических
// loopback-портах, запускает локальный Chromium через CDP (Node 24 global WebSocket).
// Никаких реальных сетей/секретов: логин/пароль фиктивные, только 127.0.0.1.
// Сценарий (393x852): connect -> первый poll успех -> message endpoint отказ -> UI offline
// -> восстановление -> UI online -> logout не возрождает online от позднего ответа.
// Запуск: node tests/poll-recovery-browser.cjs
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');
const { once } = require('node:events');

const ROOT = path.resolve(__dirname, '..');
const CHROMIUM = '/usr/bin/chromium';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// --- Статика приложения (только файлы внутри ROOT) ---
function startStaticServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    const rel = urlPath === '/' ? '/index.html' : urlPath;
    const filePath = path.normalize(path.join(ROOT, rel));
    if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, 'index.html')) {
      res.writeHead(403).end('forbidden'); return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  return server;
}

// --- Mock OpenCode REST v2 (см. js/core/v2-client.js) ---
function startMockApi() {
  const state = { failMessages: false, user: 'agent-test', sessions: [{ id: 'sess-1', title: 'Тестовая сессия' }], messages: [], hold: null };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    // CORS: приложение открыто с другого loopback-порта.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const send = (code, body) => { res.writeHead(code); res.end(body === undefined ? '' : JSON.stringify(body)); };
    const p = url.pathname;
    if (req.method === 'GET' && p === '/api/info') return send(200, { user: { name: 'Тест-Оператор' } });
    if (req.method === 'GET' && p === '/api/session') return send(200, { data: state.sessions });
    if (req.method === 'POST' && p === '/api/session') return send(201, { id: 'sess-1' });
    const msg = p.match(/^\/api\/session\/([^/]+)\/message$/);
    if (req.method === 'GET' && msg) {
      if (state.failMessages) return send(503, { error: 'unavailable' });
      // Удержание одного ответа: отпускается вручную через state.hold.release().
      if (state.hold) { const h = state.hold; state.hold = null; h.resolve(() => send(200, { data: state.messages })); return; }
      return send(200, { data: state.messages });
    }
    const prompt = p.match(/^\/api\/session\/([^/]+)\/prompt$/);
    if (req.method === 'POST' && prompt) return send(200, { ok: true });
    const inter = p.match(/^\/api\/session\/([^/]+)\/interrupt$/);
    if (req.method === 'POST' && inter) return send(200, { ok: true });
    send(404, { error: 'not found' });
  });
  state.holdNext = () => new Promise((resolve) => { state.hold = { resolve }; });
  return { server, state };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return server.address().port;
}

// --- Минимальный CDP-клиент ---
let id = 0;
function makeCdp(ws) {
  const cdp = async (method, params = {}) => {
    const n = ++id;
    ws.send(JSON.stringify({ id: n, method, params }));
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { ws.removeEventListener('message', fn); reject(new Error(`CDP timeout (${method})`)); }, 30000);
      const fn = (raw) => {
        const m = JSON.parse(raw.data ?? raw);
        if (m.id !== n) return;
        clearTimeout(timer); ws.removeEventListener('message', fn);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result || {});
      };
      ws.addEventListener('message', fn);
    });
  };
  return cdp;
}

async function main() {
  const staticServer = startStaticServer();
  const { server: apiServer, state: api } = startMockApi();
  const staticPort = await listen(staticServer);
  const apiPort = await listen(apiServer);
  const appUrl = `http://127.0.0.1:${staticPort}/`;
  const appOrigin = new URL(appUrl).origin;

  const profileDir = fs.mkdtempSync(path.join('/tmp/opencode', 'pollrec-chrome-'));
  const cdpPort = await getFreePort();
  // stdio полностью ignore: нечитаемый stderr может заполнить буфер и заблокировать Chromium.
  const chrome = spawn(CHROMIUM, [
    '--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-dev-shm-usage',
    '--disable-extensions', '--disable-background-networking', '--no-sandbox',
    '--remote-allow-origins=*',
  ], { stdio: 'ignore' });

  const exceptions = [];
  let ws;
  try {
    const wsUrl = await waitForCdp(cdpPort, chrome);
    // Нужен page-target: browser-level endpoint не поддерживает Runtime/Page.
    // Создаём about:blank, затем явно навигируем на appUrl.
    const pageWs = await createPageTarget(cdpPort);
    ws = new WebSocket(pageWs);
    await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
    const cdp = makeCdp(ws);
    const ev = async (expr, awaitPromise = false) => {
      const r = await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'page exception');
      return r.result?.value;
    };
    const waitFor = async (expr, ms = 8000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { if (await ev(expr)) return; await sleep(100); }
      throw new Error('timeout: ' + expr);
    };

    await cdp('Runtime.enable'); await cdp('Page.enable'); await cdp('Network.enable');
    await cdp('Emulation.setDeviceMetricsOverride', { width: 393, height: 852, deviceScaleFactor: 1, mobile: true });
    ws.addEventListener('message', (raw) => {
      const m = JSON.parse(raw.data ?? raw);
      if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails?.text || 'exception');
    });
    await cdp('Network.setCacheDisabled', { cacheDisabled: true });

    await cdp('Page.navigate', { url: appUrl });
    await waitFor(`document.readyState==='complete'`);
    await waitFor(`!!document.getElementById('connect-form')`);

    // Подключение в настоящем режиме opencode с фиктивными логином/паролем.
    await ev(`(() => {
      const m = document.getElementById('mode-select'); m.value='opencode'; m.dispatchEvent(new Event('change',{bubbles:true}));
      document.getElementById('scheme-select').value='http';
      document.getElementById('host-input').value='127.0.0.1';
      document.getElementById('port-input').value='${apiPort}';
      document.getElementById('login-input').value='agent-test';
      document.getElementById('password-input').value='fake-secret';
      return true;
    })()`);
    await ev(`document.getElementById('connect-form').requestSubmit()`);
    await waitFor(`!document.getElementById('screen-chat').hidden`);
    // Первый poll сразу после loadSessions/chooseSession должен быть успешен.
    await waitFor(`document.getElementById('status-text').textContent==='Подключено'`);
    assert.equal(await ev(`document.getElementById('status-dot').className`), 'status-dot online', 'первый poll: online');

    // Отказ message endpoint -> следующий poll переводит UI в offline.
    api.failMessages = true;
    await waitFor(`document.getElementById('status-text').textContent==='Соединение прервано'`, 8000);
    assert.equal(await ev(`document.getElementById('status-dot').className`), 'status-dot offline', 'отказ API: offline');

    // Восстановление API -> успешный poll возвращает online.
    api.failMessages = false;
    await waitFor(`document.getElementById('status-text').textContent==='Подключено'`, 8000);
    assert.equal(await ev(`document.getElementById('status-dot').className`), 'status-dot online', 'восстановление: online');

    // Удерживаем один ответ message endpoint, затем logout и отпускаем его после logout.
    const held = api.holdNext();
    // Ждём фактического удержания запроса message; таймаут означает, что удержание не сработало.
    const release = await Promise.race([
      held,
      sleep(8000).then(() => { throw new Error('message request not held'); }),
    ]);
    await ev(`document.getElementById('logout-btn').click()`);
    await waitFor(`!document.getElementById('screen-connect').hidden`);
    assert.equal(await ev(`document.getElementById('screen-chat').hidden`), true, 'logout вернул экран подключения');
    // Отпускаем отложенный ответ уже после logout; он не должен возродить online.
    release();
    await sleep(3000);
    const afterLogout = await ev(`({
      chatHidden: document.getElementById('screen-chat').hidden,
      statusText: document.getElementById('status-text').textContent,
      statusDot: document.getElementById('status-dot').className,
    })`);
    assert.equal(afterLogout.chatHidden, true, 'logout не возрождает чат');
    assert.equal(afterLogout.statusText, 'Не подключено', 'статус остаётся «Не подключено» после logout');
    assert.equal(afterLogout.statusDot, 'status-dot offline', 'индикатор offline после logout');
    assert.equal(await ev(`document.getElementById('screen-connect').hidden`), false, 'экран подключения активен');

    assert.equal(exceptions.length, 0, 'page exceptions: ' + JSON.stringify(exceptions));
    console.log(JSON.stringify({ ok: true, appUrl, apiPort, viewport: await ev('({w:innerWidth,h:innerHeight})') }, null, 2));
  } finally {
    // Закрываем страницу, но не ждём ответа: очистка не должна зависать на 30с.
    try { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id: ++id, method: 'Page.close', params: {} })); } catch {}
    try { ws?.close(); } catch {}
    try { chrome.kill('SIGKILL'); } catch {}
    if (chrome.exitCode === null) await once(chrome, 'exit').catch(() => {});
    rmrf(profileDir);
    for (const s of [staticServer, apiServer]) { try { s.closeAllConnections?.(); } catch {} }
    await new Promise((r) => staticServer.close(r));
    await new Promise((r) => apiServer.close(r));
  }
}

function rmrf(dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }

async function getFreePort() {
  const s = http.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const port = s.address().port;
  await new Promise((r) => s.close(r));
  return port;
}

async function waitForCdp(port, chrome, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) { const v = await r.json(); if (v.webSocketDebuggerUrl) return v.webSocketDebuggerUrl; }
    } catch {}
    await sleep(150);
  }
  throw new Error('CDP не поднялся' + (chrome.exitCode !== null ? ` (chromium exit ${chrome.exitCode})` : ''));
}

// Создаём отдельный page-target (about:blank) и берём его webSocketDebuggerUrl.
async function createPageTarget(port) {
  const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  if (!r.ok) throw new Error(`не удалось создать page target: ${r.status}`);
  const target = await r.json();
  if (!target.webSocketDebuggerUrl) throw new Error('page target без webSocketDebuggerUrl');
  return target.webSocketDebuggerUrl;
}

main().catch((e) => { console.error(JSON.stringify({ ok: false, error: e.message, stack: e.stack }, null, 2)); process.exitCode = 1; });
