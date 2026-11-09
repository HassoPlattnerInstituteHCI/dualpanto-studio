// Microphone recording for the Sounds tab (MediaRecorder). Delivers the recording as a
// Blob (WebM/Opus in Chrome) that the sound editor decodes, trims and saves as WAV.

export const recordingSupported = () =>
  typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';

/** Microphones of this computer. Names are only known after access was allowed once. */
export async function microphones() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'audioinput');
}

/** A readable message for a failed getUserMedia call. */
export function micErrorText(e) {
  if (e?.name === 'NotAllowedError') return 'Access to the microphone was not allowed. Allow it in the browser (left of the address bar) and try again.';
  if (e?.name === 'NotFoundError') return 'No microphone found.';
  if (e?.name === 'NotReadableError') return 'The microphone is used by another program.';
  return `The microphone could not be started: ${e?.message ?? e}`;
}

export class Recorder {
  /**
   * @param {object} opts
   * @param {string} [opts.deviceId]  microphone, default = the system's
   * @param {(level: number) => void} [opts.onLevel]  0..1, about 30 times per second
   */
  async start({ deviceId, onLevel } = {}) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.done = new Promise((resolve) => {
      this.recorder.onstop = () => resolve(new Blob(this.chunks, { type: this.recorder.mimeType || 'audio/webm' }));
    });
    this.recorder.start(250);
    this.startedAt = performance.now();

    // level meter: RMS of the live signal
    this.ctx = new AudioContext();
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 1024;
    this.ctx.createMediaStreamSource(this.stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const tick = () => {
      if (!this.recorder || this.recorder.state !== 'recording') return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      onLevel?.(Math.min(1, Math.sqrt(sum / buf.length) * 4));
      this._raf = requestAnimationFrame(tick);
    };
    tick();
  }

  get seconds() {
    return this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  /** Stops and resolves with the recording. */
  async stop() {
    if (!this.recorder) return null;
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    const blob = await this.done;
    this._release();
    return blob;
  }

  /** Stops without keeping anything. */
  cancel() {
    try {
      if (this.recorder?.state !== 'inactive') this.recorder?.stop();
    } catch {}
    this._release();
  }

  _release() {
    cancelAnimationFrame(this._raf);
    this.stream?.getTracks().forEach((t) => t.stop()); // the browser's "recording" indicator goes off
    this.ctx?.close().catch(() => {});
    this.recorder = null;
    this.stream = null;
    this.ctx = null;
    this.startedAt = 0;
  }
}
