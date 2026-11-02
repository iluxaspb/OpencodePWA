// index.js — единая точка входа в голосовой модуль opencode-mobile.
// Фасад над подмодулями:
//   - markdown.js   — очистка Markdown для озвучивания (код пропускается);
//   - voices.js     — чистая логика выбора системных голосов TTS;
//   - speech.js     — озвучивание через системный speechSynthesis (Android TTS);
//   - recognizer.js — голосовой ввод через Web Speech API (webkitSpeechRecognition).
//
// Всё — чистые ES-модули, без HTML/CSS/app-зависимостей; реальные браузерные
// API инъецируются для тестов.

export {
  cleanupMarkdownForSpeech,
  stripCodeBlocks,
  stripInlineCode,
  stripInlineMarkup,
  stripStructure,
  normalizeWhitespace,
} from './markdown.js';

export {
  pickVoice,
  resolveTtsLang,
  languageForText,
  clampRate,
  normalizeVoices,
  LANGUAGES,
} from './voices.js';

export {
  createTts,
  TTS_STATE,
} from './speech.js';

export {
  createRecognizer,
  isSpeechRecognitionSupported,
  REC_STATE,
} from './recognizer.js';
