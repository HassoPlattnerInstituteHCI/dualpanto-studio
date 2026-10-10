// DualPanto Studio – app controller: wires project, editors, stage, devices and runtime.

import { Emulator } from './panto/emulator.js';
import { SerialDevice, DEVICE_PROFILES } from './panto/webserial.js';
import { Runtime } from './panto/runtime.js';
import { TEMPLATES } from './editor/templates.js';
import {
  createProject, normalize, loadAll, saveAll, getCurrentId, setCurrentId,
  exportProject, importProjectFile, uniqueLevelName, levelScriptTemplate, uid,
} from './editor/project.js';
import {
  listAssets, putAsset, deleteAsset, deleteProjectAssets, assetUrl, assetUrlMap,
  formatBytes, isAudioFile, storageInfo, rememberFolder, forgetFolder, recentFolders,
} from './editor/assets.js';
import {
  supportsFolders, pickFolder, ensurePermission, readProjectFromFolder, writeProjectToFolder,
  folderSnapshot, snapshotsDiffer, releaseAssets, PROJECT_FILE,
} from './editor/folder.js';
import { createCodeEditor } from './editor/code-editor.js';
import { LevelEditor, TOOLS } from './editor/level-editor.js';
import { Stage } from './editor/stage.js';
import { fitView, drawWorld } from './editor/renderer.js';
import { API_DTS, API_HTML } from './editor/api-docs.js';

/** Shown in the console at startup – makes it obvious when the browser serves an old copy. */
export const BUILD = '2026-10-10 · Zoom im Level-Editor, Ordner-Projekte, Sounds';

const $ = (sel, root = document) => root.querySelector(sel);
const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
};

const app = {
  projects: [],
  project: null,
  view: 'script', // 'script' (main script) or a level id
  subtab: 'level', // when a level is open: 'level' (editor) or 'script'
  emulator: null,
  serial: null,
  device: null,
  runtime: null,
  code: null,
  levelEditor: null,
  stage: null,
  showDeviceLog: false,
  folder: null, // { handle, name, snapshot, autoSave }
  folderDirty: false,
};

// ---------------------------------------------------------------------------
// scripts: "main" is the project script, "level:<id>" the script of one level

const fileKey = (level) => (level ? `level:${level.id}` : 'main');

function scriptOf(key) {
  if (key === 'main') return app.project.script;
  return app.project.levels.find((l) => `level:${l.id}` === key)?.script ?? '';
}

function setScript(key, value) {
  if (key === 'main') app.project.script = value;
  else {
    const level = app.project.levels.find((l) => `level:${l.id}` === key);
    if (level) level.script = value;
  }
}

/** Copies what is currently in the editor back into the project. */
function syncScripts() {
  if (!app.code) return;
  for (const key of ['main', ...app.project.levels.map((l) => `level:${l.id}`)]) {
    if (!app.code.has(key)) continue;
    const v = app.code.getValue(key);
    if (typeof v === 'string') setScript(key, v);
  }
}

function openScript(key) {
  app.code?.open(key, scriptOf(key));
}

// ---------------------------------------------------------------------------
// persistence

let saveTimer = null;
let folderTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  app.folderDirty = true;
  saveTimer = setTimeout(saveNow, 400);
  if (app.folder?.autoSave) {
    clearTimeout(folderTimer);
    folderTimer = setTimeout(() => saveToFolder({ silent: true }), 1200);
  }
  renderSaveState('saving');
}
function saveNow() {
  clearTimeout(saveTimer);
  if (!app.project) return;
  app.project.updated = Date.now();
  const i = app.projects.findIndex((p) => p.id === app.project.id);
  if (i >= 0) app.projects[i] = app.project;
  else app.projects.unshift(app.project);
  const ok = saveAll(app.projects);
  if (!ok) {
    $('#save-state').dataset.state = 'dirty';
    $('#save-state').textContent = 'Nicht gespeichert (Speicher voll?)';
    return;
  }
  renderSaveState();
}

/** Shows where the project is stored and whether everything is written. */
function renderSaveState(mode) {
  const el = $('#save-state');
  const hint = $('#storage-hint');
  if (hint) {
    hint.textContent = app.folder
      ? `Dieses Projekt liegt im Ordner „${app.folder.name}“. Änderungen werden dort gespeichert.`
      : 'Alles wird automatisch im Browser gespeichert. Unter „Projekte“ kannst du eine Datei exportieren.';
  }
  if (!app.folder) {
    el.dataset.state = '';
    el.textContent = mode === 'saving' ? 'Speichert …' : 'Im Browser gespeichert';
    el.title = 'Dieses Projekt liegt im Browser-Speicher. Unter „Projekte“ kannst du es in einen Ordner legen.';
    return;
  }
  const dirty = app.folderDirty;
  el.dataset.state = dirty ? 'dirty' : 'folder';
  el.textContent = `${app.folder.name}${dirty ? ' · ungespeichert' : ' · gespeichert'}`;
  el.title = dirty ? 'Noch nicht in den Ordner geschrieben (Strg/⌘ + S)' : 'Alle Dateien im Ordner sind aktuell.';
}

function openProject(project, { keepFolder = false } = {}) {
  stopRun();
  if (!keepFolder && app.folder) {
    clearInterval(app.folderWatch);
    app.folder = null;
    renderFolderUi();
  }
  app.project = normalize(project);
  app.project.folderSlugs = project.folderSlugs ?? {};
  if (!app.projects.some((p) => p.id === app.project.id)) app.projects.unshift(app.project);
  setCurrentId(app.project.id);
  $('#project-name').value = app.project.name;
  $('#opt-boundary').checked = !!app.project.settings.boundary;
  openScript('main');
  app.view = 'script';
  app.subtab = 'level';
  renderSidebar();
  showView();
  saveNow();
  clearConsole();
  if (!keepFolder) syncAssetList();
  else renderSounds();
  app.folderDirty = false;
  renderSaveState();
  log('info', `Projekt „${app.project.name}“ geöffnet.`);
}

