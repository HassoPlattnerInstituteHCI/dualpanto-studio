// Quantized sentence embeddings for local, example-based intent matching.
// Audio recognition happens separately; only its transcript reaches this worker.
const TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';
const MODEL = 'Xenova/all-MiniLM-L6-v2';

let extractorPromise = null;
let queue = Promise.resolve();
const exampleVectors = new Map();

async function extractor(progress) {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { env, pipeline } = await import(TRANSFORMERS);
      env.allowRemoteModels = true;
      env.useBrowserCache = true;
      return pipeline('feature-extraction', MODEL, {
        progress_callback: (info) => {
          if (info.status === 'progress_total') progress?.(info.progress);
        },
      });
    })();
    extractorPromise.catch(() => { extractorPromise = null; });
  }
  return extractorPromise;
}

async function embeddings(texts, progress) {
  if (!texts.length) return [];
  const model = await extractor(progress);
  const output = await model(texts, { pooling: 'mean', normalize: true });
  const width = output.dims.at(-1);
  return texts.map((_, i) => Array.from(output.data.subarray(i * width, (i + 1) * width)));
}

function cosine(a, b) {
  let score = 0;
  for (let i = 0; i < a.length; i++) score += a[i] * b[i];
  return score;
}

async function handle({ id, type, examples = [], texts = [], intents = [], margin = 0.035 }) {
  const progress = (value) => self.postMessage({ id, type: 'progress', progress: value });
  if (type === 'warm') {
    const missing = [...new Set(examples)].filter((example) => !exampleVectors.has(example));
    const vectors = await embeddings(missing, progress);
    missing.forEach((example, i) => exampleVectors.set(example, vectors[i]));
    self.postMessage({ id, type: 'done', result: true });
    return;
  }

  const allExamples = [...new Set(intents.flatMap((intent) => intent.examples))];
  const missing = allExamples.filter((example) => !exampleVectors.has(example));
  const vectors = await embeddings(missing, progress);
  missing.forEach((example, i) => exampleVectors.set(example, vectors[i]));
  const transcriptVectors = await embeddings(texts, progress);

  let best = null;
  let second = 0;
  for (const intent of intents) {
    let score = 0;
    let matchedExample = intent.examples[0];
    let matchedText = texts[0];
    for (let textIndex = 0; textIndex < texts.length; textIndex++) {
      const text = texts[textIndex];
      const transcriptVector = transcriptVectors[textIndex];
      for (const example of intent.examples) {
        const exampleVector = exampleVectors.get(example);
        const candidate = cosine(transcriptVector, exampleVector);
        if (candidate > score) {
          score = candidate;
          matchedExample = example;
          matchedText = text;
        }
      }
    }
    if (!best || score > best.score) {
      if (best) second = best.score;
      best = { id: intent.id, score, example: matchedExample, text: matchedText, threshold: intent.threshold ?? 0.48 };
    } else if (score > second) {
      second = score;
    }
  }

  const accepted = best && best.score >= best.threshold && (best.score - second >= margin || second === 0);
  self.postMessage({ id, type: 'done', result: accepted ? { ...best, second } : null });
}

self.onmessage = ({ data }) => {
  queue = queue.then(() => handle(data)).catch((error) => {
    self.postMessage({ id: data.id, type: 'error', message: error?.message || String(error) });
  });
};
