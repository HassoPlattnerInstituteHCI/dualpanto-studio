// Live preview: shows the running app (or the selected level when stopped) and
// lets you drive the emulated handles with the mouse.

import { fitView, drawWorld } from './renderer.js';
import { workAreaFor } from '../panto/areas.js';

export class Stage {
  constructor({ canvas, getDevice, getRuntime, getPreviewLevel }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.getDevice = getDevice;
    this.getRuntime = getRuntime;
    this.getPreviewLevel = getPreviewLevel;
    this.handles = [
      { index: 0, pos: { x: 204, y: 107 }, god: { x: 204, y: 107 }, rot: 0 },
      { index: 1, pos: { x: 156, y: 107 }, god: { x: 156, y: 107 }, rot: 0 },
    ];
    this.dragging = null;
    this._bind();
    const loop = () => {
      this.draw();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** Called by the app when a device reports positions. */
  setPositions(hs) {
    hs.forEach((h, i) => {
      if (this.handles[i]) Object.assign(this.handles[i], { pos: { x: h.x, y: h.y }, god: { ...h.god }, rot: h.rot ?? 0 });
    });
  }

  /** Shows when a handle is currently attached to an object (switchTo/follow). */
  _withFollow(rt) {
    return this.handles.map((h, i) => {
      const handle = rt?.handles?.[i];
      return handle?.isFollowing ? { ...h, followTo: handle.followTarget, followName: handle.followName } : h;
    });
  }

  _world(e) {
    const r = this.canvas.getBoundingClientRect();
    return this.view.toWorld({ x: e.clientX - r.left, y: e.clientY - r.top });
  }

  _bind() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      const d = this.getDevice();
      if (d?.kind !== 'emulator') return;
      c.setPointerCapture(e.pointerId);
      const index = e.button === 2 || e.shiftKey ? 1 : 0;
      this.dragging = index;
      d.setPointer(index, this._world(e));
      c.dataset.drag = index ? 'it' : 'me';
    });
    c.addEventListener('pointermove', (e) => {
      if (this.dragging == null) return;
      this.getDevice()?.setPointer(this.dragging, this._world(e));
    });
    const end = () => {
      if (this.dragging == null) return;
      this.getDevice()?.setPointer(this.dragging, null);
      this.dragging = null;
      delete c.dataset.drag;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  draw() {
    if (!this.canvas.clientWidth || this.canvas.offsetParent === null) return;
    const device = this.getDevice();
    const bounds = device?.bounds ?? { width: 360, height: 210 };
    const areas = device?.profile?.areas;
    const rt = this.getRuntime();
    let scene;
    if (rt?.running) {
      scene = { objects: [...rt.objects.values()], handles: this._withFollow(rt), caption: rt.caption, heard: rt.heard, areas };
      scene.workArea = workAreaFor(rt.level?.data?.view);
    } else {
      const level = this.getPreviewLevel();
      scene = { objects: level?.objects ?? [], spawn: level?.spawn, handles: this.handles, areas, workArea: workAreaFor(level?.view) };
    }
    // a square/rhombus level fills the view, with some room around it: the handles can still leave it
    const w = scene.workArea;
    const pad = 15;
    const focus = w ? { x: w.x - pad, y: w.y - pad, width: w.width + pad * 2, height: w.height + pad * 2 } : undefined;
    this.view = fitView(this.canvas, bounds, 14, { focus });
    drawWorld(this.ctx, this.view, scene, { labels: true });
  }
}