// ---------------------------------------------------------------------------
// sidebar

function renderSidebar() {
  const p = app.project;
  const list = $('#level-list');
  list.replaceChildren();
  $('#nav-script').classList.toggle('active', app.view === 'script');
  $('#nav-script').setAttribute('aria-current', app.view === 'script' ? 'page' : 'false');
  const start = p.startLevel ?? p.levels[0]?.name;
  for (const level of p.levels) {
    const canvas = h('canvas', { class: 'thumb', 'aria-hidden': 'true' });
    const item = h(
      'li',
      { class: 'level-item' + (app.view === level.id ? ' active' : '') },
      h(
        'button',
        { class: 'level-open', onclick: () => selectView(level.id), 'aria-current': app.view === level.id ? 'page' : 'false' },
        canvas,
        h('span', { class: 'level-name' }, level.name),
        level.script?.trim() ? h('span', { class: 'level-script-badge', title: 'Dieses Level hat ein eigenes Skript' }, 'JS') : null,
        level.name === start ? h('span', { class: 'badge', title: 'Wird beim Start geladen' }, 'Start') : null
      ),
      h(
        'div',
        { class: 'level-actions' },
        h('button', { class: 'icon-btn', title: 'Duplizieren', 'aria-label': `${level.name} duplizieren`, onclick: () => duplicateLevel(level) }, iconCopy()),
        h('button', { class: 'icon-btn', title: 'Löschen', 'aria-label': `${level.name} löschen`, onclick: () => deleteLevel(level) }, iconTrash())
      )
    );
    list.append(item);
    requestAnimationFrame(() => drawThumb(canvas, level));
  }
  if (!p.levels.length) list.append(h('li', { class: 'empty' }, 'Noch keine Level. Apps brauchen nicht unbedingt eins.'));
}

function drawThumb(canvas, level) {
  const view = fitView(canvas, bounds(), 3);
  drawWorld(canvas.getContext('2d'), view, { objects: level.objects, spawn: null, areas: app.device?.profile?.areas }, { grid: false, labels: false });
}

function refreshThumbs() {
  const items = [...document.querySelectorAll('#level-list .thumb')];
  items.forEach((c, i) => app.project.levels[i] && drawThumb(c, app.project.levels[i]));
}

function selectView(v, subtab) {
  if (subtab) app.subtab = subtab;
  app.view = v;
  renderSidebar();
  showView();
}

function selectSubtab(sub) {
  app.subtab = sub;
  for (const b of document.querySelectorAll('.subtab')) {
    const on = b.dataset.sub === sub;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  }
  showView();
}

function currentLevel() {
  return app.project.levels.find((l) => l.id === app.view) ?? null;
}

function showView() {
  const level = currentLevel();
  const showCode = !level || app.subtab === 'script';
  $('#view-script').hidden = !showCode;
  $('#view-level').hidden = !(level && app.subtab === 'level');
  $('#center-title').textContent = level ? `Level: ${level.name}` : 'Haupt-Skript';
  $('#level-tabs').hidden = !level;
  $('#level-opts').hidden = !(level && app.subtab === 'level');
  $('#script-hint').hidden = !showCode;
  for (const b of document.querySelectorAll('.subtab')) {
    const on = b.dataset.sub === app.subtab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  }
  if (level && app.subtab === 'level') {
    app.levelEditor.setLevel(level);
    renderProps(null);
    requestAnimationFrame(() => app.levelEditor.draw());
  } else {
    openScript(fileKey(level));
    requestAnimationFrame(() => app.code?.layout());
  }
}

function addLevel() {
  const name = uniqueLevelName(app.project);
  const level = { id: uid('l'), name, intro: '', spawn: {}, objects: [], script: levelScriptTemplate(name) };
  app.project.levels.push(level);
  scheduleSave();
  selectView(level.id);
}

function duplicateLevel(level) {
  const copy = JSON.parse(JSON.stringify(level));
  copy.id = uid('l');
  copy.name = uniqueLevelName(app.project, level.name + ' Kopie');
  copy.objects.forEach((o) => (o.id = uid('o')));
  app.project.levels.splice(app.project.levels.indexOf(level) + 1, 0, copy);
  scheduleSave();
  selectView(copy.id);
}

function deleteLevel(level) {
  if (!confirm(`Level „${level.name}“ löschen?`)) return;
  app.project.levels = app.project.levels.filter((l) => l !== level);
  app.code?.forget(fileKey(level));
  if (app.project.startLevel === level.name) app.project.startLevel = null;
  scheduleSave();
  selectView(app.view === level.id ? 'script' : app.view);
}

// ---------------------------------------------------------------------------
// project folder (File System Access API, see editor/folder.js)

async function connectFolder(handle, { read = true } = {}) {
  if (!(await ensurePermission(handle))) {
    log('warn', 'Ohne Schreibrechte für den Ordner geht es nicht.');
    return false;
  }
  if (read) {
    const project = await readProjectFromFolder(handle);
    stopRun();
    releaseAssets(app.project);
    openProject(project, { keepFolder: true });
  }
  app.folder = { handle, name: handle.name, autoSave: true, snapshot: await folderSnapshot(handle) };
  app.folderDirty = false;
  await rememberFolder(app.project.id, handle, handle.name).catch((e) => {
    log('warn', 'Ordner konnte nicht für später gemerkt werden: ' + e.message);
  });
  renderSaveState();
  renderFolderUi();
  startFolderWatch();
  log('info', `Ordner „${handle.name}“ verbunden. Änderungen werden automatisch hineingeschrieben.`);
  return true;
}

