// The DualPanto runtime: turns a project (script + levels) into a running app on a
// device (emulator or real hardware) and provides the API that scripts use.

import { Emitter } from './emitter.js';
import {
  toPoint, dist, rectPoints, circlePoints, shapeContains, shapeCenter,
  pointInPolygon, clampToPolygon, distToPolygonEdge, polygonCentroid,
} from './geometry.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

export class StopSignal extends Error {
  constructor() {
    super('Programm gestoppt');
    this.name = 'StopSignal';
  }
}

/** Collects dispose functions; used for level-scoped and global resources. */
class Scope {
  constructor(name) {
    this.name = name;
    this.items = new Set();
  }
  add(dispose) {
    this.items.add(dispose);
    return () => {
      this.items.delete(dispose);
      dispose();
    };
  }
  dispose() {
    for (const d of [...this.items].reverse()) {
      try {
        d();
      } catch (e) {
        console.error(e);
      }
    }
    this.items.clear();
  }
}

// ---------------------------------------------------------------------------

class Handle {
  constructor(rt, index, name) {
    this._rt = rt;
    this.index = index;
    this.name = name;
    this._pos = { x: 0, y: 0 };
    this._god = { x: 0, y: 0 };
    this._rot = 0;
    this._transition = null;
    this._moveListeners = new Set();
  }
  /** Position the user feels (god object), in mm. */
  get position() {
    return { ...this._god };
  }
  /** Physical position of the handle (may be inside a wall). */
  get handlePosition() {
    return { ...this._pos };
  }
  get x() {
    return this._god.x;
  }
  get y() {
    return this._god.y;
  }
  get rotation() {
    return this._rot;
  }
  get isMoving() {
    return !!this._transition;
  }
  /** Outline of the area this handle can reach (mm), or null if unknown. */
  get area() {
    return this._rt._area(this.index)?.map((q) => ({ ...q })) ?? null;
  }
  /** true if the handle can physically reach p. */
  canReach(p) {
    return this._rt._reachable(toPoint(p?.position ?? p), this.index);
  }
  distanceTo(p) {
    return dist(this._god, toPoint(p?.position ?? p));
  }
  /** fn(position) is called whenever the handle moves. */
  onMove(fn) {
    const g = this._rt._guard(fn);
    this._moveListeners.add(g);
    return this._rt._scope().add(() => this._moveListeners.delete(g));
  }
  /**
   * Moves the handle to p. Resolves when it arrives.
   * options: speed (mm/s, default 120), duration (s), rotation (deg), hold (keep it there afterwards)
   */
  moveTo(p, { speed = 120, duration, rotation = null, hold = this.index === 1 } = {}) {
    const rt = this._rt;
    rt._assertRunning();
    const wanted = toPoint(p?.position ?? p);
    const target = rt._clamp(wanted, this.index);
    if (dist(wanted, target) > 1) rt._warnOnce(`reach:${this.name}`, `${this.name}.moveTo: (${Math.round(wanted.x)}, ${Math.round(wanted.y)}) liegt außerhalb des Bereichs von ${this.name === 'me' ? 'Me' : 'It'}. Der Griff fährt zum nächsten erreichbaren Punkt.`);
    const d = dist(this._pos, target);
    const dur = duration ?? Math.max(0.3, d / Math.max(1, speed));
    if (this._transition) this._transition.resolve(false); // superseded
    rt.device.setSpeed(this.index, Math.min(100, 1 / dur));
    rt.device.moveHandle(this.index, target, rotation);
    return new Promise((resolve) => {
      const t = {
        resolve: (arrived) => {
          if (this._transition !== t) return;
          clearTimeout(t.timer);
          this._transition = null;
          if (!hold && arrived !== false) rt.device.free(this.index);
          resolve(arrived !== false);
        },
      };
      t.timer = setTimeout(() => t.resolve(true), dur * 1000 + 2000);
      this._transition = t;
    });
  }
  /** Gives control back to the user. */
  free() {
    this._transition?.resolve(false);
    this._rt.device.free(this.index);
  }
  /** Locks the handle at its current position. */
  freeze() {
    this._rt.device.freeze(this.index);
  }
  /** Force feedback: pushes in direction dir ({x,y}) with strength 0..1. */
  applyForce(dir, strength = 0.5) {
    this._rt.device.applyForce(this.index, toPoint(dir), strength);
  }
  stopForce() {
    this._rt.device.free(this.index);
  }
}

// ---------------------------------------------------------------------------

class WorldObject {
  constructor(rt, data) {
    this._rt = rt;
    Object.assign(this, data);
  }
  get isEnabled() {
    return this.enabled;
  }
}

