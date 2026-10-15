// World objects: Obstacles (walls, rails), Zones, and Entities (enemies, items, markers).

import {
  toPoint,
  dist,
  circlePoints,
  shapeContains,
  shapeCenter,
  norm,
  sub,
  lerp,
} from './geometry.js';

export class WorldObject {
  constructor(rt, data) {
    this._rt = rt;
    Object.assign(this, data);
  }

  get isEnabled() {
    return this.enabled;
  }
}

export class Obstacle extends WorldObject {
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

export class Zone extends WorldObject {
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
export class Entity extends WorldObject {
  constructor(rt, data) {
    super(rt, data);
    this._touch = new Set();
    this._leave = new Set();
    this._collect = new Set();
    this._inside = new Map(); // handle index -> currently touching
    this._move = null; // { points, i, speed, loop, pingpong, dir, resolve }
    this._follow = null; // { target, speed, distance }
    this._attached = null; // handle attached to this object (attachTo)
    this._body = null; // Obstacle, only when solid
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

  /** True while a handle is inside the touch radius. */
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

/** Accepts panto.entity({…}), panto.entity(x, y, {…}) and panto.entity([x, y], {…}). */
export function entityArgs(a, b, c) {
  if (typeof a === 'number') {
    const opts = c ?? (b && typeof b === 'object' ? b : {});
    return { ...opts, x: a, y: typeof b === 'number' ? b : opts.y ?? 0 };
  }
  if (Array.isArray(a)) return { ...(b ?? {}), x: +a[0], y: +a[1] };
  return { ...(a ?? {}), ...(b ?? {}) };
}
