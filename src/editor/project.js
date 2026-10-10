// Project model and persistence (browser localStorage + JSON import/export).

import { TEMPLATES } from './templates.js';
import { exportAssets, importAssets } from './assets.js';

const KEY_PROJECTS = 'dualpanto-web:projects';
const KEY_CURRENT = 'dualpanto-web:current';
export const FORMAT_VERSION = 1;

export const uid = (p = 'p') => p + Math.random().toString(36).slice(2, 10);

export function createProject(templateKey = 'hello') {
  const t = TEMPLATES.find((x) => x.key === templateKey) ?? TEMPLATES[0];
  const data = t.project();
  return normalize({ ...data, id: uid('p'), template: t.key, created: Date.now() });
}

/** Fills in missing fields so older/imported projects keep working. */
export function normalize(p) {
  const project = {
    version: FORMAT_VERSION,
    id: p.id ?? uid('p'),
    name: p.name ?? 'Unbenannt',
    script: p.script ?? '',
    levels: (p.levels ?? []).map((l) => ({
      id: l.id ?? uid('l'),
      name: l.name ?? 'Level',
      intro: l.intro ?? '',
      script: l.script ?? '',
      spawn: l.spawn ?? {},
      objects: (l.objects ?? []).map((o) => ({ id: o.id ?? uid('o'), ...o })),
    })),
    startLevel: p.startLevel ?? null,
    // sounds: metadata only, the audio data itself lives in IndexedDB (assets.js)
    assets: (p.assets ?? []).map((a) => ({ id: a.id, name: a.name, type: a.type ?? '', size: a.size ?? 0, created: a.created ?? Date.now() })),
    settings: { lang: 'de-DE', device: 'ember', boundary: false, ...(p.settings ?? {}) },
    // level id -> file name inside the project folder (only set for folder projects)
    folderSlugs: p.folderSlugs ?? {},
    created: p.created ?? Date.now(),
    updated: p.updated ?? Date.now(),
  };
  if (project.startLevel && !project.levels.some((l) => l.name === project.startLevel)) project.startLevel = null;
  return project;
}

export function loadAll() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY_PROJECTS) || '[]');
    return Array.isArray(list) ? list.map(normalize) : [];
  } catch {
    return [];
  }
}

export function saveAll(list) {
  try {
    localStorage.setItem(KEY_PROJECTS, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function getCurrentId() {
  try {
    return localStorage.getItem(KEY_CURRENT);
  } catch {
    return null;
  }
}

export function setCurrentId(id) {
  try {
    localStorage.setItem(KEY_CURRENT, id);
  } catch {}
}

/** Writes the project as JSON; uploaded sounds are embedded as base64. */
export async function exportProject(project) {
  const data = { ...project, assets: await exportAssets(project) };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (project.name || 'projekt').replace(/[^\w\-äöüÄÖÜß ]+/g, '').trim().replace(/\s+/g, '-') + '.dualpanto.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function importProjectFile(file) {
  const data = JSON.parse(await file.text());
  if (!data || typeof data !== 'object' || typeof data.script !== 'string') throw new Error('Keine gültige DualPanto-Projektdatei.');
  const id = uid('p');
  const assets = await importAssets(id, data.assets ?? []);
  return normalize({ ...data, id, assets });
}

/** Starter content for a new level script. */
export function levelScriptTemplate(name) {
  return `// Skript für Level „${name}“. Läuft jedes Mal, wenn das Level geladen wird.
// "level" ist dieses Level, z. B. level.zone("Ziel").
// Alles, was hier angelegt wird, räumt die Runtime beim Level-Wechsel wieder auf.

`;
}

export function uniqueLevelName(project, base = 'Level') {
  let i = project.levels.length + 1;
  let name = `${base} ${i}`;
  while (project.levels.some((l) => l.name === name)) name = `${base} ${++i}`;
  return name;
}
