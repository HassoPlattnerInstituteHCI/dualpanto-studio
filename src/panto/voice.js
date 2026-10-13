// Voice input (Web Speech API).
//
// Two things make voice input on the DualPanto special:
//
// 1. The program speaks itself. The microphone hears the speech output and recognises
//    it as input. That is why `_isEcho()` drops results that arrive during or shortly
//    after our own output and resemble what was said last.
// 2. In Chrome, recognition runs on a Google server by default (audio goes over the
//    network, nothing works offline). `processLocally = true` forces on-device
//    recognition if the browser supports it – `VoiceInput.deviceAvailable()` checks that.
//
// Interpretation uses patterns rather than a language model: placeholders, alternatives,
// number words (English and German) and a tolerant comparison against recognition errors.

import { Emitter } from './emitter.js';

const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

/** Lower case, no punctuation, single spaces. */
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[.,!?;:„“"'`´()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// English and German number words, so projects in either language understand numbers.
const ONES = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  null: 0, eins: 1, ein: 1, eine: 1, einen: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9,
};
const TEENS = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  zehn: 10, elf: 11, zwölf: 12, dreizehn: 13, vierzehn: 14, fünfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19,
};
const TENS = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  zwanzig: 20, dreißig: 30, dreissig: 30, vierzig: 40, fünfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90,
};
const HUNDRED = new Set(['hundred', 'hundert']);

/** "twenty-three", "two hundred five", "dreiundzwanzig", "-12", "3,5" → number. null if there is nothing countable. */
export function parseNumber(text) {
  const t = normalize(text).replace(/,(\d)/g, '.$1');
  const digits = t.match(/-?\d+(\.\d+)?/);
  if (digits) return parseFloat(digits[0]);
  const neg = /\bminus\b/.test(t);
  let total = null;
  for (const word of t.split(/[ -]/)) {
    // "two hundred": hundred multiplies what came before
    if (HUNDRED.has(word)) {
      total = (total || 1) * 100;
      continue;
    }
    const n = wordToNumber(word);
    if (n == null) continue;
    total = (total ?? 0) + n;
  }
  if (total == null) return null;
  return neg ? -total : total;
}

function wordToNumber(word) {
  if (word in TEENS) return TEENS[word];
  if (word in TENS) return TENS[word];
  if (word in ONES) return ONES[word];
  if (HUNDRED.has(word)) return 100;
  // German compounds: "einundzwanzig", "fünfundvierzig" (\w does not know umlauts)
  const m = /^([a-zäöüß]+?)und([a-zäöüß]+)$/.exec(word);
  if (m && m[1] in ONES && m[2] in TENS) return ONES[m[1]] + TENS[m[2]];
  // "zweihundert", "dreihundertfünfzig"
  const h = /^([a-zäöüß]+?)hundert([a-zäöüß]*)$/.exec(word);
  if (h && h[1] in ONES) return ONES[h[1]] * 100 + (h[2] ? wordToNumber(h[2]) ?? 0 : 0);
  return null;
}

/** Unify umlauts so that "grün" and "gruen" count as equal. */
export function fold(text) {
  return normalize(text).replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
}

/** 0..1, 1 = equal. For tolerance against recognition errors ("goal" / "gole"). */
export function similarity(a, b) {
  a = fold(a);
  b = fold(b);
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const d = [];
  for (let i = 0; i <= a.length; i++) d[i] = [i];
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return 1 - d[a.length][b.length] / Math.max(a.length, b.length);
}

/** Same word stem: "starting" matches "start", but "stopwatch" does not match "stop". */
function stemScore(a, b) {
  const [x, y] = [fold(a), fold(b)];
  if (x.length < 3 || y.length < 3) return 0;
  if (!x.startsWith(y) && !y.startsWith(x)) return 0;
  return 0.1 + 0.9 * (Math.min(x.length, y.length) / Math.max(x.length, y.length));
}

