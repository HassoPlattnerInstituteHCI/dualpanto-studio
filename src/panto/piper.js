// Downloadable Piper voices: neural text-to-speech that runs in the browser, so a project
// sounds the same on Linux, Windows and macOS (the built-in voices differ per computer).
//
// The heavy part runs in piper-worker.js (ONNX runtime + the Piper phonemizer, both kept
// loaded – rebuilding them per sentence costs ~1.5 s). Voice files come from the official
// rhasspy/piper-voices repository on Hugging Face and are kept in the browser's Cache
// Storage, so each computer downloads a voice once. Only freely licensed voices are listed.

export const PIPER_HF = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';
export const PIPER_CACHE = 'dualpanto-piper-voices';

export const PIPER_VOICES = [
  { id: 'en_US-kristin-medium', label: 'Kristin', accent: 'US, female', license: 'public domain', path: 'en/en_US/kristin/medium', mb: 63.5 },
  { id: 'en_US-norman-medium', label: 'Norman', accent: 'US, male', license: 'public domain', path: 'en/en_US/norman/medium', mb: 63.5 },
  { id: 'en_US-mike-medium', label: 'Mike', accent: 'US, male', license: 'CC0', path: 'en/en_US/mike/medium', mb: 63.2 },
  { id: 'en_GB-cori-medium', label: 'Cori', accent: 'British, female', license: 'public domain', path: 'en/en_GB/cori/medium', mb: 63.5 },
];

export const DEFAULT_PIPER_VOICE = PIPER_VOICES[0].id;

export const piperSupported = () => typeof Worker !== 'undefined' && typeof caches !== 'undefined';

/** A voice by id or (part of its) label – "mike", "Cori", "en_US-kristin-medium". */
export function piperVoice(name) {
  const wanted = String(name ?? '').trim().toLowerCase();
  if (!wanted) return null;
  return PIPER_VOICES.find((v) => v.id.toLowerCase() === wanted || v.label.toLowerCase() === wanted) ??
    PIPER_VOICES.find((v) => v.label.toLowerCase().includes(wanted)) ?? null;
}

export const voiceUrls = (voice) => {
  const base = `${PIPER_HF}/${voice.path}/${voice.id}.onnx`;
  return { model: base, config: `${base}.json` };
};

/** Ids of the voices downloaded in this browser. */
export async function storedPiperVoices() {
  if (!piperSupported()) return new Set();
  const cache = await caches.open(PIPER_CACHE);
  const found = new Set();
  for (const v of PIPER_VOICES) if (await cache.match(voiceUrls(v).model)) found.add(v.id);
  return found;
}

export async function removePiperVoice(id) {
  const v = piperVoice(id);
  if (!v || !piperSupported()) return;
  piper.forget(v.id);
  const cache = await caches.open(PIPER_CACHE);
  const urls = voiceUrls(v);
  await Promise.all([cache.delete(urls.model), cache.delete(urls.config)]);
}

/**
 * Splits text into sentences, so the first one can play while the rest is computed.
 * Very short pieces stay with their neighbour ("Dr. Who" is not two sentences).
 */