async function openFolder(handle) {
  try {
    const dir = handle ?? (await pickFolder());
    if (!(await ensurePermission(dir))) return log('warn', 'Zugriff auf den Ordner wurde nicht erlaubt.');
    let hasProject = true;
    try {
      await dir.getFileHandle(PROJECT_FILE);
    } catch {
      hasProject = false;
    }
    if (hasProject) return void (await connectFolder(dir));
    if (!confirm(`In „${dir.name}“ liegt noch kein Projekt.\n\nSoll „${app.project.name}“ dort gespeichert werden?`)) return;
    await connectFolder(dir, { read: false });
    await saveToFolder();
  } catch (e) {
    if (e.name === 'AbortError') return;
    log('error', 'Ordner konnte nicht geöffnet werden: ' + e.message);
  }
}

async function saveAsFolder() {
  try {
    const dir = await pickFolder();
    if (!(await ensurePermission(dir))) return log('warn', 'Zugriff auf den Ordner wurde nicht erlaubt.');
    await connectFolder(dir, { read: false });
    await saveToFolder();
  } catch (e) {
    if (e.name === 'AbortError') return;
    log('error', 'Speichern nicht möglich: ' + e.message);
  }
}

async function saveToFolder({ silent = false } = {}) {
  if (!app.folder) return saveNow();
  clearTimeout(folderTimer);
  syncScripts();
  saveNow();
  try {
    const { written, removed } = await writeProjectToFolder(app.folder.handle, app.project);
    app.folder.snapshot = await folderSnapshot(app.folder.handle);
    app.folderDirty = false;
    renderSaveState();
    if (!silent) {
      const parts = [];
      if (written.length) parts.push(`${written.length} Datei${written.length > 1 ? 'en' : ''} geschrieben`);
      if (removed.length) parts.push(`${removed.length} gelöscht`);
      log('info', `Ordner „${app.folder.name}“: ${parts.join(', ') || 'nichts geändert'}.`);
    }
  } catch (e) {
    log('error', 'Schreiben in den Ordner fehlgeschlagen: ' + e.message);
  }
}

async function reloadFromFolder({ auto = false } = {}) {
  if (!app.folder) return;
  try {
    const project = await readProjectFromFolder(app.folder.handle, { projectId: app.project.id });
    stopRun();
    releaseAssets(app.project);
    openProject(project, { keepFolder: true });
    app.folder.snapshot = await folderSnapshot(app.folder.handle);
    app.folderDirty = false;
    renderSaveState();
    log('info', auto ? `Ordner „${app.folder.name}“ wurde außerhalb geändert – neu geladen.` : 'Projekt aus dem Ordner neu geladen.');
  } catch (e) {
    log('error', 'Neu laden fehlgeschlagen: ' + e.message);
  }
}

function disconnectFolder() {
  if (!app.folder) return;
  const name = app.folder.name;
  forgetFolder(app.project.id).catch(() => {});
  app.folder = null;
  clearInterval(app.folderWatch);
  app.folderWatch = null;
  renderSaveState();
  renderFolderUi();
  log('info', `Ordner „${name}“ getrennt. Das Projekt liegt weiter im Browser-Speicher.`);
}

/** Notices when someone else (git pull, der andere Rechner) changed the files. */
function startFolderWatch() {
  clearInterval(app.folderWatch);
  app.folderWatch = setInterval(async () => {
    if (!app.folder || document.visibilityState !== 'visible') return;
    try {
      const snap = await folderSnapshot(app.folder.handle);
      if (!snapshotsDiffer(app.folder.snapshot, snap)) return;
      app.folder.snapshot = snap;
      if (app.folderDirty || app.runtime?.running) {
        log('warn', 'Der Ordner wurde außerhalb geändert. „Projekte → Vom Ordner neu laden“ holt den Stand, überschreibt aber deine ungespeicherten Änderungen.');
        return;
      }
      await reloadFromFolder({ auto: true });
    } catch {
      // folder gone (unmounted, deleted) – stop watching quietly
      clearInterval(app.folderWatch);
    }
  }, 4000);
}

function renderFolderUi() {
  $('#btn-reload-folder').hidden = !app.folder;
  $('#btn-close-folder').hidden = !app.folder;
}

async function renderFolderList() {
  const list = $('#folder-list');
  list.replaceChildren();
  if (!supportsFolders()) {
    list.append(h('li', { class: 'empty muted small' }, 'Dieser Browser unterstützt keine Ordner. Chrome oder Edge am Computer verwenden.'));
    $('#btn-open-folder').disabled = true;
    $('#btn-save-folder').disabled = true;
    return;
  }
  const recent = await recentFolders().catch(() => []);
  for (const entry of recent.slice(0, 5)) {
    const current = app.folder?.handle === entry.handle;
    list.append(
      h('li', { class: 'project-row folder-row' + (current ? ' current' : '') },
        h('button', { class: 'project-open', onclick: () => { $('#dlg-open').close(); openFolder(entry.handle); } },
          h('strong', {}, entry.name),
          h('span', { class: 'muted' }, `Ordner · zuletzt ${new Date(entry.opened).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`)),
        current ? h('span', { class: 'badge' }, 'offen') : h('button', { class: 'icon-btn', title: 'Aus der Liste entfernen', onclick: async () => { await forgetFolder(entry.id); renderFolderList(); } }, iconTrash()))
    );
  }
}

// ---------------------------------------------------------------------------
// sounds (stored in IndexedDB, see editor/assets.js)

function soundSnippet(name) {
  return `sound.play(${JSON.stringify(name)});`;
}

