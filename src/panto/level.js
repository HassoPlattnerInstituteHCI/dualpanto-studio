// Level management and querying for zones, entities, and obstacles.

export class Level {
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
    if (!z) {
      this._rt.log(
        'warn',
        `There is no zone "${name}" – neither in level "${this.name}" nor in the main script.`
      );
    }
    return z ?? this._rt._dummyZone();
  }

  /** Finds an entity (enemy, item, marker) by its name. */
  entity(name) {
    const e = this._scene('entity').find((o) => o.name === name);
    if (!e) {
      this._rt.log(
        'warn',
        `There is no object "${name}" – neither in level "${this.name}" nor in the main script.`
      );
    }
    return e ?? this._rt._dummyEntity();
  }

  /** Finds a physics-driven Ball object by name. */
  ball(name) {
    const ball = this._scene('entity').find((o) => o.kind === 'ball' && o.name === name);
    if (!ball) this._rt.log('warn', `There is no Ball "${name}" in level "${this.name}".`);
    return ball ?? this._rt._dummyEntity();
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

  /**
   * Browser counterpart of Unity Level.PlayIntroduction. Entities may define
   * description, priority, isOnUpper and outline (ordered contour points).
   */
  async playIntroduction({ introductionSpeed = 10, msDelayBetweenObjects = 200 } = {}) {
    const pointsOfInterest = this._scene('entity')
      .filter((entity) => entity.description)
      .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));

    for (const entity of pointsOfInterest) {
      if (!this._rt.running) return;
      const handle = entity.isOnUpper ? this._rt.me : this._rt.it;
      const movement = entity.traceShape && Array.isArray(entity.outline) && entity.outline.length
        ? handle.traceObjectByPoints(entity.outline, introductionSpeed)
        : handle.switchTo(entity, { speed: introductionSpeed });
      await Promise.all([this._rt.speak(entity.description), movement]);
      if (msDelayBetweenObjects > 0) await new Promise((resolve) => setTimeout(resolve, msDelayBetweenObjects));
    }

    this._rt.me.free();
    this._rt.it.free();
  }
}
