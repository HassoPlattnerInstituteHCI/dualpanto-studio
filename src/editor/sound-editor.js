// Sound editor: trim, cut, volume, normalize, silence and fades for a project sound. The
// result is rendered in the browser and saved as a WAV file that replaces the sound (or is
// added as a copy), so sound.play(), exports and folder projects keep working with plain
// audio files.

import { h } from './dom.js';

const MAX_UNDO = 30;
const SILENCE = 0.05; // "Trim silence": quieter than 5 % of the loudest part
const SILENCE_PAD = 0.06; // seconds kept before and after, so soft word starts survive
const fmt = (sec) => `${sec.toFixed(2)} s`;

/**
 * Opens the editor for one sound.
 * @param {object} opts
 * @param {string} opts.name   file name, shown in the title
 * @param {Blob}   opts.blob   the stored audio
 * @param {(wav: Blob) => Promise<void>} opts.onSave        replace the sound
 * @param {(wav: Blob) => Promise<void>} [opts.onSaveCopy]  keep the sound, add the result as a new one
 * @param {string}  [opts.title]      dialog title, default "Edit sound: <name>"
 * @param {string}  [opts.saveLabel]  label of the save button
 * @param {boolean} [opts.unsaved]    a fresh recording: closing without saving asks first
 * @param {boolean} [opts.mono]       mix down to one channel (recordings: half the size)
 */