export function splitSentences(text) {
  const parts = String(text).match(/[^.!?;:\n]+(?:[.!?;:]+|\n|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  const out = [];
  for (const p of parts) {
    if (out.length && (p.length < 4 || out[out.length - 1].length < 4)) out[out.length - 1] += ' ' + p;
    else out.push(p);
  }
  return out.length ? out : [String(text).trim()].filter(Boolean);
}

/**
 * Talks to the worker. Requests are sent one at a time: speech the program needs now goes
 * to the front, warming up texts in advance ("Say on …" of a level) to the back. Finished
 * sentences are remembered, so repeated announcements play immediately.
 */
class PiperClient {
  constructor() {
    this._worker = null;
    this._nextId = 1;
    this._pending = new Map(); // id -> { resolve, reject, onProgress }
    this._queue = [];
    this._busy = false;
    this._loads = new Map(); // voice id -> Promise (loaded in the worker)
    this._audio = new Map(); // cache key -> { samples, sampleRate }
    this._inflight = new Map(); // cache key -> Promise, so the same sentence is computed once
  }

  _ensureWorker() {
    if (this._worker) return this._worker;
    this._worker = new Worker(new URL('./piper-worker.js', import.meta.url), { type: 'module' });
    this._worker.onmessage = ({ data }) => {
      const p = this._pending.get(data.id);
      if (!p) return;
      if (data.type === 'progress') return p.onProgress?.(data.loaded, data.total);
      this._pending.delete(data.id);
      if (data.type === 'error') p.reject(new Error(data.message));
      else p.resolve(data);
    };
    this._worker.onerror = (e) => {
      const err = new Error(e.message || 'The speech worker failed to start.');
      for (const p of this._pending.values()) p.reject(err);
      this._pending.clear();
      this._worker = null;
      this._loads.clear();
      this._busy = false;
    };
    return this._worker;
  }

  // one request at a time, in queue order
  _request(msg, { front = false, onProgress, direct = false } = {}) {
    return new Promise((resolve, reject) => {
      const job = { msg, resolve, reject, onProgress };
      if (direct) return this._send(job);
      if (front) this._queue.unshift(job);
      else this._queue.push(job);
      this._pump();
    });
  }

  _send(job) {
    const id = this._nextId++;
    const done = new Promise((resolve, reject) => this._pending.set(id, { resolve, reject, onProgress: job.onProgress }));
    this._ensureWorker().postMessage({ ...job.msg, id });
    done.then(job.resolve, job.reject);
    return done;
  }

  async _pump() {
    if (this._busy) return;
    const job = this._queue.shift();
    if (!job) return;
    this._busy = true;
    try {
      await this._send(job).catch(() => {});
    } finally {
      this._busy = false;
      this._pump();
    }
  }

  /** Downloads a voice into the browser (no-op when it is already there). */
  download(id, onProgress) {
    const v = piperVoice(id);
    if (!v) return Promise.reject(new Error(`Unknown voice "${id}".`));
    return this._request({ type: 'download', voice: { id: v.id, ...voiceUrls(v) } }, { onProgress, direct: true });
  }

  /** Downloads if needed and loads the voice in the worker (about 2 s). */
  load(id, onProgress) {
    const v = piperVoice(id);
    if (!v) return Promise.reject(new Error(`Unknown voice "${id}".`));
    if (!this._loads.has(v.id)) {
      const p = this._request({ type: 'load', voice: { id: v.id, ...voiceUrls(v) } }, { front: true, onProgress });
      p.catch(() => this._loads.delete(v.id));
      this._loads.set(v.id, p);
    }
    return this._loads.get(v.id);
  }

  forget(id) {
    this._loads.delete(id);
    for (const key of [...this._audio.keys()]) if (key.startsWith(id + '|')) this._audio.delete(key);
    this._worker?.postMessage({ type: 'unload', voiceId: id, id: 0 });
  }

  /** Audio for one sentence: `{ samples: Float32Array, sampleRate }`. */
  async synth(text, { voice = DEFAULT_PIPER_VOICE, rate = 1, warm = false } = {}) {
    const v = piperVoice(voice);
    if (!v) throw new Error(`Unknown voice "${voice}".`);
    const key = `${v.id}|${rate.toFixed(3)}|${text}`;
    const hit = this._audio.get(key);
    if (hit) {
      // keep recently used sentences at the end (least recently used are dropped first)
      this._audio.delete(key);
      this._audio.set(key, hit);
      return hit;
    }
    if (this._inflight.has(key)) {
      if (!warm) this._promote(text);
      return this._inflight.get(key);
    }
    const job = (async () => {
      await this.load(v.id);
      const res = await this._request({ type: 'synth', voice: { id: v.id, ...voiceUrls(v) }, text, rate }, { front: !warm });
      const audio = { samples: res.samples, sampleRate: res.sampleRate };
      this._audio.set(key, audio);
      while (this._audio.size > 300) this._audio.delete(this._audio.keys().next().value);
      return audio;
    })();
    this._inflight.set(key, job);
    job.finally(() => this._inflight.delete(key)).catch(() => {});
    return job;
  }

  // needed right now but only queued as warm-up: move it to the front of the queue
  _promote(text) {
    const i = this._queue.findIndex((j) => j.msg.type === 'synth' && j.msg.text === text);
    if (i > 0) this._queue.unshift(...this._queue.splice(i, 1));
  }

  /** Computes texts in advance, behind everything that has to be spoken now. */
  warm(texts, opts) {
    for (const text of texts) for (const s of splitSentences(text)) this.synth(s, { ...opts, warm: true }).catch(() => {});
  }
}

export const piper = new PiperClient();
