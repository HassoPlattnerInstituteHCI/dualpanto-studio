// Spracheingabe (Web Speech API).
//
// Zwei Dinge machen Spracheingabe am DualPanto besonders:
//
// 1. Das Programm spricht selbst. Das Mikrofon hört die eigene Sprachausgabe mit und
//    erkennt sie als Eingabe. Deshalb verwirft `_isEcho()` Ergebnisse, die während oder
//    kurz nach der eigenen Ausgabe kommen und dem zuletzt Gesagten ähnlich sind.
// 2. Die Erkennung läuft in Chrome standardmäßig über einen Google-Server (Audio geht
//    ins Netz, offline geht nichts). `processLocally = true` erzwingt Erkennung auf dem
//    Gerät, wenn der Browser sie kann – `VoiceInput.deviceAvailable()` prüft das.
//
// Interpretiert wird nicht mit einem Sprachmodell, sondern mit Mustern: Platzhalter,
// Alternativen, deutsche Zahlwörter und ein toleranter Vergleich gegen Erkennungsfehler.

import { Emitter } from './emitter.js';

const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

/** Kleinschreibung, keine Satzzeichen, einfache Leerzeichen. */
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[.,!?;:„“"'`´()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ONES = { null: 0, eins: 1, ein: 1, eine: 1, einen: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9 };
const TEENS = { zehn: 10, elf: 11, zwölf: 12, dreizehn: 13, vierzehn: 14, fünfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19 };
const TENS = { zwanzig: 20, dreißig: 30, dreissig: 30, vierzig: 40, fünfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90 };

/** „dreiundzwanzig“, „fünf“, „-12“, „3,5“ → Zahl. null, wenn nichts Zählbares drinsteht. */
export function parseNumber(text) {
  const t = normalize(text).replace(/,(\d)/g, '.$1');
  const digits = t.match(/-?\d+(\.\d+)?/);
  if (digits) return parseFloat(digits[0]);
  const neg = /\bminus\b/.test(t);
  let total = null;
  for (const word of t.split(' ')) {
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
  if (word === 'hundert') return 100;
  // „einundzwanzig“, „fünfundvierzig“ (\w kennt keine Umlaute)
  const m = /^([a-zäöüß]+?)und([a-zäöüß]+)$/.exec(word);
  if (m && m[1] in ONES && m[2] in TENS) return ONES[m[1]] + TENS[m[2]];
  // „zweihundert“, „dreihundertfünfzig“
  const h = /^([a-zäöüß]+?)hundert([a-zäöüß]*)$/.exec(word);
  if (h && h[1] in ONES) return ONES[h[1]] * 100 + (h[2] ? wordToNumber(h[2]) ?? 0 : 0);
  return null;
}

/** Umlaute vereinheitlichen, damit „grün“ und „gruen“ gleich zählen. */
export function fold(text) {
  return normalize(text).replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
}

/** 0..1, 1 = gleich. Für Toleranz gegen Erkennungsfehler („ziel“ / „ziehl“). */
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

/** Gleicher Wortstamm: „startet“ passt zu „start“, „stoppuhr“ aber nicht zu „stopp“. */
function stemScore(a, b) {
  const [x, y] = [fold(a), fold(b)];
  if (x.length < 3 || y.length < 3) return 0;
  if (!x.startsWith(y) && !y.startsWith(x)) return 0;
  return 0.1 + 0.9 * (Math.min(x.length, y.length) / Math.max(x.length, y.length));
}

/** Findet in einer Liste den Eintrag, der am besten zum Text passt (oder null). */
export function bestMatch(text, options, minScore = 0.72) {
  const t = fold(text);
  const words = t.split(' ');
  let best = null;
  for (const option of options) {
    const label = fold(typeof option === 'string' ? option : option?.label ?? option);
    if (!label) continue;
    // ganzes Wort im Satz enthalten zählt voll
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
 * Baut aus einem Muster eine Regex.
 *   "gehe zu {ziel}"          → Platzhalter, landet in args.ziel
 *   "setze punkte {n:zahl}"   → args.n ist eine Zahl
 *   "(start|starte) spiel"    → Alternativen
 *   "*"                       → alles
 * Ohne Platzhalter reicht es, wenn die Wörter im Satz vorkommen (Erkenner hängt gern
 * Füllwörter an).
 */
export function compilePattern(pattern, { folded = false } = {}) {
  const prep = (s) => (folded ? fold(s) : normalize(s));
  if (pattern === '*') return { re: /^(.*)$/, slots: [{ name: 'text', type: 'text' }], raw: pattern, fallback: true };
  const slots = [];
  const parts = String(pattern).split(/(\{[^}]*\}|\([^)]*\))/).filter(Boolean);
  // Steht am Ende ein Platzhalter, nimmt er den Rest des Satzes („gehe zu der Tür“).
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
      // normalize() schneidet Leerzeichen ab – an den Rändern müssen sie bleiben,
      // sonst klebt "(start|starte) spiel" zu "startespiel" zusammen.
      const pad = (/^\s/.test(part) ? ' ' : '') + prep(part) + (/\s$/.test(part) ? ' ' : '');
      src += pad.replace(RE_SPECIAL, '\\$&').replace(/ /g, '\\s+');
    }
  });
  // Füllwörter davor erlauben; ohne Platzhalter am Ende darf auch dahinter etwas stehen
  const tail = lastIsSlot ? '\\s*$' : '(?=\\s|$)';
  return { re: new RegExp(`(?:^|\\s)${src}${tail}`), slots, raw: pattern };
}

