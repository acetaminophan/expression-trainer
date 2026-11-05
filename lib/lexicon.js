/**
 * Lexicon matching module (bilingual: zh / en)
 *
 * zh: character-based maximum-forward-match segmentation against the Chinese lexicon
 * en: word/phrase-based matching against data/english-lexicon.json (case-insensitive,
 *     whole-word, multi-word phrases supported, longest match first)
 *
 * Both languages expose the same analysis shape:
 *   { totalWords, fillers, hedges, vagueWords, emotionWords, density, suggestions }
 * and the same highlightText() HTML output (spans with class filler / hedge / vague).
 */

const fs = require('fs');
const path = require('path');

let lexiconData = null;   // Chinese emotion lexicon
let enLexicon = null;     // English lexicon
let currentLanguage = 'zh';

// ===================== Chinese word lists =====================

const FILLER_WORDS = [
  '嗯', '啊', '呃', '额', '那个', '就是', '然后',
  '这个', '对吧', '是吧', '你知道', '怎么说呢',
  '反正', '基本上', '总之', '所以说'
];

const HEDGE_WORDS = [
  '可能', '也许', '大概', '应该', '我觉得', '好像',
  '似乎', '或许', '不一定', '差不多', '算是',
  '某种程度上', '一般来说', '感觉'
];

const VAGUE_TO_PRECISE = {
  '开心': ['欣喜', '雀跃', '兴奋', '欣慰', '畅快', '满足'],
  '难过': ['心酸', '失落', '委屈', '心疼', '沮丧', '低落'],
  '害怕': ['恐惧', '焦虑', '不安', '慌张', '胆怯', '忐忑'],
  '生气': ['愤怒', '恼火', '窝火', '气愤', '不满', '暴躁'],
  '不舒服': ['压抑', '烦躁', '憋屈', '窒息', '煎熬', '疲惫'],
  '很好': ['出色', '精彩', '优秀', '惊艳', '完美', '理想'],
  '很多': ['大量', '海量', '充裕', '丰富', '密集', '可观'],
  '很快': ['迅速', '飞速', '立刻', '瞬间', '即刻', '火速'],
  '很大': ['巨大', '庞大', '显著', '惊人', '可观', '壮观'],
  '很小': ['微小', '细微', '轻微', '渺小', '微不足道', '些许'],
  '好看': ['精致', '优雅', '绚丽', '惊艳', '别致', '夺目'],
  '不好': ['糟糕', '恶劣', '拙劣', '不堪', '惨淡', '低劣'],
  '喜欢': ['热爱', '痴迷', '着迷', '钟爱', '倾心', '沉醉'],
  '讨厌': ['厌恶', '反感', '排斥', '憎恨', '鄙视', '嫌弃'],
  '觉得': ['认为', '判断', '确信', '推断', '意识到', '发现'],
  '想': ['渴望', '期待', '向往', '盼望', '企图', '打算'],
  '做': ['执行', '落实', '推进', '完成', '实施', '操作'],
  '看': ['审视', '观察', '注视', '打量', '端详', '凝视'],
  '说': ['表达', '阐述', '强调', '指出', '坦言', '声明'],
  '想想': ['反思', '回顾', '审视', '复盘', '琢磨', '斟酌']
};

// Highlight patterns for Chinese subtitles (moved here from the renderer)
const ZH_HIGHLIGHT_VAGUE = ['开心','难过','害怕','生气','不舒服','很好','很多','很快','很大','很小','好看','不好','喜欢','讨厌','觉得','想想'];
const ZH_HIGHLIGHT_FILLER = /(嗯|啊|呃|额|那个|就是|然后|这个|对吧|是吧|反正|基本上)/g;
const ZH_HIGHLIGHT_HEDGE = /(可能|也许|大概|应该|我觉得|好像|似乎|或许|不一定|差不多|感觉)/g;

// ===================== Loading =====================

