// Visual level editor: draw walls, rails, zones and start positions.

import { fitView, drawWorld } from './renderer.js';
import { dist, distToSegment, edges, shapeContains, rectPoints, clampToPolygon } from '../panto/geometry.js';
import { uid } from './project.js';
import { workAreaFor } from '../panto/areas.js';

export const TOOLS = [
  { key: 'select', label: 'Select', hint: 'Click objects, move them, drag corner points. Delete removes. Mouse wheel zooms, dragging empty space pans.', shortcut: 'V' },
  { key: 'wall', label: 'Wall', hint: 'Place points. Double-click or Enter finishes, clicking the first point closes the shape.', shortcut: 'W' },
  { key: 'box', label: 'Box', hint: 'Drag a rectangle: a closed wall.', shortcut: 'B' },
  { key: 'rail', label: 'Rail', hint: 'Place points (hallway). Double-click or Enter finishes.', shortcut: 'R' },
  { key: 'zone', label: 'Zone', hint: 'Drag a rectangle: an area that reacts when entered.', shortcut: 'Z' },
  { key: 'zoneCircle', label: 'Round zone', hint: 'Drag out from the centre.', shortcut: 'C' },
  { key: 'enemy', label: 'Enemy', hint: 'Click to place an enemy. It is shown and reacts when Me touches it. In the script: level.entity("Name").', shortcut: 'E' },
  { key: 'item', label: 'Item', hint: 'Click to place an item to collect. It disappears when touched.', shortcut: 'I' },
  { key: 'spawnMe', label: 'Start Me', hint: 'Click: the Me handle moves here when the level loads.', shortcut: '' },
  { key: 'spawnIt', label: 'Start It', hint: 'Click: the It handle moves here when the level loads.', shortcut: '' },
];

export class LevelEditor {
  constructor({ canvas, bounds, areas, onChange, onSelect }) {
    this.canvas = canvas;
    this.areas = areas;
    this.ctx = canvas.getContext('2d');
    this.bounds = bounds;
    this.onChange = onChange;
    this.onSelect = onSelect;
    this.level = null;
    this.tool = 'select';
    this.selectedId = null;
    this.snap = true;
    this.draft = null; // points of polyline in progress
    this.drag = null;
    this.hover = null;
    this.undoStack = [];
    this.redoStack = [];
    this.zoom = 1; // 1 = whole working area fits
    this.pan = { x: 0, y: 0 };
    this.spaceDown = false;
    this._bind();
    new ResizeObserver(() => this.draw()).observe(canvas);
  }

  setLevel(level) {
    const changed = this.level?.id !== level?.id;
    this.level = level;
    this.selectedId = null;
    this.draft = null;
    // keep zoom and pan when the same level is shown again
    if (changed) this.resetView();
    this.undoStack = [];
    this.redoStack = [];
    this.onSelect?.(null);
    this.draw();
  }

