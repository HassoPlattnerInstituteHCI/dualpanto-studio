// Sound storage. Projects (scripts, levels) live in localStorage, which only holds a few MB
// of text. Audio files go into IndexedDB instead: it stores Blobs and has room for hundreds
// of megabytes. Metadata (name, type, size) is kept in the project so export/import and the
// UI know what belongs to a project even before the blobs are loaded.

const DB_NAME = 'dualpanto-studio';
const DB_VERSION = 2;
const STORE = 'assets';
const HANDLES = 'handles'; // folder handles (File System Access API) of recent projects

export const MAX_ASSET_BYTES = 25 * 1024 * 1024; // per file
export const ACCEPTED_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/flac'];

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB is not available in this browser.'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('projectId', 'projectId');
      }
      if (!db.objectStoreNames.contains(HANDLES)) db.createObjectStore(HANDLES, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn, storeName = STORE) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const store = t.objectStore(storeName);
        let result;
        try {
          result = fn(store);
        } catch (e) {
          reject(e);
          return;
        }
        // an empty get() has result.result === undefined – must not fall back to the request
        t.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

export const assetId = () => 'a' + Math.random().toString(36).slice(2, 10);

/** Metadata of one stored sound (what the project file remembers). */
const meta = (r) => ({ id: r.id, name: r.name, type: r.type, size: r.size, created: r.created });

export async function putAsset(projectId, file, { name } = {}) {
  if (file.size > MAX_ASSET_BYTES) {
    throw new Error(`"${file.name}" is ${formatBytes(file.size)}. Files can be at most ${formatBytes(MAX_ASSET_BYTES)}.`);
  }
  const record = {
    id: assetId(),
    projectId,
    name: name ?? file.name,
    type: file.type || guessType(file.name),
    size: file.size,
    created: Date.now(),
    blob: file instanceof Blob ? file : new Blob([file]),
  };
  await tx('readwrite', (store) => store.put(record));
  return meta(record);
}

export async function getAsset(id) {
  return tx('readonly', (store) => store.get(id));
}

export async function deleteAsset(id) {
  revokeUrl(id);
  return tx('readwrite', (store) => store.delete(id));
}

export async function listAssets(projectId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readonly');
    const req = t.objectStore(STORE).index('projectId').getAll(projectId);
    req.onsuccess = () => resolve(req.result.map(meta));
    req.onerror = () => reject(req.error);
  });
}

export async function deleteProjectAssets(projectId) {
  const list = await listAssets(projectId);
  await Promise.all(list.map((a) => deleteAsset(a.id)));
}

// ---- object URLs ----------------------------------------------------------

const urls = new Map();

/** Object URL for a stored sound; cached until revoked. */
export async function assetUrl(id) {
  if (urls.has(id)) return urls.get(id);
  const rec = await getAsset(id);
  if (!rec) return null;
  const url = URL.createObjectURL(rec.blob);
  urls.set(id, url);
  return url;
}

export function revokeUrl(id) {
  const url = urls.get(id);
  if (url) URL.revokeObjectURL(url);
  urls.delete(id);
}

/** { "klick.wav": "blob:…" } for every sound of the project – what scripts address by name. */
export async function assetUrlMap(project) {
  const map = {};
  for (const a of project.assets ?? []) {
    const url = await assetUrl(a.id);
    if (!url) continue;
    map[a.name] = url;
    map[a.id] = url;
    map[a.name.replace(/\.[^.]+$/, '')] = url; // name without extension
  }
  return map;
}

// ---- export / import ------------------------------------------------------

const toBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1] ?? '');
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });

export async function exportAssets(project) {
  const out = [];
  for (const a of project.assets ?? []) {
    const rec = await getAsset(a.id);
    if (!rec) continue;
    out.push({ ...meta(rec), data: await toBase64(rec.blob) });
  }
  return out;
}

export async function importAssets(projectId, assets = []) {
  const kept = [];
  for (const a of assets) {
    if (!a?.data) continue;
    const bytes = Uint8Array.from(atob(a.data), (c) => c.charCodeAt(0));
    const record = {
      id: assetId(),
      projectId,
      name: a.name ?? 'sound',
      type: a.type || guessType(a.name ?? ''),
      size: bytes.byteLength,
      created: Date.now(),
      blob: new Blob([bytes], { type: a.type || guessType(a.name ?? '') }),
    };
    await tx('readwrite', (store) => store.put(record));
    kept.push(meta(record));
  }
  return kept;
}

// ---- helpers --------------------------------------------------------------

export function guessType(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  return { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', webm: 'audio/webm' }[ext] ?? '';
}

export function isAudioFile(file) {
  return ACCEPTED_TYPES.includes(file.type) || !!guessType(file.name);
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** How much space the browser gives this site and how much is used. */
export async function storageInfo() {
  try {
    const { usage = 0, quota = 0 } = (await navigator.storage?.estimate?.()) ?? {};
    return { usage, quota };
  } catch {
    return { usage: 0, quota: 0 };
  }
}

// ---- folder handles (File System Access API) -------------------------------
// Directory handles can be stored in IndexedDB, so a project folder can be reopened
// later without picking it again (the browser still asks for permission once).

export async function rememberFolder(id, handle, name) {
  await tx('readwrite', (store) => store.put({ id, handle, name, opened: Date.now() }), HANDLES);
}

export async function forgetFolder(id) {
  await tx('readwrite', (store) => store.delete(id), HANDLES);
}

export async function recentFolders() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(HANDLES, 'readonly').objectStore(HANDLES).getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.opened - a.opened));
    req.onerror = () => reject(req.error);
  });
}
