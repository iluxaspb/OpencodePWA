// voice-speech.test.mjs — тесты озвучивателя TTS (speech.js) с injected mocks.
// Никакой внешней сети/микрофона не используется: speechSynthesis и
// SpeechSynthesisUtterance инъецируются как локальные заглушки.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTts, TTS_STATE } from '../js/voice/speech.js';

// -- Локальные заглушки (mock), без выхода во внешний мир ---------------------

function makeMockUtterance() {
  class MockUtterance {
    constructor(text) {
      this.text = text;
      this.lang = '';
      this.rate = 1;
      this.voice = null;
      this._handlers = {};
    }
    addEventListener(name, fn) {
      this._handlers[name] = fn;
    }
    fire(name) {
      if (this._handlers[name]) this._handlers[name]({ type: name, target: this });
    }
  }
  return MockUtterance;
}

function makeMockSynthesis(voices = [], opts = {}) {
  return {
    spoken: [],
    getVoices: () => voices,
    speak(utterance) { this.spoken.push(utterance); if (opts.failSpeak) throw new Error(opts.failSpeak); },
    pause() { this.paused = (this.paused || 0) + 1; },
    resume() { this.resumed = (this.resumed || 0) + 1; },
    cancel() { this.cancelled = (this.cancelled || 0) + 1; },
  };
}

const VOICES = [
  { lang: 'ru-RU', name: 'Android Russian', default: false, localService: true },
  { lang: 'en-US', name: 'Android English', default: false, localService: true },
];

function makeTts(overrides = {}) {
  const synthesis = overrides.synthesis;
  const usesOwnSynth = !synthesis;
  const s = synthesis || makeMockSynthesis(VOICES, overrides);
  const events = [];
  const tts = createTts({
    speechSynthesis: s,
    SpeechSynthesisUtterance: makeMockUtterance(),
    lang: overrides.lang || 'ru',
    rate: overrides.rate ?? 1,
    readCode: Boolean(overrides.readCode),
    onEvent: (ev, payload) => events.push({ ev, payload }),
  });
  return { tts, synth: s, events, usesOwnSynth };
}

// -- available и отказ при недоступном TTS --------------------------------------

test('available=false, когда нет speechSynthesis или Utterance', () => {
  assert.equal(createTts({}).available(), false);
  assert.equal(createTts({ speechSynthesis: {} }).available(), false);
  const s = makeMockSynthesis(VOICES);
  assert.equal(createTts({ speechSynthesis: s }).available(), false);
  assert.equal(createTts({ speechSynthesis: s, SpeechSynthesisUtterance: makeMockUtterance() }).available(), true);
});

test('speak при недоступном TTS возвращает false и шлёт ERROR', () => {
  const tts = createTts({});
  const events = [];
  tts.setOnEvent((ev, p) => events.push(ev));
  assert.equal(tts.speak('привет'), false);
  assert.deepEqual(events, [TTS_STATE.ERROR]);
});

// -- Озвучивание с mocks --------------------------------------------------------

test('speak передаёт очищенный текст, lang, rate и голос в utterance', () => {
  const { tts, synth } = makeTts();
  const ok = tts.speak('Привет **мир**');
  assert.equal(ok, true);
  assert.equal(synth.spoken.length, 1);
  const u = synth.spoken[0];
  assert.equal(u.text, 'Привет мир'); // Markdown очищен
  assert.equal(u.lang, 'ru-RU');      // режим ru
  assert.equal(u.rate, 1);
  assert.equal(u.voice.name, 'Android Russian'); // голос по базе ru
  assert.equal(tts.getState().current, u);
});

test('speak: auto-режим определяет язык по тексту и ставит en-US для латиницы', () => {
  const { tts, synth } = makeTts({ lang: 'auto' });
  tts.speak('hello world');
  assert.equal(synth.spoken[0].lang, 'en-US');
});

test('speak шлёт START и при срыве — ERROR с сообщением', () => {
  const s = makeMockSynthesis(VOICES, { failSpeak: 'нет двигателя' });
  const { tts, events } = makeTts({ synthesis: s });
  assert.equal(tts.speak('привет'), false);
  assert.ok(events.some((e) => e.ev === TTS_STATE.ERROR && /нет двигателя/.test(e.payload.message)));
});

test('speak: текст, пустой после очистки, не озвучивается', () => {
  const { tts, synth, events } = makeTts();
  assert.equal(tts.speak('   '), false); // только пробелы
  assert.equal(synth.spoken.length, 0);
  assert.ok(!events.some((e) => e.ev === TTS_STATE.START));
});

