// markdown.js — подготовка текста ответа ассистента к озвучиванию (TTS).
// Чистые функции: не обращаются к DOM, не выполняют сетевых операций.
//
// Цель: убрать из Markdown-разметку, оставив связный «говоримый» текст.
// Блоки кода и inline-код по умолчанию ПРОПУСКАЮТСЯ (заменяются на короткую
// пометку «код»), потому что код в речи читается плохо. Если передан
// параметр readCode=true — содержимое кода сохраняется.
//
// Реализация построена как конвейер чистых шагов, каждый шаг покрыт тестами.

// Стандартные замены для часто встречающейся разметки.
const RE = {
  // Заголовки: '# Заголовок' -> 'Заголовок' (без решёток).
  heading: /(^|\n)[ \t]*#{1,6}[ \t]+/g,
  // Блок кода: весь ```lang\n...\n``` или ~~~ ... ~~~
  fencedCode: /```[^\n`]*[\s\S]*?```|~~~[\s\S]*?~~~/g,
  // Inline-код: `code`
  inlineCode: /`[^`\n]*`/g,
  // Ссылки: [текст](url) -> текст; [текст][ref] -> текст.
  link: /\[([^\]\n]*)\]\([^)\n]*\)/g,
  linkRef: /\[([^\]\n]*)\]\[[^\]]*\]/g,
  // Изображения: ![alt](url) -> alt.
  image: /!\[([^\]\n]*)\]\([^)\n]*\)/g,
  // Жирный/курсив/зачёркнутый (markdown emphasis).
  strong: /(\*\*|__)([^*_]+)\1/g,
  em: /(\*|_)([^*_]+)\1/g,
  strike: /~~([^~]+)~~/g,
  // Горизонтальная линия.
  hr: /(^|\n)[ \t]*([-*_][ \t]*){3,}[ \t]*(\n|$)/g,
  // Списки: маркеры - * + и блоки-номера.
  listMarker: /(^|\n)[ \t]*([-*+]|\d+[.)])[ \t]+/g,
  // Упоминания/идентификаторы @user.
  mention: /@([A-Za-z0-9_.-]+)/g,
};

// Прямые URL и почта оставляем как есть (без разметки их удалять не нужно).

// Шаг 1: удалить/заменить блоки кода.
// readCode=false (по умолчанию) — пропускаем код (заменяем на «код»).
export function stripCodeBlocks(text, readCode = false) {
  if (typeof text !== 'string' || !text) return text;
  if (readCode) return text.replace(RE.fencedCode, (m) => m);
  return text.replace(RE.fencedCode, ' код ');
}

// Шаг 2: удалить/заменить inline-код.
export function stripInlineCode(text, readCode = false) {
  if (typeof text !== 'string' || !text) return text;
  if (readCode) return text.replace(RE.inlineCode, (m) => m);
  // Захватываем один окружающий пробел, чтобы замена не давала двойных
  // пробелов, но при этом сохраняла разделение слов.
  return text.replace(/ ?`[^`\n]*` ?/g, ' код ');
}

// Шаг 3: снять основную разметку inline (ссылки, изображения, акценты).
export function stripInlineMarkup(text) {
  if (typeof text !== 'string' || !text) return text;
  return String(text)
    .replace(RE.image, ' $1 ')
    .replace(RE.link, ' $1 ')
    .replace(RE.linkRef, ' $1 ')
    .replace(RE.strong, ' $2 ')
    .replace(RE.em, ' $2 ')
    .replace(RE.strike, ' $1 ')
    .replace(RE.mention, '$1');
}

// Шаг 4: очистить структурную разметку (заголовки, списки, разделители).
export function stripStructure(text) {
  if (typeof text !== 'string' || !text) return text;
  return String(text)
    .replace(RE.heading, '$1')
    .replace(RE.listMarker, '$1')
    .replace(RE.hr, '$1');
}

// Шаг 5: нормализовать пробелы и пустые строки.
export function normalizeWhitespace(text) {
  if (typeof text !== 'string' || !text) return text;
  return String(text)
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    // Схлопываем только 3+ новых строк, сохраняя максимум одну пустую строку.
    .replace(/\n{3,}/g, '\n\n')
    // Убираем пробелы перед знаками препинания.
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .trim();
}

// Публичная функция: полная подготовка текста к озвучиванию.
// options: { readCode: boolean (по умолчанию false — код пропускается) }
export function cleanupMarkdownForSpeech(text, options = {}) {
  if (typeof text !== 'string' || !text) return '';
  const readCode = Boolean(options && options.readCode);
  let out = stripCodeBlocks(text, readCode);
  out = stripInlineCode(out, readCode);
  out = stripInlineMarkup(out);
  out = stripStructure(out);
  out = normalizeWhitespace(out);
  return out;
}
