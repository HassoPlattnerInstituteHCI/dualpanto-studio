// Web Worker for Piper speech (see piper.js). Runs the ONNX model off the main thread, so
// the run loop and the handles keep moving while a sentence is computed.
//
// Messages in:  { id, type: 'download' | 'load', voice: { id, model, config } }
//               { id, type: 'synth', voice, text, rate }  (loads the voice again if it was dropped)
//               { type: 'unload', voiceId }
// Messages out: { id, type: 'progress', loaded, total } while downloading
//               { id, type: 'done' } / { id, type: 'audio', samples, sampleRate } / { id, type: 'error', message }
//
// The libraries are pinned versions from public CDNs (the same build vits-web 1.0.3 uses);
// unlike vits-web, the model session and the phonemizer are created once and reused.

import { PIPER_CACHE } from './piper.js';

const ORT = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/+esm';
const ORT_WASM = 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/';
const PHONEMIZER_JS = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/vits-web@1.0.3/dist/piper-DeOu3H9E.js';
const PHONEMIZER_FILES = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';

let ort = null;
let phonemizer = null;
let onLine = null;
const voices = new Map(); // voice id -> { session, config }
const MAX_VOICES = 2; // each loaded voice holds ~65 MB

async function libraries() {
  if (!ort) {
    ort = await import(ORT);
    ort.env.wasm.wasmPaths = ORT_WASM;
    // several threads need a cross-origin isolated page, which a static host cannot provide
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  }
  if (!phonemizer) {
    const { createPiperPhonemize } = await import(PHONEMIZER_JS);
    phonemizer = await createPiperPhonemize({
      print: (line) => onLine?.(line),
      printErr: (line) => console.warn('[piper]', line),
      locateFile: (f) => (f.endsWith('.wasm') ? `${PHONEMIZER_FILES}.wasm` : f.endsWith('.data') ? `${PHONEMIZER_FILES}.data` : f),
    });
  }
}

/** A file from the cache, or downloaded (with progress) and put into the cache. */
async function cachedFile(url, progress) {
  const cache = await caches.open(PIPER_CACHE);
  const hit = await cache.match(url);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const parts = [];
  let loaded = 0;
  let last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    const now = performance.now();
    if (progress && now - last > 100) {
      last = now;
      progress(loaded, total);
    }
  }
  progress?.(loaded, total || loaded);
  const blob = new Blob(parts);
  await cache.put(url, new Response(blob, { headers: { 'content-type': 'application/octet-stream' } }));
  return blob.arrayBuffer();
}

async function download(voice, progress) {
  await cachedFile(voice.config);
  return cachedFile(voice.model, progress);
}

async function load(voice, progress) {
  if (voices.has(voice.id)) return voices.get(voice.id);
  const model = await download(voice, progress);
  const config = JSON.parse(new TextDecoder().decode(await cachedFile(voice.config)));
  await libraries();
  const session = await ort.InferenceSession.create(model);
  while (voices.size >= MAX_VOICES) {
    const [oldest, entry] = voices.entries().next().value;
    voices.delete(oldest);
    entry.session.release?.();
  }
  const entry = { session, config };
  voices.set(voice.id, entry);
  return entry;
}

const phonemize = (text, lang) => new Promise((resolve, reject) => {
  onLine = (line) => {
    try {
      resolve(JSON.parse(line).phoneme_ids);
    } catch (e) {
      reject(e);
    }
  };
  phonemizer.callMain(['-l', lang, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']);
});

async function synth(voice, text, rate) {
  const { session, config } = await load(voice);
  const ids = await phonemize(text, config.espeak.voice);
  const { noise_scale, length_scale, noise_w } = config.inference;
  const inputs = {
    input: new ort.Tensor('int64', ids, [1, ids.length]),
    input_lengths: new ort.Tensor('int64', [ids.length]),
    // length_scale is the duration: faster speech = shorter
    scales: new ort.Tensor('float32', [noise_scale, length_scale / Math.max(0.1, rate || 1), noise_w]),
  };
  if (config.num_speakers > 1) inputs.sid = new ort.Tensor('int64', [0]);
  const { output } = await session.run(inputs);
  return { samples: new Float32Array(output.data), sampleRate: config.audio.sample_rate };
}

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  const progress = (loaded, total) => self.postMessage({ id, type: 'progress', loaded, total });
  try {
    if (type === 'download') {
      await download(data.voice, progress);
      self.postMessage({ id, type: 'done' });
    } else if (type === 'load') {
      await load(data.voice, progress);
      self.postMessage({ id, type: 'done' });
    } else if (type === 'synth') {
      const { samples, sampleRate } = await synth(data.voice, data.text, data.rate);
      self.postMessage({ id, type: 'audio', samples, sampleRate }, [samples.buffer]);
    } else if (type === 'unload') {
      voices.get(data.voiceId)?.session.release?.();
      voices.delete(data.voiceId);
    }
  } catch (e) {
    self.postMessage({ id, type: 'error', message: e?.message ?? String(e) });
  }
};
