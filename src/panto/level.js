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