class Obstacle extends WorldObject {
  enable() {
    if (this.enabled || this.removed) return this;
    this.enabled = true;
    for (const id of this.deviceIds) this._rt.device.enableObstacle(id, this.handles);
    this._rt._changed();
    return this;
  }
  disable() {
    if (!this.enabled || this.removed) return this;
    this.enabled = false;
    for (const id of this.deviceIds) this._rt.device.disableObstacle(id, this.handles);
    this._rt._changed();
    return this;
  }
  remove() {
    this._dispose?.();
  }
}

class Zone extends WorldObject {
  constructor(rt, data) {
    super(rt, data);
    this._enter = new Set();
    this._exit = new Set();
    this._inside = new Map(); // handle index -> bool
  }
  contains(p) {
    return shapeContains(this, toPoint(p?.position ?? p));
  }
  get center() {
    return shapeCenter(this);
  }
  isInside(handle = 'me') {
    const h = handle === 'it' ? 1 : 0;
    return !!this._inside.get(h);
  }
  /** fn(handle) when a handle enters the zone. */
  onEnter(fn) {
    const g = this._rt._guard(fn);
    this._enter.add(g);
    return this._rt._scope().add(() => this._enter.delete(g));
  }
  /** fn(handle) when a handle leaves the zone. */
  onExit(fn) {
    const g = this._rt._guard(fn);
    this._exit.add(g);
    return this._rt._scope().add(() => this._exit.delete(g));
  }
  enable() {
    this.enabled = true;
    this._rt._changed();
    return this;
  }
  disable() {
    this.enabled = false;
    this._inside.clear();
    this._rt._changed();
    return this;
  }
  remove() {
    this._dispose?.();
  }
}

class Level {
  constructor(rt, data) {
    this._rt = rt;
    this.data = data;
    this.name = data.name;
    this.objects = [];
  }
  /** Finds a zone of this level by its name. */
  zone(name) {
    const z = this.objects.find((o) => o.type === 'zone' && o.name === name);
    if (!z) this._rt.log('warn', `Zone „${name}“ gibt es in Level „${this.name}“ nicht.`);
    return z ?? this._rt._dummyZone();
  }
  /** Finds any object (wall, rail, zone) of this level by its name. */
  object(name) {
    return this.objects.find((o) => o.name === name) ?? null;
  }
  zones() {
    return this.objects.filter((o) => o.type === 'zone');
  }
  get spawn() {
    return this.data.spawn ?? {};
  }
}

// ---------------------------------------------------------------------------

export class Runtime extends Emitter {
  /**
   * @param {object} opts
   * @param {object} opts.device  Emulator or SerialDevice
   * @param {object} opts.project project data (script, levels, settings)
   */
  constructor({ device, project }) {
    super();
    this.device = device;
    this.project = project;
    this.running = false;
    this.objects = new Map(); // id -> WorldObject (walls, rails, zones) for rendering
    this.me = new Handle(this, 0, 'me');
    this.it = new Handle(this, 1, 'it');
    this.handles = [this.me, this.it];
    this.level = null;
    this.state = {};
    this._nextId = 1;
    this._globalScope = new Scope('global');
    this._levelScope = null;
    this._levelHandlers = [];
    this._keyHandlers = new Set();
    this._stopHandlers = [];
    this._lineOffset = computeLineOffset();
    this._sources = new Map(); // sourceURL -> { id, label }
    this._unsub = [];
    this._audio = null;
    this.caption = '';
  }

  // ---- lifecycle --------------------------------------------------------
  async start() {
    this.running = true;
    const d = this.device;
    this._unsub.push(
      d.on('position', (hs) => this._onPosition(hs)),
      d.on('transitionEnded', (i) => this.handles[i]?._transition?.resolve(true)),
      d.on('deviceReset', () => this._reupload())
    );
    this._onKeyDown = (e) => this._handleKey(e);
    window.addEventListener('keydown', this._onKeyDown);
    this.log('info', `▶ Start (${d.kind === 'serial' ? 'DualPanto' : 'Emulator'})`);
    try {
      await this._setupBoundary();
    } catch (e) {
      this._reportError(e);
    }

    const main = this._compile(this.project.script, { id: 'main', label: 'Skript' });
    if (!main) {
      this.stop();
      return;
    }
    try {
      await main();
    } catch (e) {
      this._reportError(e);
    }
    if (this.running && !this.level) {
      const first = this.project.startLevel ?? this.project.levels?.[0]?.name;
      if (first) await this.loadLevel(first);
    }
  }

