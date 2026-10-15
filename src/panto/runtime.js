// The DualPanto runtime: turns a project (script + levels) into a running app on a
// device (emulator or real hardware) and provides the API that scripts use.

import { Emitter } from './emitter.js';
import { VoiceInput, bestMatch, parseNumber, normalize as normalizeText } from './voice.js';
import {
  toPoint,
  dist,
  rectPoints,
  circlePoints,
  shapeContains,
  shapeCenter,
  pointInPolygon,
  clampToPolygon,
  distToPolygonEdge,
  polygonCentroid,
} from './geometry.js';
import { StopSignal, Scope } from './scope.js';
import { Handle } from './handle.js';
import { WorldObject, Obstacle, Zone, Entity, entityArgs } from './objects.js';
import { Level } from './level.js';
import { createMenu } from './menu.js';

export { StopSignal, Scope, Handle, WorldObject, Obstacle, Zone, Entity, Level };

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

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
    this._frameHandlers = new Set();
    this._codeLevels = new Map(); // levels defined in code via panto.defineLevel
    this._time = 0;
    this._lineOffset = computeLineOffset();
    this._sources = new Map(); // sourceURL -> { id, label }
    this._unsub = [];
    this._audio = null;
    this.caption = '';
    this.heard = '';
    this.voice = new VoiceInput(this);
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
    this._startTicker();
    this.log('info', `▶ Start (${d.kind === 'serial' ? 'DualPanto' : 'Emulator'})`);
    try {
      await this._setupBoundary();
    } catch (e) {
      this._reportError(e);
    }

    const main = this._compile(this.project.script, { id: 'main', label: 'Script' });
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
    this._stopTicker?.();
    this._levelScope?.dispose();
    this._globalScope.dispose();
    for (const id of [...this.objects.keys()]) this.objects.delete(id);
    for (const h of this.handles) {
      h._follow = null;
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
    this.voice.dispose();
    this._audio?.close?.();
    this.caption = '';
    this.heard = '';
    this.level = null;
    this.log('info', '■ Stopped');
    this.emit('stopped');
    this._changed();
  }

  // ---- frame loop -------------------------------------------------------
  /**
   * Drives everything that moves on its own: entities, follow/patrol, onFrame
   * callbacks and the touch test. Runs on requestAnimationFrame when available.
   */
  _startTicker() {
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (fn) => setTimeout(() => fn(now()), 16);
    const cancel = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;
    this._t0 = now();
    let last = this._t0;
    let handle = null;
    const step = () => {
      if (!this.running) return;
      const t = now();
      const dt = Math.min(0.1, Math.max(0, (t - last) / 1000));
      last = t;
      this._time = (t - this._t0) / 1000;
      try {
        this._tick(dt, t);
      } catch (e) {
        this._reportError(e);
      }
      handle = raf(step);
    };
    handle = raf(step);
    this._stopTicker = () => {
      try {
        cancel(handle);
      } catch {}
      this._stopTicker = null;
    };
  }

  _tick(dt, now) {
    let moved = false;
    for (const o of [...this.objects.values()]) {
      if (o.type === 'entity' && o._step(dt)) moved = true;
    }
    // handles attached to an object keep getting the new target position
    for (const h of this.handles) h._tickFollow(now);
    this._checkTouch();
    for (const fn of [...this._frameHandlers]) fn(dt, this._time);
    if (moved) this.emit('frame');
  }

  /** Entities react when a handle comes inside their radius. */
  _checkTouch() {
    for (const o of this.objects.values()) {
      if (o.type !== 'entity' || !o.isVisible) continue;
      const which = o.handle === 'both' ? [0, 1] : o.handle === 'it' ? [1] : [0];
      for (const i of which) {
        const h = this.handles[i];
        if (!h) continue;
        const near = dist(h._god, o) <= (o.r ?? 8);
        const was = !!o._inside.get(i);
        if (near === was) continue;
        o._inside.set(i, near);
        if (h.isMoving) continue; // the program is driving the handle: no trigger
        if (near) o._fire(h);
        else for (const fn of o._leave) fn(h);
      }
    }
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
      this.log('error', `Syntax error in ${source.label}: ${e.message}`, undefined, source);
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
    this.log('error', `${e?.name ?? 'Error'}: ${e?.message ?? e}`, at?.line, at?.source);
  }

  /** Wraps a user callback so errors are reported instead of breaking the runtime. */
  _guard(fn) {
    if (typeof fn !== 'function') throw new TypeError('Function expected');
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

  /**
   * Target point of an object: entity/handle (position), zone (center), point, or a
   * function that returns a point. null if no point can be derived.
   */
  _targetPoint(t) {
    try {
      const v = typeof t === 'function' ? t() : t;
      if (v == null) return null;
      return toPoint(v.position ?? (v.type === 'zone' ? v.center : null) ?? v);
    } catch {
      return null;
    }
  }

  /** Keeps a point on the working area (entities may stand anywhere on it). */
  _clampWorld(p) {
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
   * Turn it on with the "Boundary" switch (project setting `boundary`).
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
    this.log('info', `${n} obstacles sent again.`);
  }

  /** Warns about level content the handles cannot reach. */
  _checkLevelReach(data) {
    const me = this._area(0);
    const it = this._area(1);
    if (!me) return;
    const outside = [];
    const label = (o, i) =>
      o.name ||
      { wall: 'Wall', rail: 'Rail', zone: 'Zone', entity: 'Object' }[o.type] + ` #${i + 1}`;
    (data.objects ?? []).forEach((o, i) => {
      const handle =
        o.type === 'zone' || o.type === 'entity' ? o.handle ?? 'me' : o.handles ?? 'both';
      const area = handle === 'it' ? it : me;
      const pts = o.type === 'entity' ? [{ x: o.x, y: o.y }] : o.points ?? [shapeCenter(o)];
      // walls may stick out over the edge (that closes gaps); everything else must be reachable
      const bad =
        o.type === 'wall'
          ? pts.every((q) => !pointInPolygon(q, area))
          : pts.some((q) => !pointInPolygon(q, area));
      if (bad) outside.push(label(o, i));
    });
    if (data.spawn?.me && !pointInPolygon(data.spawn.me, me)) outside.push('Start Me');
    if (data.spawn?.it && it && !pointInPolygon(data.spawn.it, it)) outside.push('Start It');
    if (outside.length) {
      this.log('warn', `Level "${data.name}": outside the reachable area: ${outside.join(', ')}`);
    }
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
    return new Zone(this, {
      type: 'zone',
      shape: 'rect',
      x: -1e6,
      y: -1e6,
      w: 0,
      h: 0,
      enabled: false,
    });
  }

  // ---- world objects ----------------------------------------------------
  _register(obj, persistent) {
    this.objects.set(obj.id, obj);
    // objects a level script creates belong to that level, so level.entity("…"),
    // level.zones() and level.items() find them just like the drawn ones
    const level = !persistent && !obj.body ? this.level : null;
    if (level && !level.objects.includes(obj)) level.objects.push(obj);
    const dispose = () => {
      obj.removed = true;
      if (obj.deviceIds) {
        for (const id of obj.deviceIds) this.device.removeObstacle(id, obj.handles);
      }
      this.objects.delete(obj.id);
      if (level) {
        const i = level.objects.indexOf(obj);
        if (i >= 0) level.objects.splice(i, 1);
      }
      this._changed();
    };
    obj._dispose = this._scope(persistent).add(dispose);
    this._changed();
    return obj;
  }

  createWall(
    points,
    {
      closed = false,
      passable = false,
      handles = 'both',
      name = '',
      enabled = true,
      persistent = false,
      boundary = false,
      body = false,
    } = {}
  ) {
    this._assertRunning();
    const pts = points.map(toPoint);
    if (pts.length < 2) throw new Error('A wall needs at least 2 points.');
    const devId = this._allocDeviceId();
    const upload = () => this.device.createObstacle(devId, pts, { closed, passable, handles });
    upload();
    const obj = new Obstacle(this, {
      id: devId,
      type: 'wall',
      name,
      points: pts,
      closed,
      passable,
      handles,
      enabled: false,
      deviceIds: [devId],
      boundary,
      body,
      _upload: upload,
    });
    this._register(obj, persistent);
    if (enabled) obj.enable();
    return obj;
  }

  createRail(
    points,
    { strength = 5, handles = 'both', name = '', enabled = true, persistent = false } = {}
  ) {
    this._assertRunning();
    const pts = points.map(toPoint);
    if (pts.length < 2) throw new Error('A rail needs at least 2 points.');
    const ids = [];
    for (let i = 0; i < pts.length - 1; i++) ids.push(this._allocDeviceId());
    const upload = () =>
      ids.forEach((id, i) =>
        this.device.createRail(id, pts[i], pts[i + 1], strength, { handles })
      );
    upload();
    const obj = new Obstacle(this, {
      id: ids[0],
      type: 'rail',
      name,
      points: pts,
      strength,
      handles,
      enabled: false,
      deviceIds: ids,
      _upload: upload,
    });
    this._register(obj, persistent);
    if (enabled) obj.enable();
    return obj;
  }

  createZone(
    shape,
    { name = '', speak = '', handle = 'me', enabled = true, persistent = false, label } = {}
  ) {
    this._assertRunning();
    let s;
    if (Array.isArray(shape)) s = { shape: 'polygon', points: shape.map(toPoint) };
    else if (shape.shape === 'polygon') s = { shape: 'polygon', points: shape.points.map(toPoint) };
    else if (shape.shape === 'circle') s = { shape: 'circle', x: shape.x, y: shape.y, r: shape.r };
    else if (shape.shape === 'rect')
      s = { shape: 'rect', x: shape.x, y: shape.y, w: shape.w, h: shape.h };
    else if ('r' in shape) s = { shape: 'circle', x: shape.x, y: shape.y, r: shape.r };
    else
      s = {
        shape: 'rect',
        x: shape.x,
        y: shape.y,
        w: shape.w ?? shape.width,
        h: shape.h ?? shape.height,
      };
    const obj = new Zone(this, {
      id: `z${this._nextId++}`,
      type: 'zone',
      name,
      speak,
      handle,
      enabled,
      label,
      ...s,
    });
    // a handle that already stands in a new zone does not "enter" it
    for (const h of this.handles) obj._inside.set(h.index, shapeContains(obj, h._god));
    return this._register(obj, persistent);
  }

  /**
   * An entity: shown in the editor and the preview, reacts on touch. By default it has
   * no body on the device – `solid: true` adds a round wall, `attachTo("it")` sends the
   * It handle to it.
   */
  createEntity(opts = {}) {
    this._assertRunning();
    const {
      x = 0,
      y = 0,
      r = 10,
      kind = 'marker',
      name = '',
      speak = '',
      sound = '',
      solid = false,
      vanish,
      handle = 'me',
      handles = 'me',
      enabled = true,
      persistent = false,
      ...rest
    } = opts;
    const p = this._clampWorld({ x: +x, y: +y });
    const obj = new Entity(this, {
      ...rest,
      id: `e${this._nextId++}`,
      type: 'entity',
      shape: 'circle',
      kind,
      name,
      x: p.x,
      y: p.y,
      r: Math.max(1, +r || 1),
      speak,
      sound,
      solid,
      vanish,
      handle,
      handles,
      enabled,
      collected: false,
    });
    this._register(obj, persistent);
    if (solid) obj._syncBody(true);
    return obj;
  }

  _dummyEntity() {
    const e = new Entity(this, {
      id: 'e0',
      type: 'entity',
      shape: 'circle',
      kind: 'marker',
      name: '',
      x: -1e6,
      y: -1e6,
      r: 1,
      enabled: false,
      handle: 'me',
    });
    e.removed = true;
    return e;
  }

  entities(kind) {
    return this.sceneObjects('entity').filter((o) => !kind || o.kind === kind);
  }

  /** All objects of the scene (without the helper walls of solid entities and the boundary). */
  sceneObjects(type) {
    return [...this.objects.values()].filter(
      (o) => !o.body && !o.boundary && !o.removed && (!type || o.type === type)
    );
  }

  /** Object of the scene by name (level first, then main script). */
  find(name) {
    return this.level?.object(name) ?? this.sceneObjects().find((o) => o.name === name) ?? null;
  }

  _instantiate(o) {
    const common = { name: o.name ?? '', enabled: o.enabled !== false };
    switch (o.type) {
      case 'entity':
        return this.createEntity({
          ...o,
          ...common,
          kind: o.kind ?? 'marker',
          x: o.x,
          y: o.y,
          r: o.r ?? 10,
          speak: o.speak ?? '',
          sound: o.sound ?? '',
          solid: !!o.solid,
          handle: o.handle ?? 'me',
        });
      case 'wall':
        return this.createWall(o.points, {
          ...common,
          closed: !!o.closed,
          passable: !!o.passable,
          handles: o.handles ?? 'both',
        });
      case 'rail':
        return this.createRail(o.points, {
          ...common,
          strength: o.strength ?? 5,
          handles: o.handles ?? 'both',
        });
      case 'zone':
        return this.createZone(o, { ...common, speak: o.speak ?? '', handle: o.handle ?? 'me' });
      default:
        return null;
    }
  }

  // ---- levels -----------------------------------------------------------
  async loadLevel(name) {
    this._assertRunning();
    const code = this._codeLevels.get(name);
    const data =
      this.project.levels?.find((l) => l.name === name) ??
      (code
        ? {
            id: code.id,
            name,
            intro: code.intro ?? '',
            spawn: code.spawn ?? {},
            objects: [],
            script: '',
          }
        : null);
    if (!data) {
      this.log(
        'error',
        `There is no level "${name}". Available: ${this.levelNames().join(', ') || '–'}`
      );
      return null;
    }
    this._levelScope?.dispose();
    this._levelScope = new Scope('level:' + name);
    const level = new Level(this, data);
    this.level = level;
    this._checkLevelReach(data);
    for (const o of data.objects ?? []) this._instantiate(o); // _register adds them to level.objects
    this.log('info', `Level "${name}" loaded`);
    this.emit('level', level);
    this._changed();

    // a level built in code (panto.defineLevel): run its builder in the level scope
    if (code) {
      try {
        const r = code.build(level);
        if (r && typeof r.catch === 'function') r.catch((e) => this._reportError(e));
      } catch (e) {
        this._reportError(e);
      }
    }

    // the level's own script: everything it creates belongs to this level
    const levelFn = this._compile(
      data.script,
      { id: `level-${data.id}`, label: `Level "${name}"`, levelId: data.id },
      { level }
    );
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
    const names = (this.project.levels ?? []).map((l) => l.name);
    for (const n of this._codeLevels.keys()) if (!names.includes(n)) names.push(n);
    return names;
  }

  // ---- speech & sound ---------------------------------------------------
  speak(text, { interrupt = false, lang, rate = 1, pitch = 1 } = {}) {
    text = String(text ?? '');
    this.caption = text;
    this.emit('speech', text);
    this.log('speech', text);
    // Echo protection for voice input: what is being said right now, and since when?
    this._lastSpoken = text;
    this._spokeAt = Date.now();
    const seq = (this._speakSeq = (this._speakSeq ?? 0) + 1);
    const spoken = () => {
      if (seq !== this._speakSeq) return;
      this._speaking = false;
      this._spokeAt = Date.now();
    };
    if (!this.running || typeof speechSynthesis === 'undefined') {
      spoken();
      return Promise.resolve();
    }
    this._speaking = true;
    if (interrupt) speechSynthesis.cancel();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = lang ?? this.project.settings?.lang ?? 'en-US';
      u.rate = rate;
      u.pitch = pitch;
      const done = () => {
        clearTimeout(timer);
        spoken();
        resolve();
      };
      u.onend = done;
      u.onerror = done;
      // browsers without voices never fire "end": resolve after an estimate
      const timer = setTimeout(done, 1500 + (text.length * 90) / rate);
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
  /** Resolves a sound name ("click.wav", "click") or a URL to a playable URL. */
  _soundUrl(name) {
    const map = this.project.assetUrls ?? {};
    return map[name] ?? (/^(https?:|blob:|data:|\.|\/)/.test(name) ? name : null);
  }

  async _audioBuffer(name) {
    const url = this._soundUrl(name);
    if (!url) {
      const have = (this.project.assets ?? []).map((a) => a.name).join(', ');
      throw new Error(`There is no sound "${name}". Uploaded: ${have || '– no sounds yet'}`);
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
            throw new Error(`Sound "${name}" could not be loaded: ${e.message}`);
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
    if (
      t &&
      t.closest &&
      t.closest(
        'input, textarea, select, [contenteditable="true"], .monaco-editor, .code-editor, [data-no-runtime-keys]'
      )
    )
      return;
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
      get me() {
        return rt.me;
      },
      get it() {
        return rt.it;
      },
      get level() {
        return rt.level;
      },
      get levels() {
        return rt.levelNames();
      },
      get width() {
        return rt.device.bounds.width;
      },
      get height() {
        return rt.device.bounds.height;
      },
      get device() {
        return rt.device.kind;
      },
      /** Working area of a handle: { points, contains(p) } */
      area: (handle = 'me') => {
        const i = handle === 'it' ? 1 : 0;
        return {
          points: rt._area(i)?.map((q) => ({ ...q })) ?? null,
          contains: (p) => rt._reachable(toPoint(p?.position ?? p), i),
        };
      },
      canReach: (p, handle = 'me') => {
        const q = toPoint(p?.position ?? p);
        return handle === 'both'
          ? rt._reachable(q, 0) && rt._reachable(q, 1)
          : rt._reachable(q, handle === 'it' ? 1 : 0);
      },
      wall: (points, opts) => rt.createWall(points, opts),
      box: (x, y, w, h, opts = {}) => rt.createWall(rectPoints(x, y, w, h), { closed: true, ...opts }),
      circle: (x, y, r, opts = {}) =>
        rt.createWall(circlePoints(x, y, r, opts.corners ?? 16), { closed: true, ...opts }),
      rail: (points, opts) => rt.createRail(points, opts),
      zone: (shape, opts) => rt.createZone(shape, opts),
      /** Visible object (enemy, item, marker). panto.entity(x, y, {…}) */
      entity: (a, b, c) => rt.createEntity(entityArgs(a, b, c)),
      enemy: (a, b, c) => rt.createEntity({ kind: 'enemy', r: 12, ...entityArgs(a, b, c) }),
      item: (a, b, c) => rt.createEntity({ kind: 'item', r: 10, ...entityArgs(a, b, c) }),
      /** All entities of the scene, optionally filtered by kind. */
      entities: (kind) => rt.entities(kind),
      /** Object of the scene by name – also works in the main script, without `level`. */
      find: (name) => rt.find(name),
      /** All objects of the scene, optionally by type ("wall", "rail", "zone", "entity"). */
      objects: (type) => rt.sceneObjects(type),
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
      /** A level entirely in code: panto.defineLevel("Arena", (level) => { … }) */
      defineLevel: (name, build, { spawn, intro } = {}) => {
        if (typeof name !== 'string' || !name.trim()) throw new Error('defineLevel requires a name.');
        if (typeof build !== 'function')
          throw new Error('defineLevel requires a function that builds the level.');
        rt._codeLevels.set(name, {
          id: `code-${name.replace(/\W+/g, '-').toLowerCase()}`,
          name,
          build: rt._guard(build),
          spawn,
          intro,
        });
        return name;
      },
      /** fn(dt, time) runs every frame – for your own game logic. dt in seconds. */
      onFrame: (fn, { persistent = false } = {}) => {
        const g = rt._guard(fn);
        rt._frameHandlers.add(g);
        return rt._scope(persistent).add(() => rt._frameHandlers.delete(g));
      },
      /** Seconds since start. */
      get time() {
        return rt._time;
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
          rt.log('warn', 'Cannot save: ' + e.message);
        }
      },
      remove(key) {
        try {
          localStorage.removeItem(prefix + key);
        } catch {}
      },
    };

    /** Simple variant: listen(["start", "stop"], fn) or listen(null, fn) for everything. */
    const listen = (commands, fn) =>
      rt.voice.onText((text, raw, alts) => {
        if (!commands?.length) return fn(text, raw);
        for (const alt of [raw, ...(alts ?? [])]) {
          const hit = bestMatch(alt, commands);
          if (hit) return fn(hit.option, raw);
        }
      });

    const ui = {
      menu: (items, opts) => createMenu(rt, { speak, sound, onKey }, items, opts),
      /** Text input via keyboard. For blind users, voice.ask() is better. */
      prompt: async (question, def = '') => {
        await rt.speak(question, { interrupt: true });
        return window.prompt(question, def);
      },
      /** Asks by voice, falls back to keyboard without a microphone. */
      askVoice: async (question, opts) => {
        if (VoiceInput.supported) {
          const a = await rt.voice.ask(question, opts);
          if (a != null) return a;
        }
        return ui.prompt(question);
      },
    };

    const log = (...args) => rt.log('log', args.map(fmt).join(' '));
    const random = (min = 0, max = 1) => min + Math.random() * (max - min);
    /** Random point that the given handle(s) can reach, at least `margin` mm from the edge. */
    const randomPoint = (margin = 15, handle = 'both') => {
      const areas = (handle === 'both' ? [0, 1] : [handle === 'it' ? 1 : 0])
        .map((i) => rt._area(i))
        .filter(Boolean);
      const b = rt.device.bounds;
      if (!areas.length)
        return { x: random(margin, b.width - margin), y: random(margin, b.height - margin) };
      for (let i = 0; i < 2000; i++) {
        const q = { x: random(0, b.width), y: random(0, b.height) };
        if (areas.every((a) => pointInPolygon(q, a) && distToPolygonEdge(q, a) >= margin)) return q;
      }
      return polygonCentroid(areas[0]);
    };
    const distance = (a, b) => {
      const p = rt._targetPoint(a);
      const q = rt._targetPoint(b);
      return p && q ? dist(p, q) : NaN;
    };

    return {
      panto,
      me: rt.me,
      it: rt.it,
      speak,
      sound,
      after,
      every,
      wait,
      onKey,
      listen,
      ui,
      storage,
      state: rt.state,
      log,
      random,
      randomPoint,
      distance,
      voice: rt.voice,
      parseNumber,
      matchText: bestMatch,
      normalizeText,
    };
  }
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
