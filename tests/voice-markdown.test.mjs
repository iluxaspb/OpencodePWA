// voice-markdown.test.mjs — тесты очистки Markdown для озвучивания.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanupMarkdownForSpeech,
  stripCodeBlocks,
  stripInlineCode,
  stripInlineMarkup,
  stripStructure,
  normalizeWhitespace,
} from '../js/voice/markdown.js';

test('cleanupMarkdownForSpeech: ссылки и изображения заменяются текстом', () => {
  const input = 'Смотри [документ](https://example.com) и ![схема](x.png)';
  assert.equal(cleanupMarkdownForSpeech(input), 'Смотри документ и схема');
});

test('cleanupMarkdownForSpeech: жирный, курсив и зачёркнутый убираются', () => {
  assert.equal(cleanupMarkdownForSpeech('это **важно** и *курсив* и ~~старое~~'), 'это важно и курсив и старое');
  assert.equal(cleanupMarkdownForSpeech('__подчёркнуто__ и _тоже_'), 'подчёркнуто и тоже');
});

test('cleanupMarkdownForSpeech: заголовки и списки читаются как обычный текст', () => {
  const input = '# Заголовок\n\n- первый пункт\n- второй пункт\n\n1. нумерованный';
  const out = cleanupMarkdownForSpeech(input);
  assert.ok(out.includes('Заголовок'));
  assert.ok(out.includes('первый пункт'));
  assert.ok(out.includes('второй пункт'));
  assert.ok(out.includes('нумерованный'));
  assert.ok(!out.includes('#'));
  assert.ok(!out.includes('- первый'));
  assert.ok(!out.includes('1.'));
});

test('cleanupMarkdownForSpeech: блок кода по умолчанию пропускается', () => {
  const input = 'Начало\n```js\nconst x = 1;\n```\nКонец';
  const out = cleanupMarkdownForSpeech(input);
  assert.ok(!out.includes('const x'));
  assert.ok(!out.includes('```'));
  assert.ok(out.includes('Начало'));
  assert.ok(out.includes('Конец'));
});

test('cleanupMarkdownForSpeech: inline code по умолчанию пропускается', () => {
  const input = 'Наберите `npm install` для установки';
  const out = cleanupMarkdownForSpeech(input);
  assert.ok(!out.includes('npm install'));
  assert.ok(out.includes('Наберите'));
});

test('cleanupMarkdownForSpeech: readCode=true сохраняет код', () => {
  const fenced = '```js\nconst a = 1;\n```';
  assert.ok(cleanupMarkdownForSpeech(fenced, { readCode: true }).includes('const a = 1;'));
  const inline = 'наберите `npm i`';
  assert.ok(cleanupMarkdownForSpeech(inline, { readCode: true }).includes('npm i'));
});

test('cleanupMarkdownForSpeech: упоминания @user сохраняются без @', () => {
  assert.equal(cleanupMarkdownForSpeech('привет @ivan'), 'привет ivan');
});

test('cleanupMarkdownForSpeech: пробелы перед знаками препинания убираются', () => {
  assert.equal(cleanupMarkdownForSpeech('текст , запятая . точка !'), 'текст, запятая. точка!');
});

test('cleanupMarkdownForSpeech: пустая строка и нестрока возвращают пустоту', () => {
  assert.equal(cleanupMarkdownForSpeech(''), '');
  assert.equal(cleanupMarkdownForSpeech('   '), '');
  assert.equal(cleanupMarkdownForSpeech(null), '');
  assert.equal(cleanupMarkdownForSpeech(undefined), '');
});

test('cleanupMarkdownForSpeech: избыточные пустые строки схлопываются', () => {
  const out = cleanupMarkdownForSpeech('a\n\n\n\nb');
  assert.equal(out, 'a\n\nb');
});

test('stripCodeBlocks: отдельные шаги работают в изоляции', () => {
  assert.ok(!stripCodeBlocks('```lang\ncode\n```').includes('code'));
  assert.ok(stripCodeBlocks('```\nx\n```', true).includes('x'));
  assert.equal(stripInlineCode('а `b` в'), 'а код в');
  assert.ok(stripInlineMarkup('[x](u)').includes('x'));
  assert.ok(!stripStructure('## Заголовок').includes('#'));
  assert.equal(normalizeWhitespace('  a   b  '), 'a b');
});