  stop() {
    if (!this.running) return;
    for (const fn of this._stopHandlers) {
      try {
        fn();
      } catch (e) {
        this._reportError(e);
      }
    }
    this.running = false;
    this._levelScope?.dispose();
    this._globalScope.dispose();
    for (const id of [...this.objects.keys()]) this.objects.delete(id);
    for (const h of this.handles) {
      h._transition?.resolve(false);
      try {
        this.device.free(h.index);
      } catch {}
    }
    this._unsub.forEach((u) => u());
    this._unsub = [];
    window.removeEventListener('keydown', this._onKeyDown);
    this.stopSounds();
    try {
      speechSynthesis.cancel();
    } catch {}
    this._recognition?.stop?.();
    this._audio?.close?.();
    this.caption = '';
    this.level = null;
    this.log('info', '■ Gestoppt');
    this.emit('stopped');
    this._changed();
  }

  // ---- scripts ----------------------------------------------------------
  /**
   * Compiles a script (main script or level script) into a callable function.
   * `source` = { id, label, extra } – id identifies the file in error messages.
   */
  _compile(code, source, extra = {}) {
    if (!code || !code.trim()) return null;
    const api = { ...this._buildApi(), ...extra };
    const names = Object.keys(api);
    const url = `dp-${source.id}.js`;
    this._sources.set(url, source);
    try {
      const fn = new AsyncFunction(...names, `${code}\n//# sourceURL=${url}`);
      return () => fn(...names.map((n) => api[n]));
    } catch (e) {
      this.log('error', `Syntaxfehler in ${source.label}: ${e.message}`, undefined, source);
      return null;
    }
  }

  // ---- logging / errors -------------------------------------------------
  log(level, text, line, source) {
    this.emit('log', { level, text, line, source });
  }

  _reportError(e) {
    if (e instanceof StopSignal || e?.name === 'StopSignal') return;
    const at = findLine(e, this._sources);
    this.log('error', `${e?.name ?? 'Fehler'}: ${e?.message ?? e}`, at?.line, at?.source);
  }

  /** Wraps a user callback so errors are reported instead of breaking the runtime. */
  _guard(fn) {
    if (typeof fn !== 'function') throw new TypeError('Funktion erwartet');
    return (...args) => {
      if (!this.running) return;
      try {
        const r = fn(...args);
        if (r && typeof r.catch === 'function') r.catch((e) => this._reportError(e));
        return r;
      } catch (e) {
        this._reportError(e);
      }
    };
  }

  _assertRunning() {
    if (!this.running) throw new StopSignal();
  }

  _scope(persistent = false) {
    return persistent || !this._levelScope ? this._globalScope : this._levelScope;
  }

  _changed() {
    this.emit('changed');
  }

  /** Working area polygon of a handle (0 = me, 1 = it) from the device profile. */
  _area(index) {
    return this.device.profile?.areas?.[index === 1 ? 'it' : 'me'] ?? null;
  }

  _reachable(p, index) {
    const area = this._area(index);
    if (area) return pointInPolygon(p, area);
    const b = this.device.bounds;
    return p.x >= 0 && p.y >= 0 && p.x <= b.width && p.y <= b.height;
  }

  /** Keeps a target inside the handle's working area (3 mm away from the edge). */
  _clamp(p, index = 0) {
    const area = this._area(index);
    if (area) return clampToPolygon(p, area, 3);
    const b = this.device.bounds;
    return { x: Math.max(0, Math.min(b.width, p.x)), y: Math.max(0, Math.min(b.height, p.y)) };
  }

  _warnOnce(key, text) {
    this._warned ??= new Set();
    if (this._warned.has(key)) return;
    this._warned.add(key);
    this.log('warn', text);
  }

  /**
   * Optional: the edge of Me's working area becomes a wall, so the person feels where the
   * play area ends. Off by default – it costs one packet per point before anything else is
   * sent, and on hardware we want the level's own obstacles to go out first.
   * Turn it on with the "Rand als Wand" switch (project setting `boundary`).
   */
  async _setupBoundary() {
    const area = this._area(0);
    if (!area || !this.project.settings?.boundary) return;
    await new Promise((r) => setTimeout(r, 60)); // wait for the first position update
    if (!this.running) return;
    if (!pointInPolygon(this.me._god, area)) {
      // a wall would trap the god object outside: bring the handle in first
      await this.me.moveTo(clampToPolygon(this.me._god, area, 12));
    }
    if (!this.running) return;
    // every second point is enough for the outline and halves the number of packets
    const coarse = area.filter((_, i) => i % 2 === 0);
    this.createWall(coarse, { closed: true, handles: 'me', persistent: true, boundary: true });
  }

  _allocDeviceId() {
    return this.device.allocId?.() ?? this._nextId++;
  }

