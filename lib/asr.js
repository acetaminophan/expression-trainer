/**
 * Speech recognition module - based on sherpa-onnx-node
 * Streaming recognizer; audio is captured by the renderer (Web Audio) and fed in via IPC.
 *
 * Model selection by practice language:
 *   zh  -> streaming paraformer bilingual zh-en (Chinese-first, handles mixed English)
 *   en  -> streaming zipformer English (if downloaded), otherwise falls back to the bilingual model
 */

const path = require('path');
const fs = require('fs');

let recognizer = null;
let stream = null;
let isRunning = false;
let loadedModelKey = null;

const MODELS_DIR = path.join(__dirname, '..', 'models');

const MODELS = {
  paraformer_zh_en: {
    dir: 'sherpa-onnx-streaming-paraformer-bilingual-zh-en',
    type: 'paraformer',
    files: ['encoder.int8.onnx', 'decoder.int8.onnx', 'tokens.txt']
  },
  zipformer_en: {
    dir: 'sherpa-onnx-streaming-zipformer-en-2023-06-26',
    type: 'transducer',
    // file names carry the epoch/chunk suffix; resolved by prefix at load time
    files: ['encoder-*.int8.onnx', 'decoder-*-128.onnx', 'joiner-*.int8.onnx', 'tokens.txt']
  }
};

/** Resolve a file inside a model dir, supporting a single '*' wildcard. */
function resolveModelFile(dir, pattern) {
  if (!pattern.includes('*')) {
    const p = path.join(dir, pattern);
    return fs.existsSync(p) ? p : null;
  }
  const [prefix, suffix] = pattern.split('*');
  if (!fs.existsSync(dir)) return null;
  const hit = fs.readdirSync(dir).find(f => f.startsWith(prefix) && f.endsWith(suffix));
  return hit ? path.join(dir, hit) : null;
}

function modelAvailable(key) {
  const spec = MODELS[key];
  const dir = path.join(MODELS_DIR, spec.dir);
  return spec.files.every(f => resolveModelFile(dir, f));
}

function pickModelKey(lang) {
  if (lang === 'en' && modelAvailable('zipformer_en')) return 'zipformer_en';
  return 'paraformer_zh_en';
}

function buildConfig(key) {
  const spec = MODELS[key];
  const dir = path.join(MODELS_DIR, spec.dir);
  const resolved = spec.files.map(f => resolveModelFile(dir, f));
  const missing = spec.files.filter((f, i) => !resolved[i]);
  if (missing.length) {
    throw new Error(
      `Model files not found: ${missing.join(', ')}\n` +
      `Please make sure models/${spec.dir}/ contains the complete model`
    );
  }

  const modelConfig = {
    tokens: resolved[spec.files.indexOf('tokens.txt')],
    numThreads: 2,
    provider: 'cpu',
    debug: false
  };
  if (spec.type === 'paraformer') {
    modelConfig.paraformer = { encoder: resolved[0], decoder: resolved[1] };
  } else {
    modelConfig.transducer = { encoder: resolved[0], decoder: resolved[1], joiner: resolved[2] };
  }

  return {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig,
    decodingMethod: 'greedy_search',
    maxActivePaths: 4,
    enableEndpoint: true,
    rule1MinTrailingSilence: 2.4,
    rule2MinTrailingSilence: 1.2,
    rule3MinUtteranceLength: 20
  };
}

/**
 * Initialise the ASR engine for the given practice language.
 * Re-creates the recognizer only when the required model changes.
 * @param {'zh'|'en'} [lang]
 */
async function initASR(lang = 'zh') {
  const key = pickModelKey(lang);

  if (recognizer && loadedModelKey === key) {
    stream = recognizer.createStream();
    isRunning = true;
    console.log(`[ASR] reusing ${key}, new stream`);
    return { model: key };
  }

  const sherpa = require('sherpa-onnx-node');
  const config = buildConfig(key);
  recognizer = new sherpa.OnlineRecognizer(config);
  loadedModelKey = key;
  stream = recognizer.createStream();
  isRunning = true;

  console.log(`[ASR] engine ready: ${key} (lang=${lang})`);
  return { model: key };
}

/**
 * Feed 16 kHz mono samples from the renderer.
 * @param {Float32Array} samples
 * @returns {{ text: string, isFinal: boolean } | null}
 */
let loggedRate = null;

/** English models emit ALL CAPS; present it as normal lowercase text ("I" kept). */
function normalizeText(text) {
  if (loadedModelKey === 'zipformer_en' && /^[A-Z0-9\s'.,?!-]+$/.test(text)) {
    return text.toLowerCase().replace(/\bi\b/g, 'I').replace(/\bi'/g, "I'");
  }
  return text;
}

function feedAudio(samples, sampleRate = 16000) {
  if (!isRunning || !stream || !recognizer) return null;

  if (loggedRate !== sampleRate) {
    loggedRate = sampleRate;
    console.log(`[ASR] input sample rate ${sampleRate} Hz (resampled to 16000 by sherpa if needed)`);
  }
  // sherpa resamples internally when sampleRate != 16000
  stream.acceptWaveform({ samples, sampleRate });

  while (recognizer.isReady(stream)) {
    recognizer.decode(stream);
  }

  const result = recognizer.getResult(stream);
  const text = normalizeText((result.text || '').trim());
  const isEndpoint = recognizer.isEndpoint(stream);

  if (isEndpoint && text) {
    recognizer.reset(stream);
    return { text, isFinal: true };
  } else if (text) {
    return { text, isFinal: false };
  }

  return null;
}

/**
 * Stop recognition.
 * @returns {string} trailing unconfirmed text
 */
function stopRecognition() {
  isRunning = false;

  let finalText = '';
  if (stream && recognizer) {
    stream.inputFinished();
    while (recognizer.isReady(stream)) {
      recognizer.decode(stream);
    }
    const result = recognizer.getResult(stream);
    finalText = normalizeText((result.text || '').trim());
    stream = null;
  }

  console.log('[ASR] stopped');
  return finalText;
}

module.exports = { initASR, feedAudio, stopRecognition, modelAvailable, pickModelKey };
