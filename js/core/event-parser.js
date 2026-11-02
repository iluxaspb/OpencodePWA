// event-parser.js — чистый парсер входящих событий WebSocket (см. CONTRACT.md).
// Не выполняет сетевых операций и не обращается к DOM. Покрыт тестами.
// parseSocketEvent(raw) => { kind, text?, meta? } | null

export const KINDS = Object.freeze({
  CONTENT: 'content',
  DONE: 'done',
  ERROR: 'error',
  SESSION_ID: 'session_id',
  STATUS: 'status',
});

// Карта типов событий OpenCode -> нормализованный kind.
const KIND_BY_TYPE = {
  content: KINDS.CONTENT,
  done: KINDS.DONE,
  error: KINDS.ERROR,
  session_id: KINDS.SESSION_ID,
  status: KINDS.STATUS,
};

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function takeText(obj) {
  if (typeof obj === 'string') return obj;
  if (!isPlainObject(obj)) return undefined;
  if (typeof obj.text === 'string') return obj.text;
  if (typeof obj.content === 'string') return obj.content;
  if (typeof obj.data === 'string') return obj.data;
  return undefined;
}

function takeType(obj) {
  if (!isPlainObject(obj)) return undefined;
  return typeof obj.type === 'string' ? obj.type : undefined;
}

// Нормальный объект события с полем type (может быть обёрнут в "payload").
function fromJsonValue(value) {
  if (!isPlainObject(value)) return null;
  let type = takeType(value) || (isPlainObject(value.payload) ? takeType(value.payload) : undefined);
  if (!type) {
    // Планарный блок текста без type — считаем содержимым.
    const text = takeText(value);
    if (text !== undefined) {
      return { kind: KINDS.CONTENT, text };
    }
    return null;
  }
  const kind = KIND_BY_TYPE[type] || KINDS.STATUS;
  const raw = value.payload && isPlainObject(value.payload) ? value.payload : value;
  const text = takeText(raw);
  const textValue = text !== undefined ? text : undefined;
  let meta;
  if (kind === KINDS.SESSION_ID) {
    const sid = takeSessionId(raw) || takeSessionId(value);
    meta = sid ? { session_id: sid } : undefined;
  } else if (kind === KINDS.ERROR) {
    const msg = typeof raw.error === 'string' ? raw.error : textValue;
    const message = msg || (typeof value.error === 'string' ? value.error : undefined) || 'Неизвестная ошибка';
    meta = { message };
  } else if (kind === KINDS.DONE) {
    // Пакет может нести stop_reason — сохраняем в meta.
    const reason = takeStopReason(raw) || takeStopReason(value);
    meta = reason ? { stop_reason: reason } : undefined;
  } else if (kind === KINDS.STATUS) {
    meta = { type };
    const text2 = textValue;
    if (text2 !== undefined) meta.text = text2;
    else if (isPlainObject(raw)) meta = { ...raw, type };
  }
  const out = { kind };
  if (textValue !== undefined) out.text = textValue;
  if (meta) out.meta = meta;
  return out;
}

function takeSessionId(obj) {
  if (!isPlainObject(obj)) return undefined;
  const value = obj.session_id;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  // устаревший вариант поля ("session"/"id")
  for (const key of ['session', 'id']) {
    const k = obj[key];
    if (typeof k === 'string' || typeof k === 'number') return String(k);
  }
  return undefined;
}

function takeStopReason(obj) {
  if (!isPlainObject(obj)) return undefined;
  const value = obj.stop_reason;
  return typeof value === 'string' ? value : undefined;
}

// Парсим JSON, аккуратно возвращая null для не-JSON.
function tryParseJson(raw) {
  if (typeof raw !== 'string') return { ok: false };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false };
  if (trimmed[0] !== '{' && trimmed[0] !== '[') return { ok: false };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false };
  }
}

// Парсим SSE-подобную строку "data: <json>" / "event: <type>".
function tryParseSseLine(raw) {
  const lines = String(raw).split('\n').map((l) => l.trim()).filter(Boolean);
  let type;
  let data;
  for (const line of lines) {
    const med = line.match(/^(data|event|id)\s*:\s*(.*)$/i);
    if (!med) continue;
    if (med[1].toLowerCase() === 'event') {
      if (typeof med[2] === 'string' && med[2]) type = med[2];
    } else if (med[1].toLowerCase() === 'data') {
      data = med[2];
    }
  }
  if (data === undefined) return null;
  let value;
  const json = tryParseJson(data);
  if (json.ok) {
    value = json.value;
    // Объединяем event: <type> с JSON-телом
    if (type && isPlainObject(value) && !value.type) value = { ...value, type };
  } else {
    if (type) return { event: type, data };
    return null;
  }
  return { value };
}

export function parseSocketEvent(raw) {
  if (typeof raw !== 'string') return null;
  const line = raw.trim();
  if (line.startsWith('data:') || line.startsWith('event:') || line.startsWith('id:')) {
    const sse = tryParseSseLine(line);
    if (sse) {
      if (sse.value) return fromJsonValue(sse.value);
      if (sse.event) {
        const kind = KIND_BY_TYPE[sse.event] || KINDS.STATUS;
        return sse.data !== undefined ? { kind, text: takeText(sse.data) ?? undefined, meta: { event: sse.event } } : { kind, meta: { event: sse.event } };
      }
    }
    // Падает в общий текстовый разбор ниже, если не SSE.
  }
  const parsed = tryParseJson(line);
  if (parsed.ok) {
    const fromArray = Array.isArray(parsed.value)
      ? parsed.value.map((v) => fromJsonValue(v)).find(Boolean)
      : fromJsonValue(parsed.value);
    return fromArray || null;
  }
  // Планарный блок текста: любая непустая строка — фрагмент содержимого.
  return line ? { kind: KINDS.CONTENT, text: line } : null;
}