  /** After a device reboot all obstacles are gone: send them again (same ids, same state). */
  _reupload() {
    if (!this.running) return;
    let n = 0;
    for (const o of this.objects.values()) {
      if (!o._upload || o.removed) continue;
      o._upload();
      if (o.enabled) for (const id of o.deviceIds) this.device.enableObstacle(id, o.handles);
      n++;
    }
    this.log('info', `${n} Hindernisse erneut übertragen.`);
  }

  /** Warns about level content the handles cannot reach. */
  _checkLevelReach(data) {
    const me = this._area(0);
    const it = this._area(1);
    if (!me) return;
    const outside = [];
    const label = (o, i) => o.name || { wall: 'Wand', rail: 'Schiene', zone: 'Zone' }[o.type] + ` #${i + 1}`;
    (data.objects ?? []).forEach((o, i) => {
      const handle = o.type === 'zone' ? o.handle ?? 'me' : o.handles ?? 'both';
      const area = handle === 'it' ? it : me;
      const pts = o.points ?? [shapeCenter(o)];
      // walls may stick out over the edge (that closes gaps); everything else must be reachable
      const bad = o.type === 'wall' ? pts.every((q) => !pointInPolygon(q, area)) : pts.some((q) => !pointInPolygon(q, area));
      if (bad) outside.push(label(o, i));
    });
    if (data.spawn?.me && !pointInPolygon(data.spawn.me, me)) outside.push('Start Me');
    if (data.spawn?.it && it && !pointInPolygon(data.spawn.it, it)) outside.push('Start It');
    if (outside.length) this.log('warn', `Level „${data.name}“: außerhalb des erreichbaren Bereichs: ${outside.join(', ')}`);
  }

  // ---- position updates / zones -----------------------------------------
  _onPosition(hs) {
    if (!this.running) return;
    hs.forEach((h, i) => {
      const handle = this.handles[i];
      if (!handle) return;
      const moved = dist(handle._god, h.god) > 0.01;
      handle._pos = { x: h.x, y: h.y };
      handle._god = { ...h.god };
      handle._rot = h.rot;
      if (moved) for (const fn of handle._moveListeners) fn(handle.position);
    });
    this._checkZones();
    this.emit('frame');
  }

  _checkZones() {
    for (const o of this.objects.values()) {
      if (o.type !== 'zone' || !o.enabled) continue;
      const which = o.handle === 'both' ? [0, 1] : o.handle === 'it' ? [1] : [0];
      for (const i of which) {
        const h = this.handles[i];
        const inside = shapeContains(o, h._god);
        const was = !!o._inside.get(i);
        if (inside === was) continue;
        o._inside.set(i, inside);
        if (h.isMoving) continue; // moved there by the program: update silently
        if (inside) {
          if (o.speak) this.speak(o.speak, { interrupt: true });
          for (const fn of o._enter) fn(h);
        } else {
          for (const fn of o._exit) fn(h);
        }
      }
    }
  }

  _dummyZone() {
    return new Zone(this, { type: 'zone', shape: 'rect', x: -1e6, y: -1e6, w: 0, h: 0, enabled: false });
  }

  // ---- world objects ----------------------------------------------------
  _register(obj, persistent) {
    this.objects.set(obj.id, obj);
    const dispose = () => {
      obj.removed = true;
      if (obj.deviceIds) for (const id of obj.deviceIds) this.device.removeObstacle(id, obj.handles);
      this.objects.delete(obj.id);
      this._changed();
    };
    obj._dispose = this._scope(persistent).add(dispose);
    this._changed();
    return obj;
  }

  createWall(points, { closed = false, passable = false, handles = 'both', name = '', enabled = true, persistent = false, boundary = false } = {}) {
    this._assertRunning();
    const pts = points.map(toPoint);
    if (pts.length < 2) throw new Error('Eine Wand braucht mindestens 2 Punkte.');
    const devId = this._allocDeviceId();
    const upload = () => this.device.createObstacle(devId, pts, { closed, passable, handles });
    upload();
    const obj = new Obstacle(this, { id: devId, type: 'wall', name, points: pts, closed, passable, handles, enabled: false, deviceIds: [devId], boundary, _upload: upload });
    this._register(obj, persistent);
    if (enabled) obj.enable();
    return obj;
  }

