// Browser implementation of the Unity toolkit's UpperHandle/LowerHandle.
// Unity Vector3 positions map to the runtime's millimetre {x, y} points.

import { dist, toPoint } from './geometry.js';

const MAX_MOVEMENT_SPEED = 100;
const TRANSITION_TIMEOUT_MS = 2000;
const FOLLOW_INTERVAL_MS = 5; // Unity FixedUpdate's default 50 Hz cadence.

export class Handle {
  constructor(rt, index, name) {
    this._rt = rt;
    this.index = index;
    this.name = name;
    this.isUpper = index === 0;
    this._pos = { x: 0, y: 0 };
    this._god = { x: 0, y: 0 };
    this._hasPosition = false;
    this._rot = 0;
    this._target = null;
    this._rotationTarget = null;
    this._transition = null;
    this._moveListeners = new Set();
    this._lastFollowUpdate = 0;
    this.inTransition = false;
    this.isFrozen = false;
    this.userControlledPosition = true;
    this.userControlledRotation = true;
  }

  /** Unity GetPosition(): reported position, including god-object displacement. */
  get position() { return { ...this._god }; }
  /** Physical handle position. */
  get handlePosition() { return { ...this._pos }; }
  get x() { return this._god.x; }
  get y() { return this._god.y; }
  get rotation() { return this._rot; }
  get isMoving() { return this.inTransition; }
  get isFollowing() { return this._target !== null; }
  get followTarget() { return this._target == null ? null : this._rt._targetPoint(this._target); }
  get followName() { return this._target && typeof this._target === 'object' ? this._target.name || null : null; }
  get area() { return this._rt._area(this.index)?.map((p) => ({ ...p })) ?? null; }

  canReach(value) {
    const point = this._rt._targetPoint(value);
    return !!point && this._rt._reachable(point, this.index);
  }

  distanceTo(value) {
    const point = this._rt._targetPoint(value);
    return point ? dist(this._god, point) : NaN;
  }

  onMove(fn) {
    const callback = this._rt._guard(fn);
    this._moveListeners.add(callback);
    return this._rt._scope().add(() => this._moveListeners.delete(callback));
  }

  /** Unity MoveToPosition: move to a fixed position, then free or freeze. */
  async moveTo(value, options = {}) {
    const { shouldFreeHandle = true, hold, ...switchOptions } = options;
    const point = this._rt._targetPoint(value);
    if (!point) throw new TypeError(`${this.name}.moveTo needs a point or an object with a position.`);
    const target = { ...point };
    const arrived = await this.switchTo(target, switchOptions);
    if (this._target !== target) return false; // another target replaced this move
    this._target = null;
    if (hold === undefined ? shouldFreeHandle : !hold) this.free();
    else this.freeze();
    return arrived;
  }

  /** C# PantoHandle.MoveToPosition counterpart and Unity-style call signature. */
  moveToPosition(position, newSpeed = 1, shouldFreeHandle = true) {
    return this.moveTo(position, { speed: newSpeed, shouldFreeHandle });
  }

  /** Unity SwitchTo: command position mode, wait for transition, then track target. */
  switchTo(value, options = {}) {
    const { speed = 100, rotation } = options;
    const rt = this._rt;
    rt._assertRunning();
    if (value == null) throw new Error(`${this.name}.switchTo needs a target.`);
    const wanted = rt._targetPoint(value);
    if (!wanted) throw new TypeError(`${this.name}.switchTo: this target has no position.`);
    if (this.inTransition) {
      const previous = this._target?.name;
      rt.log('warn', previous
        ? `[DualPanto] Discarding not yet reached gameObject: ${previous}`
        : '[DualPanto] Discarding not yet reached position or gameObject');
      this._transition?.resolve(false);
    }

    this.userControlledPosition = false;
    this.userControlledRotation = false;
    this.isFrozen = false;
    this._target = value;
    // Unity always sends target.eulerAngles.y + 180. An explicit JS rotation
    // keeps the browser API's override; true follows the target's rotation.
    this._rotationTarget = Object.hasOwn(options, 'rotation') ? rotation : 'unity';
    this._lastFollowUpdate = 0;

    const requestedSpeed = Number(speed);
    rt.device.setSpeed(this.index, Math.min(Number.isFinite(requestedSpeed) ? requestedSpeed : 1, MAX_MOVEMENT_SPEED));
    rt.device.moveHandle(this.index, wanted, this._resolveRotation(value));
    this.inTransition = true;

    return new Promise((resolve) => {
      const transition = {
        timer: null,
        resolve: (arrived) => {
          if (this._transition !== transition) return;
          clearTimeout(transition.timer);
          this._transition = null;
          this.inTransition = false;
          resolve(arrived);
        },
      };
      this._transition = transition;
      transition.timer = setTimeout(() => transition.resolve(false), TRANSITION_TIMEOUT_MS);
    });
  }

