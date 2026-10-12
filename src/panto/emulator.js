// Software DualPanto: the mouse replaces the handles. Implements the same
// device interface as SerialDevice, including a simple god-object collision
// model, rails ("hallways") and position tweening, so apps can be developed
// without hardware.

import { Emitter } from './emitter.js';
import {
  sub, add, mul, dot, norm, dist, lerp, edges, segmentIntersection, closestOnSegment, clampToPolygon, polygonCentroid,
} from './geometry.js';
import { DEVICE_PROFILES } from './webserial.js';

const HANDLE_MASK = { me: [0], it: [1], both: [0, 1] };
const TICK_MS = 1000 / 60;
const EPS = 0.05; // mm the god object is kept away from walls
const PASSABLE_BREAK_MM = 10; // pull this far into a passable wall to pass it

export class Emulator extends Emitter {
  constructor({ profile = DEVICE_PROFILES.ember } = {}) {
    super();
    this.kind = 'emulator';
    this.profile = profile;
    this.connected = true;
    this.obstacles = new Map(); // id -> {kind:'wall'|'rail', points, closed, passable, handles, enabled, displacement}
    const startOf = (i) => {
      const area = profile.areas?.[i ? 'it' : 'me'];
      if (area) return polygonCentroid(area);
      return { x: profile.width / 2 + (i ? 40 : -40), y: profile.height * 0.75 };
    };
    this.handles = [0, 1].map((i) => ({
      index: i,
      pos: startOf(i),
      god: startOf(i),
      rot: 0,
      pointer: null, // where the user drags this handle
      tween: null, // {from, to, t, duration, v0}
      vel: { x: 0, y: 0 }, // mm/s, aus dem letzten Tick
      held: false, // position controlled by the program
      target: null,
      speed: 1, // firmware semantics: 1/duration in seconds
      force: null,
    }));
    this._timer = null;
  }

  get bounds() {
    return { width: this.profile.width, height: this.profile.height };
  }

