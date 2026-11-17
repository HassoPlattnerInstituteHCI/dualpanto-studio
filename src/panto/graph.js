// Haptic graph: a network of zero-width hallways (nodes connected by edges), e.g. the paths
// of a Pac-Man maze. It feels like a groove dug into the surface instead of two walls.
// Port of dualpantoframework firmware/src/physics/hapticGraph.cpp (protocol revision 7), so
// the emulator behaves like the device. The device does all of this on its own; the studio
// only uploads the graph (protocol.js) and listens for GRAPH_STATE.

const WALK_STEPS = 8;
const WALK_EPS = 0.00001;
const JUNCTION_HYSTERESIS = 0.1; // mm

/** Defaults, the same as utils/scripts/graphTest.py of the framework. */
export const GRAPH_DEFAULTS = Object.freeze({
  capture: 5, // mm: how close to an entry node the handle has to get to enter
  junction: 4, // mm: around a node the handle can turn into another way
  breakaway: 15, // mm: pulling further than this off the way leaves the graph (0: never)
  sinkRadius: 0, // mm: nodes feel like dips within this distance (0: off)
  sinkDepth: 1.5, // mm: how strongly they pull; negative makes bumps
});

/**
 * Normalises graph data. nodes: [{x, y, entry?}] or [[x, y]], edges: [[i, j]] (indices into
 * nodes). Drops edges with unknown, equal or coincident nodes and duplicate edges.
 */
export function normalizeGraph(nodes, edges) {
  const ns = (nodes ?? []).map((n) => {
    const p = Array.isArray(n) ? { x: +n[0], y: +n[1] } : { x: +n.x, y: +n.y };
    return { ...p, entry: Array.isArray(n) ? true : n.entry !== false };
  });
  const seen = new Set();
  const es = [];
  for (const e of edges ?? []) {
    const a = +e[0];
    const b = +e[1];
    if (!ns[a] || !ns[b] || a === b) continue;
    if (ns[a].x === ns[b].x && ns[a].y === ns[b].y) continue;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    es.push([a, b]);
  }
  return { nodes: ns, edges: es };
}

export class HapticGraph {
  /** nodes: [{x, y, entry}], edges: [[i, j]] */
  constructor({ nodes, edges, capture = GRAPH_DEFAULTS.capture, junction = GRAPH_DEFAULTS.junction, breakaway = GRAPH_DEFAULTS.breakaway } = {}) {
    const g = normalizeGraph(nodes, edges);
    this.nodes = g.nodes.map((n) => ({ ...n, edges: [] }));
    this.edges = g.edges.map(([a, b]) => ({ first: this.nodes[a], second: this.nodes[b] }));
    for (const e of this.edges) {
      e.first.edges.push(e);
      e.second.edges.push(e);
    }
    this.capture = Math.max(0, +capture || 0);
    this.junction = Math.max(0, +junction || 0);
    this.breakaway = Math.max(0, +breakaway || 0);
    // a handle that was just captured must not count as breaking away right away
    if (this.breakaway > 0 && this.breakaway < 2 * this.capture) this.breakaway = 2 * this.capture;
    this.sinkRadius = 0;
    this.sinkDepth = 0;
  }

  setSinks(radius, depth) {
    const valid = radius > 0 && Number.isFinite(depth);
    this.sinkRadius = valid ? radius : 0;
    this.sinkDepth = valid ? depth : 0;
  }

  /** Closest entry node within the capture radius, as a position on the graph, or null. */
  findEntry(handle) {
    let best = null;
    let closest = this.capture;
    for (const node of this.nodes) {
      if (!node.entry || !node.edges.length) continue;
      const d = Math.hypot(node.x - handle.x, node.y - handle.y);
      if (d <= closest) {
        closest = d;
        const edge = node.edges[0];
        best = { edge, ratio: edge.first === node ? 0 : 1 };
      }
    }
    return best;
  }

  /** Moves the position along the ways to the point closest to target (in place). */
  walk(position, target) {
    for (let step = 0; step < WALK_STEPS; step++) {
      position.ratio = closestRatio(position.edge, target);
      if (!this._switchWay(position, target)) return position;
    }
    return position;
  }

  _switchWay(position, target) {
    const point = pointAt(position);
    const distance = Math.hypot(point.x - target.x, point.y - target.y);
    let closestDistance = distance;
    let closest = null;
    for (const node of [position.edge.first, position.edge.second]) {
      const toNode = Math.hypot(node.x - point.x, node.y - point.y);
      if (toNode > this.junction && toNode > 0) continue;
      const margin = toNode > 0 ? JUNCTION_HYSTERESIS : WALK_EPS;
      for (const edge of node.edges) {
        if (edge === position.edge) continue;
        const candidate = { edge, ratio: closestRatio(edge, target) };
        const p = pointAt(candidate);
        const d = Math.hypot(p.x - target.x, p.y - target.y);
        if (d < distance - margin && d < closestDistance) {
          closestDistance = d;
          closest = candidate;
        }
      }
    }
    if (!closest) return false;
    position.edge = closest.edge;
    position.ratio = closest.ratio;
    return true;
  }

  isBreakingAway(error) {
    return this.breakaway > 0 && Math.hypot(error.x, error.y) > this.breakaway;
  }

  /** Offset towards the nearest node within the sink radius (along the way), in mm. */
  sinkOffset(position) {
    if (this.sinkRadius <= 0 || this.sinkDepth === 0 || !position?.edge) return { x: 0, y: 0 };
    const { first, second } = position.edge;
    const wx = second.x - first.x;
    const wy = second.y - first.y;
    const length = Math.hypot(wx, wy);
    const radius = Math.min(this.sinkRadius, length / 2);
    const toFirst = position.ratio * length;
    const towardsFirst = toFirst <= length - toFirst;
    const d = towardsFirst ? toFirst : length - toFirst;
    if (d >= radius) return { x: 0, y: 0 };
    const s = ((towardsFirst ? -1 : 1) / length) * this.sinkDepth * Math.sin((Math.PI * d) / radius);
    return { x: wx * s, y: wy * s };
  }
}

export function pointAt({ edge, ratio }) {
  return { x: edge.first.x + (edge.second.x - edge.first.x) * ratio, y: edge.first.y + (edge.second.y - edge.first.y) * ratio };
}

function closestRatio(edge, p) {
  const dx = edge.second.x - edge.first.x;
  const dy = edge.second.y - edge.first.y;
  const r = ((p.x - edge.first.x) * dx + (p.y - edge.first.y) * dy) / (dx * dx + dy * dy);
  return r < 0 ? 0 : r > 1 ? 1 : r;
}