function loadLexicon() {
  const zhPath = path.join(__dirname, '..', 'data', 'emotion-lexicon.json');
  if (fs.existsSync(zhPath)) {
    lexiconData = JSON.parse(fs.readFileSync(zhPath, 'utf-8'));
    console.log(`[lexicon] zh loaded: ${Object.keys(lexiconData.emotions || {}).length} emotion words`);
  } else {
    console.warn('[lexicon] emotion-lexicon.json not found, using built-in lists');
    lexiconData = { emotions: {} };
  }

  const enPath = path.join(__dirname, '..', 'data', 'english-lexicon.json');
  if (fs.existsSync(enPath)) {
    enLexicon = JSON.parse(fs.readFileSync(enPath, 'utf-8'));
    buildEnglishIndex();
    console.log(`[lexicon] en loaded: ${enLexicon.fillers.length} fillers, ${enLexicon.hedges.length} hedges, ${Object.keys(enLexicon.vagueToPrecise).length} vague words`);
  } else {
    console.warn('[lexicon] english-lexicon.json not found, English mode disabled');
    enLexicon = { fillers: [], hedges: [], vagueToPrecise: {}, emotions: {} };
    buildEnglishIndex();
  }
}

function setLanguage(lang) {
  currentLanguage = lang === 'en' ? 'en' : 'zh';
}

function getLanguage() {
  return currentLanguage;
}

// ===================== English index =====================

// enPhraseIndex: Map<normalizedPhrase, { type, alternatives? }>
// enPhraseRegex: one alternation regex, longest phrase first, whole-word, case-insensitive
let enPhraseIndex = new Map();
let enPhraseRegex = null;

