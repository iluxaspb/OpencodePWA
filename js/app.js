import { createV2Client } from './core/v2-client.js';
import { createMockTransport } from './core/mock-transport.js';
import { createTts, createRecognizer, isSpeechRecognitionSupported } from './voice/index.js';

const $ = (id) => document.getElementById(id);
const state = { client: null, transport: null, session: null, timer: 0, generation: 0, messages: [], busy: false, transitioning: false, voiceBase: '', interim: '', reply: null };
const text = (id, value) => { $(id).textContent = value; };
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').hidden = true, 3500); }
function status(value, kind = 'online') { text('status-text', value); $('status-dot').className = `status-dot ${kind}`; }
function showChat(show) { $('screen-chat').hidden = !show; $('screen-connect').hidden = show; }
function userName(value) { text('user-name', value || ''); }
function renderMessages(items) {
  const root = $('messages'), bottom = root.scrollHeight - root.scrollTop - root.clientHeight < 80;
  root.replaceChildren(); state.messages = items;
  for (const item of items) { const el = document.createElement('div'); el.className = `msg ${item.type === 'user' ? 'user' : 'assistant'}`; el.textContent = item.type === 'user' ? item.text || '' : (item.content || []).filter(x => x.type === 'text').map(x => x.text).join(''); root.append(el); }
  if (bottom) root.scrollTop = root.scrollHeight;
}
function sessionTitle(s) { return s.title || s.id || s.sessionID || 'Сессия'; }
async function loadSessions(selectId) {
  const gen = state.generation, result = await state.client.listSessions(); if (gen !== state.generation) return;
  const sessions = result?.data || result || [], select = $('session-select'); select.replaceChildren();
  for (const s of sessions) { const option = document.createElement('option'); option.value = s.id || s.sessionID; option.textContent = sessionTitle(s); select.append(option); }
  if (selectId && [...select.options].some(o => o.value === selectId)) select.value = selectId;
  if (select.value) await chooseSession(select.value);
  else await newSession(false);
}
function stopPolling() { clearTimeout(state.timer); state.timer = 0; }
function schedulePoll(gen, id) {
  state.timer = setTimeout(async () => {
    if (gen !== state.generation || id !== state.session || !state.client) return;
    await poll();
    if (gen === state.generation && id === state.session && state.client) schedulePoll(gen, id);
  }, 1800);
}
async function poll() {
  if (!state.client || !state.session) return;
  const gen = state.generation, id = state.session;
  try { const result = await state.client.listMessages(id); if (gen !== state.generation || id !== state.session) return; renderMessages(result?.data || result || []); }
  catch (e) { if (gen === state.generation) status('Соединение прервано', 'offline'); }
}
async function chooseSession(id) {
  state.session = id; state.generation++; const gen = state.generation; state.busy = false; state.transitioning = false; state.reply = null; $('send-btn').disabled = false; $('send-btn').hidden = false; renderMessages([]); stopPolling();
  await poll();
  if (gen !== state.generation || id !== state.session || !state.client) return;
  schedulePoll(gen, id);
}
async function newSession(refresh = true) {
  const gen = ++state.generation;
  const priorSession = state.session, wasBusy = state.busy;
  stopPolling(); state.reply = null; state.session = null; state.transitioning = true; state.busy = false; $('send-btn').disabled = true; $('send-btn').hidden = false;
  try {
    if (wasBusy && state.client) { try { await state.client.interrupt(priorSession); } catch {} }
    if (gen !== state.generation || !state.client) return;
    const result = await state.client.createSession({}); if (gen !== state.generation || !state.client) return;
    const id = result?.id || result?.sessionID || result?.data?.id;
    if (!id) throw new Error('Сервер не вернул ID сессии');
    if (refresh) { await loadSessions(id); } else { state.session = id; renderMessages([]); schedulePoll(gen, id); }
  } finally {
    if (gen === state.generation) { state.transitioning = false; $('send-btn').disabled = false; $('send-btn').hidden = false; }
  }
}
async function connect(event) {
  event?.preventDefault(); $('connect-btn').disabled = true; status('Подключение…', 'connecting');
  try {
    if ($('mode-select').value === 'mock') {
      state.transport = createMockTransport(); await state.transport.connect(); await state.transport.authenticate({});
        state.transport.on('content', e => {
         if (!state.client || !state.session || state.generation !== state.reply?.generation) return;
         const reply = state.reply;
         reply.content[0].text += e.text || '';
         renderMessages([...state.messages]);
       });
        state.transport.on('done', () => { if (state.reply && state.reply.generation === state.generation) { state.reply = null; state.busy = false; $('send-btn').hidden = false; } });
       state.transport.on('error', e => { if (state.reply && state.reply.generation === state.generation) { state.reply = null; state.busy = false; $('send-btn').hidden = false; } toast(e.text || 'Ошибка mock'); }); state.client = { listSessions: async()=>({data:[]}), createSession: async()=>({id:'mock'}), listMessages: async()=>({data:state.messages}), prompt: async(_id,t)=>state.transport.sendInput(t), interrupt: async()=>state.transport.abort(), disconnect: async()=>state.transport.disconnect() };
    } else {
      const host = $('host-input').value.trim(), port = $('port-input').value.trim();
      if (!host || !/^\d{1,5}$/.test(port) || +port < 1 || +port > 65535) throw new Error('Укажите корректные хост и порт');
      state.client = createV2Client({ baseUrl: `${$('scheme-select').value}://${host}:${port}`, login: $('login-input').value, password: $('password-input').value });
      $('password-input').value = '';
      const info = await state.client.info(); userName(info?.user?.name || info?.user || info?.name || 'OpenCode');
    }
   showChat(true); status('Подключено'); $('stop-btn').hidden = false; await loadSessions();
  } catch (e) { ++state.generation; stopPolling(); try { await state.transport?.disconnect(); } catch {} try { await state.client?.disconnect(); } catch {} state.transport = state.client = null; state.session = null; showChat(false); status('Не подключено', 'offline'); toast(e.message || 'Не удалось подключиться'); }
  finally { $('connect-btn').disabled = false; }
}
async function send() {
  const input = $('chat-input'), originalDraft = input.value, draft = originalDraft.trim(); if (!draft || !state.session || state.busy || state.transitioning) return;
  const gen = state.generation, id = state.session;
  state.busy = true; $('send-btn').hidden = true; $('stop-btn').hidden = false;
  state.messages = [...state.messages, { type: 'user', text: draft }]; renderMessages(state.messages);
  if (state.transport) { const reply = { type: 'assistant', content: [{ type: 'text', text: '' }], generation: gen }; state.reply = reply; state.messages = [...state.messages, reply]; renderMessages(state.messages); }
  try { await state.client.prompt(id, draft); if (gen === state.generation && id === state.session) { if (input.value === originalDraft) input.value = ''; await poll(); } }
  catch (e) { if (gen === state.generation && id === state.session) toast(`Не отправлено: ${e.message || e}`); }
  finally { if (!state.transport && gen === state.generation && id === state.session) { state.busy = false; $('send-btn').hidden = false; } }
}
async function stop() { if (state.session) try { await state.client.interrupt(state.session); state.busy = false; state.reply = null; $('send-btn').hidden = false; } catch (e) { toast(e.message); } }
async function logout() {
  state.generation++; stopPolling(); state.busy = false; state.reply = null;
  recognizer?.destroy(); tts.stop();
  try { await state.transport?.disconnect(); } catch {} try { await state.client?.disconnect(); } catch {}
  state.client = state.transport = null; state.session = null; userName(''); showChat(false); status('Не подключено', 'offline'); renderMessages([]); createRecognizerInstance();
}
let tts = createTts({ speechSynthesis: window.speechSynthesis, SpeechSynthesisUtterance: window.SpeechSynthesisUtterance });
let recognizer;
function createRecognizerInstance() { recognizer = createRecognizer({ recognitionCtor: window.SpeechRecognition || window.webkitSpeechRecognition,
  onStart: () => $('mic-btn').classList.add('listening'),
  onEnd: () => $('mic-btn').classList.remove('listening'),
  onError: e => toast(e.message || 'Ошибка микрофона'),
  onResult: result => { const box = $('chat-input'); box.value = state.voiceBase + (state.voiceBase && result.final ? ' ' : '') + result.final + (result.interim ? ` ${result.interim}` : ''); state.interim = result.interim; } }); }
