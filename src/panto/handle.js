// DualPanto Handle: controls movement, target-following, and haptic feedback.

import { dist, toPoint } from './geometry.js';

export class Handle {
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

  /** True if the handle can physically reach p (point, object, zone or function). */
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
    if (dist(wanted, target) > 1) {
      rt._warnOnce(
        `reach:${this.name}`,
        `${this.name}.moveTo: (${Math.round(wanted.x)}, ${Math.round(wanted.y)}) is outside the area of ${
          this.name === 'me' ? 'Me' : 'It'
        }. The handle moves to the nearest reachable point.`
      );
    }
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
      target,
      speed,
      rotation,
      hz: Math.max(1, Math.min(60, hz)),
      ease: Math.max(1, Math.min(10, ease)),
      smooth: Math.max(0, Math.min(0.95, smooth)),
      lead: Math.max(0, Math.min(2, lead)),
      deadzone: Math.max(0, deadzone),
      last: 0,
      sent: null,
      sm: null,
      v: null,
      prev: null,
      seen: 0,
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
      f.sm = {
        x: f.sm.x + (raw.x - f.sm.x) * (1 - f.smooth),
        y: f.sm.y + (raw.y - f.sm.y) * (1 - f.smooth),
      };
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
      rt._warnOnce(
        `follow:${this.name}`,
        `${this.name} is following a target outside the reachable area – the handle stays at the nearest reachable point.`
      );
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
    const rot =
      f.rotation === true
        ? f.target?.rotation ?? null
        : typeof f.rotation === 'number'
          ? f.rotation
          : null;
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