  /** Alias for SwitchTo. */
  follow(target, options) { return this.switchTo(target, options); }

  /** Unity FixedUpdate: keep the reached GameObject position commanded. */
  _tickFollow(now = typeof performance !== 'undefined' ? performance.now() : Date.now()) {
    if (this._target == null || this.inTransition || this.isFrozen) return;
    if (now - this._lastFollowUpdate < FOLLOW_INTERVAL_MS) return;
    const target = this._target;
    const wanted = this._rt._targetPoint(target);
    if (!wanted || target?.removed || target?.isVisible === false) {
      this._target = null;
      this._rotationTarget = null;
      return;
    }
    const rotation = this._resolveRotation(target);
    this._rt.device.moveHandle(this.index, wanted, rotation);
    this._lastFollowUpdate = now;
  }

  _resolveRotation(target) {
    if (this._rotationTarget === 'unity') {
      const value = target?.rotation ?? target?.angle;
      if (value && typeof value === 'object') return (Number.isFinite(value.y) ? value.y : 0) + 180;
      return (Number.isFinite(Number(value)) ? Number(value) : 0) + 180;
    }
    if (this._rotationTarget !== true) return this._rotationTarget;
    const value = target?.rotation ?? target?.angle;
    if (value && typeof value === 'object') return Number.isFinite(value.y) ? value.y : null;
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  /** Give control back to the player. */
  free() {
    this._target = null;
    this._rotationTarget = null;
    this._transition?.resolve(false);
    this._rt.device.free(this.index);
    if (this._rt.device.kind === 'emulator') {
      this.userControlledPosition = true;
      this.userControlledRotation = true;
    }
    this.isFrozen = false;
    this.inTransition = false;
  }

  /** Lock the handle at its current position. */
  freeze() {
    this._target = null;
    this._rotationTarget = null;
    this._transition?.resolve(false);
    this._rt.device.freeze(this.index);
    if (this._rt.device.kind === 'emulator') {
      this.userControlledPosition = false;
      this.userControlledRotation = false;
    }
    this.isFrozen = true;
    this.inTransition = false;
  }

  stopFollow() {
    this._target = null;
    this._rotationTarget = null;
    return this;
  }

  isUserControlled() { return this.userControlledPosition; }
  isRotationUserControlled() { return this.userControlledRotation; }

  /** Free rotation while leaving position under motor control. */
  freeRotation() {
    this._rt.device.moveHandle(this.index, null, null);
    this.userControlledRotation = true;
  }

  rotate(degrees) {
    this._rt.device.moveHandle(this.index, null, degrees);
  }

  applyForce(direction, strength = 0.5) {
    const vector = toPoint(direction);
    const magnitude = Math.hypot(vector.x, vector.y);
    const normalized = magnitude ? { x: vector.x / magnitude, y: vector.y / magnitude } : { x: 0, y: 0 };
    const value = Number(strength);
    // Unity caps positive force at 1 but preserves negative strength, which
    // reverses the force direction (used by repulsive center force fields).
    this._rt.device.applyForce(this.index, normalized, Math.min(1, Number.isFinite(value) ? value : 0.5));
  }

  stopForce() { this._rt.device.applyForce(this.index, { x: 0, y: 0 }, 0); }

  /** Position callback counterpart to PantoHandle.SetPositions. */
  _setPositions(position, rotation, godPosition) {
    this._pos = toPoint(position);
    if (rotation != null) this._rot = rotation;
    this._god = godPosition == null ? { ...this._pos } : toPoint(godPosition);
  }

  /** Trace child points in order and return to the first point. */
  async traceObjectByPoints(points, speed = 1) {
    if (!points?.length) return;
    for (const point of points) await this.switchTo(point, { speed });
    await this.switchTo(points[0], { speed });
  }
}