createRecognizerInstance();
$('connect-form').addEventListener('submit', connect);
$('mode-select').addEventListener('change', () => { $('net-fields').hidden = $('mode-select').value === 'mock'; }); $('net-fields').hidden = true;
$('send-btn').addEventListener('click', send); $('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
$('stop-btn').addEventListener('click', stop); $('logout-btn').addEventListener('click', logout);
$('new-session-btn').addEventListener('click', () => newSession(true).catch(e => toast(e.message)));
$('session-select').addEventListener('change', e => chooseSession(e.target.value));
function readFont() { try { return Number(localStorage.getItem('ocm-font-size')) || 16; } catch { return 16; } }
const font = Math.max(12, Math.min(28, readFont())); document.documentElement.style.setProperty('--font-size', `${font}px`);
function setFont(n) { const size = Math.max(12, Math.min(28, Number(n) || 16)); document.documentElement.style.setProperty('--font-size', `${size}px`); try { localStorage.setItem('ocm-font-size', String(size)); } catch {} }
$('font-minus').addEventListener('click', () => setFont(readFont() - 1)); $('font-plus').addEventListener('click', () => setFont(readFont() + 1));
$('font-reset').addEventListener('click', () => setFont(16));
$('tts-speak').addEventListener('click', () => { const latest = [...state.messages].reverse().find(x => x.type === 'assistant'); if (latest) tts.speak((latest.content || []).map(x => x.text || '').join('')); });
$('tts-pause').disabled = true; $('tts-stop').disabled = true;
tts.setOnEvent(ev => { const active = ev !== 'end' && ev !== 'cancel' && ev !== 'error'; $('tts-pause').disabled = !active; $('tts-stop').disabled = !active; $('tts-pause').textContent = ev === 'pause' ? 'Продолжить' : 'Пауза'; });
$('tts-pause').addEventListener('click', () => window.speechSynthesis?.paused ? tts.resume() : tts.pause()); $('tts-stop').addEventListener('click', () => tts.stop());
$('tts-rate').addEventListener('input', e => { const n = tts.setRate(e.target.value); text('tts-rate-val', `${n.toFixed(1)}×`); }); $('tts-lang').addEventListener('change', e => tts.setLang(e.target.value)); $('tts-code').addEventListener('change', e => tts.setReadCode(e.target.checked));
$('tts-voices').addEventListener('click', () => { const panel = $('voices-panel'); panel.hidden = !panel.hidden; panel.replaceChildren(); for (const v of tts.voices()) { const row = document.createElement('div'); row.className = 'voice-item'; row.textContent = `${v.name} — ${v.lang}`; panel.append(row); } });
$('mic-btn').disabled = !isSpeechRecognitionSupported(window); $('mic-btn').addEventListener('click', () => { if (recognizer.isRunning()) recognizer.stop(); else { state.voiceBase = $('chat-input').value; recognizer.start(); } });
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js').catch(() => {});
