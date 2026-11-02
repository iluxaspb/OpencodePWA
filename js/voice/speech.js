// speech.js — системный озвучиватель ответов через speechSynthesis (TTS).
// Используется ТОЛЬКО системный движок браузера (на Android — системный
// Android TTS). Никаких внешних TTS-сервисов и облачных движков.
//
// Модуль полностью изолирован от DOM: speechSynthesis и SpeechSynthesisUtterance
// инъецируются (для тестов передаются заглушки). Поддерживает:
//   speak(), pause(), resume(), stop(),
//   скорость 0.5-2.0, выбор языка/голоса, очистку Markdown (код пропускается).
//
// API:
//   const tts = createTts({ speechSynthesis, SpeechSynthesisUtterance, lang, rate, readCode, onEvent });
//   tts.speak(markdownText);
//   tts.pause(); tts.resume(); tts.stop();
//   tts.setRate(0.8); tts.setLang('ru'); tts.setReadCode(true);
//   tts.available() -> boolean; tts.voices() -> [normalized voices].

import { cleanupMarkdownForSpeech } from './markdown.js';
import { pickVoice, resolveTtsLang, clampRate, normalizeVoices } from './voices.js';

// События состояния озвучивания (передаются через onEvent callback).
export const TTS_STATE = Object.freeze({
  START: 'start',
  END: 'end',
  PAUSE: 'pause',
  RESUME: 'resume',
  ERROR: 'error',
  CANCEL: 'cancel',
});

const DEFAULT_RATE = 1;

export function createTts(config = {}) {
  const synthesis = config.speechSynthesis || null;
  const UtteranceCtor = config.SpeechSynthesisUtterance || config.Utterance || null;

  let state = {
    lang: config.lang || 'ru', // 'auto' | 'ru' | 'en'
    rate: clampRate(config.rate === undefined || config.rate === null ? DEFAULT_RATE : config.rate),
    readCode: Boolean(config.readCode),
    current: null,
  };
  let onEvent = typeof config.onEvent === 'function' ? config.onEvent : null;

  function emit(event, payload) {
    if (!onEvent) return;
    try {
      onEvent(event, payload || {});
    } catch { /* не даём колбэку уронить поток */ }
  }

  function available() {
    return !!(synthesis && UtteranceCtor && typeof synthesis.speak === 'function');
  }

  function setOnEvent(fn) {
    onEvent = typeof fn === 'function' ? fn : null;
  }

  function setLang(lang) {
    state = { ...state, lang: lang || 'ru' };
  }

  function setRate(rate) {
    state = { ...state, rate: clampRate(rate) };
    return state.rate;
  }

  function setReadCode(readCode) {
    state = { ...state, readCode: Boolean(readCode) };
  }

  function voices() {
    if (!synthesis || typeof synthesis.getVoices !== 'function') return [];
    try {
      return normalizeVoices(synthesis.getVoices());
    } catch {
      return [];
    }
  }

  // Выбор голоса по текущему языку ситуации. При lang='auto' язык определяется
  // по тексту.
  function chooseVoice(textToSpeak) {
    const langMode = state.lang || 'auto';
    const ttsLang = resolveTtsLang(langMode, textToSpeak);
    return pickVoice(voices(), ttsLang);
  }

  function makeUtterance(textToSpeak) {
    if (!UtteranceCtor) return null;
    const clean = cleanupMarkdownForSpeech(textToSpeak, { readCode: state.readCode });
    if (!clean) return null;
    const u = new UtteranceCtor(clean);
    const ttsLang = resolveTtsLang(state.lang || 'auto', clean);
    const voice = chooseVoice(clean);
    u.text = clean;
    u.lang = ttsLang;
    u.rate = state.rate;
    if (voice) u.voice = voice;
    attachHandlers(u);
    return u;
  }

  function attachHandlers(utterance) {
    if (!utterance || typeof utterance.addEventListener !== 'function') return;
    const evt = (name) => {
      try { utterance.addEventListener(name, () => emit(TTS_STATE[name] || name)); } catch { /* ignore */ }
    };
    // addEventListener на utterance поддерживается не везде; допускаем и on<событие>.
    evt('start');
    evt('end');
    evt('pause');
    evt('resume');
    evt('error');
    evt('cancel');
  }

  function speak(markdownText) {
    if (!available()) {
      emit(TTS_STATE.ERROR, { message: 'SpeechSynthesis недоступно в этом браузере' });
      return false;
    }
    // Прервать прежнее озвучивание, если идёт (повторное «Прочитать» = заново).
    stop();
    const utterance = makeUtterance(markdownText);
    if (!utterance) return false;
    state = { ...state, current: utterance };
    emit(TTS_STATE.START, { lang: utterance.lang, rate: utterance.rate });
    try {
      synthesis.speak(utterance);
      return true;
    } catch (err) {
      emit(TTS_STATE.ERROR, { message: (err && err.message) || String(err) });
      return false;
    }
  }

  function pause() {
    if (!available() || !state.current) return false;
    try {
      synthesis.pause();
      emit(TTS_STATE.PAUSE, {});
      return true;
    } catch (err) {
      emit(TTS_STATE.ERROR, { message: (err && err.message) || String(err) });
      return false;
    }
  }

  function resume() {
    if (!available() || !state.current) return false;
    try {
      synthesis.resume();
      emit(TTS_STATE.RESUME, {});
      return true;
    } catch (err) {
      emit(TTS_STATE.ERROR, { message: (err && err.message) || String(err) });
      return false;
    }
  }

  function stop() {
    if (!available()) return false;
    try {
      synthesis.cancel();
      state = { ...state, current: null };
      emit(TTS_STATE.CANCEL, {});
      return true;
    } catch (err) {
      emit(TTS_STATE.ERROR, { message: (err && err.message) || String(err) });
      return false;
    }
  }

  function getState() {
    return { ...state };
  }

  return {
    speak,
    pause,
    resume,
    stop,
    setRate,
    setLang,
    setReadCode,
    available,
    voices,
    setOnEvent,
    getState,
  };
}