function slotValue(raw, type) {
  if (type === 'zahl' || type === 'number') return parseNumber(raw);
  return normalize(raw);
}

// ---------------------------------------------------------------------------

export class VoiceInput extends Emitter {
  /** @param {object} rt Runtime – für speak(), log() und den Echo-Schutz */
  constructor(rt) {
    super();
    this.rt = rt;
    this.state = 'off'; // off | listening | paused | error
    this.lastText = '';
    this.manual = false; // true bei Push-to-talk: nicht automatisch neu starten
    this._rec = null;
    this._commands = new Set();
    this._text = new Set();
    this._partial = new Set();
    this._want = false;
    this._starting = false;
    this._restarts = 0;
    this._askResolve = null;
    this._opts = { lang: null, continuous: true, interim: true, local: false, minScore: 0.72 };
    /** So lange nach der eigenen Sprachausgabe gilt ein ähnlicher Satz als Echo (ms). */
    this.echoWindow = 1500;
  }

  static get supported() {
    return !!SR;
  }

  /** true, wenn dieser Browser Spracheingabe kann (Chrome, Edge). */
  get supported() {
    return !!SR;
  }

  /** "available" | "downloadable" | "downloading" | "unavailable" | "unknown" */
  localAvailable(lang) {
    return VoiceInput.deviceAvailable(lang ?? this._opts.lang ?? this.rt?.project?.settings?.lang ?? 'de-DE');
  }

  /** Lädt das Sprachpaket, danach läuft die Erkennung ohne Server. Braucht einmal Internet. */
  async installLocal(lang) {
    const l = lang ?? this._opts.lang ?? this.rt?.project?.settings?.lang ?? 'de-DE';
    this.rt?.log('info', `Sprachpaket für „${l}“ wird geladen …`);
    const ok = await VoiceInput.installDevice(l);
    this.rt?.log(ok ? 'info' : 'warn', ok
      ? 'Sprachpaket geladen. voice.start({ local: true }) erkennt jetzt auf dem Gerät.'
      : 'Erkennung auf dem Gerät ist in diesem Browser nicht möglich.');
    return ok;
  }

