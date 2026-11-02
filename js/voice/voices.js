// voices.js — чистая логика выбора системных голосов TTS по языку.
// Не обращается к speechSynthesis и не выполняет сетевых операций:
// только принимает список голосов [{ lang, name, default, localService } or null]
// и возвращает выбранный. Логика покрыта тестами.
//
// Список голосов передаётся извне (приложение берёт его из
// speechSynthesis.getVoices()). Голоса считаются «системными» — доступными
// локальному движку браузера (на Android — системный Android TTS).

// Список языков, которые считаем «основными» и умеем выбирать.
export const LANGUAGES = Object.freeze({
  RU: 'ru',
  EN: 'en',
  AUTO: 'auto',
});

// Приводим код языка к нормализованному виду: 'ru', 'ru-RU', 'en-us' и т.п.
export function normalizeLang(lang) {
  if (typeof lang !== 'string' || !lang) return '';
  return lang.trim().toLowerCase().replace('_', '-');
}

// База языка: 'ru-RU' -> 'ru', 'en-US' -> 'en'.
export function langBase(lang) {
  const norm = normalizeLang(lang);
  if (!norm) return '';
  const dash = norm.indexOf('-');
  return dash === -1 ? norm : norm.slice(0, dash);
}

// Отбрасываем несуществующие/пустые голоса и оставляем объект голоса
// нормализованной формы { lang, name, default, localService }.
export function normalizeVoice(voice) {
  if (!voice || typeof voice !== 'object') return null;
  const lang = typeof voice.lang === 'string' ? voice.lang : '';
  if (!lang) return null;
  const name = typeof voice.name === 'string' ? voice.name : voice.name || '';
  return {
    lang: normalizeLang(lang),
    name,
    default: Boolean(voice.default),
    localService: Boolean(voice.localService),
  };
}

export function normalizeVoices(voices) {
  if (!Array.isArray(voices)) return [];
  const out = [];
  for (const v of voices) {
    const nv = normalizeVoice(v);
    if (nv) out.push(nv);
  }
  return out;
}

// Проверяем, что у голоса язык совпадает с нужной базой (например 'ru').
function matchesBase(voice, base) {
  const b = langBase(voice.lang);
  return Boolean(b && base && b === base);
}

// Похожесть языка для мягкого сопоставления: стараемся выбрать голос,
// близкий к запрошенному (ru-RU для ru и т.п.).
function similarity(voice, requested) {
  const req = normalizeLang(requested);
  if (!req) return 0;
  const v = normalizeLang(voice.lang);
  let score = 0;
  if (v === req) score += 4; // точное совпадение ru-RU == ru-RU
  if (langBase(v) === langBase(req)) score += 2; // ru-RU и ru
  if (v.startsWith(req)) score += 1;
  return score;
}

// Выбор голоса:
//   pickVoice(voices, langOrNull)
// Возвращает нормализованный голос или null, если выбрать нечего.
// Порядок:
//   1. Точное совпадение языка запроса;
//   2. голос с той же базой языка (ru для ru-RU);
//   3. голос по умолчанию (default: true);
//   4. первый голос в списке (если есть);
//   5. null.
export function pickVoice(voices, lang = null) {
  const list = normalizeVoices(voices);
  if (list.length === 0) return null;
  const requested = lang ? normalizeLang(lang) : '';
  if (requested) {
    // Точное совпадение.
    const exact = list.find((v) => normalizeLang(v.lang) === requested);
    if (exact) return exact;
    // Совпадение по базе языка.
    const base = langBase(requested);
    const byBase = list.find((v) => matchesBase(v, base));
    if (byBase) return byBase;
  }
  // Самый близкий по языку (если запрошен язык).
  if (requested) {
    let best = null;
    let bestScore = 0;
    for (const v of list) {
      const s = similarity(v, requested);
      if (s > bestScore) {
        bestScore = s;
        best = v;
      }
    }
    if (best) return best;
  }
  // Голос по умолчанию.
  const def = list.find((v) => v.default);
  if (def) return def;
  // Первый голос.
  return list[0];
}

// Упрощённый выбор по языку ответа: определяем базовый язык (ru/en) по тексту
// и выбираем голос.
export function languageForText(text) {
  if (typeof text !== 'string' || !text) return LANGUAGES.AUTO;
  const hasCyrillic = /[а-яА-ЯёЁ]/.test(text);
  return hasCyrillic ? LANGUAGES.RU : LANGUAGES.EN;
}

// Возвращает строку локали для speechSynthesis по выбранному режиму языка.
//   resolveTtsLang(mode, text)
//   mode: 'auto' | 'ru' | 'en'
export function resolveTtsLang(mode, text = '') {
  const m = String(mode || 'auto').toLowerCase();
  if (m === 'ru') return 'ru-RU';
  if (m === 'en') return 'en-US';
  const detected = languageForText(text);
  return detected === LANGUAGES.RU ? 'ru-RU' : 'en-US';
}

// Приводит скорость голоса к допустимому диапазону 0.5-2.0.
export function clampRate(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n)) return 1;
  return Math.min(2, Math.max(0.5, n));
}
