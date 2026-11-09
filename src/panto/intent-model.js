// Client for the small on-device semantic intent model. The model runs in a worker
// so embedding inference does not block the game or editor thread.
export const INTENT_MODEL_SIZE_MB = 24;

class IntentModelClient {
  constructor() {
    this.worker = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  _ensureWorker() {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./intent-model-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      if (data.type === 'progress') {
        pending.onProgress?.(data.progress);
        return;
      }
      this.pending.delete(data.id);
      if (data.type === 'error') pending.reject(new Error(data.message));
      else pending.resolve(data.result);
    };
    worker.onerror = (event) => {
      const error = new Error(event.message || 'The intent model worker failed.');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.worker = null;
    };
    this.worker = worker;
    return worker;
  }

  _request(message, onProgress) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject, onProgress });
      this._ensureWorker().postMessage({ ...message, id });
    });
  }

  warm(examples, onProgress) {
    return this._request({ type: 'warm', examples: [...new Set(examples)] }, onProgress);
  }

  match(texts, intents, { threshold = 0.48, margin = 0.035 } = {}) {
    return this._request({ type: 'match', texts, intents, threshold, margin });
  }
}

export const intentModel = new IntentModelClient();