test('speak: код-единственный текст заменяется на «код» и озвучивается', () => {
  const { tts, synth } = makeTts();
  assert.equal(tts.speak('```code```'), true);
  assert.equal(synth.spoken.length, 1);
  assert.equal(synth.spoken[0].text, 'код');
});

test('speak дважды подряд прерывает прежнее (cancel) и озвучивает заново', () => {
  const { tts, synth } = makeTts();
  tts.speak('первый');
  const first = synth.spoken[0];
  const ok = tts.speak('второй');
  assert.equal(ok, true);
  assert.equal(synth.cancelled, 2); // speak() сам вызывает stop()
  assert.equal(synth.spoken.length, 2);
  assert.equal(synth.spoken[1].text, 'второй');
  assert.notEqual(tts.getState().current, first);
});

// -- Скорость -------------------------------------------------------------------

test('setRate ограничивает скорость диапазоном 0.5-2.0', () => {
  const { tts, synth } = makeTts({ rate: 3 });
  assert.equal(tts.getState().rate, 2); // уже на входе сжат
  assert.equal(tts.setRate(0.2), 0.5);
  assert.equal(tts.setRate(1.5), 1.5);
  tts.speak('текст');
  assert.equal(synth.spoken[0].rate, 1.5);
});

// -- Пауза/возобновление/останов -------------------------------------------------

test('pause/resume/stop зовут методы synthesis и шлют события', () => {
  const { tts, synth, events } = makeTts();
  tts.speak('текст');
  assert.equal(tts.pause(), true);
  assert.equal(tts.resume(), true);
  assert.equal(tts.stop(), true);
  assert.equal(synth.paused, 1);
  assert.equal(synth.resumed, 1);
  assert.equal(synth.cancelled, 2); // speak() сам вызывает stop()
  assert.equal(tts.getState().current, null);
  const evs = events.map((e) => e.ev);
  assert.ok(evs.includes(TTS_STATE.PAUSE));
  assert.ok(evs.includes(TTS_STATE.RESUME));
  assert.ok(evs.includes(TTS_STATE.CANCEL));
});

test('pause/resume без активного utterance ничего не делают', () => {
  const { tts, synth } = makeTts();
  assert.equal(tts.pause(), false);
  assert.equal(tts.resume(), false);
  assert.equal(synth.paused || 0, 0);
  assert.equal(synth.resumed || 0, 0);
});

test('stop без активного TTS возвращает false', () => {
  assert.equal(createTts({}).stop(), false);
});

// -- События utterance (start/end) ----------------------------------------------

test('события utterance пробрасываются в onEvent через addEventListener', () => {
  const { tts, synth, events } = makeTts();
  tts.speak('текст');
  const u = synth.spoken[0];
  assert.equal(typeof u._handlers.start, 'function');
  u.fire('start');
  u.fire('end');
  const evs = events.map((e) => e.ev);
  assert.ok(evs.includes(TTS_STATE.START));
  assert.ok(evs.includes(TTS_STATE.END));
});

test('onEvent не роняет поток при броске исключения', () => {
  const s = makeMockSynthesis(VOICES);
  const events = [];
  const tts = createTts({
    speechSynthesis: s,
    SpeechSynthesisUtterance: makeMockUtterance(),
    lang: 'ru',
    onEvent: () => { throw new Error('колбэк упал'); },
  });
  assert.doesNotThrow(() => tts.speak('текст'));
  assert.equal(s.spoken.length, 1);
  // не уронило синтезатор
  tts.setOnEvent((ev, p) => events.push(ev));
  assert.equal(events.length, 0);
});

// -- Голоса и readCode ------------------------------------------------------------

test('voices() возвращает нормализованный список из mock getVoices', () => {
  const { tts } = makeTts();
  const vs = tts.voices();
  assert.equal(vs.length, 2);
  assert.equal(vs[0].lang, 'ru-ru');
  assert.equal(vs[1].name, 'Android English');
});

test('voices() возвращает [] при ошибке getVoices или отсутствии метода', () => {
  const bad = { getVoices: () => { throw new Error('no voices'); } };
  const s = { noise: true };
  assert.deepEqual(createTts({ speechSynthesis: bad, SpeechSynthesisUtterance: makeMockUtterance() }).voices(), []);
  assert.deepEqual(createTts({ speechSynthesis: s, SpeechSynthesisUtterance: makeMockUtterance() }).voices(), []);
});

test('readCode=true сохраняет код при озвучивании', () => {
  const { tts, synth } = makeTts({ readCode: true });
  tts.speak('наберите `npm i` и код ```js\nconst x=1;\n```');
  const u = synth.spoken[0];
  assert.ok(u.text.includes('const x=1;'));
  assert.ok(u.text.includes('npm i'));
});
