// DualPanto serial protocol, revision 6.
// Source of truth: dualpantoframework/documentation/protocol/protocol.md,
// utils/serial/src (host side) and firmware/src/utils/serial.cpp (device side).
// All multi-byte values are big-endian. Floats are IEEE 754 single precision.

export const REVISION = 6;
export const BAUD_RATE = 115200;
export const MAGIC = [0x44, 0x50]; // "DP"
export const HEADER_SIZE = 4; // type, packet id, payload size (u16)
export const MAX_PAYLOAD = 256;

export const MSG = Object.freeze({
  // device -> host
  SYNC: 0x00,
  HEARTBEAT: 0x01,
  BUFFER_CRITICAL: 0x02,
  BUFFER_READY: 0x03,
  PACKET_ACK: 0x04,
  INVALID_PACKET_ID: 0x05,
  INVALID_DATA: 0x06,
  POSITION: 0x10,
  DEBUG_LOG: 0x20,
  TRANSITION_ENDED: 0x93, // sent by the device although it is in the host range
  // host -> device
  SYNC_ACK: 0x80,
  HEARTBEAT_ACK: 0x81,
  MOTOR: 0x90,
  PID: 0x91,
  SPEED: 0x92,
  CREATE_OBSTACLE: 0xa0,
  ADD_TO_OBSTACLE: 0xa1,
  REMOVE_OBSTACLE: 0xa2,
  ENABLE_OBSTACLE: 0xa3,
  DISABLE_OBSTACLE: 0xa4,
  CALIBRATE_PANTO: 0xa5,
  CREATE_PASSABLE_OBSTACLE: 0xa6,
  CREATE_RAIL: 0xa7,
  FREEZE: 0xa8,
  FREE: 0xa9,
  SPEED_CONTROL: 0xaa,
  DUMP_HASHTABLE: 0xc0,
});

/** Message types that change device state; they get a packet id and must be acknowledged. */
export const TRACKED = new Set([
  MSG.CREATE_OBSTACLE,
  MSG.ADD_TO_OBSTACLE,
  MSG.REMOVE_OBSTACLE,
  MSG.ENABLE_OBSTACLE,
  MSG.DISABLE_OBSTACLE,
  MSG.CREATE_PASSABLE_OBSTACLE,
  MSG.CREATE_RAIL,
]);

export const CONTROL = Object.freeze({ POSITION: 0x00, FORCE: 0x01 });
export const PANTO_BOTH = 0xff;

/** Builds a payload with big-endian helpers. */
export class PayloadWriter {
  constructor(size) {
    this.buf = new ArrayBuffer(size);
    this.view = new DataView(this.buf);
    this.i = 0;
  }
  u8(v) {
    this.view.setUint8(this.i, v);
    this.i += 1;
    return this;
  }
  u16(v) {
    this.view.setUint16(this.i, v, false);
    this.i += 2;
    return this;
  }
  f32(v) {
    this.view.setFloat32(this.i, v, false);
    this.i += 4;
    return this;
  }
  bytes() {
    if (this.i !== this.buf.byteLength) throw new Error(`Payload size mismatch: ${this.i} != ${this.buf.byteLength}`);
    return new Uint8Array(this.buf);
  }
}

/** Encodes one full packet (magic + header + payload). */
export function encodePacket(type, payload = new Uint8Array(0), packetId = 0) {
  if (payload.length > MAX_PAYLOAD) throw new Error('Payload too large');
  const out = new Uint8Array(2 + HEADER_SIZE + payload.length);
  out[0] = MAGIC[0];
  out[1] = MAGIC[1];
  out[2] = type;
  out[3] = packetId & 0xff;
  out[4] = (payload.length >> 8) & 0xff;
  out[5] = payload.length & 0xff;
  out.set(payload, 6);
  return out;
}

/** Returns a copy of an encoded packet with a new packet id. */
export function withPacketId(packet, id) {
  const copy = packet.slice();
  copy[3] = id & 0xff;
  return copy;
}

// ---- Payload builders (host -> device) -------------------------------------