function normalizePhrase(p) {
  return p.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildEnglishIndex() {
  enPhraseIndex = new Map();
  const add = (phrase, entry) => {
    const key = normalizePhrase(phrase);
    // precedence: filler > hedge > vague > emotion (first registered wins)
    if (!enPhraseIndex.has(key)) enPhraseIndex.set(key, entry);
  };
  (enLexicon.fillers || []).forEach(w => add(w, { type: 'filler' }));
  (enLexicon.hedges || []).forEach(w => add(w, { type: 'hedge' }));
  Object.entries(enLexicon.vagueToPrecise || {}).forEach(([w, alts]) => add(w, { type: 'vague', alternatives: alts }));
  Object.keys(enLexicon.emotions || {}).forEach(w => add(w, { type: 'emotion', ...enLexicon.emotions[w] }));

  // Longest first so "a little bit" wins over "a bit", "kind of like" over "kind of"
  const phrases = [...enPhraseIndex.keys()].sort((a, b) => b.length - a.length);
  const alternation = phrases
    .map(p => escapeRegex(p).replace(/ /g, '\\s+').replace(/'/g, "['’]"))
    .join('|');
  enPhraseRegex = alternation ? new RegExp(`(?<![\\w'’])(${alternation})(?![\\w'’])`, 'gi') : null;
}

// "like" is a filler only in discourse position ("it was like, um"), not as a verb/preposition.
const LIKE_FILLER_PREV = new Set(['and', 'so', "it's", 'its', 'was', 'is', 'were', 'are', "i'm", 'im', "you're", "they're", "he's", "she's", "we're", 'be', 'but', 'just', 'um', 'uh']);
const LIKE_FILLER_NEXT = new Set(['um', 'uh', 'you', 'i', 'basically', 'kind', 'sort', 'like']);

function isDiscourseLike(text, matchIndex, matchLength) {
  const before = text.slice(0, matchIndex).toLowerCase().replace(/[’‘]/g, "'");
  const after = text.slice(matchIndex + matchLength).toLowerCase().replace(/[’‘]/g, "'");
  const prevWord = (before.match(/([\w']+)\W*$/) || [])[1];
  const nextWord = (after.match(/^\W*([\w']+)/) || [])[1];
  if (/^\s*,/.test(after) || /,\s*$/.test(before)) return true;
  if (!prevWord) return false; // sentence-initial "Like this." is usually a preposition
  if (LIKE_FILLER_PREV.has(prevWord)) return true;
  if (nextWord && LIKE_FILLER_NEXT.has(nextWord)) return true;
  return false;
}

/**
 * Find all lexicon matches in an English text.
 * @returns {Array<{ start, end, text, key, type, alternatives? }>}
 */
function matchEnglish(text) {
  const matches = [];
  if (!enPhraseRegex) return matches;
  enPhraseRegex.lastIndex = 0;
  let m;
  while ((m = enPhraseRegex.exec(text)) !== null) {
    const key = normalizePhrase(m[1]);
    const entry = enPhraseIndex.get(key);
    if (!entry) continue;
    if (key === 'like' && !isDiscourseLike(text, m.index, m[0].length)) continue;
    matches.push({ start: m.index, end: m.index + m[0].length, text: m[0], key, ...entry });
  }
  return matches;
}

function countEnglishWords(text) {
  const tokens = text.match(/[A-Za-z0-9]+(?:['’][A-Za-z]+)?/g);
  return tokens ? tokens.length : 0;
}

// ===================== Chinese segmentation =====================

function segmentText(text) {
  const words = [];
  let i = 0;
  const maxLen = 6;
  const dict = new Set([
    ...FILLER_WORDS,
    ...HEDGE_WORDS,
    ...Object.keys(VAGUE_TO_PRECISE),
    ...Object.keys(lexiconData.emotions || {})
  ]);

  while (i < text.length) {
    let matched = false;
    for (let len = Math.min(maxLen, text.length - i); len >= 2; len--) {
      const word = text.substring(i, i + len);
      if (dict.has(word)) {
        words.push(word);
        i += len;
        matched = true;
        break;
      }
    }
    if (!matched) {
      words.push(text[i]);
      i++;
    }
  }
  return words;
}

// ===================== Analysis =====================

/**
 * Analyze a chunk of text.
 * @param {string} text
 * @param {'zh'|'en'} [lang] defaults to the current language
 */
function analyzeText(text, lang) {
  if (!text || !text.trim()) return null;
  const l = lang || currentLanguage;
  return l === 'en' ? analyzeEnglish(text) : analyzeChinese(text);
}

function analyzeChinese(text) {
  const words = segmentText(text);
  const totalWords = words.length;

  const fillers = [];
  const hedges = [];
  const vagueWords = [];
  const emotionWords = [];

  words.forEach((word, idx) => {
    if (FILLER_WORDS.includes(word)) fillers.push({ word, position: idx });
    if (HEDGE_WORDS.includes(word)) hedges.push({ word, position: idx });
    if (VAGUE_TO_PRECISE[word]) vagueWords.push({ word, position: idx, alternatives: VAGUE_TO_PRECISE[word] });
    if (lexiconData && lexiconData.emotions && lexiconData.emotions[word]) {
      emotionWords.push({ word, position: idx, ...lexiconData.emotions[word] });
    }
  });

  const meaningfulWords = totalWords - fillers.length - hedges.length;
  const density = totalWords > 0 ? (meaningfulWords / totalWords) : 1;

  return {
    language: 'zh',
    totalWords,
    fillers,
    hedges,
    vagueWords,
    emotionWords,
    density: Math.round(density * 100),
    suggestions: generateSuggestionsZh(vagueWords, fillers, hedges)
  };
}

function analyzeEnglish(text) {
  const totalWords = countEnglishWords(text);
  const matches = matchEnglish(text);

  const fillers = [];
  const hedges = [];
  const vagueWords = [];
  const emotionWords = [];

  matches.forEach(m => {
    const item = { word: m.key, position: m.start };
    if (m.type === 'filler') fillers.push(item);
    else if (m.type === 'hedge') hedges.push(item);
    else if (m.type === 'vague') vagueWords.push({ ...item, alternatives: m.alternatives });
    else if (m.type === 'emotion') emotionWords.push({ ...item, category: m.category, intensity: m.intensity, polarity: m.polarity });
  });

  const meaningfulWords = totalWords - fillers.length - hedges.length;
  const density = totalWords > 0 ? Math.max(0, meaningfulWords / totalWords) : 1;

  return {
    language: 'en',
    totalWords,
    fillers,
    hedges,
    vagueWords,
    emotionWords,
    density: Math.round(density * 100),
    suggestions: generateSuggestionsEn(vagueWords, fillers, hedges)
  };
}

function generateSuggestionsZh(vagueWords, fillers, hedges) {
  const suggestions = [];
  vagueWords.forEach(item => {
    suggestions.push({
      type: 'vague',
      original: item.word,
      alternatives: item.alternatives.slice(0, 3),
      message: `「${item.word}」→ 试试更精准的：${item.alternatives.slice(0, 3).join('、')}`
    });
  });
  if (fillers.length >= 3) {
    const topFillers = [...new Set(fillers.map(f => f.word))].slice(0, 3);
    suggestions.push({ type: 'filler', message: `填充词偏多（${fillers.length}次）：${topFillers.join('、')}。试试用停顿替代` });
  }
  if (hedges.length >= 2) {
    suggestions.push({ type: 'hedge', message: `犹豫表达较多（${hedges.length}次）。试试把「我觉得」改成直接陈述` });
  }
  return suggestions;
}

function generateSuggestionsEn(vagueWords, fillers, hedges) {
  const suggestions = [];
  vagueWords.forEach(item => {
    suggestions.push({
      type: 'vague',
      original: item.word,
      alternatives: item.alternatives.slice(0, 3),
      message: `"${item.word}" → try: ${item.alternatives.slice(0, 3).join(' / ')}`
    });
  });
  if (fillers.length >= 3) {
    const topFillers = [...new Set(fillers.map(f => f.word))].slice(0, 3);
    suggestions.push({ type: 'filler', message: `Too many fillers (${fillers.length}): ${topFillers.join(', ')}. Pause instead.` });
  }
  if (hedges.length >= 2) {
    suggestions.push({ type: 'hedge', message: `Hedging a lot (${hedges.length}x). Drop "I think / maybe" and state it.` });
  }
  return suggestions;
}

// ===================== Subtitle highlighting =====================

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Wrap fillers / hedges / vague words in <span class="..."> for the subtitle view.
 * Returns HTML.
 */
function highlightText(text, lang) {
  const l = lang || currentLanguage;
  if (!text) return '';
  return l === 'en' ? highlightEnglish(text) : highlightChinese(text);
}

function highlightChinese(text) {
  let result = escapeHtml(text);
  ZH_HIGHLIGHT_VAGUE.forEach(w => {
    result = result.replace(new RegExp(w, 'g'), `<span class="vague">${w}</span>`);
  });
  result = result.replace(ZH_HIGHLIGHT_FILLER, '<span class="filler">$1</span>');
  result = result.replace(ZH_HIGHLIGHT_HEDGE, '<span class="hedge">$1</span>');
  return result;
}

function highlightEnglish(text) {
  const matches = matchEnglish(text).filter(m => m.type !== 'emotion');
  let html = '';
  let cursor = 0;
  matches.forEach(m => {
    if (m.start < cursor) return;
    html += escapeHtml(text.slice(cursor, m.start));
    const title = m.type === 'vague' && m.alternatives ? ` title="${escapeHtml(m.alternatives.slice(0, 3).join(' / '))}"` : '';
    html += `<span class="${m.type}"${title}>${escapeHtml(m.text)}</span>`;
    cursor = m.end;
  });
  html += escapeHtml(text.slice(cursor));
  return html;
}

module.exports = {
  loadLexicon,
  setLanguage,
  getLanguage,
  analyzeText,
  highlightText,
  VAGUE_TO_PRECISE,
  FILLER_WORDS,
  HEDGE_WORDS
};