  createRail(points, { strength = 5, handles = 'both', name = '', enabled = true, persistent = false } = {}) {
    this._assertRunning();
    const pts = points.map(toPoint);
    if (pts.length < 2) throw new Error('Eine Rail braucht mindestens 2 Punkte.');
    const ids = [];
    for (let i = 0; i < pts.length - 1; i++) ids.push(this._allocDeviceId());
    const upload = () => ids.forEach((id, i) => this.device.createRail(id, pts[i], pts[i + 1], strength, { handles }));
    upload();
    const obj = new Obstacle(this, { id: ids[0], type: 'rail', name, points: pts, strength, handles, enabled: false, deviceIds: ids, _upload: upload });
    this._register(obj, persistent);
    if (enabled) obj.enable();
    return obj;
  }

  createZone(shape, { name = '', speak = '', handle = 'me', enabled = true, persistent = false, label } = {}) {
    this._assertRunning();
    let s;
    if (Array.isArray(shape)) s = { shape: 'polygon', points: shape.map(toPoint) };
    else if (shape.shape === 'polygon') s = { shape: 'polygon', points: shape.points.map(toPoint) };
    else if (shape.shape === 'circle') s = { shape: 'circle', x: shape.x, y: shape.y, r: shape.r };
    else if (shape.shape === 'rect') s = { shape: 'rect', x: shape.x, y: shape.y, w: shape.w, h: shape.h };
    else if ('r' in shape) s = { shape: 'circle', x: shape.x, y: shape.y, r: shape.r };
    else s = { shape: 'rect', x: shape.x, y: shape.y, w: shape.w ?? shape.width, h: shape.h ?? shape.height };
    const obj = new Zone(this, { id: `z${this._nextId++}`, type: 'zone', name, speak, handle, enabled, label, ...s });
    // a handle that already stands in a new zone does not "enter" it
    for (const h of this.handles) obj._inside.set(h.index, shapeContains(obj, h._god));
    return this._register(obj, persistent);
  }

  _instantiate(o) {
    const common = { name: o.name ?? '', enabled: o.enabled !== false };
    switch (o.type) {
      case 'wall':
        return this.createWall(o.points, { ...common, closed: !!o.closed, passable: !!o.passable, handles: o.handles ?? 'both' });
      case 'rail':
        return this.createRail(o.points, { ...common, strength: o.strength ?? 5, handles: o.handles ?? 'both' });
      case 'zone':
        return this.createZone(o, { ...common, speak: o.speak ?? '', handle: o.handle ?? 'me' });
      default:
        return null;
    }
  }

  // ---- levels -----------------------------------------------------------
  async loadLevel(name) {
    this._assertRunning();
    const data = this.project.levels?.find((l) => l.name === name);
    if (!data) {
      this.log('error', `Level „${name}“ gibt es nicht. Vorhanden: ${this.levelNames().join(', ') || '–'}`);
      return null;
    }
    this._levelScope?.dispose();
    this._levelScope = new Scope('level:' + name);
    const level = new Level(this, data);
    this.level = level;
    this._checkLevelReach(data);
    for (const o of data.objects ?? []) {
      const obj = this._instantiate(o);
      if (obj) level.objects.push(obj);
    }
    this.log('info', `Level „${name}“ geladen`);
    this.emit('level', level);
    this._changed();

    // the level's own script: everything it creates belongs to this level
    const levelFn = this._compile(data.script, { id: `level-${data.id}`, label: `Level „${name}“`, levelId: data.id }, { level });
    if (levelFn) {
      try {
        const r = levelFn();
        if (r && typeof r.catch === 'function') r.catch((e) => this._reportError(e));
      } catch (e) {
        this._reportError(e);
      }
    }

    const moves = [];
    if (data.spawn?.me) moves.push(this.me.moveTo(data.spawn.me));
    if (data.spawn?.it) moves.push(this.it.moveTo(data.spawn.it));
    if (data.intro) this.speak(data.intro, { interrupt: true });
    for (const h of this._levelHandlers) {
      if (h.name == null || h.name === name) h.fn(level);
    }
    await Promise.all(moves);
    return level;
  }

  levelNames() {
    return (this.project.levels ?? []).map((l) => l.name);
  }