function renderSounds() {
  const list = $('#sound-list');
  list.replaceChildren();
  const assets = app.project.assets ?? [];
  if (!assets.length) {
    list.append(h('li', { class: 'empty' }, 'MP3 oder WAV hierher ziehen oder ＋ drücken.'));
  }
  for (const a of assets) {
    const playing = app.preview?.id === a.id;
    const item = h(
      'li',
      { class: 'sound-item' },
      h('button', {
        class: 'icon-btn', title: playing ? 'Stopp' : 'Anhören', 'aria-label': `${a.name} ${playing ? 'stoppen' : 'anhören'}`,
        onclick: () => togglePreview(a),
      }, playing ? '■' : '▶'),
      h('button', {
        class: 'sound-meta', title: `${a.name} – klicken fügt sound.play("${a.name}") ins Skript ein`,
        onclick: () => insertSnippet(soundSnippet(a.name)),
      }, h('span', { class: 'sound-name' }, a.name), h('span', { class: 'sound-size' }, formatBytes(a.size))),
      h('div', { class: 'sound-actions' },
        h('button', { class: 'icon-btn', title: 'Löschen', 'aria-label': `${a.name} löschen`, onclick: () => removeSound(a) }, iconTrash()))
    );
    list.append(item);
  }
  updateStorageInfo();
}

function togglePreview(a) {
  if (app.preview?.id === a.id) {
    app.preview.audio.pause();
    app.preview = null;
    renderSounds();
    return;
  }
  app.preview?.audio.pause();
  assetUrl(a.id).then((url) => {
    if (!url) return log('error', `„${a.name}“ ist nicht mehr gespeichert.`);
    const audio = new Audio(url);
    audio.onended = () => {
      if (app.preview?.id === a.id) app.preview = null;
      renderSounds();
    };
    audio.play().catch((e) => log('warn', 'Abspielen nicht möglich: ' + e.message));
    app.preview = { id: a.id, audio };
    renderSounds();
  });
}

/** Puts a snippet into whichever script is open. */
function insertSnippet(snippet) {
  const level = currentLevel();
  if (level && app.subtab === 'script') return appendToLevelScript(snippet);
  if (level) return appendToLevelScript(snippet);
  syncScripts();
  const base = (app.project.script ?? '').replace(/\s*$/, '');
  app.project.script = (base ? base + '\n\n' : '') + snippet + '\n';
  app.code?.setValue('main', app.project.script);
  scheduleSave();
  selectView('script');
  app.code?.revealLine(app.project.script.split('\n').length - 1);
}

async function addSounds(files) {
  const list = [...files];
  if (!list.length) return;
  for (const file of list) {
    if (!isAudioFile(file)) {
      log('warn', `„${file.name}“ ist keine Audiodatei – übersprungen.`);
      continue;
    }
    let name = file.name;
    const taken = new Set((app.project.assets ?? []).map((a) => a.name));
    if (taken.has(name)) {
      const dot = name.lastIndexOf('.');
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const ext = dot > 0 ? name.slice(dot) : '';
      let i = 2;
      while (taken.has(`${stem}-${i}${ext}`)) i++;
      name = `${stem}-${i}${ext}`;
      log('info', `Name schon vergeben, gespeichert als „${name}“.`);
    }
    try {
      const meta = await putAsset(app.project.id, file, { name });
      app.project.assets = [...(app.project.assets ?? []), meta];
      log('info', `Sound „${meta.name}“ gespeichert (${formatBytes(meta.size)}). Abspielen mit sound.play("${meta.name}").`);
    } catch (e) {
      log('error', 'Speichern fehlgeschlagen: ' + e.message);
    }
  }
  saveNow();
  renderSounds();
}

async function removeSound(a) {
  if (!confirm(`Sound „${a.name}“ löschen?`)) return;
  if (app.preview?.id === a.id) {
    app.preview.audio.pause();
    app.preview = null;
  }
  await deleteAsset(a.id);
  app.project.assets = (app.project.assets ?? []).filter((x) => x.id !== a.id);
  saveNow();
  renderSounds();
  log('info', `Sound „${a.name}“ gelöscht.`);
}

async function updateStorageInfo() {
  const assets = app.project.assets ?? [];
  const own = assets.reduce((n, a) => n + (a.size ?? 0), 0);
  const { usage, quota } = await storageInfo();
  const parts = [];
  if (assets.length) parts.push(`${assets.length} Sound${assets.length > 1 ? 's' : ''}, ${formatBytes(own)}`);
  if (quota) parts.push(`Browser-Speicher: ${formatBytes(usage)} von ${formatBytes(quota)}`);
  $('#storage-info').textContent = parts.join(' · ');
}

/** Sounds of the project may be missing after an import or a cleared database. */
async function syncAssetList() {
  try {
    const stored = await listAssets(app.project.id);
    const byId = new Map(stored.map((a) => [a.id, a]));
    const before = (app.project.assets ?? []).length;
    app.project.assets = (app.project.assets ?? []).filter((a) => byId.has(a.id)).map((a) => byId.get(a.id));
    for (const a of stored) if (!app.project.assets.some((x) => x.id === a.id)) app.project.assets.push(a);
    if (before !== app.project.assets.length) saveNow();
  } catch (e) {
    log('warn', 'Sound-Speicher nicht verfügbar: ' + e.message);
  }
  renderSounds();
}

// ---------------------------------------------------------------------------
// level properties panel

function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'field-hint' }, hint) : null);
}

function renameInScript(oldName, newName) {
  if (!oldName || oldName === newName) return;
  syncScripts();
  const swap = (text) => text.split(`"${oldName}"`).join(`"${newName}"`).split(`'${oldName}'`).join(`'${newName}'`);
  let touched = 0;
  for (const key of ['main', ...app.project.levels.map((l) => `level:${l.id}`)]) {
    const before = scriptOf(key);
    const after = swap(before);
    if (after === before) continue;
    setScript(key, after);
    app.code?.setValue(key, after);
    touched++;
  }
  if (touched) log('info', `„${oldName}“ in „${newName}“ umbenannt (${touched} Skript${touched > 1 ? 'e' : ''} angepasst).`);
}

function snippetFor(obj) {
  if (!obj.name) return null;
  const name = JSON.stringify(obj.name);
  if (obj.type === 'zone') {
    return `level.zone(${name}).onEnter(() => {\n  speak("Hier bist du richtig!");\n});`;
  }
  return `const obj = level.object(${name});\nobj.disable(); // z. B. eine Tür öffnen`;
}

