// DualPanto Studio – app controller: wires project, editors, stage, devices and runtime.

import { Emulator } from './panto/emulator.js';
import { SerialDevice, DEVICE_PROFILES } from './panto/webserial.js';
import { Runtime } from './panto/runtime.js';
import { VoiceInput } from './panto/voice.js';
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
  folderSnapshot, snapshotsDiffer, releaseAssets, hasProjectFile,
} from './editor/folder.js';
import { createCodeEditor } from './editor/code-editor.js';
import { LevelEditor, TOOLS } from './editor/level-editor.js';
import { Stage } from './editor/stage.js';
import { fitView, drawWorld } from './editor/renderer.js';
import { API_DTS, API_HTML } from './editor/api-docs.js';

/** Shown in the console at startup – makes it obvious when the browser serves an old copy. */
export const BUILD = '2026-10-13 · English UI';

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

// Resizable workspace panels. Store pixel sizes locally so each user keeps their layout.
function setupResizeHandles() {
  const root = document.documentElement;
  const config = {
    sidebar: { property: '--sidebar-width', initial: 220, min: 150, max: () => innerWidth * 0.32, sign: 1 },
    right: { property: '--right-width', initial: 36, min: 320, max: () => innerWidth * 0.58, sign: -1, percent: true },
    props: { property: '--props-width', initial: 250, min: 170, max: () => innerWidth * 0.42, sign: -1 },
    console: { property: '--stage-height', initial: 46, min: 120, max: () => innerHeight * 0.75, sign: 1, percent: true },
  };
  for (const [key, item] of Object.entries(config)) {
    try {
      const stored = localStorage.getItem(`studio-layout-${key}`);
      if (stored && Number.isFinite(Number(stored))) root.style.setProperty(item.property, `${stored}${item.percent ? '%' : 'px'}`);
    } catch { /* Private browsing may disable storage. */ }
  }
  for (const handle of document.querySelectorAll('[data-resize]')) {
    const item = config[handle.dataset.resize];
    handle.addEventListener('pointerdown', (event) => {
      if (innerWidth <= 980) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const vertical = handle.dataset.resize === 'console';
      const start = vertical ? event.clientY : event.clientX;
      const computed = getComputedStyle(root).getPropertyValue(item.property).trim();
      const fallback = item.percent ? item.initial : item.initial;
      let initial = parseFloat(computed) || fallback;
      if (item.percent) initial = item.property === '--stage-height'
        ? parseFloat(getComputedStyle(document.querySelector('.right')).height) * initial / 100
        : parseFloat(getComputedStyle(document.querySelector('.workspace')).width) * initial / 100;
      const move = (e) => {
        const delta = ((vertical ? e.clientY : e.clientX) - start) * item.sign;
        const value = Math.max(item.min, Math.min(item.max(), initial + delta));
        const stored = item.percent
          ? value / (item.property === '--stage-height' ? document.querySelector('.right').clientHeight : document.querySelector('.workspace').clientWidth) * 100
          : value;
        root.style.setProperty(item.property, `${stored}${item.percent ? '%' : 'px'}`);
        try { localStorage.setItem(`studio-layout-${handle.dataset.resize}`, String(stored)); } catch { /* optional */ }
      };
      const end = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', end);
        handle.removeEventListener('pointercancel', end);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
    });
  }
}

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
    $('#save-state').textContent = 'Not saved (storage full?)';
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
      ? `This project lives in the folder "${app.folder.name}". Changes are saved there.`
      : 'Everything is saved in the browser automatically. Under "Projects" you can export a file.';
  }
  if (!app.folder) {
    el.dataset.state = '';
    el.textContent = mode === 'saving' ? 'Saving …' : 'Saved in browser';
    el.title = 'This project lives in browser storage. Under "Projects" you can move it into a folder.';
    return;
  }
  const dirty = app.folderDirty;
  el.dataset.state = dirty ? 'dirty' : 'folder';
  el.textContent = `${app.folder.name}${dirty ? ' · unsaved' : ' · saved'}`;
  el.title = dirty ? 'Not yet written to the folder (Ctrl/⌘ + S)' : 'All files in the folder are up to date.';
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
  // Throw away the old project's editor documents: "main" has the same name in the new
  // project, and a leftover document would overwrite its script.
  app.code?.reset();
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
  log('info', `Project "${app.project.name}" opened.`);
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
        level.script?.trim() ? h('span', { class: 'level-script-badge', title: 'This level has its own script' }, 'JS') : null,
        level.name === start ? h('span', { class: 'badge', title: 'Loaded on start' }, 'Start') : null
      ),
      h(
        'div',
        { class: 'level-actions' },
        h('button', { class: 'icon-btn', title: 'Duplicate', 'aria-label': `Duplicate ${level.name}`, onclick: () => duplicateLevel(level) }, iconCopy()),
        h('button', { class: 'icon-btn', title: 'Delete', 'aria-label': `Delete ${level.name}`, onclick: () => deleteLevel(level) }, iconTrash())
      )
    );
    list.append(item);
    requestAnimationFrame(() => drawThumb(canvas, level));
  }
  if (!p.levels.length) list.append(h('li', { class: 'empty' }, 'No levels yet. Apps don\'t necessarily need one.'));
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
  $('#center-title').textContent = level ? `Level: ${level.name}` : 'Main script';
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
    const viewVal = app.levelEditor.viewMode || level.view || 'square';
    const sel = $('#select-view');
    if (sel) sel.value = viewVal;
    renderProps(null);
    requestAnimationFrame(() => app.levelEditor.draw());
  } else {
    openScript(fileKey(level));
    requestAnimationFrame(() => app.code?.layout());
  }
}