  // ---- speech & sound ---------------------------------------------------
  speak(text, { interrupt = false, lang, rate = 1, pitch = 1 } = {}) {
    text = String(text ?? '');
    this.caption = text;
    this.emit('speech', text);
    this.log('speech', text);
    if (!this.running || typeof speechSynthesis === 'undefined') return Promise.resolve();
    if (interrupt) speechSynthesis.cancel();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang ?? this.project.settings?.lang ?? 'de-DE';
      u.rate = rate;
      u.pitch = pitch;
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      u.onend = done;
      u.onerror = done;
      // browsers without voices never fire "end": resolve after an estimate
      const timer = setTimeout(done, 1500 + text.length * 90 / rate);
      speechSynthesis.speak(u);
    });
  }

  _ctx() {
    if (!this._audio) this._audio = new (window.AudioContext || window.webkitAudioContext)();
    return this._audio;
  }

  beep(freq = 440, ms = 150, { volume = 0.2, type = 'sine' } = {}) {
    if (!this.running) return Promise.resolve();
    const ctx = this._ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(volume, t + 0.01);
    gain.gain.linearRampToValueAtTime(0, t + ms / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + ms / 1000 + 0.02);
    return new Promise((r) => setTimeout(r, ms));
  }

  // ---- uploaded sounds --------------------------------------------------
  /** Resolves a sound name ("klick.wav", "klick") or a URL to a playable URL. */
  _soundUrl(name) {
    const map = this.project.assetUrls ?? {};
    return map[name] ?? (/^(https?:|blob:|data:|\.|\/)/.test(name) ? name : null);
  }

  async _audioBuffer(name) {
    const url = this._soundUrl(name);
    if (!url) {
      const have = (this.project.assets ?? []).map((a) => a.name).join(', ');
      throw new Error(`Sound „${name}“ gibt es nicht. Hochgeladen sind: ${have || '– noch keine Sounds'}`);
    }
    this._buffers ??= new Map();
    if (!this._buffers.has(url)) {
      this._buffers.set(
        url,
        fetch(url)
          .then((r) => r.arrayBuffer())
          .then((ab) => this._ctx().decodeAudioData(ab))
          .catch((e) => {
            this._buffers.delete(url);
            throw new Error(`Sound „${name}“ konnte nicht geladen werden: ${e.message}`);
          })
      );
    }
    return this._buffers.get(url);
  }

  /**
   * Plays an uploaded sound. Returns a handle: { stop(), ended } – `ended` is a promise
   * that resolves when the sound is over, so `await sound.play("x").ended` works.
   */
  playSound(name, { volume = 1, loop = false, rate = 1 } = {}) {
    const handle = { stopped: false, stop: () => {}, ended: Promise.resolve() };
    if (!this.running) return handle;
    let resolveEnded;
    handle.ended = new Promise((r) => (resolveEnded = r));
    this._playing ??= new Set();
    this._playing.add(handle);
    const dispose = this._scope().add(() => handle.stop());
    handle.stop = () => {
      handle.stopped = true;
      this._playing?.delete(handle);
      try {
        handle.source?.stop();
      } catch {}
      resolveEnded();
    };
    this._audioBuffer(name)
      .then((buffer) => {
        if (handle.stopped || !this.running) return;
        const ctx = this._ctx();
        const src = ctx.createBufferSource();
        const gain = ctx.createGain();
        src.buffer = buffer;
        src.loop = loop;
        src.playbackRate.value = rate;
        gain.gain.value = volume;
        src.connect(gain).connect(ctx.destination);
        src.onended = () => {
          this._playing?.delete(handle);
          dispose?.();
          resolveEnded();
        };
        handle.source = src;
        src.start();
      })
      .catch((e) => {
        this.log('warn', e.message);
        handle.stop();
      });
    return handle;
  }

  stopSounds() {
    for (const h of [...(this._playing ?? [])]) h.stop();
  }

  // ---- keyboard ---------------------------------------------------------
  _handleKey(e) {
    if (!this.running) return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"], .monaco-editor, .code-editor, [data-no-runtime-keys]')) return;
    const key = e.key === ' ' ? 'Space' : e.key;
    let handled = false;
    for (const h of this._keyHandlers) {
      if (h.key === '*' || h.key.toLowerCase() === key.toLowerCase() || h.key === e.code) {
        handled = true;
        h.fn(key, e);
      }
    }
    if (handled) e.preventDefault();
  }

  // ---- API for scripts --------------------------------------------------
  _buildApi() {
    const rt = this;
    const timers = (persistent) => rt._scope(persistent);

    const panto = {
      get me() { return rt.me; },
      get it() { return rt.it; },
      get level() { return rt.level; },
      get levels() { return rt.levelNames(); },
      get width() { return rt.device.bounds.width; },
      get height() { return rt.device.bounds.height; },
      get device() { return rt.device.kind; },
      /** Working area of a handle: { points, contains(p) } */
      area: (handle = 'me') => {
        const i = handle === 'it' ? 1 : 0;
        return { points: rt._area(i)?.map((q) => ({ ...q })) ?? null, contains: (p) => rt._reachable(toPoint(p?.position ?? p), i) };
      },
      canReach: (p, handle = 'me') => {
        const q = toPoint(p?.position ?? p);
        return handle === 'both' ? rt._reachable(q, 0) && rt._reachable(q, 1) : rt._reachable(q, handle === 'it' ? 1 : 0);
      },
      wall: (points, opts) => rt.createWall(points, opts),
      box: (x, y, w, h, opts = {}) => rt.createWall(rectPoints(x, y, w, h), { closed: true, ...opts }),
      circle: (x, y, r, opts = {}) => rt.createWall(circlePoints(x, y, r, opts.corners ?? 16), { closed: true, ...opts }),
      rail: (points, opts) => rt.createRail(points, opts),
      zone: (shape, opts) => rt.createZone(shape, opts),
      loadLevel: (name) => rt.loadLevel(name),
      nextLevel: () => {
        const names = rt.levelNames();
        const i = names.indexOf(rt.level?.name);
        if (i >= 0 && i < names.length - 1) return rt.loadLevel(names[i + 1]);
        return Promise.resolve(null);
      },
      /** onLevel(name, fn) or onLevel(fn): runs fn(level) every time the level is loaded. */
      onLevel: (name, fn) => {
        if (typeof name === 'function') [name, fn] = [null, name];
        rt._levelHandlers.push({ name, fn: rt._guard(fn) });
      },
      onStop: (fn) => {
        rt._stopHandlers.push(fn);
      },
      stop: () => rt.stop(),
    };

    const speak = (text, opts) => rt.speak(text, opts);

    const sound = {
      beep: (freq, ms, opts) => rt.beep(freq, ms, opts),
      tick: () => rt.beep(1400, 25, { volume: 0.15, type: 'square' }),
      success: async () => {
        await rt.beep(660, 90);
        await rt.beep(880, 140);
      },
      error: () => rt.beep(180, 250, { type: 'sawtooth', volume: 0.12 }),
      /** Plays an uploaded sound by its file name (or any URL). */
      play: (name, opts) => rt.playSound(name, opts),
      /** Decodes sounds in advance so the first playback is not delayed. */
      preload: (...names) => Promise.all(names.flat().map((n) => rt._audioBuffer(n).catch(() => null))),
      stopAll: () => rt.stopSounds(),
      /** Names of the sounds uploaded for this project. */
      get names() {
        return (rt.project.assets ?? []).map((a) => a.name);
      },
    };

    const after = (ms, fn, { persistent = false } = {}) => {
      rt._assertRunning();
      const id = setTimeout(rt._guard(fn), ms);
      return timers(persistent).add(() => clearTimeout(id));
    };
    const every = (ms, fn, { persistent = false } = {}) => {
      rt._assertRunning();
      const id = setInterval(rt._guard(fn), ms);
      return timers(persistent).add(() => clearInterval(id));
    };
    const wait = (ms) =>
      new Promise((resolve, reject) => {
        if (!rt.running) return reject(new StopSignal());
        const id = setTimeout(() => (rt.running ? resolve() : reject(new StopSignal())), ms);
        rt._globalScope.add(() => {
          clearTimeout(id);
          reject(new StopSignal());
        });
      });

    const onKey = (key, fn, { persistent = false } = {}) => {
      const h = { key: key === ' ' ? 'Space' : key, fn: rt._guard(fn) };
      rt._keyHandlers.add(h);
      return timers(persistent).add(() => rt._keyHandlers.delete(h));
    };

    const prefix = `dualpanto:${rt.project.id ?? 'default'}:`;
    const storage = {
      get(key, fallback = null) {
        try {
          const v = localStorage.getItem(prefix + key);
          return v == null ? fallback : JSON.parse(v);
        } catch {
          return fallback;
        }
      },
      set(key, value) {
        try {
          localStorage.setItem(prefix + key, JSON.stringify(value));
        } catch (e) {
          rt.log('warn', 'Speichern nicht möglich: ' + e.message);
        }
      },
      remove(key) {
        try {
          localStorage.removeItem(prefix + key);
        } catch {}
      },
    };

    const listen = (commands, fn) => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        rt.log('warn', 'Spracherkennung wird von diesem Browser nicht unterstützt.');
        return () => {};
      }
      const rec = new SR();
      rec.lang = rt.project.settings?.lang ?? 'de-DE';
      rec.continuous = true;
      rec.interimResults = false;
      const g = rt._guard(fn);
      rec.onresult = (ev) => {
        const text = ev.results[ev.results.length - 1][0].transcript.trim().toLowerCase();
        rt.log('info', `🎤 „${text}“`);
        const match = commands?.length ? commands.find((c) => text.includes(String(c).toLowerCase())) : text;
        if (match) g(match, text);
      };
      rec.onend = () => rt.running && active && rec.start();
      let active = true;
      rec.start();
      rt._recognition = rec;
      return rt._scope().add(() => {
        active = false;
        rec.stop();
      });
    };

    const ui = {
      menu: (items, opts) => createMenu(rt, { speak, sound, onKey }, items, opts),
      prompt: async (question, def = '') => {
        await rt.speak(question, { interrupt: true });
        return window.prompt(question, def);
      },
    };

    const log = (...args) => rt.log('log', args.map(fmt).join(' '));
    const random = (min = 0, max = 1) => min + Math.random() * (max - min);
    /** Random point that the given handle(s) can reach, at least `margin` mm from the edge. */
    const randomPoint = (margin = 15, handle = 'both') => {
      const areas = (handle === 'both' ? [0, 1] : [handle === 'it' ? 1 : 0]).map((i) => rt._area(i)).filter(Boolean);
      const b = rt.device.bounds;
      if (!areas.length) return { x: random(margin, b.width - margin), y: random(margin, b.height - margin) };
      for (let i = 0; i < 2000; i++) {
        const q = { x: random(0, b.width), y: random(0, b.height) };
        if (areas.every((a) => pointInPolygon(q, a) && distToPolygonEdge(q, a) >= margin)) return q;
      }
      return polygonCentroid(areas[0]);
    };
    const distance = (a, b) => dist(toPoint(a?.position ?? a), toPoint(b?.position ?? b));

    return {
      panto, me: rt.me, it: rt.it, speak, sound, after, every, wait, onKey, listen, ui, storage,
      state: rt.state, log, random, randomPoint, distance,
    };
  }
}