/** Finds the entry in a list that best matches the text (or null). */
export function bestMatch(text, options, minScore = 0.72) {
  const t = fold(text);
  const words = t.split(' ');
  let best = null;
  for (const option of options) {
    const label = fold(typeof option === 'string' ? option : option?.label ?? option);
    if (!label) continue;
    // a whole word contained in the sentence counts fully
    const contained = new RegExp(`(^| )${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(t);
    const score = contained
      ? 1
      : Math.max(similarity(t, label), ...words.map((w) => similarity(w, label)), ...words.map((w) => stemScore(w, label)));
    if (!best || score > best.score) best = { option, score, label };
  }
  return best && best.score >= minScore ? best : null;
}

const RE_SPECIAL = /[.*+?^${}()|[\]\\]/g;

/**
 * Builds a regex from a pattern.
 *   "go to {target}"          → placeholder, ends up in args.target
 *   "set score {n:number}"    → args.n is a number ("zahl" works too)
 *   "(start|begin) game"      → alternatives
 *   "*"                       → anything
 * Without placeholders it is enough for the words to occur in the sentence (the
 * recogniser likes to add filler words).
 */
export function compilePattern(pattern, { folded = false } = {}) {
  const prep = (s) => (folded ? fold(s) : normalize(s));
  if (pattern === '*') return { re: /^(.*)$/, slots: [{ name: 'text', type: 'text' }], raw: pattern, fallback: true };
  const slots = [];
  const parts = String(pattern).split(/(\{[^}]*\}|\([^)]*\))/).filter(Boolean);
  // A placeholder at the end takes the rest of the sentence ("go to the door").
  const lastIsSlot = /\}\s*$/.test(String(pattern));
  let src = '';
  parts.forEach((part, i) => {
    const last = i === parts.length - 1;
    if (part.startsWith('{') && part.endsWith('}')) {
      const [name, type = 'text'] = part.slice(1, -1).split(':');
      const t = type.trim();
      slots.push({ name: name.trim(), type: t });
      const chars = t === 'zahl' || t === 'number' ? '[\\wäöüßaeoeue .,-]' : '.';
      src += `(${chars}+${last && lastIsSlot ? '' : '?'})`;
    } else if (part.startsWith('(') && part.endsWith(')')) {
      src += '(?:' + part.slice(1, -1).split('|').map((x) => prep(x).replace(RE_SPECIAL, '\\$&')).join('|') + ')';
    } else {
      // normalize() trims spaces – at the edges they have to stay, otherwise
      // "(start|begin) game" sticks together as "begingame".
      const pad = (/^\s/.test(part) ? ' ' : '') + prep(part) + (/\s$/.test(part) ? ' ' : '');
      src += pad.replace(RE_SPECIAL, '\\$&').replace(/ /g, '\\s+');
    }
  });
  // allow filler words before; without a placeholder at the end, words may also follow
  const tail = lastIsSlot ? '\\s*$' : '(?=\\s|$)';
  return { re: new RegExp(`(?:^|\\s)${src}${tail}`), slots, raw: pattern };
}

function slotValue(raw, type) {
  if (type === 'zahl' || type === 'number') return parseNumber(raw);
  return normalize(raw);
}

// ---------------------------------------------------------------------------

export class VoiceInput extends Emitter {
  /** @param {object} rt runtime – for speak(), log() and echo protection */
  constructor(rt) {
    super();
    this.rt = rt;
    this.state = 'off'; // off | listening | paused | error
    this.lastText = '';
    this.manual = false; // true with push-to-talk: don't restart automatically
    this._rec = null;
    this._commands = new Set();
    this._text = new Set();
    this._partial = new Set();
    this._want = false;
    this._starting = false;
    this._restarts = 0;
    this._askResolve = null;
    this._opts = { lang: null, continuous: true, interim: true, local: false, minScore: 0.72 };
    /** How long after our own speech output a similar sentence counts as echo (ms). */
    this.echoWindow = 1500;
  }

  static get supported() {
    return !!SR;
  }

  /** true if this browser supports voice input (Chrome, Edge). */
  get supported() {
    return !!SR;
  }

  /** "available" | "downloadable" | "downloading" | "unavailable" | "unknown" */
  localAvailable(lang) {
    return VoiceInput.deviceAvailable(lang ?? this._opts.lang ?? this.rt?.project?.settings?.lang ?? 'en-US');
  }

  /** Downloads the language pack; afterwards recognition runs without a server. Needs internet once. */
  async installLocal(lang) {
    const l = lang ?? this._opts.lang ?? this.rt?.project?.settings?.lang ?? 'en-US';
    this.rt?.log('info', `Downloading language pack for "${l}" …`);
    const ok = await VoiceInput.installDevice(l);
    this.rt?.log(ok ? 'info' : 'warn', ok
      ? 'Language pack loaded. voice.start({ local: true }) now recognises on the device.'
      : 'On-device recognition is not possible in this browser.');
    return ok;
  }

  /**
   * Can the browser recognise on the device (without a server)?
   *
   * CAUTION: `SpeechRecognition.available()` is still experimental. In a Chromium without
   * a speech recognition service (e.g. headless) the call crashes the renderer – and no
   * try/catch catches that kind of crash. That is why this check NEVER runs automatically
   * on start, only when a script calls it explicitly.
   */
  static async deviceAvailable(lang = 'en-US') {
    if (!SR || typeof SR.available !== 'function') return 'unknown';
    try {
      return await SR.available({ langs: [lang], processLocally: true });
    } catch {
      return 'unknown';
    }
  }

  /** Downloads the language pack for on-device recognition (once, needs internet). */
  static async installDevice(lang = 'en-US') {
    if (!SR || typeof SR.install !== 'function') return false;
    try {
      return await SR.install({ langs: [lang], processLocally: true });
    } catch {
      return false;
    }
  }

  // ---- internals ---------------------------------------------------------
  _setState(state, detail) {
    if (this.state === state && !detail) return;
    this.state = state;
    this.emit('state', { state, detail });
    this.rt?.emit?.('voice', { state, detail, text: this.lastText });
  }

  _create() {
    const o = this._opts;
    const rec = new SR();
    rec.lang = o.lang ?? this.rt?.project?.settings?.lang ?? 'en-US';
    rec.continuous = !this.manual && o.continuous !== false;
    rec.interimResults = o.interim !== false;
    rec.maxAlternatives = 3;
    if (o.local) {
      try {
        rec.processLocally = true;
      } catch {}
    }
    rec.onresult = (ev) => this._onResult(ev);
    rec.onerror = (ev) => this._onError(ev);
    rec.onend = () => this._onEnd();
    rec.onstart = () => {
      this._starting = false;
      this._restarts = 0;
      this._setState('listening');
    };
    return rec;
  }

  /** Starts recognition. The first time, the browser asks for the microphone. */
  start(options = {}) {
    if (!SR) {
      this.rt?.log('warn', 'Voice input is only available in Chrome or Edge on desktop.');
      this._setState('error', 'unsupported');
      return this;
    }
    Object.assign(this._opts, options);
    this._want = true;
    this._rec ??= this._create();
    if (this.state === 'listening' || this._starting) return this;
    try {
      this._starting = true;
      this._rec.start();
    } catch (e) {
      this._starting = false;
      if (!/already started/i.test(e.message)) this.rt?.log('warn', 'Cannot start the microphone: ' + e.message);
    }
    return this;
  }

  stop() {
    this._want = false;
    try {
      this._rec?.stop();
    } catch {}
    if (this.rt) this.rt.heard = '';
    this._setState('off');
    return this;
  }

  /** Stops listening for a moment (e.g. while the app speaks) but remembers that it should listen. */
  pause() {
    if (!this._want) return this;
    try {
      this._rec?.abort();
    } catch {}
    this._setState('paused');
    return this;
  }

  resume() {
    if (this._want) this.start();
    return this;
  }

  get isListening() {
    return this.state === 'listening';
  }

  _onEnd() {
    this._starting = false;
    if (!this._want || this.manual) return this._setState(this.state === 'error' ? 'error' : 'off');
    // Chrome ends recognition by itself after a pause: start it again, with a
    // back-off so a persistent error does not become an endless loop.
    this._restarts++;
    const delay = Math.min(2000, 120 * this._restarts);
    this._setState('paused');
    clearTimeout(this._restartTimer);
    this._restartTimer = setTimeout(() => {
      if (this._want && this.rt?.running) this.start();
    }, delay);
  }

  _onError(ev) {
    const code = ev?.error ?? 'unknown';
    if (code === 'no-speech' || code === 'aborted') return; // normal
    const texts = {
      'not-allowed': 'No access to the microphone. Allow it in the browser (left of the address bar) and restart.',
      'service-not-allowed': 'Speech recognition is blocked in the browser.',
      network: 'Speech recognition in Chrome needs an internet connection (the audio is sent to a server).',
      'audio-capture': 'No microphone found.',
      'language-not-supported': 'The recogniser does not support this language.',
    };
    this.rt?.log('warn', texts[code] ?? `Speech recognition: error "${code}".`);
    if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
      this._want = false;
      this._setState('error', code);
    }
  }

  /**
   * Drops our own speech output that the microphone picks up. The recogniser delivers a
   * result almost a second after the sound, so the window lasts `echoWindow` ms after
   * speaking – but only what resembles the last spoken text is dropped. A real answer
   * may come right afterwards.
   */
  _isEcho(text) {
    const rt = this.rt;
    if (!rt) return false;
    const fresh = rt._speaking || Date.now() - (rt._spokeAt ?? 0) < this.echoWindow;
    if (!fresh) return false;
    const said = normalize(rt._lastSpoken ?? '');
    const heard = normalize(text);
    if (!said || !heard) return rt._speaking;
    return said.includes(heard) || similarity(said.slice(0, heard.length + 6), heard) > 0.6;
  }

  _onResult(ev) {
    const res = ev.results[ev.results.length - 1];
    const alts = [...res].map((a) => a.transcript.trim()).filter(Boolean);
    const text = alts[0] ?? '';
    if (!text) return;
    if (this.rt) this.rt.heard = text;
    if (!res.isFinal) {
      for (const fn of this._partial) fn(normalize(text), text);
      this.emit('partial', text);
      this.rt?.emit?.('voice', { state: this.state, text, partial: true });
      return;
    }
    if (this._isEcho(text)) {
      this.rt?.log('device', `[Microphone] dropped own output: "${text}"`);
      return;
    }
    this.lastText = text;
    this.rt?.log('info', `🎤 "${text}"`);
    this.rt?.emit?.('voice', { state: this.state, text });
    // ask() takes precedence: it is waiting for exactly one answer
    if (this._askResolve) {
      const done = this._askResolve;
      this._askResolve = null;
      done({ text, alts });
      return;
    }
    for (const fn of this._text) fn(normalize(text), text, alts);
    this._dispatch(alts);
  }

  /**
   * Tries all recognition alternatives against all patterns: first as is, then with
   * unified umlauts. "*" is a catch-all pattern and only runs if no real pattern matched.
   */
  _dispatch(alts) {
    const commands = [...this._commands];
    const specific = commands.filter((c) => !c.fallback);
    const fallbacks = commands.filter((c) => c.fallback);
    for (const key of ['re', 'reFolded']) {
      for (const alt of alts) {
        const t = key === 're' ? normalize(alt) : fold(alt);
        let hit = false;
        for (const cmd of specific) {
          const m = cmd[key]?.exec(t);
          if (!m) continue;
          const args = {};
          cmd.slots.forEach((s, i) => (args[s.name] = slotValue(m[i + 1] ?? '', s.type)));
          if (cmd.slots.some((s) => (s.type === 'zahl' || s.type === 'number') && args[s.name] == null)) continue;
          hit = true;
          cmd.fn(args, alt, cmd.raw);
        }
        if (hit) return true;
      }
    }
    if (fallbacks.length) {
      for (const cmd of fallbacks) cmd.fn({ text: normalize(alts[0]) }, alts[0], cmd.raw);
      return true;
    }
    if (specific.length) this.rt?.log('device', `[Microphone] no command matches "${alts[0]}"`);
    return false;
  }

  // ---- API for scripts -------------------------------------------------
  /**
   * voice.command("go to {target}", ({ target }) => …)
   * Placeholders {name} and {name:number}, alternatives (a|b), "*" for anything.
   */
  command(pattern, fn, { persistent = false } = {}) {
    const { re, slots, raw, fallback } = compilePattern(pattern);
    const folded = compilePattern(pattern, { folded: true });
    const entry = { re, reFolded: folded.re, slots, raw, fallback, fn: this.rt._guard(fn) };
    this._commands.add(entry);
    this._autoStart();
    return this.rt._scope(persistent).add(() => this._commands.delete(entry));
  }

  /** Several commands at once: voice.commands({ "start": fn, "stop": fn }) */
  commands(map, opts) {
    const offs = Object.entries(map).map(([p, fn]) => this.command(p, fn, opts));
    return () => offs.forEach((off) => off());
  }

  /** Every recognised sentence, without patterns. fn(normalized, original, alternatives) */
  onText(fn, { persistent = false } = {}) {
    const g = this.rt._guard(fn);
    this._text.add(g);
    this._autoStart();
    return this.rt._scope(persistent).add(() => this._text.delete(g));
  }

  /** Interim results while the person is still speaking – good for quick reactions. */
  onPartial(fn, { persistent = false } = {}) {
    const g = this.rt._guard(fn);
    this._partial.add(g);
    this._autoStart();
    return this.rt._scope(persistent).add(() => this._partial.delete(g));
  }

  _autoStart() {
    this.rt?.emit?.('voice', { state: this.state }); // UI: show the microphone indicator
    if (this.manual || this._want || this.state === 'error') return;
    this.start();
  }

  /**
   * Hold a key = listen ("push-to-talk"). Prevents our own speech output or
   * background noise from triggering commands.
   */
  pushToTalk(key = 'v', { persistent = false } = {}) {
    this.manual = true;
    this._rec = null; // reset continuous
    const want = (e) => {
      const k = e.key === ' ' ? 'Space' : e.key;
      return k.toLowerCase() === String(key).toLowerCase() || e.code === key;
    };
    const skip = (e) => e.target?.closest?.('input, textarea, select, [contenteditable="true"], .monaco-editor, .code-editor');
    const down = (e) => {
      if (!want(e) || e.repeat || skip(e)) return;
      e.preventDefault();
      this._want = true;
      this.start();
    };
    const up = (e) => {
      if (!want(e) || skip(e)) return;
      this.stop();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    this.rt.log('info', `Push-to-talk: hold "${key}" and speak.`);
    this.rt.emit?.('voice', { state: this.state });
    return this.rt._scope(persistent).add(() => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      this.manual = false;
    });
  }

  /**
   * Asks a question and waits for the answer.
   * expect: "text" | "number" | ["yes", "no"] (then the best match is returned)
   * Returns null if nothing was understood.
   */
  async ask(question, { expect = 'text', timeout = 8000, retries = 1, lang } = {}) {
    if (!SR) {
      this.rt.log('warn', 'Voice input is only available in Chrome or Edge on desktop.');
      return null;
    }
    const wasListening = this._want;
    const wasManual = this.manual;
    for (let round = 0; round <= retries; round++) {
      if (question) await this.rt.speak(round === 0 ? question : "I didn't catch that. " + question, { interrupt: true });
      if (!this.rt.running) return null;
      await new Promise((r) => setTimeout(r, 250)); // let the speaker fade out
      this.manual = true; // no auto-restart during the question
      this._rec = null;
      this._want = true;
      this.start({ lang, continuous: false });
      const answer = await new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (this._askResolve !== resolve) return;
          this._askResolve = null;
          try {
            this._rec?.stop();
          } catch {}
          resolve(null);
        }, timeout);
        this._askResolve = (v) => {
          clearTimeout(timer);
          resolve(v);
        };
      });
      this._askResolve = null;
      this.manual = wasManual;
      this._rec = null;
      this._want = wasListening;
      if (wasListening) this.start();
      else this._setState('off');
      if (!answer) continue;
      if (expect === 'zahl' || expect === 'number') {
        const n = answer.alts.map(parseNumber).find((x) => x != null);
        if (n != null) return n;
        continue;
      }
      if (Array.isArray(expect)) {
        for (const alt of answer.alts) {
          const hit = bestMatch(alt, expect, this._opts.minScore);
          if (hit) return hit.option;
        }
        continue;
      }
      return answer.text;
    }
    return null;
  }

  /** Yes/no question. Returns true, false or null. */
  async confirm(question, { timeout = 8000, retries = 1 } = {}) {
    const yes = ['yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'correct', 'right', 'ja', 'jawohl', 'klar', 'stimmt'];
    const no = ['no', 'nope', 'not', 'cancel', 'nein', 'nicht', 'ne', 'abbrechen'];
    const answer = await this.ask(question, { expect: [...yes, ...no], timeout, retries });
    if (answer == null) return null;
    return yes.includes(answer);
  }

  /** Called when the runtime stops. */
  dispose() {
    this._want = false;
    clearTimeout(this._restartTimer);
    this._askResolve?.(null);
    this._askResolve = null;
    try {
      this._rec?.abort();
    } catch {}
    this._rec = null;
    if (this.rt) this.rt.heard = '';
    this._commands.clear();
    this._text.clear();
    this._partial.clear();
    this._setState('off');
  }
}