function addLevel() {
  const name = uniqueLevelName(app.project);
  const level = { id: uid('l'), name, intro: '', spawn: {}, objects: [], script: levelScriptTemplate(name), view: 'square' };
  app.project.levels.push(level);
  scheduleSave();
  selectView(level.id);
}

function duplicateLevel(level) {
  const copy = JSON.parse(JSON.stringify(level));
  copy.id = uid('l');
  copy.name = uniqueLevelName(app.project, level.name + ' copy');
  copy.objects.forEach((o) => (o.id = uid('o')));
  app.project.levels.splice(app.project.levels.indexOf(level) + 1, 0, copy);
  scheduleSave();
  selectView(copy.id);
}

function deleteLevel(level) {
  if (!confirm(`Delete level "${level.name}"?`)) return;
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
    log('warn', 'This does not work without write access to the folder.');
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
    log('warn', 'Could not remember the folder for later: ' + e.message);
  });
  renderSaveState();
  renderFolderUi();
  startFolderWatch();
  log('info', `Folder "${handle.name}" connected. Changes are written to it automatically.`);
  return true;
}

async function openFolder(handle) {
  try {
    const dir = handle ?? (await pickFolder());
    if (!(await ensurePermission(dir))) return log('warn', 'Access to the folder was not allowed.');
    if (await hasProjectFile(dir)) return void (await connectFolder(dir));
    if (!confirm(`There is no project in "${dir.name}" yet.\n\nSave "${app.project.name}" there?`)) return;
    await connectFolder(dir, { read: false });
    await saveToFolder();
  } catch (e) {
    if (e.name === 'AbortError') return;
    log('error', 'Could not open the folder: ' + e.message);
  }
}

async function saveAsFolder() {
  try {
    const dir = await pickFolder();
    if (!(await ensurePermission(dir))) return log('warn', 'Access to the folder was not allowed.');
    await connectFolder(dir, { read: false });
    await saveToFolder();
  } catch (e) {
    if (e.name === 'AbortError') return;
    log('error', 'Cannot save: ' + e.message);
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
      if (written.length) parts.push(`${written.length} file${written.length > 1 ? 's' : ''} written`);
      if (removed.length) parts.push(`${removed.length} deleted`);
      log('info', `Folder "${app.folder.name}": ${parts.join(', ') || 'nothing changed'}.`);
    }
  } catch (e) {
    log('error', 'Writing to the folder failed: ' + e.message);
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
    log('info', auto ? `Folder "${app.folder.name}" was changed outside – reloaded.` : 'Project reloaded from the folder.');
  } catch (e) {
    log('error', 'Reload failed: ' + e.message);
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
  log('info', `Folder "${name}" disconnected. The project stays in browser storage.`);
}