export async function openSoundEditor({ name, blob, onSave, onSaveCopy, title, saveLabel = 'Save', unsaved = false, mono = false }) {
  const ctx = new AudioContext();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
  } catch {
    ctx.close();
    throw new Error(`"${name}" could not be decoded as audio.`);
  }

  // Cuts change the channel data; volume and fades are applied on top when playing and
  // saving, so they can be changed at any time.
  const state = {
    rate: decoded.sampleRate,
    channels: mono ? [mixDown(decoded)] : channelsOf(decoded),
    gainDb: 0,
    fadeIn: 0, // ms
    fadeOut: 0, // ms
    sel: null, // { a, b } in samples
    cursor: 0, // where playback starts without a selection
    dirty: unsaved,
  };
  const undo = [];
  const play = { source: null, startedAt: 0, from: 0, raf: 0 };
  let rendered = null; // channels with volume and fades, until the next change
  let columns = null; // waveform min/max per pixel column

  const length = () => state.channels[0].length;
  const seconds = (samples) => samples / state.rate;

  /** Something changed the sound: drop the caches and redraw. */
  function changed() {
    rendered = null;
    columns = null;
    state.dirty = true;
    draw();
  }

  function render() {
    if (!rendered) rendered = applyLevels(state.channels, state.rate, state);
    return rendered;
  }

  // ---- UI -------------------------------------------------------------------
  const canvas = h('canvas', { class: 'sound-wave', tabindex: '0', 'aria-label': 'Waveform. Drag to select, Space plays.' });
  const info = h('span', { class: 'sound-edit-info muted small', 'aria-live': 'polite' });
  const btn = (label, tip, onclick, cls = 'btn btn-secondary btn-sm') => h('button', { class: cls, type: 'button', title: tip, onclick }, label);
  const playBtn = btn('▶ Play', 'Play the selection, or everything from the cursor (Space)', () => (play.source ? stop() : start()), 'btn btn-primary btn-sm');
  const keepBtn = btn('Keep selection', 'Cut away everything outside the selection', () => keepSelection());
  const deleteBtn = btn('Delete selection', 'Cut out the selection (Delete)', () => deleteSelection());
  const silenceBtn = btn('Trim silence', 'Cut the quiet part at the start and the end', () => trimSilence());
  const undoBtn = btn('↶ Undo', 'Undo the last cut (Ctrl/⌘ + Z)', () => doUndo());

  const slider = (label, min, max, step, unit, key) => {
    const input = h('input', { type: 'range', min, max, step, value: state[key] });
    const out = h('output', {}, `${state[key]}${unit}`);
    const set = (v) => {
      state[key] = v;
      input.value = v;
      out.textContent = `${v}${unit}`;
      changed();
    };
    input.addEventListener('input', () => set(+input.value));
    return { row: h('label', { class: 'sound-edit-slider' }, h('span', {}, label), input, out), set };
  };
  const gain = slider('Volume', -24, 24, 0.5, ' dB', 'gainDb');
  const fadeIn = slider('Fade in', 0, 2000, 10, ' ms', 'fadeIn');
  const fadeOut = slider('Fade out', 0, 2000, 10, ' ms', 'fadeOut');
  const normalizeBtn = btn('Normalize', 'Make it as loud as possible without distortion', () => normalize());

  const saveBtn = btn(saveLabel, unsaved ? 'Add the recording to the project' : 'Replace the sound with the edited version', () => save(onSave), 'btn btn-primary');
  const copyBtn = onSaveCopy && btn('Save as copy', 'Keep the original and add the edited version as a new sound', () => save(onSaveCopy));
  const closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: () => close() }, '✕');

  const dlg = h('dialog', { class: 'dialog sound-editor', 'aria-label': `Edit ${name}` },
    h('div', { class: 'dialog-head' }, h('h2', {}, title ?? `Edit sound: ${name}`), closeBtn),
    h('div', { class: 'sound-wave-wrap' }, canvas),
    h('div', { class: 'sound-edit-row' }, playBtn, keepBtn, deleteBtn, silenceBtn, undoBtn, h('span', { class: 'spacer' }), info),
    h('div', { class: 'sound-edit-row sound-edit-levels' }, gain.row, normalizeBtn),
    h('div', { class: 'sound-edit-row sound-edit-levels' }, fadeIn.row, fadeOut.row),
    h('p', { class: 'muted small' }, 'Drag in the waveform to select. Saving stores the result as a WAV file; a renamed file is updated in the scripts.'),
    h('div', { class: 'dialog-actions sound-edit-actions' }, h('span', { class: 'spacer' }), copyBtn, saveBtn)
  );
  document.body.append(dlg);

  // ---- waveform -------------------------------------------------------------
  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const ht = canvas.clientHeight;
    if (!w || !ht) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(ht * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(ht * dpr);
      columns = null;
    }
    const g = canvas.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    const color = (v, f) => css.getPropertyValue(v).trim() || f;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = color('--stage-bg', '#eee');
    g.fillRect(0, 0, w, ht);

    const n = length();
    const toX = (s) => (s / Math.max(1, n)) * w;
    if (state.sel) {
      g.fillStyle = color('--accent-soft', '#fdeede');
      g.fillRect(toX(state.sel.a), 0, Math.max(1, toX(state.sel.b) - toX(state.sel.a)), ht);
    }
    columns ??= waveColumns(render(), w);
    const mid = ht / 2;
    g.fillStyle = color('--accent', '#e8710a');
    columns.forEach(([lo, hi], x) => g.fillRect(x, mid - hi * mid, 1, Math.max(1, (hi - lo) * mid)));
    g.fillStyle = color('--border-strong', '#ccc');
    g.fillRect(0, mid, w, 1);
    const head = play.source ? play.from + (ctx.currentTime - play.startedAt) * state.rate : state.cursor;
    g.fillStyle = color('--fg', '#111');
    g.fillRect(Math.round(toX(head)), 0, 1.5, ht);

    info.textContent = state.sel
      ? `Selection ${fmt(seconds(state.sel.a))} – ${fmt(seconds(state.sel.b))} (${fmt(seconds(state.sel.b - state.sel.a))}) · total ${fmt(seconds(n))}`
      : `Length ${fmt(seconds(n))} · ${state.channels.length === 1 ? 'mono' : `${state.channels.length} channels`}`;
    keepBtn.disabled = deleteBtn.disabled = !state.sel;
    undoBtn.disabled = !undo.length;
  }

  const sampleAt = (e) => {
    const r = canvas.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * length());
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const from = sampleAt(e);
    let moved = false;
    stop();
    const move = (ev) => {
      const s = sampleAt(ev);
      if (Math.abs(s - from) > length() / 400) moved = true;
      if (moved) state.sel = { a: Math.min(from, s), b: Math.max(from, s) };
      draw();
    };
    const up = () => {
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      if (!moved) {
        state.sel = null;
        state.cursor = from;
      }
      draw();
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
  });

  // ---- playback -------------------------------------------------------------
  function start() {
    stop();
    ctx.resume();
    const from = state.sel ? state.sel.a : state.cursor >= length() ? 0 : state.cursor;
    const to = state.sel ? state.sel.b : length();
    const src = ctx.createBufferSource();
    src.buffer = toBuffer(ctx, render(), state.rate);
    src.connect(ctx.destination);
    src.onended = () => {
      if (play.source === src) play.source = null;
      playBtn.textContent = '▶ Play';
      cancelAnimationFrame(play.raf);
      draw();
    };
    Object.assign(play, { source: src, from, startedAt: ctx.currentTime });
    src.start(0, seconds(from), seconds(Math.max(1, to - from)));
    playBtn.textContent = '■ Stop';
    const tick = () => {
      draw();
      play.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  function stop() {
    const src = play.source;
    play.source = null;
    try {
      src?.stop();
    } catch {}
  }

  // ---- edits ----------------------------------------------------------------
  /** A cut: stops playback, keeps the old audio for undo, replaces the channels. */
  function edit(fn, cursor = 0) {
    stop();
    undo.push(state.channels);
    if (undo.length > MAX_UNDO) undo.shift();
    state.channels = state.channels.map(fn);
    state.sel = null;
    state.cursor = cursor;
    changed();
  }

  function keepSelection() {
    if (!state.sel) return;
    const { a, b } = state.sel;
    edit((c) => c.slice(a, b));
  }

  function deleteSelection() {
    if (!state.sel) return;
    const { a, b } = state.sel;
    if (b - a >= length()) return; // nothing would be left to save
    edit((c) => {
      const out = new Float32Array(c.length - (b - a));
      out.set(c.subarray(0, a), 0);
      out.set(c.subarray(b), a);
      return out;
    }, a);
  }

  function trimSilence() {
    const top = peak(state.channels);
    if (!top) return;
    const limit = Math.max(0.005, top * SILENCE);
    const n = length();
    const loud = (i) => state.channels.some((c) => Math.abs(c[i]) > limit);
    let a = 0;
    while (a < n && !loud(a)) a++;
    let b = n - 1;
    while (b > a && !loud(b)) b--;
    const pad = Math.round(SILENCE_PAD * state.rate);
    a = Math.max(0, a - pad);
    b = Math.min(n, b + 1 + pad);
    if (a === 0 && b === n) {
      info.textContent = 'No silence at the start or the end.';
      return;
    }
    edit((c) => c.slice(a, b));
  }

  function doUndo() {
    const prev = undo.pop();
    if (!prev) return;
    stop();
    state.channels = prev;
    state.sel = null;
    state.cursor = Math.min(state.cursor, length());
    changed();
  }

  function normalize() {
    const top = peak(state.channels);
    // −1 dB of headroom so the result does not clip; rounded to the slider's 0.5 dB steps
    if (top) gain.set(Math.max(-24, Math.min(24, Math.round(20 * Math.log10(0.89 / top) * 2) / 2)));
  }

  // ---- save / close ---------------------------------------------------------
  async function save(handler) {
    stop();
    const buttons = [saveBtn, copyBtn].filter(Boolean);
    buttons.forEach((b) => (b.disabled = true));
    try {
      await handler(encodeWav(render(), state.rate));
      close(true);
    } catch (e) {
      info.textContent = `Saving failed: ${e.message}`;
      buttons.forEach((b) => (b.disabled = false));
    }
  }

  function close(force = false) {
    if (!force && state.dirty && !confirm(unsaved ? 'Discard this recording?' : 'Discard the changes to this sound?')) return;
    stop();
    cancelAnimationFrame(play.raf);
    ctx.close();
    dlg.close();
    dlg.remove();
  }

  dlg.addEventListener('cancel', (e) => {
    e.preventDefault(); // Esc: ask first when there are changes
    close();
  });
  dlg.addEventListener('keydown', (e) => {
    if (e.target.closest('input')) return;
    if (e.key === ' ') {
      e.preventDefault();
      play.source ? stop() : start();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelection();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      doUndo();
    }
  });
  new ResizeObserver(() => draw()).observe(canvas);

  dlg.showModal();
  canvas.focus();
  draw();
  return dlg;
}

// ---- audio helpers ------------------------------------------------------------

const channelsOf = (buffer) => Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i).slice());

