// Draws walls, rails, zones and handles on a canvas. Used by the live stage and
// the level editor so both look the same.

import { edges, shapeCenter } from '../panto/geometry.js';

export function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function palette() {
  return {
    bg: cssVar('--stage-bg', '#f4f1ea'),
    area: cssVar('--stage-area', '#ffffff'),
    grid: cssVar('--stage-grid', 'rgba(0,0,0,0.06)'),
    wall: cssVar('--c-wall', '#2b2b2b'),
    passable: cssVar('--c-passable', '#8a8a8a'),
    rail: cssVar('--c-rail', '#1f7a6d'),
    zone: cssVar('--c-zone', '#3a6fd8'),
    enemy: cssVar('--c-enemy', '#d23f3f'),
    item: cssVar('--c-item', '#2f9e44'),
    me: cssVar('--c-me', '#e8710a'),
    it: cssVar('--c-it', '#7b4fd0'),
    text: cssVar('--fg', '#1d1d1f'),
    muted: cssVar('--fg-muted', '#6b6b6b'),
    select: cssVar('--accent', '#e8710a'),
  };
}

/**
 * Computes a view that fits the working area into the canvas.
 * `view.zoom` (1 = fit) and `view.pan` (screen pixels) zoom into a detail.
 * `focus` ({ x, y, width, height } in mm) fits that rectangle instead of the whole area.
 */
export function fitView(canvas, bounds, margin = 16, { zoom = 1, pan = { x: 0, y: 0 }, focus } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const f = focus ?? { x: 0, y: 0, width: bounds.width, height: bounds.height };
  const base = Math.max(0.1, Math.min((w - margin * 2) / f.width, (h - margin * 2) / f.height));
  const scale = base * zoom;
  const ox = (w - f.width * scale) / 2 - f.x * scale + pan.x;
  const oy = (h - f.height * scale) / 2 - f.y * scale + pan.y;
  return {
    dpr, scale, base, zoom, pan, ox, oy, w, h, bounds,
    toScreen: (p) => ({ x: ox + p.x * scale, y: oy + p.y * scale }),
    toWorld: (p) => ({ x: (p.x - ox) / scale, y: (p.y - oy) / scale }),
  };
}

