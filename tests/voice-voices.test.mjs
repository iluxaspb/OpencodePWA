// voice-voices.test.mjs — тесты чистой логики выбора системных голосов TTS.
// Модуль voices.js не обращается к speechSynthesis и не выполняет сетевых
// операций: только принимает список голосов и возвращает выбранный.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LANGUAGES,
  normalizeLang,
  langBase,
  normalizeVoice,
  normalizeVoices,
  pickVoice,
  languageForText,
  resolveTtsLang,
  clampRate,
} from '../js/voice/voices.js';

const ruVoice = { lang: 'ru-RU', name: 'Android Russian', default: false, localService: true };
const enVoice = { lang: 'en-US', name: 'Android English', default: false, localService: true };
const enGB = { lang: 'en-GB', name: 'English UK', default: false, localService: true };
const defaultVoice = { lang: 'de-DE', name: 'German Default', default: true, localService: true };

test('LANGUAGES задаёт ru/en/auto', () => {
  assert.equal(LANGUAGES.RU, 'ru');
  assert.equal(LANGUAGES.EN, 'en');
  assert.equal(LANGUAGES.AUTO, 'auto');
});

test('normalizeLang приводит регистр, подчёркивание и пробелы', () => {
  assert.equal(normalizeLang('ru'), 'ru');
  assert.equal(normalizeLang('ru-RU'), 'ru-ru');
  assert.equal(normalizeLang('en_US'), 'en-us');
  assert.equal(normalizeLang('  Ru-RU  '), 'ru-ru');
  assert.equal(normalizeLang(''), '');
  assert.equal(normalizeLang(null), '');
  assert.equal(normalizeLang(42), '');
});

test('langBase выделяет базу языка', () => {
  assert.equal(langBase('ru-RU'), 'ru');
  assert.equal(langBase('en-us'), 'en');
  assert.equal(langBase('ru'), 'ru');
  assert.equal(langBase(''), '');
  assert.equal(langBase(null), '');
});

test('normalizeVoice отбрасывает невалидные и нормализует поля', () => {
  assert.equal(normalizeVoice(null), null);
  assert.equal(normalizeVoice(undefined), null);
  assert.equal(normalizeVoice('string'), null);
  assert.equal(normalizeVoice({}), null);
  assert.equal(normalizeVoice({ name: 'Only Name' }), null);
  const v = normalizeVoice(ruVoice);
  assert.deepEqual(v, {
    lang: 'ru-ru',
    name: 'Android Russian',
    default: false,
    localService: true,
  });
});

test('normalizeVoice приводит default/localService к булеву', () => {
  const v = normalizeVoice({ lang: 'ru', name: 'x', default: 1, localService: 'yes' });
  assert.equal(v.default, true);
  assert.equal(v.localService, true);
});

test('normalizeVoices фильтрует невалидные записи', () => {
  const out = normalizeVoices([ruVoice, null, 'x', {}, enVoice]);
  assert.equal(out.length, 2);
  assert.equal(out[0].lang, 'ru-ru');
  assert.equal(out[1].lang, 'en-us');
});

test('normalizeVoices не-массив возвращает []', () => {
  assert.deepEqual(normalizeVoices(null), []);
  assert.deepEqual(normalizeVoices({}), []);
  assert.deepEqual(normalizeVoices('x'), []);
});

test('pickVoice: идёт к голосу точного совпадения языка', () => {
  const v = pickVoice([enVoice, ruVoice], 'ru-RU');
  assert.equal(v.name, 'Android Russian');
});

test('pickVoice: выбирает по базе языка (ru для ru-RU)', () => {
  const list = [{ lang: 'ru-BY', name: 'RU-BY' }, { lang: 'en-US', name: 'EN' }];
  const v = pickVoice(list, 'ru-RU');
  assert.equal(v.name, 'RU-BY');
});

test('pickVoice: пустой список -> null', () => {
  assert.equal(pickVoice([], 'ru'), null);
  assert.equal(pickVoice(null, 'ru'), null);
});

test('pickVoice: без совпадения по языку использует более близкий голос', () => {
  const list = [enGB, ruVoice];
  // запрос ru-RU: ruVoice точнее (база ru), en-GB тоже база en.
  const v = pickVoice(list, 'ru-RU');
  assert.equal(v.name, 'Android Russian');
});

test('pickVoice: если языкового совпадения нет — голос по умолчанию', () => {
  const v = pickVoice([enVoice, defaultVoice], 'fr-FR');
  assert.equal(v.name, 'German Default');
});

test('pickVoice: без запрошенного языка — голос по умолчанию', () => {
  const v = pickVoice([enVoice, defaultVoice]);
  assert.equal(v.name, 'German Default');
});

test('pickVoice: без default — первый голос списка', () => {
  const v = pickVoice([enVoice, ruVoice], 'fr');
  assert.equal(v.name, 'Android English');
});

test('pickVoice: языковое совпадение имеет приоритет над default', () => {
  const v = pickVoice([defaultVoice, ruVoice], 'ru');
  assert.equal(v.name, 'Android Russian');
});

test('languageForText определяет язык по кириллице', () => {
  assert.equal(languageForText('Привет мир'), LANGUAGES.RU);
  assert.equal(languageForText('hello world'), LANGUAGES.EN);
  assert.equal(languageForText(''), LANGUAGES.AUTO);
  assert.equal(languageForText(null), LANGUAGES.AUTO);
  assert.equal(languageForText('  '), LANGUAGES.EN); // нет кириллицы
});

test('resolveTtsLang по явному режиму', () => {
  assert.equal(resolveTtsLang('ru'), 'ru-RU');
  assert.equal(resolveTtsLang('en'), 'en-US');
});

test('resolveTtsLang auto определяется по тексту', () => {
  assert.equal(resolveTtsLang('auto', 'Привет'), 'ru-RU');
  assert.equal(resolveTtsLang('auto', 'hello'), 'en-US');
  assert.equal(resolveTtsLang('AUTO', 'Привет'), 'ru-RU');
});

test('clampRate ограничивает диапазон 0.5-2.0', () => {
  assert.equal(clampRate(0.1), 0.5);
  assert.equal(clampRate(5), 2);
  assert.equal(clampRate(1), 1);
  assert.equal(clampRate(0.75), 0.75);
  assert.equal(clampRate('сильно'), 1);
  assert.equal(clampRate(NaN), 1);
  assert.equal(clampRate(undefined), 1);
});
