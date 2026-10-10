// Projects as a folder on disk (File System Access API, Chrome/Edge — the same browsers
// that support Web Serial). A project is split into plain files so two people can work on
// it with git: different levels are different files, and a script conflict is a text conflict.
//
//   mein-spiel/
//   ├── projekt.json        name, settings, order of the levels
//   ├── main.js             main script
//   ├── levels/gang.json    objects, start positions, intro
//   ├── levels/gang.js      level script
//   ├── sounds/treffer.wav
//   └── README.md           written once, explains the layout
//
// Everything here takes a directory handle, so it can be tested with a fake handle.

import { normalize, uid } from './project.js';
import { getAsset, putAsset, listAssets, deleteAsset, revokeUrl } from './assets.js';

export const FOLDER_FORMAT = 2;
export const PROJECT_FILE = 'projekt.json';

export const supportsFolders = () => typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/** Asks the user for a folder. Must be called from a click. */
export async function pickFolder() {
  if (!supportsFolders()) throw new Error('Dieser Browser kann keine Ordner öffnen. Chrome oder Edge am Computer verwenden.');
  return window.showDirectoryPicker({ id: 'dualpanto-projects', mode: 'readwrite', startIn: 'documents' });
}

/** true if we may read/write; asks the user if necessary (needs a user gesture). */
export async function ensurePermission(handle, mode = 'readwrite') {
  if (!handle?.queryPermission) return true;
  if ((await handle.queryPermission({ mode })) === 'granted') return true;
  return (await handle.requestPermission({ mode })) === 'granted';
}

// ---------------------------------------------------------------------------
// helpers

export function slugify(name, taken = new Set()) {
  const map = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'ae', Ö: 'oe', Ü: 'ue', ß: 'ss' };
  let base = (name || 'level')
    .replace(/[äöüÄÖÜß]/g, (c) => map[c])
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'level';
  let slug = base;
  let i = 2;
  while (taken.has(slug)) slug = `${base}-${i++}`;
  taken.add(slug);
  return slug;
}

async function readText(dir, name) {
  try {
    const fh = await dir.getFileHandle(name);
    return await (await fh.getFile()).text();
  } catch {
    return null;
  }
}

async function writeFile(dir, name, data) {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}

/** Writes only if the content really differs – keeps git diffs and mtimes clean. */
async function writeTextIfChanged(dir, name, text) {
  const current = await readText(dir, name);
  if (current === text) return false;
  await writeFile(dir, name, text);
  return true;
}

async function listNames(dir) {
  const out = [];
  if (!dir) return out;
  for await (const [name, handle] of dir.entries()) if (handle.kind === 'file') out.push(name);
  return out;
}

async function subDir(dir, name, create = false) {
  try {
    return await dir.getDirectoryHandle(name, { create });
  } catch {
    return null;
  }
}

const json = (value) => JSON.stringify(value, null, 2) + '\n';

// ---------------------------------------------------------------------------
// reading

/**
 * Reads a project folder. Sounds are copied into IndexedDB so they can be played.
 * Returns a normalized project with `folderSlugs` (level id -> file name).
 */
export async function readProjectFromFolder(dir, { projectId } = {}) {
  const text = await readText(dir, PROJECT_FILE);
  if (text == null) throw new Error(`In diesem Ordner liegt keine ${PROJECT_FILE}. „Projekt in Ordner speichern“ legt eine an.`);
  let meta;
  try {
    meta = JSON.parse(text);
  } catch (e) {
    throw new Error(`${PROJECT_FILE} ist kein gültiges JSON: ${e.message}`);
  }
  const id = projectId ?? uid('p');
  const levelsDir = await subDir(dir, 'levels');
  const levels = [];
  const slugs = {};
  for (const slug of meta.levels ?? []) {
    const raw = levelsDir ? await readText(levelsDir, `${slug}.json`) : null;
    if (raw == null) continue;
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      throw new Error(`levels/${slug}.json ist kein gültiges JSON: ${e.message}`);
    }
    const level = {
      id: data.id ?? uid('l'),
      name: data.name ?? slug,
      intro: data.intro ?? '',
      spawn: data.spawn ?? {},
      objects: data.objects ?? [],
      script: (levelsDir ? await readText(levelsDir, `${slug}.js`) : '') ?? '',
    };
    levels.push(level);
    slugs[level.id] = slug;
  }

  // sounds: folder is the source of truth, import what is there
  const soundsDir = await subDir(dir, 'sounds');
  for (const a of await listAssets(id)) await deleteAsset(a.id);
  const assets = [];
  if (soundsDir) {
    for await (const [name, handle] of soundsDir.entries()) {
      if (handle.kind !== 'file') continue;
      const file = await handle.getFile();
      if (!file.size) continue;
      try {
        assets.push(await putAsset(id, file, { name }));
      } catch (e) {
        console.warn('Sound übersprungen:', name, e);
      }
    }
  }

  const project = normalize({
    id,
    name: meta.name ?? dir.name ?? 'Projekt',
    script: (await readText(dir, 'main.js')) ?? '',
    levels,
    startLevel: meta.startLevel ?? null,
    settings: meta.settings ?? {},
    assets,
    created: meta.created,
  });
  project.folderSlugs = slugs;
  return project;
}

// ---------------------------------------------------------------------------
// writing

