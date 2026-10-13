// Real DualPanto over the Web Serial API (Chrome / Edge, desktop).
// Implements the same device interface as the emulator (see emulator.js).

import { Emitter } from './emitter.js';
import {
  BAUD_RATE, REVISION, MSG, CONTROL, PANTO_BOTH, TRACKED,
  PacketParser, build, obstaclePackets, withPacketId, decodePosition, decodeText,
} from './protocol.js';
import { EMBER_AREAS } from './areas.js';

/**
 * Working area of the device ("Ember" version, taken from DualPantoSync.cs).
 * Device coordinates: millimetres, x centred, y = 0 near the motors, negative towards the user.
 * World coordinates (what the API uses): origin top-left, x right, y down.
 */
export const DEVICE_PROFILES = {
  // areas: where each handle can actually go (see areas.js). Without areas the whole rectangle is used.
  ember: { name: 'DualPanto Ember', width: 360, height: 210, offsetX: -180, topY: 5, areas: EMBER_AREAS },
  versionD: { name: 'DualPanto Version D', width: 320, height: 160, offsetX: -160, topY: -30 },
};

// The firmware acknowledges a state-changing packet before it processes it, and processing
// (hashtable updates in a critical section) takes time. The Unity toolkit therefore spaces
// obstacle creation out by 10 ms per collider (ColliderRegistry.RegisterObstacles); we do the
// same between tracked packets instead of sending the next one immediately after the ACK.
const TRACKED_GAP_MS = 10;
const TRACKED_RESEND_MS = 250;
const TRACKED_MAX_RETRIES = 12;
const SYNC_GRACE_MS = 1500;
const SYNC_STALE_MS = 1000;

const HANDLE_INDEX = { me: 0, it: 1, both: PANTO_BOTH };

export class SerialDevice extends Emitter {
  static isSupported() {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  constructor({ profile = DEVICE_PROFILES.ember, resetOnConnect = true } = {}) {
    super();
    this.kind = 'serial';
    this.profile = profile;
    this.resetOnConnect = resetOnConnect;
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.connected = false; // handshake done
    this.bootSeen = false;
    this.openedAt = 0;
    this.lastHeartbeat = 0;
    this.lastPosition = null;
    this.nextPacketId = 1;
    this.trackedQueue = [];
    this.inflight = null;
    this.paused = false; // BUFFER_CRITICAL
    this._writeChain = Promise.resolve();
    this._noiseLine = '';
    this.parser = new PacketParser(
      (p) => this._onPacket(p),
      (bytes) => this._onNoise(bytes)
    );
  }

  // ---- coordinate transforms --------------------------------------------
  toDevice(p) {
    return { x: p.x + this.profile.offsetX, y: this.profile.topY - p.y };
  }
  fromDevice(x, y) {
    return { x: x - this.profile.offsetX, y: this.profile.topY - y };
  }
  get bounds() {
    return { width: this.profile.width, height: this.profile.height };
  }

  // ---- connection -------------------------------------------------------
  async connect() {
    if (!SerialDevice.isSupported()) throw new Error('Web Serial is not supported by this browser (use Chrome or Edge).');
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: BAUD_RATE, bufferSize: 8192 });
    this.openedAt = performance.now();
    this.emit('status', 'opened');
    this._log('info', 'Port opened, waiting for SYNC from the device …');

    if (this.resetOnConnect) {
      try {
        // Same sequence as SerialPortReset.cs: DTR low (normal boot), RTS pulse on EN.
        await this.port.setSignals({ dataTerminalReady: false, requestToSend: true });
        await sleep(100);
        await this.port.setSignals({ requestToSend: false });
        this.bootSeen = false;
        this.openedAt = performance.now();
        this._log('info', 'Device restarted via DTR/RTS.');
      } catch (e) {
        this._log('warn', 'Reset via DTR/RTS not possible: ' + e.message);
      }
    }