  start() {
    if (this._timer) return;
    let last = performance.now();
    this._timer = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      this._tick(dt);
    }, TICK_MS);
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
  }

  async connect() {
    this.start();
    this.emit('status', 'connected');
  }

  async disconnect() {
    this.stop();
  }

  /** Called by the stage when the user drags a handle with the mouse. */
  setPointer(index, pos) {
    this.handles[index].pointer = pos ? this._clamp(pos, index) : null;
  }

  // ---- device interface -------------------------------------------------
  /**
   * Obstacle ids are unique per connection, never reused across program runs: the firmware
   * removes obstacles asynchronously (GO_REMOVE_OBSTACLE in the physics action queue, one
   * action per frame). A new run that reused an id could have its fresh obstacle deleted by
   * a removal from the previous run that is still queued ("↻ Neu starten").
   */
  allocId() {
    this._idCounter = ((this._idCounter ?? 0) % 65000) + 1;
    return this._idCounter;
  }
  createObstacle(id, points, { closed = true, passable = false, handles = 'both' } = {}) {
    this.obstacles.set(id, { kind: 'wall', points: points.map((p) => ({ ...p })), closed, passable, handles, enabled: false });
  }
  createRail(id, a, b, displacement, { handles = 'both' } = {}) {
    this.obstacles.set(id, { kind: 'rail', points: [{ ...a }, { ...b }], displacement, handles, enabled: false });
  }
  enableObstacle(id) {
    const o = this.obstacles.get(id);
    if (o) o.enabled = true;
  }
  disableObstacle(id) {
    const o = this.obstacles.get(id);
    if (o) o.enabled = false;
  }
  removeObstacle(id) {
    this.obstacles.delete(id);
  }
  moveHandle(index, pos, rotDeg = null) {
    const h = this.handles[index];
    if (rotDeg != null) h.rot = rotDeg;
    if (!pos) return;
    const to = this._clamp(pos, index);
    // firmware semantics: speed = 1 / duration of the transition in seconds
    const duration = 1 / Math.max(0.01, h.speed);
    // Die Anfangsgeschwindigkeit wird mitgenommen: ein neues Ziel während der Fahrt
    // lässt die Mechanik weiterlaufen, sie fängt nicht wieder bei Null an. Ohne das
    // pulsiert ein laufend aktualisiertes Ziel (switchTo) mit der Update-Rate.
    h.tween = { from: { ...h.pos }, to, t: 0, duration, v0: h.tween ? { ...h.vel } : { x: 0, y: 0 } };
    h.target = to;
    h.held = true;
  }
  applyForce(index, dir, strength = 1) {
    this.handles[index].force = { dir, strength };
  }
  setSpeed(index, speed) {
    this.handles[index].speed = speed;
  }
  free(index) {
    const h = this.handles[index];
    h.held = false;
    h.tween = null;
    h.target = null;
    h.force = null;
  }
  freeze(index) {
    const h = this.handles[index];
    h.held = true;
    h.tween = null;
    h.target = { ...h.pos };
  }
  setSpeedControl() {}

  // ---- simulation -------------------------------------------------------
  /** A handle cannot physically leave its working area. */
  _clamp(p, index) {
    const area = this.profile.areas?.[index === 1 ? 'it' : 'me'];
    if (area && index != null) return clampToPolygon(p, area, 0.5);
    return {
      x: Math.max(0, Math.min(this.profile.width, p.x)),
      y: Math.max(0, Math.min(this.profile.height, p.y)),
    };
  }

  _tick(dt) {
    for (const h of this.handles) {
      const before = { ...h.pos };
      if (h.tween) {
        const tw = h.tween;
        tw.t += dt / tw.duration;
        const t = Math.min(1, tw.t);
        // Hermite: startet mit der vorhandenen Geschwindigkeit v0 und endet in Ruhe.
        // Mit v0 = 0 ist das dieselbe weiche Kurve wie vorher (einzelnes moveTo).
        const h00 = 2 * t ** 3 - 3 * t ** 2 + 1;
        const h10 = t ** 3 - 2 * t ** 2 + t;
        const h01 = -2 * t ** 3 + 3 * t ** 2;
        h.pos = {
          x: tw.from.x * h00 + tw.v0.x * tw.duration * h10 + tw.to.x * h01,
          y: tw.from.y * h00 + tw.v0.y * tw.duration * h10 + tw.to.y * h01,
        };
        if (t >= 1) {
          h.pos = { ...tw.to };
          h.tween = null;
          this.emit('transitionEnded', h.index);
        }
        h.god = { ...h.pos }; // the motors drag the god object along
      } else if (h.held && h.target) {
        // position controlled by the program: the user cannot move it
        h.pos = { ...h.target };
        h.god = { ...h.pos };
      } else {
        if (h.pointer) h.pos = { ...h.pointer };
        h.god = this._moveGod(h.index, h.god, h.pos);
      }
      // Momentangeschwindigkeit mitführen (für die Anfangsgeschwindigkeit der nächsten Fahrt)
      h.vel = dt > 0 ? { x: (h.pos.x - before.x) / dt, y: (h.pos.y - before.y) / dt } : { x: 0, y: 0 };
    }
    this.emit(
      'position',
      this.handles.map((h) => ({ x: h.pos.x, y: h.pos.y, rot: h.rot, god: { ...h.god } }))
    );
  }

  _wallsFor(index) {
    const out = [];
    for (const o of this.obstacles.values()) {
      if (!o.enabled || !HANDLE_MASK[o.handles]?.includes(index)) continue;
      if (o.kind === 'wall') for (const e of edges(o.points, o.closed)) out.push({ a: e[0], b: e[1], passable: o.passable });
    }
    return out;
  }

  _railsFor(index) {
    const out = [];
    for (const o of this.obstacles.values()) {
      if (o.enabled && o.kind === 'rail' && HANDLE_MASK[o.handles]?.includes(index)) out.push(o);
    }
    return out;
  }

  /** God object: follows the handle but slides along walls instead of crossing them. */
  _moveGod(index, from, to) {
    const walls = this._wallsFor(index);
    let p = { ...from };
    let q = { ...to };
    for (let iter = 0; iter < 4; iter++) {
      let hit = null;
      for (const w of walls) {
        const t = segmentIntersection(p, q, w.a, w.b);
        if (t != null && (!hit || t < hit.t)) hit = { t, w };
      }
      if (!hit) {
        p = q;
        break;
      }
      // passable walls give way when the user pushes far enough
      if (hit.w.passable) {
        const depth = dist(closestOnSegment(to, hit.w.a, hit.w.b).point, to);
        if (depth > PASSABLE_BREAK_MM) {
          p = q;
          break;
        }
      }
      const contact = lerp(p, q, hit.t);
      const dir = norm(sub(hit.w.b, hit.w.a));
      let n = { x: -dir.y, y: dir.x };
      if (dot(n, sub(p, contact)) < 0) n = mul(n, -1);
      const rest = sub(q, contact);
      const slide = mul(dir, dot(rest, dir));
      p = add(contact, mul(n, EPS));
      q = add(p, slide);
    }
    // rails pull the god object onto their line while the handle is close enough
    for (const r of this._railsFor(index)) {
      const c = closestOnSegment(to, r.points[0], r.points[1]);
      if (dist(c.point, to) <= r.displacement) {
        p = c.point;
        break;
      }
    }
    return p;
  }

  /** Snapshot of obstacles for rendering. */
  debugObstacles() {
    return [...this.obstacles.entries()].map(([id, o]) => ({ id, ...o }));
  }
}