/** Appends a snippet to the current level's script and opens it. */
function appendToLevelScript(snippet) {
  const level = currentLevel();
  if (!level) return;
  syncScripts();
  const base = (level.script ?? '').replace(/\s*$/, '');
  level.script = (base ? base + '\n\n' : '') + snippet + '\n';
  app.code?.setValue(fileKey(level), level.script);
  scheduleSave();
  selectView(level.id, 'script');
  app.code?.revealLine(level.script.split('\n').length - 1);
  renderSidebar();
}

function renderProps(obj) {
  const panel = $('#props');
  panel.replaceChildren();
  const ed = app.levelEditor;
  const level = currentLevel();
  if (!level) return;

  if (!obj) {
    const name = h('input', { type: 'text', value: level.name });
    name.addEventListener('change', () => {
      const v = name.value.trim();
      if (!v || app.project.levels.some((l) => l !== level && l.name === v)) {
        name.value = level.name;
        return log('warn', 'Level-Namen müssen eindeutig und nicht leer sein.');
      }
      if (app.project.startLevel === level.name) app.project.startLevel = v;
      renameInScript(level.name, v);
      level.name = v;
      scheduleSave();
      renderSidebar();
      $('#center-title').textContent = `Level: ${v}`;
    });
    const intro = h('textarea', { rows: 3, placeholder: 'z. B. „Level 1. Finde den Ausgang.“' });
    intro.value = level.intro ?? '';
    intro.addEventListener('input', () => {
      level.intro = intro.value;
      scheduleSave();
    });
    const isStart = (app.project.startLevel ?? app.project.levels[0]?.name) === level.name;
    const start = h('input', { type: 'checkbox', checked: isStart });
    start.addEventListener('change', () => {
      app.project.startLevel = start.checked ? level.name : null;
      scheduleSave();
      renderSidebar();
    });
    const sp = level.spawn ?? {};
    const spawnInfo = (k) =>
      sp[k]
        ? h('span', { class: 'spawn-row' }, `${Math.round(sp[k].x)}, ${Math.round(sp[k].y)} mm `,
          h('button', { class: 'link-btn', onclick: () => { ed.snapshot(); delete level.spawn[k]; ed.changed(); renderProps(null); } }, 'entfernen'))
        : h('span', { class: 'muted' }, 'nicht gesetzt – Werkzeug „Start ' + (k === 'me' ? 'Me' : 'It') + '“');
    panel.append(
      h('h3', {}, 'Level'),
      field('Name', name, 'Mit diesem Namen lädst du das Level im Skript.'),
      field('Beim Laden sagen', intro),
      h('label', { class: 'check' }, start, 'Beim Programmstart laden'),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Start Me'), spawnInfo('me')),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Start It'), spawnInfo('it')),
      h('button', { class: 'btn btn-secondary full', onclick: () => run({ startLevel: level.name }) }, '▶ Dieses Level testen'),
      h('p', { class: 'muted small' }, `${level.objects.length} Objekte. Wähle ein Objekt aus, um es zu bearbeiten.`)
    );
    return;
  }

  const typeLabel = { wall: 'Wand', rail: 'Schiene', zone: 'Zone' }[obj.type];
  const nameIn = h('input', { type: 'text', value: obj.name ?? '', placeholder: obj.type === 'zone' ? 'z. B. Ziel' : 'optional, z. B. Tür' });
  let before = obj.name;
  nameIn.addEventListener('input', () => ed.update(obj, { name: nameIn.value }, { history: false }));
  nameIn.addEventListener('focus', () => {
    before = obj.name;
    ed.snapshot();
  });
  nameIn.addEventListener('change', () => {
    renameInScript(before, nameIn.value);
    before = nameIn.value;
  });
  panel.append(h('h3', {}, typeLabel), field('Name', nameIn, 'Über den Namen findest du das Objekt im Skript.'));

  const check = (label, key, hint) => {
    const c = h('input', { type: 'checkbox', checked: key === 'enabled' ? obj[key] !== false : !!obj[key] });
    c.addEventListener('change', () => ed.update(obj, { [key]: c.checked }));
    return h('label', { class: 'check', title: hint ?? '' }, c, label);
  };
  const select = (label, key, options, def) => {
    const s = h('select', {}, options.map(([v, l]) => h('option', { value: v, selected: (obj[key] ?? def) === v }, l)));
    s.addEventListener('change', () => ed.update(obj, { [key]: s.value }));
    return field(label, s);
  };

  if (obj.type === 'wall') {
    panel.append(
      check('Geschlossene Form', 'closed'),
      check('Durchlässig (mit Kraft überwindbar)', 'passable'),
      check('Beim Start aktiv', 'enabled'),
      select('Gilt für', 'handles', [['both', 'Beide Griffe'], ['me', 'Nur Me'], ['it', 'Nur It']], 'both')
    );
  } else if (obj.type === 'rail') {
    const r = h('input', { type: 'range', min: 2, max: 20, step: 1, value: obj.strength ?? 6 });
    const out = h('output', {}, `${obj.strength ?? 6} mm`);
    r.addEventListener('pointerdown', () => ed.snapshot());
    r.addEventListener('input', () => {
      out.textContent = `${r.value} mm`;
      ed.update(obj, { strength: +r.value }, { history: false });
    });
    panel.append(
      field('Stärke (Fangbreite)', h('div', { class: 'range-row' }, r, out), 'Wie weit man sich von der Schiene entfernen muss, um sie zu verlassen.'),
      check('Beim Start aktiv', 'enabled'),
      select('Gilt für', 'handles', [['both', 'Beide Griffe'], ['me', 'Nur Me'], ['it', 'Nur It']], 'both')
    );
  } else if (obj.type === 'zone') {
    const say = h('textarea', { rows: 2, placeholder: 'Optional, z. B. „Du bist am Ziel.“' });
    say.value = obj.speak ?? '';
    say.addEventListener('focus', () => ed.snapshot());
    say.addEventListener('input', () => ed.update(obj, { speak: say.value }, { history: false }));
    panel.append(
      field('Beim Betreten sagen', say),
      select('Reagiert auf', 'handle', [['me', 'Me-Griff'], ['it', 'It-Griff'], ['both', 'Beide']], 'me'),
      check('Beim Start aktiv', 'enabled')
    );
  }

  const snippet = snippetFor(obj);
  panel.append(
    snippet == null
      ? h('p', { class: 'muted small' }, 'Gib dem Objekt einen Namen, um es im Skript anzusprechen.')
      : h('div', { class: 'snippet' },
      h('div', { class: 'snippet-head' }, h('span', {}, 'Im Level-Skript'),
        h('span', { class: 'snippet-actions' },
          h('button', { class: 'link-btn', onclick: () => appendToLevelScript(snippet) }, 'Einfügen'),
          h('button', {
            class: 'link-btn',
            onclick: (e) => {
              navigator.clipboard?.writeText(snippet);
              e.target.textContent = 'Kopiert';
              setTimeout(() => (e.target.textContent = 'Kopieren'), 1200);
            },
          }, 'Kopieren'))),
      h('pre', {}, snippet)),
    h('button', { class: 'btn btn-danger full', onclick: () => ed.deleteSelected() }, 'Objekt löschen')
  );
}