// ---------------------------------------------------------------------------
// ui.menu: a haptic list. A rail guides the handle, every item is a zone that
// announces itself; Enter/Space selects.

function createMenu(rt, { speak, sound, onKey }, items, opts = {}) {
  const {
    x = 190, y = 55, spacing = 25, width = 120, title = '',
    onSelect = () => {}, onFocus = () => {}, strength = 6, moveHandle = true, announceIndex = true,
  } = opts;
  const menu = {
    items: [],
    focused: -1,
    _parts: [],
    get length() { return this.items.length; },
    remove() {
      clearItems();
      keys.forEach((off) => off());
      keys = [];
    },
    select(i = this.focused) {
      if (i >= 0 && i < this.items.length) rt._guard(onSelect)(this.items[i], i, menu);
    },
    setItems(newItems) {
      const keep = this.focused;
      clearItems();
      build(newItems);
      this.focused = Math.min(keep, this.items.length - 1);
    },
  };
  const label = (it) => (typeof it === 'string' ? it : it?.label ?? String(it));

  let keys = [];
  function clearItems() {
    menu._parts.forEach((p) => p.remove());
    menu._parts = [];
  }

  function build(list) {
    menu.items = [...list];
    const n = menu.items.length;
    if (n > 1) menu._parts.push(rt.createRail([{ x, y }, { x, y: y + spacing * (n - 1) }], { strength, handles: 'me', name: 'menu-rail' }));
    menu.items.forEach((item, i) => {
      const z = rt.createZone({ x: x - width / 2, y: y + i * spacing - spacing / 2, w: width, h: spacing }, { name: `menu:${i}`, label: label(item) });
      z.onEnter(() => {
        menu.focused = i;
        sound.tick();
        speak(label(item) + (announceIndex ? `, ${i + 1} von ${n}` : ''), { interrupt: true });
        rt._guard(onFocus)(item, i, menu);
      });
      menu._parts.push(z);
    });
  }

  build(items);
  keys = [onKey('Enter', () => menu.select()), onKey('Space', () => menu.select())];
  if (title) speak(title, { interrupt: true });
  if (moveHandle && items.length) rt.me.moveTo({ x, y }).then(() => {
    menu.focused = 0;
    if (rt.running) speak(label(menu.items[0]) + (announceIndex ? `, 1 von ${menu.items.length}` : ''));
  });
  return menu;
}

// ---------------------------------------------------------------------------

function fmt(v) {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Line numbers of Function/AsyncFunction bodies are shifted by the generated header. */
function computeLineOffset() {
  try {
    const e = new Function('a', 'b', 'return new Error("probe")\n//# sourceURL=probe.js')();
    const m = /probe\.js:(\d+)/.exec(e.stack || '');
    return m ? +m[1] - 1 : 2;
  } catch {
    return 2;
  }
}

function findLine(e, sources) {
  const m = /dp-([\w-]+)\.js:(\d+)(?::(\d+))?/.exec(e?.stack || '');
  if (!m) return null;
  const off = computeLineOffset();
  return { source: sources?.get(`dp-${m[1]}.js`), line: Math.max(1, +m[2] - off) };
}