export function drawWorld(ctx, view, scene, opts = {}) {
  const c = palette();
  const { scale } = view;
  ctx.save();
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, view.w, view.h);

  // working area. With a square/rhombus work area only that shape is drawn: what lies
  // outside it does not matter for the level, so it is not shown at all.
  ctx.save();
  ctx.translate(view.ox, view.oy);
  ctx.scale(scale, scale);
  const { width, height } = view.bounds;
  const px = (n) => n / scale; // screen pixels -> world units
  const objects = scene.objects ?? [];
  const shape = scene.workArea?.points?.length ? scene.workArea.points : null;
  const outline = () => {
    ctx.beginPath();
    shape.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  };
  if (shape) {
    ctx.save();
    outline();
    ctx.clip();
  }
  ctx.fillStyle = c.area;
  ctx.fillRect(0, 0, width, height);
  if (opts.grid !== false) {
    // finer grid when zoomed in, coarser when the whole area is tiny
    const step = scale > 4 ? 5 : scale > 1.2 ? 10 : 20;
    ctx.strokeStyle = c.grid;
    ctx.lineWidth = 1 / scale;
    ctx.beginPath();
    for (let x = 0; x <= width; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y <= height; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();
  }

  if (!shape) {
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = 1.5 / scale;
    ctx.strokeRect(0, 0, width, height);

    // reachable working areas of the handles
    for (const [key, color] of [['it', c.it], ['me', c.me]]) {
      const pts = scene.areas?.[key];
      if (!pts?.length) continue;
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = hexA(color, key === 'me' ? 0.08 : 0.06);
      ctx.fill();
      ctx.setLineDash([px(5), px(4)]);
      ctx.strokeStyle = hexA(color, 0.6);
      ctx.lineWidth = px(1.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // zones first (background)
  for (const o of objects) if (o.type === 'zone') drawZone(ctx, o, c, px, opts);
  for (const o of objects) if (o.type === 'rail') drawRail(ctx, o, c, px, opts);
  for (const o of objects) if (o.type === 'wall') drawWall(ctx, o, c, px, opts);
  for (const o of objects) if (o.type === 'entity') drawEntity(ctx, o, c, px, opts);

  if (shape) {
    ctx.restore(); // end of the clip
    outline();
    ctx.strokeStyle = c.muted;
    ctx.lineWidth = px(2);
    ctx.stroke();
  }

  // spawn markers (level editor)
  if (scene.spawn) {
    for (const [key, color] of [['me', c.me], ['it', c.it]]) {
      const p = scene.spawn[key];
      if (!p) continue;
      ctx.setLineDash([px(3), px(3)]);
      ctx.strokeStyle = color;
      ctx.lineWidth = px(2);
      ctx.beginPath();
      ctx.arc(p.x, p.y, px(9), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      label(ctx, key === 'me' ? 'Start Me' : 'Start It', p.x, p.y - px(14), color, px);
    }
  }

  // handles
  for (const h of scene.handles ?? []) drawHandle(ctx, h, h.index === 0 ? c.me : c.it, px);

  // in-progress drawing (level editor)
  if (scene.draft) {
    ctx.strokeStyle = c.select;
    ctx.fillStyle = c.select;
    ctx.lineWidth = px(2);
    ctx.setLineDash([px(4), px(3)]);
    ctx.beginPath();
    scene.draft.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
    for (const p of scene.draft) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, px(3), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // what the microphone heard
  if (scene.heard) {
    const t = scene.heard.length > 70 ? scene.heard.slice(0, 68) + '…' : scene.heard;
    ctx.font = '500 12px system-ui, sans-serif';
    const w = ctx.measureText(t).width + 38;
    ctx.fillStyle = hexA(c.me, 0.92);
    roundRect(ctx, 10, 10, Math.min(view.w - 20, w), 24, 12);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎤 ' + t, 22, 22, view.w - 44);
  }

  // caption (speech output)
  if (scene.caption) {
    const text = scene.caption.length > 90 ? scene.caption.slice(0, 88) + '…' : scene.caption;
    ctx.font = '500 13px system-ui, sans-serif';
    const tw = ctx.measureText(text).width;
    const bw = Math.min(view.w - 24, tw + 44);
    const x = (view.w - bw) / 2;
    const y = view.h - 40;
    ctx.fillStyle = 'rgba(20,20,22,0.82)';
    roundRect(ctx, x, y, bw, 28, 14);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔊 ' + text, x + 14, y + 14, bw - 24);
  }
  ctx.restore();
}

/** Enemies, items and markers: shown, optionally felt (solid). */
function drawEntity(ctx, o, c, px, opts) {
  const selected = opts.selectedId != null && opts.selectedId === o.id;
  const color = o.kind === 'enemy' ? c.enemy : o.kind === 'item' ? c.item : c.muted;
  const gone = o.collected || o.enabled === false;
  const r = Math.max(2, o.r ?? 10);
  ctx.globalAlpha = gone ? 0.22 : 1;
  // touch radius
  ctx.beginPath();
  ctx.arc(o.x, o.y, r, 0, Math.PI * 2);
  ctx.fillStyle = hexA(color, 0.13);
  ctx.fill();
  ctx.setLineDash(o.solid ? [] : [px(3), px(3)]);
  ctx.strokeStyle = hexA(color, o.solid ? 0.9 : 0.5);
  ctx.lineWidth = px(o.solid ? 2 : 1);
  ctx.stroke();
  ctx.setLineDash([]);
  // body: triangle = enemy, diamond = item, dot = marker
  const b = Math.max(px(4), r * 0.55);
  ctx.beginPath();
  if (o.kind === 'enemy') {
    ctx.moveTo(o.x, o.y - b);
    ctx.lineTo(o.x + b * 0.92, o.y + b * 0.7);
    ctx.lineTo(o.x - b * 0.92, o.y + b * 0.7);
    ctx.closePath();
  } else if (o.kind === 'item') {
    ctx.moveTo(o.x, o.y - b);
    ctx.lineTo(o.x + b, o.y);
    ctx.lineTo(o.x, o.y + b);
    ctx.lineTo(o.x - b, o.y);
    ctx.closePath();
  } else {
    ctx.arc(o.x, o.y, b * 0.75, 0, Math.PI * 2);
  }
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = selected ? c.select : '#fff';
  ctx.lineWidth = px(selected ? 2.5 : 1.4);
  ctx.stroke();
  if (o.name && opts.labels !== false) label(ctx, o.name, o.x, o.y + r + px(11), color, px);
  ctx.globalAlpha = 1;
}

function drawWall(ctx, o, c, px, opts) {
  if (o.boundary || o.body) return; // boundary: area outline, body: drawn with its entity
  const selected = opts.selectedId != null && opts.selectedId === o.id;
  ctx.globalAlpha = o.enabled === false ? 0.3 : 1;
  ctx.strokeStyle = selected ? c.select : o.passable ? c.passable : c.wall;
  ctx.lineWidth = px(selected ? 4 : 3);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (o.passable) ctx.setLineDash([px(6), px(4)]);
  ctx.beginPath();
  for (const [a, b] of edges(o.points, o.closed)) {
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  if (selected && opts.showVertices) drawVertices(ctx, o.points, c.select, px);
  if (o.name && opts.labels !== false) {
    const m = o.points[0];
    label(ctx, o.name, m.x, m.y - px(10), c.muted, px);
  }
  ctx.globalAlpha = 1;
}

function drawRail(ctx, o, c, px, opts) {
  const selected = opts.selectedId != null && opts.selectedId === o.id;
  ctx.globalAlpha = o.enabled === false ? 0.3 : 1;
  const pts = o.points;
  // capture corridor
  ctx.strokeStyle = c.rail;
  ctx.globalAlpha *= 0.14;
  ctx.lineWidth = (o.strength ?? 5) * 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
  ctx.globalAlpha = o.enabled === false ? 0.3 : 1;
  ctx.strokeStyle = selected ? c.select : c.rail;
  ctx.lineWidth = px(selected ? 3 : 2);
  ctx.setLineDash([px(8), px(5)]);
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
  ctx.setLineDash([]);
  if (selected && opts.showVertices) drawVertices(ctx, pts, c.select, px);
  if (o.name && opts.labels !== false && !o.name.startsWith('menu')) label(ctx, o.name, pts[0].x, pts[0].y - px(10), c.rail, px);
  ctx.globalAlpha = 1;
}

function drawZone(ctx, o, c, px, opts) {
  const selected = opts.selectedId != null && opts.selectedId === o.id;
  const active = o._inside && [...o._inside.values()].some(Boolean);
  ctx.globalAlpha = o.enabled === false ? 0.35 : 1;
  ctx.fillStyle = hexA(c.zone, active ? 0.28 : 0.1);
  ctx.strokeStyle = selected ? c.select : hexA(c.zone, 0.7);
  ctx.lineWidth = px(selected ? 2.5 : 1.25);
  ctx.beginPath();
  if (o.shape === 'rect') ctx.rect(o.x, o.y, o.w, o.h);
  else if (o.shape === 'circle') ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
  else if (o.shape === 'polygon' && o.points?.length) {
    o.points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  if (selected && opts.showVertices && o.shape === 'polygon') drawVertices(ctx, o.points, c.select, px);
  const text = o.label ?? o.name;
  if (text && opts.labels !== false) {
    const ctr = shapeCenter(o);
    label(ctx, text, ctr.x, ctr.y, active ? c.text : c.zone, px, true);
  }
  ctx.globalAlpha = 1;
}

function drawHandle(ctx, h, color, px) {
  // Line to the object the handle is attached to (switchTo/follow)
  if (h.followTo) {
    ctx.strokeStyle = hexA(color, 0.75);
    ctx.setLineDash([px(2), px(4)]);
    ctx.lineWidth = px(1.5);
    ctx.beginPath();
    ctx.moveTo(h.god.x, h.god.y);
    ctx.lineTo(h.followTo.x, h.followTo.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(h.followTo.x, h.followTo.y, px(3), 0, Math.PI * 2);
    ctx.fillStyle = hexA(color, 0.75);
    ctx.fill();
  }
  // physical handle (ghost) if it differs from the god object
  const dx = h.pos.x - h.god.x;
  const dy = h.pos.y - h.god.y;
  if (Math.hypot(dx, dy) > 1) {
    ctx.strokeStyle = hexA(color, 0.5);
    ctx.setLineDash([px(3), px(3)]);
    ctx.lineWidth = px(1.5);
    ctx.beginPath();
    ctx.arc(h.pos.x, h.pos.y, px(8), 0, Math.PI * 2);
    ctx.moveTo(h.pos.x, h.pos.y);
    ctx.lineTo(h.god.x, h.god.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  // god object = what the user feels
  ctx.fillStyle = color;
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = px(2);
  ctx.beginPath();
  ctx.arc(h.god.x, h.god.y, px(9), 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // rotation indicator
  const a = ((h.rot ?? 0) - 90) * (Math.PI / 180);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = px(2);
  ctx.beginPath();
  ctx.moveTo(h.god.x, h.god.y);
  ctx.lineTo(h.god.x + Math.cos(a) * px(7), h.god.y + Math.sin(a) * px(7));
  ctx.stroke();
  label(ctx, h.index === 0 ? 'Me' : 'It', h.god.x, h.god.y + px(20), color, px);
}

function drawVertices(ctx, pts, color, px) {
  for (const p of pts) {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = color;
    ctx.lineWidth = px(2);
    ctx.beginPath();
    ctx.rect(p.x - px(4), p.y - px(4), px(8), px(8));
    ctx.fill();
    ctx.stroke();
  }
}

function label(ctx, text, x, y, color, px, centerY = false) {
  ctx.save();
  ctx.font = `600 ${px(11)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = centerY ? 'middle' : 'alphabetic';
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexA(color, a) {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
