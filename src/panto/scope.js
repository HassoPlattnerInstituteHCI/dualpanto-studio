// Execution signals and resource scopes for the DualPanto runtime.

export class StopSignal extends Error {
  constructor() {
    super('Program stopped');
    this.name = 'StopSignal';
  }
}

/** Collects dispose functions; used for level-scoped and global resources. */
export class Scope {
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
