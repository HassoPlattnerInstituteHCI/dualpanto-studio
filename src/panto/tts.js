// Speech output with the browser's built-in voices (Web Speech API, `speechSynthesis`).
//
// Which voices exist depends on the computer: Windows and macOS bring their own, Google
// Chrome adds online "Google …" voices, and Chromium on Linux only has voices through
// speech-dispatcher (and often only when started with --enable-speech-dispatcher). With
// no voice at all, speak() still shows the caption and continues after an estimate.
//
// The project chooses a voice by name (settings.tts.voice). A name that does not exist on
// this computer falls back to the first voice of the project language.

export const TTS_DEFAULTS = Object.freeze({ voice: '', rate: 1, pitch: 1 });

export const ttsSupported = () => typeof speechSynthesis !== 'undefined';

/** The project's speech settings with defaults filled in. */
export function ttsSettings(project) {
  return { ...TTS_DEFAULTS, ...(project?.settings?.tts ?? {}) };
}

/**
 * All voices of this computer. Chromium fills the list asynchronously, so wait for
 * "voiceschanged" (or give up after `timeout` ms – some systems never fire it).
 */
export function loadVoices(timeout = 1500) {
  if (!ttsSupported()) return Promise.resolve([]);
  const now = speechSynthesis.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      speechSynthesis.removeEventListener('voiceschanged', done);
      resolve(speechSynthesis.getVoices());
    };
    const timer = setTimeout(done, timeout);
    speechSynthesis.addEventListener('voiceschanged', done);
  });
}

const langPrefix = (lang) => String(lang || 'en').toLowerCase().split(/[-_]/)[0];

/** Voices for a language ("en-US" → every English voice), the exact locale first. */
export function voicesFor(voices, lang) {
  const prefix = langPrefix(lang);
  const exact = String(lang || '').toLowerCase();
  return voices
    .filter((v) => langPrefix(v.lang) === prefix)
    .sort((a, b) => (b.lang.toLowerCase() === exact) - (a.lang.toLowerCase() === exact));
}

/**
 * Finds a voice by name: exact name or voiceURI, then a case-insensitive part of the name
 * ("Samantha", "google us"). Without a match: the first voice of the language, or null.
 */
export function findVoice(voices, name, lang) {
  const wanted = String(name ?? '').trim().toLowerCase();
  if (wanted) {
    const hit =
      voices.find((v) => v.name.toLowerCase() === wanted || v.voiceURI.toLowerCase() === wanted) ??
      voices.find((v) => v.name.toLowerCase().includes(wanted));
    if (hit) return hit;
  }
  const own = voicesFor(voices, lang);
  return own.find((v) => v.default) ?? own[0] ?? null;
}

/** Whether `name` names a voice that exists here (empty = automatic, always fine). */
export function hasVoice(voices, name) {
  const wanted = String(name ?? '').trim().toLowerCase();
  return !wanted || voices.some((v) => v.name.toLowerCase().includes(wanted) || v.voiceURI.toLowerCase() === wanted);
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * An utterance with voice, rate and pitch applied. `rate` and `pitch` of a single call are
 * multiplied with the project setting, so speak("…", { rate: 1.5 }) stays relative to it.
 */
export function makeUtterance(text, { voices = [], settings = TTS_DEFAULTS, lang = 'en-US', voice, rate = 1, pitch = 1 } = {}) {
  const u = new SpeechSynthesisUtterance(text);
  const v = findVoice(voices, voice ?? settings.voice, lang);
  if (v) u.voice = v;
  u.lang = v?.lang ?? lang;
  u.rate = clamp(rate * (settings.rate ?? 1), 0.1, 10);
  u.pitch = clamp(pitch * (settings.pitch ?? 1), 0, 2);
  return u;
}