function mixDown(buffer) {
  const out = new Float32Array(buffer.length);
  for (const data of channelsOf(buffer)) for (let i = 0; i < out.length; i++) out[i] += data[i] / buffer.numberOfChannels;
  return out;
}

function peak(channels) {
  let top = 0;
  for (const c of channels) for (let i = 0; i < c.length; i++) top = Math.max(top, Math.abs(c[i]));
  return top;
}

/** Channels with volume (dB) and linear fade in/out (ms) applied, clipped to ±1. */
function applyLevels(channels, rate, { gainDb, fadeIn, fadeOut }) {
  const gain = 10 ** (gainDb / 20);
  const n = channels[0].length;
  const fi = Math.min(n, Math.round((fadeIn / 1000) * rate));
  const fo = Math.min(n, Math.round((fadeOut / 1000) * rate));
  return channels.map((data) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let g = gain;
      if (i < fi) g *= i / fi;
      if (i >= n - fo) g *= (n - 1 - i) / fo;
      out[i] = Math.max(-1, Math.min(1, data[i] * g));
    }
    return out;
  });
}

/** [min, max] of all channels for each of `width` pixel columns. */
function waveColumns(channels, width) {
  const n = channels[0].length;
  return Array.from({ length: width }, (_, x) => {
    const from = Math.floor((x / width) * n);
    const to = Math.max(from + 1, Math.floor(((x + 1) / width) * n));
    let lo = 0;
    let hi = 0;
    for (const c of channels) {
      for (let i = from; i < to && i < n; i++) {
        if (c[i] < lo) lo = c[i];
        if (c[i] > hi) hi = c[i];
      }
    }
    return [lo, hi];
  });
}

function toBuffer(ctx, channels, rate) {
  const buf = ctx.createBuffer(channels.length, Math.max(1, channels[0].length), rate);
  channels.forEach((c, i) => c.length && buf.copyToChannel(c, i));
  return buf;
}

/** 16-bit PCM WAV from channel data. */
export function encodeWav(channels, sampleRate) {
  const n = channels[0].length;
  const count = channels.length;
  const bytes = 44 + n * count * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const text = (offset, s) => [...s].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // size of the fmt chunk
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, count, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * count * 2, true);
  view.setUint16(32, count * 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, n * count * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < count; c++) {
      const v = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}