  /**
   * Kann der Browser auf dem Gerät erkennen (ohne Server)?
   *
   * ACHTUNG: `SpeechRecognition.available()` ist noch experimentell. In einem Chromium
   * ohne Spracherkennungs-Dienst (z. B. headless) bringt der Aufruf den Renderer zum
   * Absturz – und so einen Absturz fängt kein try/catch auf. Deshalb wird diese Prüfung
   * NIE automatisch beim Start ausgeführt, sondern nur, wenn ein Skript sie ausdrücklich
   * aufruft.
   */
  static async deviceAvailable(lang = 'de-DE') {
    if (!SR || typeof SR.available !== 'function') return 'unknown';
    try {
      return await SR.available({ langs: [lang], processLocally: true });
    } catch {
      return 'unknown';
    }
  }

  /** Lädt das Sprachpaket für die Erkennung auf dem Gerät (einmalig, braucht Internet). */
  static async installDevice(lang = 'de-DE') {
    if (!SR || typeof SR.install !== 'function') return false;
    try {
      return await SR.install({ langs: [lang], processLocally: true });
    } catch {
      return false;
    }
  }

  // ---- Technik ----------------------------------------------------------
  _setState(state, detail) {
    if (this.state === state && !detail) return;
    this.state = state;
    this.emit('state', { state, detail });
    this.rt?.emit?.('voice', { state, detail, text: this.lastText });
  }

  _create() {
    const o = this._opts;
    const rec = new SR();
    rec.lang = o.lang ?? this.rt?.project?.settings?.lang ?? 'de-DE';
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

  /** Startet die Erkennung. Beim ersten Mal fragt der Browser nach dem Mikrofon. */
  start(options = {}) {
    if (!SR) {
      this.rt?.log('warn', 'Spracheingabe gibt es nur in Chrome oder Edge am Computer.');
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
      if (!/already started/i.test(e.message)) this.rt?.log('warn', 'Mikrofon lässt sich nicht starten: ' + e.message);
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

  /** Hört kurz nicht zu (z. B. während die App spricht), merkt sich aber den Wunsch. */
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
    // Chrome beendet die Erkennung nach einer Pause von selbst: wieder anwerfen,
    // mit Bremse, damit ein dauerhafter Fehler keine Endlosschleife wird.
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
      'not-allowed': 'Kein Zugriff auf das Mikrofon. Im Browser links neben der Adresse erlauben und neu starten.',
      'service-not-allowed': 'Die Spracherkennung ist im Browser gesperrt.',
      network: 'Die Spracherkennung braucht in Chrome eine Internetverbindung (das Audio wird zum Server geschickt).',
      'audio-capture': 'Kein Mikrofon gefunden.',
      'language-not-supported': 'Diese Sprache kann der Erkenner nicht.',
    };
    this.rt?.log('warn', texts[code] ?? `Spracherkennung: Fehler „${code}“.`);
    if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
      this._want = false;
      this._setState('error', code);
    }
  }

  /**
   * Verwirft die eigene Sprachausgabe, die das Mikrofon mithört. Der Erkenner liefert
   * ein Ergebnis erst eine knappe Sekunde nach dem Ton, deshalb gilt das Fenster noch
   * `echoWindow` ms nach dem Sprechen – verworfen wird aber nur, was dem zuletzt
   * Gesagten ähnlich ist. Eine echte Antwort darf direkt danach kommen.
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
      this.rt?.log('device', `[Mikrofon] eigene Ausgabe verworfen: „${text}“`);
      return;
    }
    this.lastText = text;
    this.rt?.log('info', `🎤 „${text}“`);
    this.rt?.emit?.('voice', { state: this.state, text });
    // ask() hat Vorrang: es wartet gerade auf genau eine Antwort
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
   * Probiert alle Erkennungs-Alternativen gegen alle Muster: erst normal, dann mit
   * vereinheitlichten Umlauten. "*" ist ein Auffangmuster und kommt nur dran, wenn
   * kein echtes Muster gepasst hat.
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
    if (specific.length) this.rt?.log('device', `[Mikrofon] kein Befehl passt zu „${alts[0]}“`);
    return false;
  }

  // ---- API für Skripte --------------------------------------------------
  /**
   * voice.command("gehe zu {ziel}", ({ ziel }) => …)
   * Platzhalter {name} und {name:zahl}, Alternativen (a|b), "*" für alles.
   */
  command(pattern, fn, { persistent = false } = {}) {
    const { re, slots, raw, fallback } = compilePattern(pattern);
    const folded = compilePattern(pattern, { folded: true });
    const entry = { re, reFolded: folded.re, slots, raw, fallback, fn: this.rt._guard(fn) };
    this._commands.add(entry);
    this._autoStart();
    return this.rt._scope(persistent).add(() => this._commands.delete(entry));
  }