    this.writer = this.port.writable.getWriter();
    this._readLoop();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        off();
        reject(new Error('No SYNC from the device within 8 s. Switch the device off and on again and reconnect.'));
      }, 8000);
      const off = this.on('connected', () => {
        clearTimeout(timeout);
        off();
        resolve();
      });
    });
  }

  async disconnect() {
    this.connected = false;
    this._stopReading = true;
    try { await this.reader?.cancel(); } catch {}
    try { this.writer?.releaseLock(); } catch {}
    try { await this.port?.close(); } catch {}
    this.port = null;
    this.trackedQueue = [];
    if (this.inflight) clearTimeout(this.inflight.timer);
    this.inflight = null;
    clearTimeout(this._gapTimer);
    this._gapTimer = null;
    this.emit('status', 'disconnected');
  }

  async _readLoop() {
    this._stopReading = false;
    while (this.port?.readable && !this._stopReading) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value) this.parser.push(value);
        }
      } catch (e) {
        if (!this._stopReading) this._log('error', 'Read error: ' + e.message);
      } finally {
        this.reader.releaseLock();
      }
    }
    if (!this._stopReading) {
      this.connected = false;
      this.emit('status', 'disconnected');
      this._log('error', 'Lost connection to the device.');
    }
  }

  // ---- incoming ---------------------------------------------------------
  _onPacket({ type, payload, view }) {
    switch (type) {
      case MSG.SYNC: {
        const rev = view.byteLength >= 4 ? view.getUint32(0, false) : -1;
        if (rev !== REVISION) {
          this._log('error', `Protocol revision mismatch: expected ${REVISION}, device reports ${rev}. Update the firmware.`);
          return;
        }
        // A SYNC that was still buffered from before the reset would be acknowledged
        // and then the device reboots. Unity waits for the "START" log for the same reason.
        if (this.resetOnConnect && !this.bootSeen && performance.now() - this.openedAt < SYNC_GRACE_MS) return;
        if (this.connected) {
          // The firmware sends SYNC every 10 ms until our SYNC_ACK arrives, so a few more are
          // usually still in flight. Every SYNC_ACK makes the firmware call GodObject::reset(),
          // which DELETES ALL OBSTACLES – so these must not be acknowledged again.
          if (performance.now() - this.connectedAt < SYNC_STALE_MS) return;
          // A SYNC long after connecting means the device rebooted (e.g. heartbeat timeout):
          // it has lost all obstacles and expects packet id 1 again.
          this._log('warn', 'Device restarted – obstacles are being sent again.');
          this._writeRaw(build.syncAck());
          this.connectedAt = performance.now();
          this.nextPacketId = 1;
          if (this.inflight) clearTimeout(this.inflight.timer);
          this.inflight = null;
          this.trackedQueue = [];
          this._stats = null;
          this.emit('deviceReset');
          return;
        }
        this._writeRaw(build.syncAck());
        {
          this.connected = true;
          this.connectedAt = performance.now();
          this.nextPacketId = 1;
          this._log('info', 'Connected to DualPanto (protocol revision ' + rev + ').');
          this.emit('status', 'connected');
          this.emit('connected');
          this._pump();
        }
        break;
      }
      case MSG.HEARTBEAT:
        this._writeRaw(build.heartbeatAck());
        this.lastHeartbeat = performance.now();
        this.emit('heartbeat');
        break;
      case MSG.POSITION: {
        const raw = decodePosition(view);
        const handles = raw.map((h) => ({
          ...this.fromDevice(h.x, h.y),
          rot: (-h.rot * 180) / Math.PI,
          god: this.fromDevice(h.godX, h.godY),
        }));
        this.lastPosition = handles;
        this.emit('position', handles);
        break;
      }
      case MSG.DEBUG_LOG: {
        const text = decodeText(payload);
        if (text.includes('START')) this.bootSeen = true;
        if (text.includes('hearbeat') || text.includes('heartbeat')) return;
        this.emit('log', { level: 'device', text });
        break;
      }
      case MSG.TRANSITION_ENDED:
        this.emit('transitionEnded', view.byteLength ? view.getUint8(0) : 0);
        break;
      case MSG.PACKET_ACK: {
        const id = view.getUint8(0);
        if (this.inflight && this.inflight.id === id) {
          clearTimeout(this.inflight.timer);
          this._countAck(this.inflight.packet[2]);
          if (this.verbose) this._log('device', `ACK ${id} (${typeName(this.inflight.packet[2])})`);
          this.inflight = null;
          if (this.trackedQueue.length) this._pumpLater();
          else this._reportStats();
        }
        break;
      }
      case MSG.INVALID_PACKET_ID: {
        const expected = view.getUint8(0);
        const received = view.getUint8(1);
        if (!this.inflight || this.inflight.id !== received) break;
        clearTimeout(this.inflight.timer);
        this.nextPacketId = expected;
        const duplicate = expected === (received >= 255 ? 1 : received + 1);
        if (duplicate) {
          // The device already has this packet (our resend was too early): don't send it again,
          // otherwise points would be added twice.
          this._countAck(this.inflight.packet[2]);
          this.inflight = null;
        } else {
          this._log('warn', `Packet ID corrected (${received} → ${expected}), resending packet.`);
          const packet = this.inflight.packet;
          this.inflight = null;
          this.trackedQueue.unshift(packet);
        }
        if (this.trackedQueue.length) this._pumpLater();
        else this._reportStats();
        break;
      }
      case MSG.BUFFER_CRITICAL:
        this.paused = true;
        break;
      case MSG.BUFFER_READY:
        this.paused = false;
        this._pump();
        break;
      case MSG.INVALID_DATA: {
        // The firmware sends this when it has to skip bytes while searching for the next
        // packet header, e.g. when a handler left part of a payload unread. Summarise
        // instead of printing one line per packet.
        this._invalidData = (this._invalidData ?? 0) + 1;
        if (!this._invalidTimer) {
          this._invalidTimer = setTimeout(() => {
            this._log('warn', `Device reports invalid data (${this._invalidData}×). Please report which script/level triggers this.`);
            this._invalidData = 0;
            this._invalidTimer = null;
          }, 1000);
        }
        break;
      }
      default:
        break;
    }
  }

  _onNoise(bytes) {
    // ESP32 boot output etc. Collect into lines for the log.
    const text = new TextDecoder().decode(bytes);
    this._noiseLine += text;
    const lines = this._noiseLine.split(/\r?\n/);
    this._noiseLine = lines.pop();
    for (const l of lines) {
      const t = l.replace(/[^\x20-\x7e]/g, '').trim();
      if (t) this.emit('log', { level: 'device', text: t });
      if (t.includes('START')) this.bootSeen = true;
    }
  }

  // ---- outgoing ---------------------------------------------------------
  _writeRaw(bytes) {
    if (!this.writer) return;
    this._writeChain = this._writeChain
      .then(() => this.writer.write(bytes))
      .catch((e) => this._log('error', 'Write error: ' + e.message));
  }

  /** Untracked packets (motor etc.) are only sent while connected. */
  _send(bytes) {
    if (this.connected) this._writeRaw(bytes);
  }

  /** Tracked packets: one in flight, resent until acknowledged. */
  _sendTracked(bytes) {
    this.trackedQueue.push(bytes);
    if (this.inflight || this._gapTimer) return;
    this._pump();
  }

  /** Keeps a small gap between state-changing packets (see TRACKED_GAP_MS). */
  _pumpLater() {
    if (this._gapTimer) return;
    this._gapTimer = setTimeout(() => {
      this._gapTimer = null;
      this._pump();
    }, TRACKED_GAP_MS);
  }

  _pump() {
    if (!this.connected || this.paused || this.inflight || !this.trackedQueue.length) return;
    const packet = this.trackedQueue.shift();
    const id = this.nextPacketId;
    this.nextPacketId = this.nextPacketId >= 255 ? 1 : this.nextPacketId + 1;
    const bytes = withPacketId(packet, id);
    this.inflight = { id, packet, bytes, retries: 0, timer: null };
    const send = () => {
      if (!this.inflight || this.inflight.bytes !== bytes) return;
      if (this.inflight.retries++ > TRACKED_MAX_RETRIES) {
        this._log('error', 'Device does not acknowledge the packet, dropping it.');
        this.inflight = null;
        this._pump();
        return;
      }
      if (this.verbose) {
        this._log('device', `→ ${typeName(packet[2])} id ${id}${this.inflight.retries > 1 ? ' (retry)' : ''}`);
      }
      this._writeRaw(bytes);
      this.inflight.timer = setTimeout(send, TRACKED_RESEND_MS);
    };
    send();
  }

  /** Counts acknowledged state changes, so the console can confirm what the device has. */
  _countAck(type) {
    const s = (this._stats ??= { created: 0, enabled: 0, disabled: 0, removed: 0 });
    if (type === MSG.CREATE_OBSTACLE || type === MSG.CREATE_PASSABLE_OBSTACLE || type === MSG.CREATE_RAIL) s.created++;
    else if (type === MSG.ENABLE_OBSTACLE) s.enabled++;
    else if (type === MSG.DISABLE_OBSTACLE) s.disabled++;
    else if (type === MSG.REMOVE_OBSTACLE) s.removed++;
  }

  _reportStats() {
    const s = this._stats;
    this._stats = null;
    if (!s) return;
    const parts = [];
    if (s.created) parts.push(`${s.created} created`);
    if (s.enabled) parts.push(`${s.enabled} enabled`);
    if (s.disabled) parts.push(`${s.disabled} disabled`);
    if (s.removed) parts.push(`${s.removed} removed`);
    if (parts.length) this._log('info', `Obstacles acknowledged: ${parts.join(', ')}.`);
  }

  _log(level, text) {
    this.emit('log', { level, text: '[Device] ' + text });
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
    const index = HANDLE_INDEX[handles] ?? PANTO_BOTH;
    for (const p of obstaclePackets(index, id, points.map((p) => this.toDevice(p)), { closed, passable })) this._sendTracked(p);
  }
  createRail(id, a, b, displacement, { handles = 'both' } = {}) {
    const index = HANDLE_INDEX[handles] ?? PANTO_BOTH;
    this._sendTracked(build.createRail(index, id, this.toDevice(a), this.toDevice(b), displacement));
  }
  enableObstacle(id, handles = 'both') {
    this._sendTracked(build.enableObstacle(HANDLE_INDEX[handles] ?? PANTO_BOTH, id));
  }
  disableObstacle(id, handles = 'both') {
    this._sendTracked(build.disableObstacle(HANDLE_INDEX[handles] ?? PANTO_BOTH, id));
  }
  removeObstacle(id, handles = 'both') {
    this._sendTracked(build.removeObstacle(HANDLE_INDEX[handles] ?? PANTO_BOTH, id));
  }
  /** pos: world point or null (keep), rotDeg: degrees or null (keep). */
  moveHandle(index, pos, rotDeg = null) {
    const d = pos ? this.toDevice(pos) : { x: NaN, y: NaN };
    const rot = rotDeg == null ? NaN : (-rotDeg * Math.PI) / 180;
    this._send(build.motor(CONTROL.POSITION, index, d.x, d.y, rot));
  }
  /** Force rendering. dir: world vector, strength 0..1 */
  applyForce(index, dir, strength = 1) {
    const l = Math.hypot(dir.x, dir.y) || 1;
    const s = Math.min(1, Math.max(0, strength));
    this._send(build.motor(CONTROL.FORCE, index, (dir.x / l) * s, (-dir.y / l) * s, 0));
  }
  setSpeed(index, speed) {
    this._send(build.speed(index, speed));
  }
  free(index) {
    this._send(build.free(index));
  }
  freeze(index) {
    this._send(build.freeze(index));
  }
  setSpeedControl({ tethered = false, factor = 0.01, inner = 1, outer = 5, strategy = 0, pock = false } = {}) {
    this._send(build.speedControl(tethered, factor, inner, outer, strategy, pock));
  }
  // emulator-only API, no-ops here
  setPointer() {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPE_NAMES = {
  [MSG.CREATE_OBSTACLE]: 'CREATE_OBSTACLE',
  [MSG.CREATE_PASSABLE_OBSTACLE]: 'CREATE_PASSABLE',
  [MSG.CREATE_RAIL]: 'CREATE_RAIL',
  [MSG.ADD_TO_OBSTACLE]: 'ADD_POINT',
  [MSG.ENABLE_OBSTACLE]: 'ENABLE',
  [MSG.DISABLE_OBSTACLE]: 'DISABLE',
  [MSG.REMOVE_OBSTACLE]: 'REMOVE',
};
const typeName = (t) => TYPE_NAMES[t] ?? '0x' + t.toString(16);