  /** Keyboard shortcuts for work area and zoom, also usable when the canvas has no focus. */
  handleViewKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return false;
    const k = e.key;
    const mode = { 1: 'square', 2: 'rhombus', 0: 'full' }[k];
    if (mode) return this.onAreaKey?.(mode), true;
    if (this.locked) return false;
    if (k === '+' || k === '=') return this.zoomBy(1.25), true;
    if (k === '-' || k === '_') return this.zoomBy(1 / 1.25), true;
    if (k.toLowerCase() === 'f') return this.zoomToFit(), true;
    return false;
  }

  setTool(key) {
    this.finishDraft();
    this.tool = key;
    this.canvas.dataset.tool = key;
    this.draw();
  }

  get selected() {
    return this.level?.objects.find((o) => o.id === this.selectedId) ?? null;
  }

  select(id) {
    this.selectedId = id;
    this.onSelect?.(this.selected);
    this.draw();
  }

  // ---- work area (full / square / rhombus) -------------------------------
  /** The level's simplified work area, or null when it uses the full reachable area. */
  get workArea() {
    return workAreaFor(this.level?.view);
  }

  /** A square/rhombus level is shown fixed in place: no zoom, no panning. */
  get locked() {
    return !!this.workArea;
  }

  /** Switches the work area; returns how many objects now lie (partly) outside it. */
  setAreaMode(mode) {
    if (!this.level || (this.level.view ?? 'full') === mode) return 0;
    this.snapshot();
    this.level.view = mode;
    this.resetView();
    this.changed();
    return this.level.objects.filter((o) => !this._fits(o)).length;
  }

  _inside(p) {
    const w = this.workArea;
    return !w || dist(p, clampToPolygon(p, w.points)) < 0.01;
  }

  /** Whether an object (or a candidate state of it) lies completely in the work area. */
  _fits(o) {
    if (!this.workArea) return true;
    if (o.points) return o.points.every((p) => this._inside(p));
    if (o.shape === 'rect') return [[0, 0], [1, 0], [1, 1], [0, 1]].every(([a, b]) => this._inside({ x: o.x + a * o.w, y: o.y + b * o.h }));
    const r = o.shape === 'circle' && o.type === 'zone' ? o.r : 0; // entities: their centre counts
    for (let i = 0; i < 8; i++) {
      const t = (i / 8) * Math.PI * 2;
      if (!this._inside({ x: o.x + Math.cos(t) * r, y: o.y + Math.sin(t) * r })) return false;
    }
    return true;
  }

  /** Removes every object of the level (start positions stay). Undo brings them back. */
  clearObjects() {
    if (!this.level?.objects.length) return;
    this.snapshot();
    this.level.objects = [];
    this.draft = null;
    this.select(null);
    this.changed();
  }

  // ---- zoom & pan ---------------------------------------------------------
  get canvasSize() {
    return { w: this.canvas.clientWidth, h: this.canvas.clientHeight };
  }

  /** The rectangle that zoom 1 fits: the work area, or the whole working range. */
  get focus() {
    return this.workArea ?? { x: 0, y: 0, width: this.bounds.width, height: this.bounds.height };
  }

  _baseScale() {
    const { w, h } = this.canvasSize;
    const margin = 24;
    const f = this.focus;
    return Math.max(0.1, Math.min((w - margin * 2) / f.width, (h - margin * 2) / f.height));
  }

  /** Screen position of the world origin for a scale and pan (same formula as fitView). */
  _origin(scale, pan = this.pan) {
    const { w, h } = this.canvasSize;
    const f = this.focus;
    return { x: (w - f.width * scale) / 2 - f.x * scale + pan.x, y: (h - f.height * scale) / 2 - f.y * scale + pan.y };
  }

  /** Keeps at least a bit of the working area on screen. */
  _clampPan(scale, pan) {
    const { w, h } = this.canvasSize;
    const keep = 60;
    const bw = this.bounds.width * scale;
    const bh = this.bounds.height * scale;
    const o = this._origin(scale, pan);
    const ox = Math.max(Math.min(o.x, w - keep), keep - bw);
    const oy = Math.max(Math.min(o.y, h - keep), keep - bh);
    return { x: pan.x + ox - o.x, y: pan.y + oy - o.y };
  }

  /** Zooms so that the world point under `screen` stays where it is. */
  zoomAt(zoom, screen) {
    if (this.locked) return;
    const next = Math.min(8, Math.max(0.5, zoom));
    const { w, h } = this.canvasSize;
    const scale = this._baseScale() * this.zoom;
    const o = this._origin(scale);
    const anchor = screen ?? { x: w / 2, y: h / 2 };
    const world = { x: (anchor.x - o.x) / scale, y: (anchor.y - o.y) / scale };
    const scale2 = this._baseScale() * next;
    const o2 = this._origin(scale2, { x: 0, y: 0 });
    const pan = {
      x: anchor.x - world.x * scale2 - o2.x,
      y: anchor.y - world.y * scale2 - o2.y,
    };
    this.zoom = next;
    this.pan = this._clampPan(scale2, pan);
    this.onViewChange?.(this.zoom);
    this.draw();
  }

  zoomBy(factor, screen) {
    this.zoomAt(this.zoom * factor, screen);
  }

  resetView() {
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.onViewChange?.(this.zoom);
    this.draw();
  }

  /** Zooms onto the selected object, or onto everything in the level. */
  zoomToFit(target = this.selected) {
    if (this.locked) return this.resetView();
    const pts = [];
    const collect = (o) => {
      if (!o) return;
      if (o.points) pts.push(...o.points);
      else if (o.shape === 'rect') pts.push({ x: o.x, y: o.y }, { x: o.x + o.w, y: o.y + o.h });
      else if (o.shape === 'circle') pts.push({ x: o.x - o.r, y: o.y - o.r }, { x: o.x + o.r, y: o.y + o.r });
    };
    if (target) collect(target);
    else {
      (this.level?.objects ?? []).forEach(collect);
      for (const k of ['me', 'it']) if (this.level?.spawn?.[k]) pts.push(this.level.spawn[k]);
    }
    if (pts.length < 2) return this.resetView();
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const pad = 12;
    const box = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
    const { w, h } = this.canvasSize;
    const base = this._baseScale();
    const scale2 = Math.min(8 * base, Math.max(0.5 * base, Math.min(w / box.w, h / box.h)));
    this.zoom = scale2 / base;
    const center = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    const o2 = this._origin(scale2, { x: 0, y: 0 });
    this.pan = this._clampPan(scale2, {
      x: w / 2 - center.x * scale2 - o2.x,
      y: h / 2 - center.y * scale2 - o2.y,
    });
    this.onViewChange?.(this.zoom);
    this.draw();
  }

  // ---- history ------------------------------------------------------------
  snapshot() {
    if (!this.level) return;
    this.undoStack.push(JSON.stringify(this.level));
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(JSON.stringify(this.level));
    this._restore(this.undoStack.pop());
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(JSON.stringify(this.level));
    this._restore(this.redoStack.pop());
  }
  _restore(json) {
    const data = JSON.parse(json);
    const areaChanged = (data.view ?? 'full') !== (this.level.view ?? 'full');
    Object.keys(this.level).forEach((k) => delete this.level[k]);
    Object.assign(this.level, data);
    if (areaChanged) this.resetView();
    if (!this.selected) this.selectedId = null;
    this.onSelect?.(this.selected);
    this.changed();
  }

  changed() {
    this.onChange?.();
    this.draw();
  }

  /** Apply a property change to the selected object (from the properties panel). */
  update(obj, patch, { history = true } = {}) {
    if (history) this.snapshot();
    Object.assign(obj, patch);
    this.changed();
  }

  deleteSelected() {
    if (!this.selected) return;
    this.snapshot();
    this.level.objects = this.level.objects.filter((o) => o.id !== this.selectedId);
    this.select(null);
    this.changed();
  }

  // ---- input --------------------------------------------------------------
  _bind() {
    const c = this.canvas;
    c.tabIndex = 0;
    c.addEventListener('pointerdown', (e) => this._down(e));
    c.addEventListener('pointermove', (e) => this._move(e));
    c.addEventListener('pointerup', (e) => this._up(e));
    c.addEventListener('dblclick', () => this.finishDraft());
    c.addEventListener('keydown', (e) => this._key(e));
    c.addEventListener('pointerleave', () => {
      this.hover = null;
      this.draw();
    });
    // Wheel/pinch zoom. Also bound on the wrapper, so the gesture works next to the
    // canvas as well, and guarded so a failure shows up instead of doing nothing.
    const onWheel = (e) => {
      try {
        e.preventDefault();
        const r = c.getBoundingClientRect();
        const anchor = { x: e.clientX - r.left, y: e.clientY - r.top };
        // pixels (mouse/trackpad), lines (Firefox) or pages
        const unit = e.deltaMode === 1 ? 0.05 : e.deltaMode === 2 ? 0.3 : 0.0015;
        const delta = e.deltaY || e.detail || 0;
        if (!delta) return;
        this.zoomBy(Math.exp(-delta * unit), anchor);
      } catch (err) {
        console.error('[Level-Editor] Zoom fehlgeschlagen:', err);
        this.onError?.(err);
      }
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    c.parentElement?.addEventListener('wheel', onWheel, { passive: false });
    c.addEventListener('keyup', (e) => {
      if (e.code === 'Space') this.spaceDown = false;
    });
    c.addEventListener('blur', () => (this.spaceDown = false));
  }

  _world(e) {
    const r = this.canvas.getBoundingClientRect();
    const p = this.view.toWorld({ x: e.clientX - r.left, y: e.clientY - r.top });
    return p;
  }

  _snap(p, force = this.snap) {
    const b = this.bounds;
    let q = { x: Math.max(0, Math.min(b.width, p.x)), y: Math.max(0, Math.min(b.height, p.y)) };
    if (force) q = { x: Math.round(q.x / 5) * 5, y: Math.round(q.y / 5) * 5 };
    // new points always land inside the work area
    const w = this.workArea;
    if (w && !this._inside(q)) q = clampToPolygon(q, w.points);
    return q;
  }

  _tol() {
    return 7 / this.view.scale;
  }

  _hit(p) {
    const tol = this._tol();
    const objs = [...(this.level?.objects ?? [])].reverse();
    // vertices of the selected object first
    const sel = this.selected;
    if (sel?.points) {
      const i = sel.points.findIndex((q) => dist(q, p) < tol * 1.2);
      if (i >= 0) return { obj: sel, vertex: i };
    }
    if ((sel?.type === 'zone' || sel?.type === 'entity') && sel.shape === 'circle' && Math.abs(dist(p, sel) - sel.r) < tol) return { obj: sel, radius: true };
    if (sel?.type === 'zone' && sel.shape === 'rect') {
      const corner = { x: sel.x + sel.w, y: sel.y + sel.h };
      if (dist(p, corner) < tol * 1.2) return { obj: sel, corner: true };
    }
    // entities sit on top of everything else
    for (const o of objs) if (o.type === 'entity' && dist(o, p) <= Math.max(o.r ?? 10, tol)) return { obj: o };
    for (const o of objs) {
      if (o.type === 'wall' || o.type === 'rail') {
        for (const [a, b] of edges(o.points, o.closed)) if (distToSegment(p, a, b) < tol) return { obj: o };
      }
    }
    for (const o of objs) if (o.type === 'zone' && shapeContains(o, p)) return { obj: o };
    for (const key of ['me', 'it']) {
      const s = this.level?.spawn?.[key];
      if (s && dist(s, p) < tol * 1.6) return { spawn: key };
    }
    return null;
  }

  _down(e) {
    if (!this.level) return;
    this.canvas.focus();
    this.canvas.setPointerCapture(e.pointerId);
    const raw = this._world(e);
    const p = this._snap(raw, this.snap && !e.altKey);
    const t = this.tool;

    // middle button or space: pan, no matter which tool is active
    if ((e.button === 1 || this.spaceDown) && !this.locked) {
      this.drag = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, pan: { ...this.pan } };
      this.canvas.style.cursor = 'grabbing';
      return;
    }

    if (t === 'select') {
      const hit = this._hit(raw);
      if (!hit) {
        // dragging empty space moves the view; a plain click deselects
        this.drag = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, pan: { ...this.pan }, deselect: true, moved: false };
        return;
      }
      if (hit.spawn) {
        this.snapshot();
        this.drag = { kind: 'spawn', key: hit.spawn };
        return;
      }
      if (hit.obj.id !== this.selectedId) this.select(hit.obj.id);
      this.snapshot();
      if (hit.vertex != null) this.drag = { kind: 'vertex', obj: hit.obj, i: hit.vertex };
      else if (hit.radius) this.drag = { kind: 'radius', obj: hit.obj };
      else if (hit.corner) this.drag = { kind: 'corner', obj: hit.obj };
      else this.drag = { kind: 'move', obj: hit.obj, start: p, orig: JSON.parse(JSON.stringify(hit.obj)) };
      return;
    }
    if (t === 'wall' || t === 'rail') {
      if (!this.draft) this.draft = { type: t, points: [p] };
      else {
        const first = this.draft.points[0];
        if (t === 'wall' && this.draft.points.length > 2 && dist(first, p) < this._tol() * 1.5) {
          this.finishDraft(true);
          return;
        }
        this.draft.points.push(p);
      }
      this.draw();
      return;
    }
    if (t === 'box' || t === 'zone' || t === 'zoneCircle') {
      this.drag = { kind: 'create', tool: t, start: p, end: p };
      return;
    }
    if (t === 'enemy' || t === 'item') {
      this.snapshot();
      const obj = {
        id: uid('o'), type: 'entity', kind: t, shape: 'circle',
        name: this._name(t === 'enemy' ? 'Enemy' : 'Item'),
        x: p.x, y: p.y, r: t === 'enemy' ? 12 : 10,
        speak: '', sound: '', solid: false, handle: 'me',
      };
      this.level.objects.push(obj);
      this.select(obj.id);
      this.changed();
      return;
    }
    if (t === 'spawnMe' || t === 'spawnIt') {
      this.snapshot();
      this.level.spawn = { ...(this.level.spawn ?? {}), [t === 'spawnMe' ? 'me' : 'it']: p };
      this.changed();
    }
  }

  _move(e) {
    if (!this.level) return;
    const raw = this._world(e);
    const p = this._snap(raw, this.snap && !e.altKey);
    this.hover = p;
    const d = this.drag;
    if (d) {
      if (d.kind === 'pan') {
        const dx = e.clientX - d.start.x;
        const dy = e.clientY - d.start.y;
        if (Math.hypot(dx, dy) > 3) d.moved = true;
        if (this.locked) return; // fixed view: a drag on empty space only deselects
        this.pan = this._clampPan(this.view.scale, { x: d.pan.x + dx, y: d.pan.y + dy });
        this.draw();
        return;
      }
      // changes that would push an object out of the work area are not applied
      const apply = (o, patch) => {
        if (this._fits({ ...o, ...patch })) Object.assign(o, patch);
      };
      if (d.kind === 'vertex') d.obj.points[d.i] = p;
      else if (d.kind === 'spawn') this.level.spawn[d.key] = p;
      else if (d.kind === 'radius') apply(d.obj, { r: Math.max(3, Math.round(dist(d.obj, p))) });
      else if (d.kind === 'corner') {
        apply(d.obj, { w: Math.max(5, p.x - d.obj.x), h: Math.max(5, p.y - d.obj.y) });
      } else if (d.kind === 'move') {
        const dx = p.x - d.start.x;
        const dy = p.y - d.start.y;
        const o = d.obj;
        const patch = {};
        if (o.points) patch.points = d.orig.points.map((q) => ({ x: q.x + dx, y: q.y + dy }));
        if (o.shape === 'rect' || o.shape === 'circle') {
          patch.x = d.orig.x + dx;
          patch.y = d.orig.y + dy;
        }
        // an object that already sticks out may still be moved (e.g. back inside)
        if (this._fits(d.orig)) apply(o, patch);
        else Object.assign(o, patch);
      } else if (d.kind === 'create') d.end = p;
      this.draw();
      if (d.kind !== 'create') this.onChange?.({ live: true });
      return;
    }
    if (this.tool === 'select') {
      const hit = this._hit(raw);
      this.canvas.style.cursor = hit ? (hit.vertex != null || hit.corner || hit.radius ? 'grab' : 'move') : 'default';
    } else this.canvas.style.cursor = 'crosshair';
    if (this.draft) this.draw();
  }

  _up() {
    const d = this.drag;
    this.drag = null;
    this.canvas.style.cursor = '';
    if (!d) return;
    if (d.kind === 'pan') {
      if (d.deselect && !d.moved) this.select(null);
      return;
    }
    if (d.kind === 'create') {
      const a = d.start;
      let b = d.end;
      // a dragged-out shape that sticks out of the work area shrinks towards its start point
      const fits = (q) => {
        const x = Math.min(a.x, q.x), y = Math.min(a.y, q.y), w = Math.abs(a.x - q.x), h = Math.abs(a.y - q.y);
        if (d.tool === 'zoneCircle') return this._fits({ type: 'zone', shape: 'circle', x: a.x, y: a.y, r: dist(a, q) });
        return this._fits({ shape: 'rect', x, y, w, h });
      };
      if (!fits(b)) {
        let lo = 0, hi = 1;
        for (let i = 0; i < 20; i++) {
          const m = (lo + hi) / 2;
          if (fits({ x: a.x + (b.x - a.x) * m, y: a.y + (b.y - a.y) * m })) lo = m;
          else hi = m;
        }
        b = { x: a.x + (b.x - a.x) * lo, y: a.y + (b.y - a.y) * lo };
      }
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      const w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
      let obj = null;
      if (d.tool === 'zoneCircle') {
        const r = Math.floor(dist(a, b));
        if (r >= 3) obj = { id: uid('o'), type: 'zone', name: this._name('Zone'), shape: 'circle', x: a.x, y: a.y, r, speak: '' };
      } else if (w >= 3 && h >= 3) {
        if (d.tool === 'box') obj = { id: uid('o'), type: 'wall', name: '', points: rectPoints(x, y, w, h), closed: true };
        else obj = { id: uid('o'), type: 'zone', name: this._name('Zone'), shape: 'rect', x, y, w, h, speak: '' };
      }
      if (obj) {
        this.snapshot();
        this.level.objects.push(obj);
        this.select(obj.id);
        this.changed();
      } else this.draw();
      return;
    }
    this.changed();
  }

  _name(base) {
    const names = new Set(this.level.objects.map((o) => o.name));
    let i = 1;
    while (names.has(`${base} ${i}`)) i++;
    return `${base} ${i}`;
  }

  finishDraft(close = false) {
    const d = this.draft;
    this.draft = null;
    if (!d || !this.level) return this.draw();
    // remove duplicate consecutive points (from double-click)
    const pts = d.points.filter((p, i, arr) => i === 0 || dist(p, arr[i - 1]) > 0.5);
    if (pts.length >= 2) {
      this.snapshot();
      const obj = d.type === 'wall'
        ? { id: uid('o'), type: 'wall', name: '', points: pts, closed: close && pts.length > 2 }
        : { id: uid('o'), type: 'rail', name: '', points: pts, strength: 6 };
      this.level.objects.push(obj);
      this.select(obj.id);
      this.changed();
    } else this.draw();
  }

  _key(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? this.redo() : this.undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.redo();
      return;
    }
    if (e.key === 'Enter') return this.finishDraft();
    if (e.key === 'Escape') {
      if (this.draft) {
        this.draft = null;
        this.draw();
      } else this.select(null);
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
      e.preventDefault();
      this.deleteSelected();
      return;
    }
    if (e.code === 'Space') {
      this.spaceDown = true;
      e.preventDefault();
      return;
    }
    if (mod) return;
    if (this.handleViewKey(e)) {
      e.preventDefault();
      return;
    }
    const tool = TOOLS.find((t) => t.shortcut && t.shortcut.toLowerCase() === e.key.toLowerCase());
    if (tool) this.onToolShortcut?.(tool.key);
  }

  // ---- drawing ------------------------------------------------------------
  draw() {
    if (!this.canvas.clientWidth) return;
    const workArea = this.workArea;
    this.view = fitView(this.canvas, this.bounds, 24, { zoom: this.zoom, pan: this.pan, focus: workArea ?? undefined });
    const scene = { objects: this.level?.objects ?? [], spawn: this.level?.spawn, areas: this.areas, workArea };
    if (this.draft) scene.draft = [...this.draft.points, ...(this.hover ? [this.hover] : [])];
    const d = this.drag;
    if (d?.kind === 'create') {
      const a = d.start, b = d.end;
      if (d.tool === 'zoneCircle') {
        scene.objects = [...scene.objects, { type: 'zone', shape: 'circle', x: a.x, y: a.y, r: dist(a, b) }];
      } else {
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(a.x - b.x), h = Math.abs(a.y - b.y);
        scene.objects = [...scene.objects, d.tool === 'box'
          ? { type: 'wall', points: rectPoints(x, y, w, h), closed: true }
          : { type: 'zone', shape: 'rect', x, y, w, h }];
      }
    }
    drawWorld(this.ctx, this.view, scene, { selectedId: this.selectedId, showVertices: true });
    // rect/circle resize handles
    const s = this.selected;
    if ((s?.type === 'zone' || s?.type === 'entity') && (s.shape === 'rect' || s.shape === 'circle')) {
      const p = s.shape === 'rect' ? { x: s.x + s.w, y: s.y + s.h } : { x: s.x + s.r, y: s.y };
      const q = this.view.toScreen(p);
      const ctx = this.ctx;
      ctx.save();
      ctx.setTransform(this.view.dpr, 0, 0, this.view.dpr, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#e8710a';
      ctx.lineWidth = 2;
      ctx.fillRect(q.x - 4, q.y - 4, 8, 8);
      ctx.strokeRect(q.x - 4, q.y - 4, 8, 8);
      ctx.restore();
    }
    // cursor coordinates
    if (this.hover) {
      const ctx = this.ctx;
      ctx.save();
      ctx.setTransform(this.view.dpr, 0, 0, this.view.dpr, 0, 0);
      ctx.font = '11px ui-monospace, Menlo, monospace';
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--fg-muted') || '#666';
      ctx.fillText(`x ${Math.round(this.hover.x)}  y ${Math.round(this.hover.y)} mm`, 10, this.view.h - 10);
      ctx.restore();
    }
  }
}