  /** Mehrere Befehle auf einmal: voice.commands({ "start": fn, "stopp": fn }) */
  commands(map, opts) {
    const offs = Object.entries(map).map(([p, fn]) => this.command(p, fn, opts));
    return () => offs.forEach((off) => off());
  }

  /** Jeder erkannte Satz, ohne Muster. fn(normalisiert, original, alternativen) */
  onText(fn, { persistent = false } = {}) {
    const g = this.rt._guard(fn);
    this._text.add(g);
    this._autoStart();
    return this.rt._scope(persistent).add(() => this._text.delete(g));
  }

  /** Zwischenergebnisse, noch während gesprochen wird – gut für schnelle Reaktion. */
  onPartial(fn, { persistent = false } = {}) {
    const g = this.rt._guard(fn);
    this._partial.add(g);
    this._autoStart();
    return this.rt._scope(persistent).add(() => this._partial.delete(g));
  }

  _autoStart() {
    this.rt?.emit?.('voice', { state: this.state }); // Oberfläche: Mikrofon-Anzeige einblenden
    if (this.manual || this._want || this.state === 'error') return;
    this.start();
  }

  /**
   * Taste halten = zuhören („Push-to-talk“). Verhindert, dass die eigene
   * Sprachausgabe oder Hintergrundgeräusche Befehle auslösen.
   */
  pushToTalk(key = 'v', { persistent = false } = {}) {
    this.manual = true;
    this._rec = null; // continuous neu setzen
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
    this.rt.log('info', `Push-to-talk: Taste „${key}“ halten und sprechen.`);
    this.rt.emit?.('voice', { state: this.state });
    return this.rt._scope(persistent).add(() => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      this.manual = false;
    });
  }

  /**
   * Stellt eine Frage und wartet auf die Antwort.
   * expect: "text" | "zahl" | ["ja", "nein"] (dann wird der beste Treffer zurückgegeben)
   * Gibt null zurück, wenn nichts verstanden wurde.
   */
  async ask(question, { expect = 'text', timeout = 8000, retries = 1, lang } = {}) {
    if (!SR) {
      this.rt.log('warn', 'Spracheingabe gibt es nur in Chrome oder Edge am Computer.');
      return null;
    }
    const wasListening = this._want;
    const wasManual = this.manual;
    for (let round = 0; round <= retries; round++) {
      if (question) await this.rt.speak(round === 0 ? question : 'Ich habe nichts verstanden. ' + question, { interrupt: true });
      if (!this.rt.running) return null;
      await new Promise((r) => setTimeout(r, 250)); // Lautsprecher ausklingen lassen
      this.manual = true; // kein Auto-Restart während der Frage
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

  /** Ja/Nein-Frage. Gibt true, false oder null zurück. */
  async confirm(question, { timeout = 8000, retries = 1 } = {}) {
    const yes = ['ja', 'jawohl', 'okay', 'ok', 'klar', 'stimmt'];
    const no = ['nein', 'nicht', 'ne', 'nope', 'abbrechen'];
    const answer = await this.ask(question, { expect: [...yes, ...no], timeout, retries });
    if (answer == null) return null;
    return yes.includes(answer);
  }

  /** Wird beim Stopp der Runtime aufgerufen. */
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
