// recognizer.js — голосовой ввод через Web Speech API.
// Используется webkitSpeechRecognition (Web Speech API, Chrome/Chromium).
// Язык распознавания по умолчанию ru-RU; текст отдаётся через callback,
// и приложение позволяет отредактировать его ПЕРЕД отправкой (edit-before-send
// обеспечивается вызовами callback, сам модуль ничего не отправляет).
//
// Модуль не выполняет сетевых операций и не обращается к DOM. Реальное
// SpeechRecognition инъецируется (для тестов — заглушка). Класс фабрики
// выбирается из переданного объекта (обычно window или аналог):
//   const rec = createRecognizer({
//     recognitionCtor: (window.webkitSpeechRecognition || window.SpeechRecognition),
//     lang: 'ru-RU',
//     continuous: true,
//     interimResults: true,
//     onResult: (finalText, interimText) => {},
//     onStart: () => {}, onEnd: () => {}, onError: (err) => {},
//   });
//   rec.start(); rec.stop(); rec.abort(); rec.isRunning(); rec.destroy();

const DEFAULT_LANG = 'ru-RU';

export const REC_STATE = Object.freeze({
  IDLE: 'idle',
  LISTENING: 'listening',
  STOPPED: 'stopped',
});

export function createRecognizer(config = {}) {
  const RecognitionCtor = config.recognitionCtor || null;
  const lang = config.lang || DEFAULT_LANG;
  const continuous = config.continuous !== false;
  const interimResults = config.interimResults !== false;

  const onResult = typeof config.onResult === 'function' ? config.onResult : null;
  const onStart = typeof config.onStart === 'function' ? config.onStart : null;
  const onEnd = typeof config.onEnd === 'function' ? config.onEnd : null;
  const onError = typeof config.onError === 'function' ? config.onError : null;

  let recognition = null;
  let running = false;
  let finalText = '';
  let interimText = '';
  let endedNormally = false;

  // ----------------- конструирование и привязка событий ----------------
  function createRecognition() {
    if (!RecognitionCtor) return null;
    try {
      return new RecognitionCtor();
    } catch (err) {
      if (onError) onError({ name: 'not-allowed', message: (err && err.message) || String(err) });
      return null;
    }
  }

  function bindEvents(rec) {
    if (!rec) return;
    rec.lang = lang;
    rec.continuous = Boolean(continuous);
    rec.interimResults = Boolean(interimResults);

    if (typeof rec.onstart === 'function' || 'onstart' in rec) {
      rec.onstart = () => {
        running = true;
        endedNormally = false;
        if (onStart) onStart({});
      };
    }
    if (typeof rec.onend === 'function' || 'onend' in rec) {
      rec.onend = () => {
        running = false;
        if (onEnd) onEnd({ final: finalText, normal: endedNormally });
      };
    }
    if (typeof rec.onerror === 'function' || 'onerror' in rec) {
      rec.onerror = (event) => {
        const err = (event && event.error) || 'unknown';
        if (onError) onError(typeof err === 'object' ? err : { name: String(err), message: String(err) });
      };
    }
    if (typeof rec.onresult === 'function' || 'onresult' in rec) {
      rec.onresult = (event) => {
        const { final, interim } = readResults(event);
        finalText = final;
        interimText = interim;
        if (onResult) {
          onResult({ final: finalText, interim: interimText, text: finalText + (interimText ? ' ' + interimText : '') });
        }
      };
    }
  }

  function readResults(event) {
    let final = '';
    let interim = '';
    if (!event || !event.results) return { final, interim };
    const counts = typeof event.resultIndex === 'number' ? event.resultIndex : 0;
    for (let i = counts; i < event.results.length; i++) {
      const res = event.results[i];
      const transcript = (res && res[0] && res[0].transcript) ? res[0].transcript : '';
      if (res && res.isFinal) final += transcript;
      else interim += transcript;
    }
    return { final, interim };
  }

  // ----------------- публичное API -----------------
  function start() {
    if (running) return false;
    if (!RecognitionCtor) {
      if (onError) onError({ name: 'unsupported', message: 'Web Speech API (webkitSpeechRecognition) недоступно' });
      return false;
    }
    finalText = '';
    interimText = '';
    endedNormally = false;
    if (!recognition) {
      recognition = createRecognition();
      if (!recognition) return false;
      bindEvents(recognition);
    }
    try {
      recognition.start();
      return true;
    } catch (err) {
      // Повторный вызов start() на живом объекте может кинуть; помечаем как ошибку.
      if (onError) onError({ name: 'start-error', message: (err && err.message) || String(err) });
      return false;
    }
  }

  function stop() {
    if (!recognition) return false;
    try {
      endedNormally = true;
      recognition.stop();
      return true;
    } catch (err) {
      if (onError) onError({ name: 'stop-error', message: (err && err.message) || String(err) });
      return false;
    }
  }

  function abort() {
    if (!recognition) return false;
    try {
      recognition.abort();
      return true;
    } catch (err) {
      if (onError) onError({ name: 'abort-error', message: (err && err.message) || String(err) });
      return false;
    }
  }

  function isRunning() {
    return running;
  }

  function getText() {
    return {
      final: finalText,
      interim: interimText,
      text: finalText + (interimText ? ' ' + interimText : ''),
    };
  }

  function destroy() {
    if (recognition) {
      try { recognition.abort(); } catch { /* ignore */ }
      recognition = null;
    }
    running = false;
    finalText = '';
    interimText = '';
  }

  return {
    start,
    stop,
    abort,
    isRunning,
    getText,
    destroy,
    state: REC_STATE,
  };
}

// Проверка доступности Web Speech API в окружении (без создания инстанса).
export function isSpeechRecognitionSupported(env = {}) {
  const w = env || {};
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition || w.msSpeechRecognition;
  return typeof Ctor === 'function';
}
