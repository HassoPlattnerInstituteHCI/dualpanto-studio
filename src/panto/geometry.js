// Small 2D helpers. All coordinates are millimetres in "world" space:
// origin top-left of the working area, x to the right, y downwards.

export const vec = (x, y) => ({ x, y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a, s) => ({ x: a.x * s, y: a.y * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const len = (a) => Math.hypot(a.x, a.y);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a) => {
  const l = len(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Accepts {x,y}, [x,y] and returns {x,y}. */
export function toPoint(p) {
  if (Array.isArray(p)) return { x: +p[0], y: +p[1] };
  if (p && typeof p === 'object' && 'x' in p) return { x: +p.x, y: +p.y };
  throw new TypeError('Punkt erwartet: {x, y} oder [x, y]');
}

/** Closest point on segment ab to p, plus the parameter t in [0,1]. */
export function closestOnSegment(p, a, b) {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  let t = l2 > 0 ? dot(sub(p, a), ab) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return { point: add(a, mul(ab, t)), t };
}

export function distToSegment(p, a, b) {
  return dist(p, closestOnSegment(p, a, b).point);
}

/**
 * Intersection of the moving segment p->q with the wall segment a->b.
 * Returns t along p->q (0..1) or null.
 */
export function segmentIntersection(p, q, a, b) {
  const r = sub(q, p);
  const s = sub(b, a);
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-12) return null; // parallel
  const ap = sub(a, p);
  const t = cross(ap, s) / denom;
  const u = cross(ap, r) / denom;
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return t;
  return null;
}

/** Edges of a polyline; closes the loop if closed === true. */
export function edges(points, closed) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) out.push([points[i], points[i + 1]]);
  if (closed && points.length > 2) out.push([points[points.length - 1], points[0]]);
  return out;
}

export function pointInPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function rectPoints(x, y, w, h) {
  return [vec(x, y), vec(x + w, y), vec(x + w, y + h), vec(x, y + h)];
}

export function circlePoints(cx, cy, r, n = 24) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    pts.push(vec(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  return pts;
}

/** Point containment for zone shapes: {shape:'rect'|'circle'|'polygon', ...}. */
export function shapeContains(shape, p) {
  switch (shape.shape) {
    case 'rect':
      return p.x >= shape.x && p.x <= shape.x + shape.w && p.y >= shape.y && p.y <= shape.y + shape.h;
    case 'circle':
      return dist(p, shape) <= shape.r;
    case 'polygon':
      return pointInPolygon(p, shape.points);
    default:
      return false;
  }
}

export function shapeCenter(shape) {
  if (shape.shape === 'rect') return vec(shape.x + shape.w / 2, shape.y + shape.h / 2);
  if (shape.shape === 'circle') return vec(shape.x, shape.y);
  const pts = shape.points || [];
  const c = pts.reduce((acc, p) => add(acc, p), vec(0, 0));
  return pts.length ? mul(c, 1 / pts.length) : c;
}

/** Closest point on the outline of a closed polygon. */
export function closestOnPolygon(p, pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const c = closestOnSegment(p, pts[i], pts[(i + 1) % pts.length]).point;
    const d = dist(p, c);
    if (!best || d < best.d) best = { point: c, d };
  }
  return best;
}

/** Distance from p to the outline of a closed polygon (always >= 0). */
export function distToPolygonEdge(p, pts) {
  return closestOnPolygon(p, pts)?.d ?? Infinity;
}

export function polygonCentroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const f = pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    a += f;
    cx += (pts[j].x + pts[i].x) * f;
    cy += (pts[j].y + pts[i].y) * f;
  }
  a *= 0.5;
  return Math.abs(a) < 1e-9 ? pts[0] : { x: cx / (6 * a), y: cy / (6 * a) };
}

/**
 * Keeps p inside the polygon: points outside are moved onto the outline and then
 * `inset` mm towards the centroid, so they end up safely inside.
 */
export function clampToPolygon(p, pts, inset = 0) {
  if (pointInPolygon(p, pts) && (inset <= 0 || distToPolygonEdge(p, pts) >= inset)) return { ...p };
  const edge = closestOnPolygon(p, pts).point;
  if (inset <= 0) return edge;
  const c = polygonCentroid(pts);
  const dir = norm(sub(c, edge));
  let q = add(edge, mul(dir, inset));
  if (!pointInPolygon(q, pts)) q = lerp(edge, c, 0.2);
  return q;
}
