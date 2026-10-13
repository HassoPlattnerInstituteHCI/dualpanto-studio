// The DualPanto runtime: turns a project (script + levels) into a running app on a
// device (emulator or real hardware) and provides the API that scripts use.

import { Emitter } from './emitter.js';
import { VoiceInput, bestMatch, parseNumber, normalize as normalizeText } from './voice.js';
import {
  toPoint, dist, rectPoints, circlePoints, shapeContains, shapeCenter,
  pointInPolygon, clampToPolygon, distToPolygonEdge, polygonCentroid,
  norm, sub, lerp,
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
    this._follow = null; // { target, speed, rotation, hz, last, sent } – switchTo
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
  /** true if the handle can physically reach p (point, object, zone or function). */
  canReach(p) {
    const q = this._rt._targetPoint(p);
    return q ? this._rt._reachable(q, this.index) : false;
  }
  distanceTo(p) {
    const q = this._rt._targetPoint(p);
    return q ? dist(this._god, q) : NaN;
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
    const wanted = rt._targetPoint(p);
    if (!wanted) throw new TypeError(`${this.name}.moveTo needs a point or an object with a position.`);
    const target = rt._clamp(wanted, this.index);
    if (dist(wanted, target) > 1) rt._warnOnce(`reach:${this.name}`, `${this.name}.moveTo: (${Math.round(wanted.x)}, ${Math.round(wanted.y)}) is outside the area of ${this.name === 'me' ? 'Me' : 'It'}. The handle moves to the nearest reachable point.`);
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
  /**
   * The handle moves to the object and **then stays on it**: when the object moves,
   * the handle moves along. This is exactly what `PantoHandle.SwitchTo` does in the
   * Unity toolkit – there the target position is sent every physics frame, here `hz`
   * times per second (and only if the target actually moved).
   *
   * Target: an enemy/item, a zone, the other handle, a point – or a function that
   * returns a point.
   *
   * The promise resolves as soon as the handle arrives for the first time; after that
   * it keeps following until free(), freeze(), stopFollow() or the next switchTo.
   */
  switchTo(target, opts = {}) {
    const { speed = 120, rotation = null, hz = 20, ease = 2.5, lead = 0.6, deadzone = 1 } = opts;
    // A handle as target delivers sensor values and jitters – smooth more in that case.
    const smooth = opts.smooth ?? (target?.handlePosition ? 0.6 : 0.25);
    const rt = this._rt;
    rt._assertRunning();
    if (target == null) throw new Error(`${this.name}.switchTo needs a target (object, zone, handle or point).`);
    if (rt._targetPoint(target) == null) throw new TypeError(`${this.name}.switchTo: this target has no position.`);
    this._follow = {
      target, speed, rotation,
      hz: Math.max(1, Math.min(60, hz)),
      ease: Math.max(1, Math.min(10, ease)),
      smooth: Math.max(0, Math.min(0.95, smooth)),
      lead: Math.max(0, Math.min(2, lead)),
      deadzone: Math.max(0, deadzone),
      last: 0, sent: null, sm: null, v: null, prev: null, seen: 0,
    };
    return this.moveTo(target, { speed, rotation, hold: true });
  }
  /** Same as switchTo – the name you expect when reading. */
  follow(target, opts) {
    return this.switchTo(target, opts);
  }
  /** Only stops following; the handle stays where it is. */
  stopFollow() {
    this._follow = null;
    return this;
  }
  get isFollowing() {
    return !!this._follow;
  }
  /** Point the handle is currently following (or null). */
  get followTarget() {
    return this._follow ? this._rt._targetPoint(this._follow.target) : null;
  }
  /** Name of the object being followed – for display and logging. */
  get followName() {
    const t = this._follow?.target;
    return t && typeof t === 'object' ? t.name || null : null;
  }

  /**
   * One streaming step. During the first move we only re-aim if the target has moved
   * away significantly – otherwise every packet would restart the move.
   */
  _tickFollow(now) {
    const f = this._follow;
    if (!f) return;
    const rt = this._rt;
    const raw = rt._targetPoint(f.target);
    if (!raw) return;
    if (f.target?.removed || f.target?.isVisible === false) {
      this._follow = null;
      return;
    }

    // Smooth the target point (noisy targets: the person's hand, jittering objects).
    // A real jump is not smoothed, otherwise the handle would crawl after it.
    if (!f.sm || dist(f.sm, raw) > 30) {
      f.sm = { ...raw };
      f.v = null;
    } else {
      f.sm = { x: f.sm.x + (raw.x - f.sm.x) * (1 - f.smooth), y: f.sm.y + (raw.y - f.sm.y) * (1 - f.smooth) };
    }

    // Target velocity for the lead – from the SMOOTHED history. Computed from the raw
    // values it would feed the noise back in (±1.5 mm per frame is ±90 mm/s).
    const dt = f.seen ? (now - f.seen) / 1000 : 0;
    if (f.prev && dt > 0.001 && dt < 0.5) {
      const vx = (f.sm.x - f.prev.x) / dt;
      const vy = (f.sm.y - f.prev.y) / dt;
      f.v = f.v ? { x: f.v.x + (vx - f.v.x) * 0.3, y: f.v.y + (vy - f.v.y) * 0.3 } : { x: vx, y: vy };
    }
    f.prev = { ...f.sm };
    f.seen = now;

    const clamped = rt._clamp(raw, this.index);
    if (dist(raw, clamped) > 1) {
      rt._warnOnce(`follow:${this.name}`, `${this.name} is following a target outside the reachable area – the handle stays at the nearest reachable point.`);
    }

    const moving = !!this._transition;
    if (now - f.last < (moving ? 250 : 1000 / f.hz)) return;

    // The firmware moves the god object to the target in `1 / SPEED` seconds.
    //
    // If that duration is exactly one update interval, every move ends before the next
    // target arrives: the handle moves in small bursts and stops in between – on the
    // device this feels like vibration (measured: 25 % standstill, ~43 acceleration
    // changes/s). So every move lasts `ease` intervals; the moves overlap and the
    // speed stays even.
    //
    // The lag this causes (≈ ease · v / hz) is compensated by a lead: we send where
    // the target will be at the end of the move.
    const dur0 = Math.max(0.01, f.ease / f.hz);
    const aim = { x: f.sm.x, y: f.sm.y };
    if (f.lead > 0 && f.v) {
      aim.x += f.v.x * dur0 * f.lead;
      aim.y += f.v.y * dur0 * f.lead;
    }
    const target = rt._clamp(aim, this.index);
    if (f.sent && dist(f.sent, target) < (moving ? 8 : f.deadzone)) return;
    f.last = now;
    f.sent = target;
    const step = dist(this._pos, target);
    const dur = Math.max(dur0, step / Math.max(1, f.speed)); // don't take big jumps at full speed
    if (!f.durSent || Math.abs(dur - f.durSent) / f.durSent > 0.2) {
      rt.device.setSpeed(this.index, Math.min(100, 1 / dur));
      f.durSent = dur;
    }
    const rot = f.rotation === true ? f.target?.rotation ?? null : typeof f.rotation === 'number' ? f.rotation : null;
    rt.device.moveHandle(this.index, target, rot);
  }

  /** Gives control back to the user (also stops following). */
  free() {
    this._follow = null;
    this._transition?.resolve(false);
    this._rt.device.free(this.index);
  }
  /** Locks the handle at its current position (also stops following). */
  freeze() {
    this._follow = null;
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

/**
 * An entity: an enemy, an item or a marker. Entities are *shown* (editor, live preview)
 * and they react when a handle touches them – they do not need a body on the device.
 * Opt in to haptics with `solid: true` (a round wall) or `attachTo("it")` (the It handle
 * follows the entity).
 */
class Entity extends WorldObject {
  constructor(rt, data) {
    super(rt, data);
    this._touch = new Set();
    this._leave = new Set();
    this._collect = new Set();
    this._inside = new Map(); // handle index -> currently touching
    this._move = null;        // { points, i, speed, loop, pingpong, dir, resolve }
    this._follow = null;      // { target, speed, distance }
    this._attached = null;    // handle attached to this object (attachTo)
    this._body = null;        // Obstacle, only when solid
    this._bodyAt = null;
  }

  // ---- position ---------------------------------------------------------
  get position() {
    return { x: this.x, y: this.y };
  }
  set position(p) {
    this.moveToNow(p);
  }
  get radius() {
    return this.r;
  }
  set radius(v) {
    this.r = Math.max(1, +v || 1);
    this._syncBody(true);
  }
  /** Puts the entity somewhere immediately (no animation). */
  moveToNow(p) {
    const q = this._rt._clampWorld(toPoint(p?.position ?? p));
    this.x = q.x;
    this.y = q.y;
    this._syncBody(true);
    this._rt._changed();
    return this;
  }
  distanceTo(p) {
    return dist(this, toPoint(p?.position ?? p));
  }
  /** true while a handle is inside the touch radius. */
  touching(handle = 'me') {
    return !!this._inside.get(handle === 'it' ? 1 : 0);
  }
  get isMoving() {
    return !!(this._move || this._follow);
  }

  // ---- movement ---------------------------------------------------------
  /** Moves the entity to p (speed in mm/s). Resolves when it arrives. */
  moveTo(p, { speed = 60, duration } = {}) {
    return this._path([p], { speed, duration });
  }
  moveBy(dx, dy, opts) {
    return this.moveTo({ x: this.x + dx, y: this.y + dy }, opts);
  }
  /** Walks the points over and over. pingpong: back and forth instead of jumping back. */
  patrol(points, { speed = 45, loop = true, pingpong = true } = {}) {
    if (!Array.isArray(points) || points.length < 1) throw new Error('patrol needs a list of points.');
    this._path(points, { speed, loop, pingpong });
    return this;
  }
  /** Follows a handle, another entity or a point, keeping `distance` mm away. */
  follow(target, { speed = 35, distance = 0 } = {}) {
    this._endMove(false);
    this._follow = { target, speed, distance };
    return this;
  }
  /** Stops moving / following. */
  halt() {
    this._endMove(false);
    this._follow = null;
    return this;
  }
  _path(points, { speed = 60, duration, loop = false, pingpong = false } = {}) {
    this._rt._assertRunning();
    const pts = points.map((p) => toPoint(p?.position ?? p));
    this._follow = null;
    this._endMove(false);
    let total = dist(this, pts[0]);
    for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
    const sp = duration ? total / Math.max(0.05, duration) : speed;
    let resolve;
    const done = new Promise((r) => (resolve = r));
    this._move = { points: pts, i: 0, speed: Math.max(1, sp), loop, pingpong, dir: 1, resolve };
    return done;
  }
  _endMove(arrived) {
    const m = this._move;
    this._move = null;
    m?.resolve?.(arrived);
  }

  /** One animation step. Returns true if the entity moved. */
  _step(dt) {
    if (this.removed) return false;
    let moved = false;
    if (this._follow) {
      const f = this._follow;
      const t = toPoint(f.target?.position ?? f.target);
      const d = dist(this, t);
      const goal = f.distance > 0 && d > 0.01 ? lerp(t, this, Math.min(1, f.distance / d)) : t;
      if (dist(this, goal) > 0.3) moved = this._advance(goal, f.speed * dt) || true;
    } else if (this._move) {
      const m = this._move;
      const target = m.points[m.i];
      if (!target) {
        this._endMove(true);
      } else {
        moved = true;
        if (this._advance(target, m.speed * dt)) this._nextWaypoint(m);
      }
    }
    if (moved) this._syncBody();
    else if (this._bodyStale) this._syncBody(true);
    return moved;
  }

  _nextWaypoint(m) {
    if (m.pingpong && m.points.length > 1) {
      if (m.i + m.dir >= m.points.length || m.i + m.dir < 0) {
        if (!m.loop) return this._endMove(true);
        m.dir *= -1;
      }
      m.i += m.dir;
      return;
    }
    m.i++;
    if (m.i < m.points.length) return;
    if (m.loop) m.i = 0;
    else this._endMove(true);
  }

  _advance(target, step) {
    const d = dist(this, target);
    if (d <= Math.max(step, 0.01)) {
      const q = this._rt._clampWorld(target);
      this.x = q.x;
      this.y = q.y;
      return true;
    }
    const dir = norm(sub(target, this));
    const q = this._rt._clampWorld({ x: this.x + dir.x * step, y: this.y + dir.y * step });
    this.x = q.x;
    this.y = q.y;
    return false;
  }

  // ---- the It handle as a stand-in for the entity ------------------------
  /**
   * The handle moves to the object and stays on it – like `SwitchTo` in the Unity toolkit.
   * Shorthand for it.switchTo(entity).
   */
  attachTo(handle = 'it', opts = {}) {
    const h = this._rt.handles[handle === 'me' ? 0 : 1];
    this._attached = h ?? null;
    h?.switchTo(this, { speed: 150, ...opts });
    return this;
  }
  detach() {
    this._attached?.free();
    this._attached = null;
    return this;
  }

  // ---- optional haptic body ---------------------------------------------
  /** Gives the entity a round wall, so it can be felt. */
  setSolid(on = true) {
    this.solid = !!on;
    this._syncBody(true);
    return this;
  }
  _syncBody(force = false) {
    const rt = this._rt;
    if (!this.solid || this.removed || this.collected || this.enabled === false) {
      if (this._body) {
        this._body.remove();
        this._body = null;
        this._bodyAt = null;
      }
      this._bodyStale = false;
      return;
    }
    // While it moves: the device cannot re-upload an obstacle every frame. On the
    // emulator we refresh often, on hardware only when it has arrived.
    const quick = rt.device.kind !== 'serial';
    if (!force && this._bodyAt && dist(this._bodyAt, this) < (quick ? 2 : 4)) return;
    if (!force && this.isMoving && !quick) {
      this._bodyStale = true;
      this._body?.disable();
      return;
    }
    this._bodyStale = false;
    this._body?.remove();
    this._body = rt.createWall(circlePoints(this.x, this.y, this.r, 10), {
      closed: true,
      handles: this.handles ?? 'me',
      name: `${this.name || 'Object'} (body)`,
      body: true,
    });
    this._bodyAt = { x: this.x, y: this.y };
  }

  // ---- reactions --------------------------------------------------------
  /** fn(handle, entity) when a handle touches the entity. */
  onTouch(fn) {
    const g = this._rt._guard(fn);
    this._touch.add(g);
    return this._rt._scope().add(() => this._touch.delete(g));
  }
  /** fn(handle, entity) when the handle leaves the entity again. */
  onLeave(fn) {
    const g = this._rt._guard(fn);
    this._leave.add(g);
    return this._rt._scope().add(() => this._leave.delete(g));
  }
  /** fn(handle, entity) when the entity is collected (items by default). */
  onCollect(fn) {
    const g = this._rt._guard(fn);
    this._collect.add(g);
    return this._rt._scope().add(() => this._collect.delete(g));
  }

  _fire(handle) {
    const rt = this._rt;
    if (this.speak) rt.speak(this.speak, { interrupt: true });
    if (this.sound) rt.playSound(this.sound);
    else if (this.kind === 'item') rt.beep(880, 90, { volume: 0.18 });
    else if (this.kind === 'enemy') rt.beep(170, 200, { type: 'sawtooth', volume: 0.12 });
    for (const fn of this._touch) fn(handle, this);
    if (this.kind === 'item' && this.vanish !== false) this.collect(handle);
  }

  /** Marks the entity as collected: it disappears and stops reacting. */
  collect(handle = this._rt.me) {
    if (this.collected) return this;
    this.collected = true;
    this._inside.clear();
    this.halt();
    this._syncBody(true);
    for (const fn of this._collect) fn(handle, this);
    this._rt._changed();
    return this;
  }

  /** Brings a collected/hidden entity back. */
  reset(p) {
    this.collected = false;
    this.enabled = true;
    this._inside.clear();
    if (p) this.moveToNow(p);
    else this._syncBody(true);
    this._rt._changed();
    return this;
  }

  show() {
    return this.reset();
  }
  hide() {
    this.enabled = false;
    this._inside.clear();
    this._syncBody(true);
    this._rt._changed();
    return this;
  }
  enable() {
    return this.reset();
  }
  disable() {
    return this.hide();
  }
  remove() {
    this.halt();
    this.detach();
    this._body?.remove();
    this._body = null;
    this._dispose?.();
  }
  get isVisible() {
    return this.enabled !== false && !this.collected;
  }
}

class Level {
  constructor(rt, data) {
    this._rt = rt;
    this.data = data;
    this.name = data.name;
    this.objects = [];
  }
  /**
   * All objects of the scene: first those of this level, then those from the main script.
   * So level.entity("Enemy") also finds an object the main script created – the
   * difference rarely matters when programming.
   */
  _scene(type) {
    const out = type ? this.objects.filter((o) => o.type === type) : [...this.objects];
    for (const o of this._rt.objects.values()) {
      if (o.body || o.boundary || o.removed || out.includes(o)) continue;
      if (!type || o.type === type) out.push(o);
    }
    return out;
  }
  /** Finds a zone of this level (or of the main script) by its name. */
  zone(name) {
    const z = this._scene('zone').find((o) => o.name === name);
    if (!z) this._rt.log('warn', `There is no zone "${name}" – neither in level "${this.name}" nor in the main script.`);
    return z ?? this._rt._dummyZone();
  }
  /** Finds an entity (enemy, item, marker) by its name. */
  entity(name) {
    const e = this._scene('entity').find((o) => o.name === name);
    if (!e) this._rt.log('warn', `There is no object "${name}" – neither in level "${this.name}" nor in the main script.`);
    return e ?? this._rt._dummyEntity();
  }
  /** Finds any object (wall, rail, zone, entity) by its name. */
  object(name) {
    return this._scene().find((o) => o.name === name) ?? null;
  }
  zones() {
    return this._scene('zone');
  }
  /** All entities, optionally only one kind ("enemy", "item", "marker"). */
  entities(kind) {
    return this._scene('entity').filter((o) => !kind || o.kind === kind);
  }
  enemies() {
    return this.entities('enemy');
  }
  items() {
    return this.entities('item');
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
    this.log('info', '■ Gestoppt');
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
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(() => fn(now()), 16);
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
    this.log('error', `${e?.name ?? 'Error'}: ${e?.message ?? e}`, at?.line, at?.source);
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
    const label = (o, i) => o.name || { wall: 'Wall', rail: 'Rail', zone: 'Zone', entity: 'Object' }[o.type] + ` #${i + 1}`;
    (data.objects ?? []).forEach((o, i) => {
      const handle = o.type === 'zone' || o.type === 'entity' ? o.handle ?? 'me' : o.handles ?? 'both';
      const area = handle === 'it' ? it : me;
      const pts = o.type === 'entity' ? [{ x: o.x, y: o.y }] : o.points ?? [shapeCenter(o)];
      // walls may stick out over the edge (that closes gaps); everything else must be reachable
      const bad = o.type === 'wall' ? pts.every((q) => !pointInPolygon(q, area)) : pts.some((q) => !pointInPolygon(q, area));
      if (bad) outside.push(label(o, i));
    });
    if (data.spawn?.me && !pointInPolygon(data.spawn.me, me)) outside.push('Start Me');
    if (data.spawn?.it && it && !pointInPolygon(data.spawn.it, it)) outside.push('Start It');
    if (outside.length) this.log('warn', `Level "${data.name}": outside the reachable area: ${outside.join(', ')}`);
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
    // objects a level script creates belong to that level, so level.entity("…"),
    // level.zones() and level.items() find them just like the drawn ones
    const level = !persistent && !obj.body ? this.level : null;
    if (level && !level.objects.includes(obj)) level.objects.push(obj);
    const dispose = () => {
      obj.removed = true;
      if (obj.deviceIds) for (const id of obj.deviceIds) this.device.removeObstacle(id, obj.handles);
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

  createWall(points, { closed = false, passable = false, handles = 'both', name = '', enabled = true, persistent = false, boundary = false, body = false } = {}) {
    this._assertRunning();
    const pts = points.map(toPoint);
    if (pts.length < 2) throw new Error('A wall needs at least 2 points.');
    const devId = this._allocDeviceId();
    const upload = () => this.device.createObstacle(devId, pts, { closed, passable, handles });
    upload();
    const obj = new Obstacle(this, { id: devId, type: 'wall', name, points: pts, closed, passable, handles, enabled: false, deviceIds: [devId], boundary, body, _upload: upload });
    this._register(obj, persistent);
    if (enabled) obj.enable();
    return obj;
  }

  createRail(points, { strength = 5, handles = 'both', name = '', enabled = true, persistent = false } = {}) {
    this._assertRunning();
    const pts = points.map(toPoint);
    if (pts.length < 2) throw new Error('A rail needs at least 2 points.');
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

  /**
   * An entity: shown in the editor and the preview, reacts on touch. By default it has
   * no body on the device – `solid: true` adds a round wall, `attachTo("it")` sends the
   * It handle to it.
   */
  createEntity(opts = {}) {
    this._assertRunning();
    const {
      x = 0, y = 0, r = 10, kind = 'marker', name = '', speak = '', sound = '',
      solid = false, vanish, handle = 'me', handles = 'me', enabled = true, persistent = false, ...rest
    } = opts;
    const p = this._clampWorld({ x: +x, y: +y });
    const obj = new Entity(this, {
      ...rest,
      id: `e${this._nextId++}`, type: 'entity', shape: 'circle', kind, name,
      x: p.x, y: p.y, r: Math.max(1, +r || 1), speak, sound, solid, vanish, handle, handles,
      enabled, collected: false,
    });
    this._register(obj, persistent);
    if (solid) obj._syncBody(true);
    return obj;
  }

  _dummyEntity() {
    const e = new Entity(this, { id: 'e0', type: 'entity', shape: 'circle', kind: 'marker', name: '', x: -1e6, y: -1e6, r: 1, enabled: false, handle: 'me' });
    e.removed = true;
    return e;
  }

  entities(kind) {
    return this.sceneObjects('entity').filter((o) => !kind || o.kind === kind);
  }

  /** All objects of the scene (without the helper walls of solid entities and the boundary). */
  sceneObjects(type) {
    return [...this.objects.values()].filter((o) => !o.body && !o.boundary && !o.removed && (!type || o.type === type));
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
          ...o, ...common,
          kind: o.kind ?? 'marker', x: o.x, y: o.y, r: o.r ?? 10,
          speak: o.speak ?? '', sound: o.sound ?? '', solid: !!o.solid, handle: o.handle ?? 'me',
        });
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
    const code = this._codeLevels.get(name);
    const data = this.project.levels?.find((l) => l.name === name) ??
      (code ? { id: code.id, name, intro: code.intro ?? '', spawn: code.spawn ?? {}, objects: [], script: '' } : null);
    if (!data) {
      this.log('error', `There is no level "${name}". Available: ${this.levelNames().join(', ') || '–'}`);
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
    const levelFn = this._compile(data.script, { id: `level-${data.id}`, label: `Level "${name}"`, levelId: data.id }, { level });
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
    // For the echo protection of voice input: what is being said right now, and since when?
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
        if (typeof name !== 'string' || !name.trim()) throw new Error('defineLevel needs a name.');
        if (typeof build !== 'function') throw new Error('defineLevel needs a function that builds the level.');
        rt._codeLevels.set(name, { id: `code-${name.replace(/\W+/g, '-').toLowerCase()}`, name, build: rt._guard(build), spawn, intro });
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
      /** Text input via the keyboard. For blind users voice.ask() is better. */
      prompt: async (question, def = '') => {
        await rt.speak(question, { interrupt: true });
        return window.prompt(question, def);
      },
      /** Asks by voice, falls back to the keyboard without a microphone. */
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
      const areas = (handle === 'both' ? [0, 1] : [handle === 'it' ? 1 : 0]).map((i) => rt._area(i)).filter(Boolean);
      const b = rt.device.bounds;
      if (!areas.length) return { x: random(margin, b.width - margin), y: random(margin, b.height - margin) };
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
      panto, me: rt.me, it: rt.it, speak, sound, after, every, wait, onKey, listen, ui, storage,
      state: rt.state, log, random, randomPoint, distance,
      voice: rt.voice, parseNumber, matchText: bestMatch, normalizeText,
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
        speak(label(item) + (announceIndex ? `, ${i + 1} of ${n}` : ''), { interrupt: true });
        rt._guard(onFocus)(item, i, menu);
      });
      menu._parts.push(z);
    });
  }

  build(items);
  keys = [onKey('Enter', () => menu.select()), onKey('Space', () => menu.select())];
  if (title) speak(title, { interrupt: true });
  if (moveHandle && items.length) rt.me.moveTo({ x, y }).then(() => {
    // If the person (or a voice command) has already selected something in the
    // meantime, don't interrupt and don't reset the selection.
    if (!rt.running || menu.focused >= 0) return;
    menu.focused = 0;
    speak(label(menu.items[0]) + (announceIndex ? `, 1 of ${menu.items.length}` : ''));
  });
  return menu;
}

// ---------------------------------------------------------------------------

/** Accepts panto.entity({…}), panto.entity(x, y, {…}) and panto.entity([x, y], {…}). */
function entityArgs(a, b, c) {
  if (typeof a === 'number') {
    const opts = c ?? (b && typeof b === 'object' ? b : {});
    return { ...opts, x: a, y: typeof b === 'number' ? b : opts.y ?? 0 };
  }
  if (Array.isArray(a)) return { ...(b ?? {}), x: +a[0], y: +a[1] };
  return { ...(a ?? {}), ...(b ?? {}) };
}

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