export const build = {
  syncAck: () => encodePacket(MSG.SYNC_ACK),
  heartbeatAck: () => encodePacket(MSG.HEARTBEAT_ACK),
  motor: (control, index, x, y, rot) =>
    encodePacket(MSG.MOTOR, new PayloadWriter(14).u8(control).u8(index).f32(x).f32(y).f32(rot).bytes()),
  speed: (index, speed) => encodePacket(MSG.SPEED, new PayloadWriter(5).u8(index).f32(speed).bytes()),
  free: (index) => encodePacket(MSG.FREE, new PayloadWriter(1).u8(index).bytes()),
  freeze: (index) => encodePacket(MSG.FREEZE, new PayloadWriter(1).u8(index).bytes()),
  /** a, b: {x,y} in device coordinates */
  createObstacle: (index, id, a, b, passable = false) =>
    encodePacket(
      passable ? MSG.CREATE_PASSABLE_OBSTACLE : MSG.CREATE_OBSTACLE,
      new PayloadWriter(19).u8(index).u16(id).f32(a.x).f32(a.y).f32(b.x).f32(b.y).bytes()
    ),
  /**
   * Exactly ONE point per packet. The firmware computes vecCount = (size - 3) / 8 but only
   * reads the first vector (firmware/src/utils/serial.cpp, receiveAddToObstacle). A second
   * vector (as the Unity plugin sends it) stays in the RX buffer as 8 junk bytes, which the
   * magic-number search then reports as INVALID_DATA.
   */
  addToObstacle: (index, id, p) =>
    encodePacket(MSG.ADD_TO_OBSTACLE, new PayloadWriter(11).u8(index).u16(id).f32(p.x).f32(p.y).bytes()),
  createRail: (index, id, a, b, displacement) =>
    encodePacket(
      MSG.CREATE_RAIL,
      new PayloadWriter(23).u8(index).u16(id).f32(a.x).f32(a.y).f32(b.x).f32(b.y).f32(displacement).bytes()
    ),
  removeObstacle: (index, id) => encodePacket(MSG.REMOVE_OBSTACLE, new PayloadWriter(3).u8(index).u16(id).bytes()),
  enableObstacle: (index, id) => encodePacket(MSG.ENABLE_OBSTACLE, new PayloadWriter(3).u8(index).u16(id).bytes()),
  disableObstacle: (index, id) => encodePacket(MSG.DISABLE_OBSTACLE, new PayloadWriter(3).u8(index).u16(id).bytes()),
  speedControl: (tethered, factor, inner, outer, strategy, pock) =>
    encodePacket(
      MSG.SPEED_CONTROL,
      new PayloadWriter(15).u8(tethered ? 1 : 0).f32(factor).f32(inner).f32(outer).u8(strategy).u8(pock ? 1 : 0).bytes()
    ),
};

/**
 * Obstacle upload sequence as done by the Unity toolkit (PantoCollider.CreateFromCorners):
 * the firmware ignores the points in CREATE_OBSTACLE and builds the polygon from the
 * ADD_TO_OBSTACLE packets (one point each). A NaN point separates polylines.
 */
export function obstaclePackets(index, id, points, { closed = true, passable = false } = {}) {
  const nan = { x: NaN, y: NaN };
  const packets = [build.createObstacle(index, id, points[0], points[1] ?? points[0], passable)];
  for (const p of points) packets.push(build.addToObstacle(index, id, p));
  if (closed && points.length > 2) packets.push(build.addToObstacle(index, id, points[0]));
  packets.push(build.addToObstacle(index, id, nan));
  return packets;
}

// ---- Parser (device -> host) -----------------------------------------------

/**
 * Incremental packet parser. Feed it raw bytes, it calls onPacket for every complete
 * packet and onNoise for bytes outside of packets (e.g. ESP32 boot messages).
 */
export class PacketParser {
  constructor(onPacket, onNoise = () => {}) {
    this.onPacket = onPacket;
    this.onNoise = onNoise;
    this.buf = new Uint8Array(0);
  }

  push(chunk) {
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    this.buf = merged;
    this._drain();
  }

  _drain() {
    let i = 0;
    const b = this.buf;
    const noise = [];
    while (i < b.length) {
      // find magic
      if (b[i] !== MAGIC[0]) {
        noise.push(b[i]);
        i++;
        continue;
      }
      if (i + 1 >= b.length) break; // need more data
      if (b[i + 1] !== MAGIC[1]) {
        noise.push(b[i]);
        i++;
        continue;
      }
      if (i + 2 + HEADER_SIZE > b.length) break;
      const type = b[i + 2];
      const id = b[i + 3];
      const size = (b[i + 4] << 8) | b[i + 5];
      if (size > MAX_PAYLOAD) {
        // corrupt header: skip the magic and resync
        noise.push(b[i]);
        i++;
        continue;
      }
      const end = i + 2 + HEADER_SIZE + size;
      if (end > b.length) break;
      const payload = b.slice(i + 6, end);
      i = end;
      this.onPacket({ type, id, payload, view: new DataView(payload.buffer) });
    }
    if (noise.length) this.onNoise(new Uint8Array(noise));
    this.buf = b.slice(i);
  }
}

/** Decodes a POSITION payload: 5 floats per handle (x, y, rotation, godX, godY). */
export function decodePosition(view) {
  const handles = [];
  const count = Math.floor(view.byteLength / 20);
  for (let h = 0; h < count; h++) {
    const o = h * 20;
    handles.push({
      x: view.getFloat32(o, false),
      y: view.getFloat32(o + 4, false),
      rot: view.getFloat32(o + 8, false),
      godX: view.getFloat32(o + 12, false),
      godY: view.getFloat32(o + 16, false),
    });
  }
  return handles;
}

export function decodeText(payload) {
  let end = payload.indexOf(0);
  if (end < 0) end = payload.length;
  return new TextDecoder().decode(payload.slice(0, end));
}