/** Notices when someone else (git pull, the other computer) changed the files. */
function startFolderWatch() {
  clearInterval(app.folderWatch);
  app.folderWatch = setInterval(async () => {
    if (!app.folder || document.visibilityState !== 'visible') return;
    try {
      const snap = await folderSnapshot(app.folder.handle);
      if (!snapshotsDiffer(app.folder.snapshot, snap)) return;
      app.folder.snapshot = snap;
      if (app.folderDirty || app.runtime?.running) {
        log('warn', 'The folder was changed outside. "Projects → Reload from folder" fetches that state but overwrites your unsaved changes.');
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
    list.append(h('li', { class: 'empty muted small' }, 'This browser does not support folders. Use Chrome or Edge on desktop.'));
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
          h('span', { class: 'muted' }, `Folder · last opened ${new Date(entry.opened).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}`)),
        current ? h('span', { class: 'badge' }, 'open') : h('button', { class: 'icon-btn', title: 'Remove from list', onclick: async () => { await forgetFolder(entry.id); renderFolderList(); } }, iconTrash()))
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
    list.append(h('li', { class: 'empty' }, 'Drag MP3 or WAV here or press ＋.'));
  }
  for (const a of assets) {
    const playing = app.preview?.id === a.id;
    const item = h(
      'li',
      { class: 'sound-item' },
      h('button', {
        class: 'icon-btn', title: playing ? 'Stop' : 'Listen', 'aria-label': `${playing ? 'Stop' : 'Play'} ${a.name}`,
        onclick: () => togglePreview(a),
      }, playing ? '■' : '▶'),
      h('button', {
        class: 'sound-meta', title: `${a.name} – click to insert sound.play("${a.name}") into the script`,
        onclick: () => insertSnippet(soundSnippet(a.name)),
      }, h('span', { class: 'sound-name' }, a.name), h('span', { class: 'sound-size' }, formatBytes(a.size))),
      h('div', { class: 'sound-actions' },
        h('button', { class: 'icon-btn', title: 'Delete', 'aria-label': `Delete ${a.name}`, onclick: () => removeSound(a) }, iconTrash()))
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
    if (!url) return log('error', `"${a.name}" is no longer stored.`);
    const audio = new Audio(url);
    audio.onended = () => {
      if (app.preview?.id === a.id) app.preview = null;
      renderSounds();
    };
    audio.play().catch((e) => log('warn', 'Cannot play: ' + e.message));
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
      log('warn', `"${file.name}" is not an audio file – skipped.`);
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
      log('info', `Name already taken, saved as "${name}".`);
    }
    try {
      const meta = await putAsset(app.project.id, file, { name });
      app.project.assets = [...(app.project.assets ?? []), meta];
      log('info', `Sound "${meta.name}" saved (${formatBytes(meta.size)}). Play it with sound.play("${meta.name}").`);
    } catch (e) {
      log('error', 'Saving failed: ' + e.message);
    }
  }
  saveNow();
  renderSounds();
}

async function removeSound(a) {
  if (!confirm(`Delete sound "${a.name}"?`)) return;
  if (app.preview?.id === a.id) {
    app.preview.audio.pause();
    app.preview = null;
  }
  await deleteAsset(a.id);
  app.project.assets = (app.project.assets ?? []).filter((x) => x.id !== a.id);
  saveNow();
  renderSounds();
  log('info', `Sound "${a.name}" deleted.`);
}

async function updateStorageInfo() {
  const assets = app.project.assets ?? [];
  const own = assets.reduce((n, a) => n + (a.size ?? 0), 0);
  const { usage, quota } = await storageInfo();
  const parts = [];
  if (assets.length) parts.push(`${assets.length} Sound${assets.length > 1 ? 's' : ''}, ${formatBytes(own)}`);
  if (quota) parts.push(`Browser storage: ${formatBytes(usage)} of ${formatBytes(quota)}`);
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
    log('warn', 'Sound storage not available: ' + e.message);
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
  if (touched) log('info', `Renamed "${oldName}" to "${newName}" (${touched} script${touched > 1 ? 's' : ''} updated).`);
}

function snippetFor(obj) {
  if (!obj.name) return null;
  const name = JSON.stringify(obj.name);
  if (obj.type === 'zone') {
    return `level.zone(${name}).onEnter(() => {\n  speak("You found it!");\n});`;
  }
  if (obj.type === 'entity') {
    if (obj.kind === 'item') {
      return `level.entity(${name}).onCollect(() => {
  state.score = (state.score ?? 0) + 1;
  speak("Collected: " + state.score);
});`;
    }
    if (obj.kind === 'enemy') {
      const x = Math.round(obj.x);
      const y = Math.round(obj.y);
      return `const enemy = level.entity(${name});
// walks back and forth; speed in mm/s
enemy.patrol([[${x}, ${y}], [${Math.min(290, x + 60)}, ${y}]], { speed: 40 });
enemy.onTouch(() => {
  speak("Caught!");
  panto.loadLevel(panto.level.name);   // start over
});`;
    }
    return `const target = level.entity(${name});
target.onTouch(() => speak("Found it!"));
// target.follow(me, { speed: 30 });   // follows the Me handle
// target.attachTo("it");              // It keeps moving there`;
  }
  return `const obj = level.object(${name});\nobj.disable(); // e.g. open a door`;
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
        return log('warn', 'Level names must be unique and not empty.');
      }
      if (app.project.startLevel === level.name) app.project.startLevel = v;
      renameInScript(level.name, v);
      level.name = v;
      scheduleSave();
      renderSidebar();
      $('#center-title').textContent = `Level: ${v}`;
    });
    const intro = h('textarea', { rows: 3, placeholder: 'e.g. "Level 1. Find the exit."' });
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
          h('button', { class: 'link-btn', onclick: () => { ed.snapshot(); delete level.spawn[k]; ed.changed(); renderProps(null); } }, 'remove'))
        : h('span', { class: 'muted' }, 'not set – tool "Start ' + (k === 'me' ? 'Me' : 'It') + '"');
    const viewSel = h('select', {}, [
      ['square', 'Biggest square (Me & It)'],
      ['both', 'Covered by both (Me & It)'],
      ['single', 'Single handles (max zoom)'],
      ['full', 'Full workspace (360 × 210 mm)'],
    ].map(([v, l]) => h('option', { value: v, selected: (level.view ?? 'square') === v }, l)));
    viewSel.addEventListener('change', () => {
      app.levelEditor.setViewMode(viewSel.value);
      const sel = $('#select-view');
      if (sel) sel.value = viewSel.value;
      scheduleSave();
    });
    panel.append(
      h('h3', {}, 'Level'),
      field('Name', name, 'Use this name to load the level in the script.'),
      field('Workspace view', viewSel, 'Presets: biggest square, both handles, single handles, full area.'),
      field('Say on load', intro),
      h('label', { class: 'check' }, start, 'Load when the program starts'),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Start Me'), spawnInfo('me')),
      h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Start It'), spawnInfo('it')),
      h('button', { class: 'btn btn-secondary full', onclick: () => run({ startLevel: level.name }) }, '▶ Test this level'),
      h('p', { class: 'muted small' }, `${level.objects.length} objects. Select an object to edit it.`)
    );
    return;
  }

  const typeLabel = obj.type === 'entity'
    ? { enemy: 'Enemy', item: 'Item' }[obj.kind] ?? 'Object'
    : { wall: 'Wall', rail: 'Rail', zone: 'Zone' }[obj.type];
  const nameIn = h('input', { type: 'text', value: obj.name ?? '', placeholder: obj.type === 'wall' || obj.type === 'rail' ? 'optional, e.g. Door' : 'e.g. Goal' });
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
  panel.append(h('h3', {}, typeLabel), field('Name', nameIn, 'The script finds the object by this name.'));

  const check = (label, key, hint, def = false) => {
    const c = h('input', { type: 'checkbox', checked: obj[key] ?? def });
    c.addEventListener('change', () => ed.update(obj, { [key]: c.checked }));
    return h('label', { class: 'check', title: hint ?? '' }, c, label);
  };
  const range = (label, key, { min, max, step = 1, unit = ' mm', hint } = {}) => {
    const r = h('input', { type: 'range', min, max, step, value: obj[key] });
    const out = h('output', {}, `${obj[key]}${unit}`);
    r.addEventListener('pointerdown', () => ed.snapshot());
    r.addEventListener('input', () => {
      out.textContent = `${r.value}${unit}`;
      ed.update(obj, { [key]: +r.value }, { history: false });
    });
    return field(label, h('div', { class: 'range-row' }, r, out), hint);
  };
  const select = (label, key, options, def) => {
    const s = h('select', {}, options.map(([v, l]) => h('option', { value: v, selected: (obj[key] ?? def) === v }, l)));
    s.addEventListener('change', () => ed.update(obj, { [key]: s.value }));
    return field(label, s);
  };

  if (obj.type === 'wall') {
    panel.append(
      check('Closed shape', 'closed'),
      check('Passable (can be pushed through)', 'passable'),
      check('Active on start', 'enabled', null, true),
      select('Applies to', 'handles', [['both', 'Both handles'], ['me', 'Me only'], ['it', 'It only']], 'both')
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
      field('Strength (capture width)', h('div', { class: 'range-row' }, r, out), 'How far you have to move away from the rail to leave it.'),
      check('Active on start', 'enabled', null, true),
      select('Applies to', 'handles', [['both', 'Both handles'], ['me', 'Me only'], ['it', 'It only']], 'both')
    );
  } else if (obj.type === 'entity') {
    const kindSel = h('select', {}, [['enemy', 'Enemy'], ['item', 'Item'], ['marker', 'Marker']]
      .map(([v, l]) => h('option', { value: v, selected: (obj.kind ?? 'marker') === v }, l)));
    kindSel.addEventListener('change', () => {
      ed.update(obj, { kind: kindSel.value });
      renderProps(obj); // andere Art, andere Optionen
    });
    const say = h('textarea', { rows: 2, placeholder: obj.kind === 'item' ? 'e.g. "Coin!"' : 'e.g. "Ouch!"' });
    say.value = obj.speak ?? '';
    say.addEventListener('focus', () => ed.snapshot());
    say.addEventListener('input', () => ed.update(obj, { speak: say.value }, { history: false }));
    const sounds = app.project.assets ?? [];
    const sndSel = h('select', {}, [
      h('option', { value: '', selected: !obj.sound }, '– no sound –'),
      ...sounds.map((a) => h('option', { value: a.name, selected: obj.sound === a.name }, a.name)),
    ]);
    sndSel.addEventListener('change', () => ed.update(obj, { sound: sndSel.value }));
    panel.append(
      field('Kind', kindSel, 'Enemies and items are shown; the script gives them their behaviour.'),
      range('Radius (touch)', 'r', { min: 4, max: 40, hint: 'How close the handle has to get for onTouch to fire.' }),
      field('Say on touch', say),
      field('Play on touch', sndSel, sounds.length ? null : 'Upload sounds in the sidebar on the left.'),
      check('Tangible: round wall on the device', 'solid', 'Unchecked, the object is only visible and reacts to touch. Checked, the runtime creates a round wall; moving objects are only re-sent when they stop.'),
      obj.kind === 'item' ? check('Disappears when collected', 'vanish', null, true) : null,
      select('Reacts to', 'handle', [['me', 'Me handle'], ['it', 'It handle'], ['both', 'Both']], 'me'),
      check('Visible on start', 'enabled', null, true)
    );
  } else if (obj.type === 'zone') {
    const say = h('textarea', { rows: 2, placeholder: 'Optional, e.g. "You reached the goal."' });
    say.value = obj.speak ?? '';
    say.addEventListener('focus', () => ed.snapshot());
    say.addEventListener('input', () => ed.update(obj, { speak: say.value }, { history: false }));
    panel.append(
      field('Say on enter', say),
      select('Reacts to', 'handle', [['me', 'Me handle'], ['it', 'It handle'], ['both', 'Both']], 'me'),
      check('Active on start', 'enabled', null, true)
    );
  }

  const snippet = snippetFor(obj);
  panel.append(
    snippet == null
      ? h('p', { class: 'muted small' }, 'Give the object a name to use it in the script.')
      : h('div', { class: 'snippet' },
      h('div', { class: 'snippet-head' }, h('span', {}, 'In the level script'),
        h('span', { class: 'snippet-actions' },
          h('button', { class: 'link-btn', onclick: () => appendToLevelScript(snippet) }, 'Insert'),
          h('button', {
            class: 'link-btn',
            onclick: (e) => {
              navigator.clipboard?.writeText(snippet);
              e.target.textContent = 'Copied';
              setTimeout(() => (e.target.textContent = 'Copy'), 1200);
            },
          }, 'Copy'))),
      h('pre', {}, snippet)),
    h('button', { class: 'btn btn-danger full', onclick: () => ed.deleteSelected() }, 'Delete object')
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
    row.append(h('button', { class: 'link-btn log-line', onclick: open }, line ? `Line ${line}${where}` : `open${where}`));
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
// microphone (voice input)

const VOICE_LABEL = { off: '🎤 off', listening: '🎤 listening', paused: '🎤 paused', error: '🎤 blocked' };
const VOICE_TITLE = {
  off: 'The program is not listening. Click to start the microphone.',
  listening: 'The microphone is on. Click to turn it off.',
  paused: 'Short pause (the recogniser restarts in a moment, or the app is speaking).',
  error: 'No access to the microphone – allow it in the browser, left of the address bar.',
};

function renderVoice(info) {
  const pill = $('#voice-status');
  const v = app.runtime?.voice;
  // visible as soon as a project uses voice input
  const used = !!v && (v.state !== 'off' || v._commands?.size || v._text?.size || v._partial?.size);
  pill.hidden = !used;
  const state = v?.state ?? 'off';
  pill.dataset.state = state;
  pill.textContent = VOICE_LABEL[state] ?? VOICE_LABEL.off;
  pill.title = VOICE_TITLE[state] ?? '';
  if (info?.text && !info.partial) pill.title = `Last understood: "${info.text}"`;
}

function toggleVoice() {
  const v = app.runtime?.voice;
  if (!v) return;
  if (v.isListening || v.state === 'paused') v.stop();
  else v.start();
  renderVoice();
}

/**
 * Tells the console how recognition works in this browser.
 *
 * Deliberately WITHOUT `SpeechRecognition.available()`: the call is experimental and, in
 * a Chromium without a speech recognition service, crashes the renderer (white page, no
 * try/catch helps). To find out, call voice.localAvailable() in a script.
 */
function reportVoiceSupport() {
  if (!VoiceInput.supported) {
    log('info', 'Voice input: not available in this browser (only Chrome and Edge on desktop).');
    return;
  }
  log('info', 'Voice input: available. In Chrome, recognition runs on a server – the audio goes over the network and it does not work offline. voice.localAvailable() checks whether this browser can also recognise on the device.');
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
  pill.textContent = serial ? (app.device.connected ? 'DualPanto connected' : 'Connecting …') : 'Emulator';
  $('#btn-connect').textContent = serial ? 'Disconnect' : 'Connect device';
  $('#stage-hint').hidden = serial;
}

async function toggleDevice() {
  if (app.device?.kind === 'serial') {
    stopRun();
    await app.serial.disconnect();
    app.serial = null;
    app.emulator.start();
    attachDevice(app.emulator);
    log('info', 'Disconnected. Emulator active.');
    return;
  }
  if (!SerialDevice.isSupported()) {
    log('warn', 'This browser does not support Web Serial. Please use Chrome or Edge on desktop.');
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

const SELFTEST_SCRIPT = `// Self-test: a single wall across the middle of the Me area.
speak("Self-test. A wall runs across the middle. Move slowly from bottom to top.");
const wall = panto.wall([[130, 105], [260, 105]], { name: "Test wall", persistent: true });
log("Test wall created, device ID " + wall.id);
me.onMove((p) => {
  if (!state.above && p.y < 100) { state.above = true; sound.tick(); log("above the wall: " + Math.round(p.y) + " mm"); }
  if (state.above && p.y > 112) state.above = false;
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
  rt.on('stopped', () => {
    updateRunUi();
    renderVoice();
  });
  rt.on('voice', (info) => renderVoice(info));
  const started = rt.start();
  updateRunUi();
  renderVoice();
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
            h('strong', {}, p.name), h('span', { class: 'muted' }, `${p.levels.length} level${p.levels.length === 1 ? '' : 's'} · changed ${new Date(p.updated).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}`)),
          p.id === app.project.id ? h('span', { class: 'badge' }, 'open') :
            h('button', {
              class: 'icon-btn', title: 'Delete', 'aria-label': `Delete ${p.name}`,
              onclick: async () => {
                if (!confirm(`Delete project "${p.name}" permanently?`)) return;
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
  setupResizeHandles();
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
  app.levelEditor.onViewChange = (zoom, mode) => {
    $('#btn-zoom-level').textContent = `${Math.round(zoom * 100)} %`;
    const sel = $('#select-view');
    if (sel && mode) sel.value = mode;
  };
  $('#select-view').addEventListener('change', (e) => {
    app.levelEditor.setViewMode(e.target.value);
    scheduleSave();
    if (!app.levelEditor.selected) renderProps(null);
  });
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
    app.project.name = e.target.value || 'Untitled';
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
    if (n) log('info', `Exporting project with ${n} sound${n > 1 ? 's' : ''} …`);
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
      log('error', 'Import failed: ' + err.message);
    }
  });
  $('#btn-run').addEventListener('click', () => run());
  $('#btn-stop').addEventListener('click', stopRun);
  $('#btn-restart').addEventListener('click', () => run());
  $('#btn-connect').addEventListener('click', toggleDevice);
  $('#voice-status').addEventListener('click', toggleVoice);
  $('#btn-selftest').addEventListener('click', () => {
    selectTab('console');
    log('info', 'Self-test: creating a wall. Then move the Me handle slowly across it.');
    run({ project: { id: app.project.id, name: 'Self-test', script: SELFTEST_SCRIPT, levels: [], settings: { ...app.project.settings, boundary: false } } });
  });
  $('#opt-boundary').checked = !!app.project.settings.boundary;
  $('#opt-boundary').addEventListener('change', (e) => {
    app.project.settings.boundary = e.target.checked;
    scheduleSave();
    log('info', e.target.checked ? 'The edge of the Me area will be created as a wall on start.' : 'The edge of the Me area is no longer created as a wall.');
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
  if (!SerialDevice.isSupported()) $('#btn-connect').title = 'Web Serial is only available in Chrome and Edge on desktop.';

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
        if (entry) log('info', `This project came from the folder "${entry.name}". Under "Projects" you can reconnect it.`);
      })
      .catch(() => {});
  }
  log('info', `Welcome to DualPanto Studio (${BUILD}).`);
  reportVoiceSupport();
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