// ---------------------------------------------------------------------------
// console

function clearConsole() {
  $('#console-list').replaceChildren();
}

function log(level, text, line, source) {
  if (level === 'device' && !app.showDeviceLog) return;
  const list = $('#console-list');
  const icon = { error: '✕', warn: '!', speech: '🔊', device: '⌁', info: '›', log: '›' }[level] ?? '›';
  const row = h('li', { class: `log log-${level}` }, h('span', { class: 'log-icon', 'aria-hidden': 'true' }, icon), h('span', { class: 'log-text' }, text));
  if (line || source) {
    const key = source?.levelId ? `level:${source.levelId}` : 'main';
    const where = source && source.id !== 'main' ? ` in ${source.label}` : '';
    const open = () => {
      if (source?.levelId) selectView(source.levelId, 'script');
      else selectView('script');
      if (line) app.code?.revealLine(line);
    };
    row.append(h('button', { class: 'link-btn log-line', onclick: open }, line ? `Zeile ${line}${where}` : `öffnen${where}`));
    if (line) app.code?.markError(key, line, text);
  }
  list.append(row);
  while (list.children.length > 400) list.firstChild.remove();
  list.scrollTop = list.scrollHeight;
  if (level === 'error') selectTab('console');
}

function selectTab(tab) {
  for (const b of document.querySelectorAll('.tab')) {
    const on = b.dataset.tab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  }
  $('#tab-console').hidden = tab !== 'console';
  $('#tab-api').hidden = tab !== 'api';
}

// ---------------------------------------------------------------------------
// devices

function bounds() {
  return app.device?.bounds ?? DEVICE_PROFILES.ember;
}

function attachDevice(device) {
  app.device = device;
  device.on('position', (hs) => app.stage.setPositions(hs));
  updateDeviceUi();
}

function updateDeviceUi() {
  const serial = app.device?.kind === 'serial';
  const pill = $('#device-status');
  pill.dataset.state = serial ? (app.device.connected ? 'connected' : 'waiting') : 'emulator';
  pill.textContent = serial ? (app.device.connected ? 'DualPanto verbunden' : 'Verbinde …') : 'Emulator';
  $('#btn-connect').textContent = serial ? 'Trennen' : 'Gerät verbinden';
  $('#stage-hint').hidden = serial;
}

async function toggleDevice() {
  if (app.device?.kind === 'serial') {
    stopRun();
    await app.serial.disconnect();
    app.serial = null;
    app.emulator.start();
    attachDevice(app.emulator);
    log('info', 'Getrennt. Emulator aktiv.');
    return;
  }
  if (!SerialDevice.isSupported()) {
    log('warn', 'Dieser Browser unterstützt Web Serial nicht. Bitte Chrome oder Edge am Computer verwenden.');
    return;
  }
  stopRun();
  const serial = new SerialDevice({ profile: DEVICE_PROFILES[app.project.settings.device] ?? DEVICE_PROFILES.ember, resetOnConnect: $('#opt-reset').checked });
  serial.verbose = app.showDeviceLog;
  serial.on('log', (e) => log(e.level, e.text));
  serial.on('status', () => updateDeviceUi());
  try {
    $('#device-status').dataset.state = 'waiting';
    $('#device-status').textContent = 'Verbinde …';
    const p = serial.connect();
    app.serial = serial;
    await p;
    app.emulator.stop();
    attachDevice(serial);
  } catch (e) {
    if (e.name !== 'NotFoundError') log('error', e.message);
    try { await serial.disconnect(); } catch {}
    app.serial = null;
    updateDeviceUi();
  }
}

// ---------------------------------------------------------------------------
// run / stop

let captionTimer = null;

const SELFTEST_SCRIPT = `// Selbsttest: eine einzelne Wand quer durch die Mitte des Me-Bereichs.
speak("Selbsttest. Eine Wand liegt quer in der Mitte. Fahre langsam von unten nach oben.");
const wand = panto.wall([[130, 105], [260, 105]], { name: "Testwand", persistent: true });
log("Testwand angelegt, Geräte-ID " + wand.id);
me.onMove((p) => {
  if (!state.oben && p.y < 100) { state.oben = true; sound.tick(); log("über der Wand: " + Math.round(p.y) + " mm"); }
  if (state.oben && p.y > 112) state.oben = false;
});
`;