const README = `# DualPanto-Projekt

Dieser Ordner wird vom DualPanto Studio gelesen und geschrieben.

| Datei | Inhalt |
| --- | --- |
| \`projekt.json\` | Name, Einstellungen, Reihenfolge der Level |
| \`main.js\` | Haupt-Skript: Intro, Spielstand, Level-Steuerung |
| \`levels/<name>.json\` | Objekte, Startpunkte und Intro eines Levels |
| \`levels/<name>.js\` | Skript dieses Levels |
| \`sounds/\` | hochgeladene MP3- und WAV-Dateien |

Der Ordner ist bewusst in einzelne Dateien aufgeteilt, damit zwei Leute
gleichzeitig daran arbeiten können: unterschiedliche Level sind
unterschiedliche Dateien, und ein Konflikt in einem Skript ist ein ganz
normaler Text-Konflikt in git.

Öffnen: im Studio auf „Projekte → Ordner öffnen“.
`;

/**
 * Writes the project into the folder. Returns which files were written or removed.
 * Files that did not change are left alone.
 */
export async function writeProjectToFolder(dir, project) {
  const written = [];
  const removed = [];
  const slugs = { ...(project.folderSlugs ?? {}) };
  const taken = new Set();
  const order = [];

  // level files
  const levelsDir = await subDir(dir, 'levels', true);
  for (const level of project.levels) {
    const wanted = slugify(level.name, new Set(taken));
    let slug = slugs[level.id] ?? wanted;
    if (slugs[level.id] && slug !== wanted && !taken.has(wanted)) {
      // the level was renamed: rename its files too
      await levelsDir.removeEntry(`${slug}.json`).catch(() => {});
      await levelsDir.removeEntry(`${slug}.js`).catch(() => {});
      removed.push(`levels/${slug}.json`, `levels/${slug}.js`);
      slug = wanted;
    }
    taken.add(slug);
    slugs[level.id] = slug;
    order.push(slug);
    const data = json({
      id: level.id,
      name: level.name,
      intro: level.intro ?? '',
      spawn: level.spawn ?? {},
      objects: level.objects ?? [],
    });
    if (await writeTextIfChanged(levelsDir, `${slug}.json`, data)) written.push(`levels/${slug}.json`);
    if (await writeTextIfChanged(levelsDir, `${slug}.js`, level.script ?? '')) written.push(`levels/${slug}.js`);
  }

  // level files of deleted levels
  for (const name of await listNames(levelsDir)) {
    const stem = name.replace(/\.(json|js)$/, '');
    if (!name.match(/\.(json|js)$/) || order.includes(stem)) continue;
    await levelsDir.removeEntry(name).catch(() => {});
    removed.push(`levels/${name}`);
  }

  // sounds
  const assets = project.assets ?? [];
  const soundsDir = assets.length ? await subDir(dir, 'sounds', true) : await subDir(dir, 'sounds');
  if (soundsDir) {
    const existing = await listNames(soundsDir);
    for (const a of assets) {
      const rec = await getAsset(a.id);
      if (!rec) continue;
      let same = false;
      if (existing.includes(a.name)) {
        const file = await (await soundsDir.getFileHandle(a.name)).getFile();
        same = file.size === rec.blob.size;
      }
      if (!same) {
        await writeFile(soundsDir, a.name, rec.blob);
        written.push(`sounds/${a.name}`);
      }
    }
    for (const name of existing) {
      if (assets.some((a) => a.name === name)) continue;
      await soundsDir.removeEntry(name).catch(() => {});
      removed.push(`sounds/${name}`);
    }
  }

  // main script and project file
  if (await writeTextIfChanged(dir, 'main.js', project.script ?? '')) written.push('main.js');
  const meta = json({
    formatVersion: FOLDER_FORMAT,
    name: project.name,
    startLevel: project.startLevel ?? null,
    settings: project.settings ?? {},
    levels: order,
    created: project.created ?? Date.now(),
  });
  if (await writeTextIfChanged(dir, PROJECT_FILE, meta)) written.push(PROJECT_FILE);
  if ((await readText(dir, 'README.md')) == null) {
    await writeFile(dir, 'README.md', README);
    written.push('README.md');
  }

  project.folderSlugs = slugs;
  return { written, removed, slugs };
}

// ---------------------------------------------------------------------------
// change detection (someone else edited the folder, e.g. after a git pull)

/** Fingerprint of all project files: path -> "mtime:size". */
export async function folderSnapshot(dir) {
  const snap = {};
  const add = async (prefix, d) => {
    if (!d) return;
    for await (const [name, handle] of d.entries()) {
      if (handle.kind !== 'file') continue;
      const f = await handle.getFile();
      snap[prefix + name] = `${f.lastModified}:${f.size}`;
    }
  };
  await add('', dir);
  await add('levels/', await subDir(dir, 'levels'));
  await add('sounds/', await subDir(dir, 'sounds'));
  return snap;
}

export function snapshotsDiffer(a, b) {
  if (!a || !b) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (k === 'README.md') continue;
    if (a[k] !== b[k]) return true;
  }
  return false;
}

/** Frees the blob URLs of a project's sounds (called before reloading from disk). */
export function releaseAssets(project) {
  for (const a of project.assets ?? []) revokeUrl(a.id);
}