async function run({ startLevel, project: override } = {}) {
  stopRun();
  syncScripts();
  saveNow();
  app.code?.clearErrors();
  const project = override ?? JSON.parse(JSON.stringify(app.project));
  if (startLevel) project.startLevel = startLevel;
  project.assetUrls = await assetUrlMap(app.project); // name -> blob URL
  const rt = new Runtime({ device: app.device, project });
  app.runtime = rt;
  rt.on('log', (e) => log(e.level, e.text, e.line, e.source));
  rt.on('speech', (text) => {
    clearTimeout(captionTimer);
    captionTimer = setTimeout(() => (rt.caption = ''), Math.max(2500, text.length * 75));
  });
  rt.on('stopped', () => updateRunUi());
  const started = rt.start();
  updateRunUi();
  $('#stage').focus();
  await started;
}

function stopRun() {
  app.runtime?.stop();
  app.runtime = null;
  updateRunUi();
}

function updateRunUi() {
  const running = !!app.runtime?.running;
  $('#btn-run').hidden = running;
  $('#btn-stop').hidden = !running;
  $('#btn-restart').hidden = !running;
  document.body.classList.toggle('is-running', running);
}

// ---------------------------------------------------------------------------
// dialogs

function openNewDialog() {
  const dlg = $('#dlg-new');
  const grid = $('#template-grid');
  grid.replaceChildren(
    ...TEMPLATES.map((t) =>
      h('button', {
        class: 'template-card',
        onclick: () => {
          dlg.close();
          openProject(createProject(t.key));
        },
      }, h('strong', {}, t.title), h('span', {}, t.description))
    )
  );
  dlg.showModal();
}

function openProjectsDialog() {
  renderFolderList();
  const dlg = $('#dlg-open');
  const list = $('#project-list');
  const render = () => {
    list.replaceChildren(
      ...app.projects.map((p) =>
        h('li', { class: 'project-row' + (p.id === app.project.id ? ' current' : '') },
          h('button', { class: 'project-open', onclick: () => { dlg.close(); openProject(p); } },
            h('strong', {}, p.name), h('span', { class: 'muted' }, `${p.levels.length} Level · geändert ${new Date(p.updated).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`)),
          p.id === app.project.id ? h('span', { class: 'badge' }, 'offen') :
            h('button', {
              class: 'icon-btn', title: 'Löschen', 'aria-label': `${p.name} löschen`,
              onclick: async () => {
                if (!confirm(`Projekt „${p.name}“ endgültig löschen?`)) return;
                app.projects = app.projects.filter((x) => x !== p);
                saveAll(app.projects);
                await deleteProjectAssets(p.id).catch(() => {});
                render();
              },
            }, iconTrash()))
      )
    );
  };
  render();
  dlg.showModal();
}

// ---------------------------------------------------------------------------
// icons

function svg(path) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('width', '16');
  el.setAttribute('height', '16');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = path;
  return el;
}
const iconTrash = () => svg('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>');
const iconCopy = () => svg('<rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" fill="none" stroke="currentColor" stroke-width="1.8"/>');

// ---------------------------------------------------------------------------
// init

async function init() {
  app.projects = loadAll();
  const current = app.projects.find((p) => p.id === getCurrentId()) ?? app.projects[0];
  app.project = current ?? createProject('hello');
  if (!current) app.projects.unshift(app.project);
  setCurrentId(app.project.id);

  // devices
  app.emulator = new Emulator({ profile: DEVICE_PROFILES[app.project.settings.device] ?? DEVICE_PROFILES.ember });
  app.stage = new Stage({
    canvas: $('#stage'),
    getDevice: () => app.device,
    getRuntime: () => app.runtime,
    getPreviewLevel: () => currentLevel() ?? app.project.levels.find((l) => l.name === (app.project.startLevel ?? app.project.levels[0]?.name)),
  });
  app.emulator.start();
  attachDevice(app.emulator);

  // level editor
  const toolbar = $('#tools');
  for (const t of TOOLS) {
    toolbar.append(h('button', {
      class: 'tool' + (t.key === 'select' ? ' active' : ''),
      'data-tool': t.key,
      title: `${t.hint}${t.shortcut ? ` (${t.shortcut})` : ''}`,
      'aria-pressed': t.key === 'select' ? 'true' : 'false',
      onclick: () => setTool(t.key),
    }, t.label));
  }
  const setTool = (key) => {
    app.levelEditor.setTool(key);
    for (const b of toolbar.querySelectorAll('.tool')) {
      const on = b.dataset.tool === key;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    }
    $('#tool-hint').textContent = TOOLS.find((t) => t.key === key).hint;
  };
  app.levelEditor = new LevelEditor({
    canvas: $('#level-canvas'),
    bounds: bounds(),
    areas: app.device?.profile?.areas,
    onChange: (info) => {
      scheduleSave();
      if (!info?.live) {
        refreshThumbs();
        if (!app.levelEditor.selected) renderProps(null);
      }
    },
    onSelect: (obj) => renderProps(obj),
  });
  app.levelEditor.onToolShortcut = setTool;
  app.levelEditor.onViewChange = (zoom) => {
    $('#btn-zoom-level').textContent = `${Math.round(zoom * 100)} %`;
  };
  $('#btn-zoom-in').addEventListener('click', () => app.levelEditor.zoomBy(1.25));
  $('#btn-zoom-out').addEventListener('click', () => app.levelEditor.zoomBy(1 / 1.25));
  $('#btn-zoom-level').addEventListener('click', () => app.levelEditor.resetView());
  $('#btn-zoom-fit').addEventListener('click', () => app.levelEditor.zoomToFit());
  $('#tool-hint').textContent = TOOLS[0].hint;
  $('#opt-snap').addEventListener('change', (e) => (app.levelEditor.snap = e.target.checked));
  $('#btn-undo').addEventListener('click', () => app.levelEditor.undo());
  $('#btn-redo').addEventListener('click', () => app.levelEditor.redo());

  // top bar
  $('#project-name').value = app.project.name;
  $('#project-name').addEventListener('input', (e) => {
    app.project.name = e.target.value || 'Unbenannt';
    scheduleSave();
  });
  $('#btn-new').addEventListener('click', openNewDialog);
  $('#btn-open-folder').addEventListener('click', () => {
    $('#dlg-open').close();
    openFolder();
  });
  $('#btn-save-folder').addEventListener('click', () => {
    $('#dlg-open').close();
    saveAsFolder();
  });
  $('#btn-reload-folder').addEventListener('click', () => {
    $('#dlg-open').close();
    reloadFromFolder();
  });
  $('#btn-close-folder').addEventListener('click', () => {
    $('#dlg-open').close();
    disconnectFolder();
  });
  $('#btn-open').addEventListener('click', openProjectsDialog);
  $('#btn-export').addEventListener('click', async () => {
    syncScripts();
    const n = (app.project.assets ?? []).length;
    if (n) log('info', `Exportiere Projekt mit ${n} Sound${n > 1 ? 's' : ''} …`);
    await exportProject(app.project);
  });
  $('#btn-import').addEventListener('click', () => {
    $('#dlg-open').close();
    $('#file-import').click();
  });
  $('#file-import').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      openProject(await importProjectFile(file));
    } catch (err) {
      log('error', 'Import fehlgeschlagen: ' + err.message);
    }
  });
  $('#btn-run').addEventListener('click', () => run());
  $('#btn-stop').addEventListener('click', stopRun);
  $('#btn-restart').addEventListener('click', () => run());
  $('#btn-connect').addEventListener('click', toggleDevice);
  $('#btn-selftest').addEventListener('click', () => {
    selectTab('console');
    log('info', 'Selbsttest: eine Wand wird angelegt. Danach den Me-Griff langsam darüber bewegen.');
    run({ project: { id: app.project.id, name: 'Selbsttest', script: SELFTEST_SCRIPT, levels: [], settings: { ...app.project.settings, boundary: false } } });
  });
  $('#opt-boundary').checked = !!app.project.settings.boundary;
  $('#opt-boundary').addEventListener('change', (e) => {
    app.project.settings.boundary = e.target.checked;
    scheduleSave();
    log('info', e.target.checked ? 'Rand des Me-Bereichs wird beim Start als Wand angelegt.' : 'Rand des Me-Bereichs wird nicht mehr als Wand angelegt.');
  });
  $('#nav-script').addEventListener('click', () => selectView('script'));
  $('#btn-add-level').addEventListener('click', addLevel);
  $('#btn-add-sound').addEventListener('click', () => $('#file-sound').click());
  $('#file-sound').addEventListener('change', async (e) => {
    const files = [...e.target.files]; // copy: resetting the input empties the FileList
    e.target.value = '';
    await addSounds(files);
  });
  const dropZone = $('#sound-section');
  for (const type of ['dragenter', 'dragover']) {
    dropZone.addEventListener(type, (e) => {
      if (![...(e.dataTransfer?.types ?? [])].includes('Files')) return;
      e.preventDefault();
      dropZone.classList.add('dropping');
    });
  }
  for (const type of ['dragleave', 'drop']) dropZone.addEventListener(type, () => dropZone.classList.remove('dropping'));
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    await addSounds(e.dataTransfer?.files ?? []);
  });
  $('#btn-clear').addEventListener('click', clearConsole);
  $('#opt-devicelog').addEventListener('change', (e) => {
    app.showDeviceLog = e.target.checked;
    if (app.serial) app.serial.verbose = e.target.checked; // log every obstacle packet
  });
  for (const b of document.querySelectorAll('.tab')) b.addEventListener('click', () => selectTab(b.dataset.tab));
  for (const b of document.querySelectorAll('.subtab')) b.addEventListener('click', () => selectSubtab(b.dataset.sub));
  for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', (e) => e.target === d && d.close());
    d.querySelector('[data-close]')?.addEventListener('click', () => d.close());
  }
  $('#api-doc').innerHTML = API_HTML;
  if (!SerialDevice.isSupported()) $('#btn-connect').title = 'Web Serial gibt es nur in Chrome und Edge am Computer.';

  window.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    // zoom keys work while a level is open, even if the canvas has no focus
    const t = e.target;
    const typing = t && t.closest && t.closest('input, textarea, select, [contenteditable="true"], .monaco-editor');
    if (!typing && currentLevel() && app.subtab === 'level' && app.levelEditor?.handleViewKey(e)) {
      e.preventDefault();
      return;
    }
    if (mod && e.key === 'Enter') {
      e.preventDefault();
      run();
    } else if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      syncScripts();
      if (app.folder) saveToFolder();
      else saveNow();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    syncScripts();
    saveNow();
    if (app.folder && app.folderDirty) e.preventDefault();
  });

  renderSidebar();
  showView();
  syncAssetList();
  renderSaveState();
  renderFolderUi();
  if (supportsFolders()) {
    // offer to reconnect the folder this project came from
    recentFolders()
      .then((list) => {
        const entry = list.find((x) => x.id === app.project.id);
        if (entry) log('info', `Dieses Projekt kam aus dem Ordner „${entry.name}“. Unter „Projekte“ kannst du ihn wieder verbinden.`);
      })
      .catch(() => {});
  }
  log('info', `Willkommen im DualPanto Studio (${BUILD}).`);
  console.info('DualPanto Studio', BUILD);

  // code editor (async, may load Monaco from a CDN)
  const dark = matchMedia('(prefers-color-scheme: dark)');
  app.code = await createCodeEditor($('#code'), {
    typeDefs: API_DTS,
    dark: dark.matches,
    onChange: (key, value) => {
      setScript(key, value);
      scheduleSave();
      if (key !== 'main') renderSidebar();
    },
  });
  openScript(fileKey(currentLevel()));
  dark.addEventListener('change', (e) => app.code.setTheme(e.matches));
  $('#code-loading')?.remove();
  window.__studio = app; // for debugging in the console
}

init();
