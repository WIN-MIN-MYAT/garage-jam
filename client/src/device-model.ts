import { outlineBounds, type RoomModel, type Vec2, type Vec3 } from './room-model.js';

export type DeviceTemplate = 'laptop' | 'monitor' | 'monitor-keyboard' | 'extra';
export type DevicePart = 'screen' | 'base' | 'keyboard' | 'stand-neck' | 'stand-base' | 'extra' | 'typing';
export type DeviceRuntimeState = 'tracked' | 'uncertain' | 'lost' | 'away';

export type DeviceVolume = {
  part: DevicePart;
  center: Vec3;
  size: Vec3;
  yaw: number;
  tilt: number;
};

export type DeviceRecord = {
  id: string;
  template: DeviceTemplate;
  label: string;
  parts: DeviceVolume[];
  padding: number;
  createdAt: number;
  enabled: boolean;
};

type LegacyDeviceCollection = {
  version: 1;
  fingerprint: string;
  seatYaw: number;
  devices: DeviceRecord[];
};

type DeviceReference = {
  surface: 'table' | 'floor';
  width: number;
  depth: number;
  roomEdges: number[];
  floorOutline?: Vec2[];
  openings: { type: string; x: number; z: number }[];
};
type DeviceMemory = { device: DeviceRecord; reference: DeviceReference };
type DeviceCollection = { version: 2; entries: DeviceMemory[]; legacy?: LegacyDeviceCollection };

export type DeviceStateSignal = {
  anchorTracked: boolean;
  trackingLimited?: boolean;
  standUpFade: boolean;
  headBelowSeat?: boolean;
  distanceFromSeat?: number;
  awayDistance?: number;
};

export const deviceStorageKey = 'garage-jam-devices-v1';
export const defaultDevicePadding = 0.012;
export const defaultTypingHeight = 0.12;
export const minScreenDepth = 0.005;
export const minZoneHeight = 0.01;

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (a: Vec3, value: number): Vec3 => ({ x: a.x * value, y: a.y * value, z: a.z * value });
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const length = (a: Vec3) => Math.hypot(a.x, a.y, a.z);
const normalize = (a: Vec3): Vec3 => {
  const len = length(a) || 1;
  return { x: a.x / len, y: a.y / len, z: a.z / len };
};
const average = (points: Vec3[]): Vec3 => points.reduce((sum, point) => add(sum, point), { x: 0, y: 0, z: 0 });
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const yawForWidth = (width: Vec3) => Math.atan2(-width.z, width.x);

function rotateScreenOffset(screen: DeviceVolume, local: Vec3): Vec3 {
  const cy = Math.cos(screen.yaw), sy = Math.sin(screen.yaw);
  const cx = Math.cos(screen.tilt), sx = Math.sin(screen.tilt);
  const y1 = local.y * cx - local.z * sx;
  const z1 = local.y * sx + local.z * cx;
  return { x: cy * local.x + sy * z1, y: y1, z: -sy * local.x + cy * z1 };
}

function screenBottom(screen: DeviceVolume): Vec3 {
  return add(screen.center, rotateScreenOffset(screen, { x: 0, y: -screen.size.y / 2, z: 0 }));
}

/** Seat-frame yaw: world +X/+Z rotated into the room's forward frame. */
export function seatFrameYaw(room: RoomModel) {
  return Math.atan2(-room.forward.x, -room.forward.z);
}

export function worldToSeat(room: RoomModel, point: Vec3, yaw: number) {
  const angle = seatFrameYaw(room);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const dx = point.x - room.seat.x, dz = point.z - room.seat.z;
  return {
    point: {
      x: cos * dx - sin * dz,
      y: point.y - room.floor.y,
      z: sin * dx + cos * dz,
    } as Vec3,
    yaw: yaw - angle,
  };
}

export function seatToWorld(room: RoomModel, point: Vec3, yaw: number) {
  const angle = seatFrameYaw(room);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return {
    point: {
      x: room.seat.x + cos * point.x + sin * point.z,
      y: room.floor.y + point.y,
      z: room.seat.z - sin * point.x + cos * point.z,
    } as Vec3,
    yaw: yaw + angle,
  };
}

/** Marked screen corners: top-left, top-right, bottom-right, bottom-left. */
export function screenVolume(corners: Vec3[], seat: Vec3, thickness = minScreenDepth): DeviceVolume | null {
  if (corners.length !== 4) return null;
  const [tl, tr, br, bl] = corners;
  const center = scale(average(corners), 0.25);
  const widthVector = scale(add(sub(tr, tl), sub(br, bl)), 0.5);
  const heightVector = scale(add(sub(bl, tl), sub(br, tr)), 0.5);
  const width = length(widthVector);
  const height = length(heightVector);
  if (width < 0.08 || height < 0.05) return null;
  const widthUnit = normalize(widthVector);
  const heightUnit = normalize(heightVector);
  let normal = normalize(cross(widthUnit, heightUnit));
  const towardSeat = { x: seat.x - center.x, y: 0, z: seat.z - center.z };
  if (dot(normal, towardSeat) < 0) normal = scale(normal, -1);
  let yaw = yawForWidth(widthUnit);
  let front = { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
  if (front.x * normal.x + front.z * normal.z < 0) {
    yaw += Math.PI;
    front = { x: Math.sin(yaw), y: 0, z: Math.cos(yaw) };
  }
  const localUp = scale(heightUnit, -1);
  const horizontalUp = localUp.x * front.x + localUp.z * front.z;
  const tilt = Math.atan2(horizontalUp, Math.max(0.001, localUp.y));
  return {
    part: 'screen',
    center,
    size: { x: width, y: height, z: Math.max(minScreenDepth, thickness) },
    yaw,
    tilt,
  };
}

export function laptopBase(screen: DeviceVolume, tableY: number): DeviceVolume {
  const front = { x: Math.sin(screen.yaw), z: Math.cos(screen.yaw) };
  const depth = Math.min(0.30, Math.max(0.20, screen.size.x * 0.55));
  const hinge = screenBottom(screen);
  return {
    part: 'base',
    center: {
      x: hinge.x + front.x * depth / 2,
      y: tableY + 0.01,
      z: hinge.z + front.z * depth / 2,
    },
    size: { x: screen.size.x * 0.95, y: 0.02, z: depth },
    yaw: screen.yaw,
    tilt: 0,
  };
}

/** Split a touched screen diagonal into horizontal width and the actual tilted height. */
export function screenDragCorners(a: Vec3, b: Vec3, yaw: number): Vec3[] {
  const width = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
  const [top, bottom] = a.y >= b.y ? [a, b] : [b, a];
  const signedWidth = dot(sub(bottom, top), width);
  const across = scale(width, signedWidth);
  return signedWidth >= 0
    ? [top, add(top, across), bottom, sub(bottom, across)]
    : [add(top, across), top, sub(bottom, across), bottom];
}

/** Two opposite corners on the table, fitted to the table yaw. */
export function keyboardVolume(points: Vec3[], tableY: number, yaw: number): DeviceVolume | null {
  if (points.length !== 2) return null;
  const [a, b] = points;
  const cos = Math.cos(yaw), sin = Math.sin(yaw);
  const dx = b.x - a.x, dz = b.z - a.z;
  const width = Math.abs(dx * cos - dz * sin);
  const depth = Math.abs(dx * sin + dz * cos);
  if (width < 0.08 || depth < 0.05) return null;
  return {
    part: 'keyboard',
    center: { x: (a.x + b.x) / 2, y: tableY + 0.015, z: (a.z + b.z) / 2 },
    size: { x: width, y: 0.03, z: depth },
    yaw,
    tilt: 0,
  };
}

export function typingVolume(keyboard: DeviceVolume, tableY: number, sides = 0.09, front = 0.10): DeviceVolume {
  return {
    part: 'typing',
    center: { x: keyboard.center.x, y: tableY + defaultTypingHeight / 2, z: keyboard.center.z },
    size: {
      x: keyboard.size.x + sides * 2,
      y: defaultTypingHeight,
      z: keyboard.size.z + front * 2,
    },
    yaw: keyboard.yaw,
    tilt: 0,
  };
}

export function extraVolume(points: Vec3[], tableY: number, yaw: number): DeviceVolume | null {
  if (points.length !== 2) return null;
  const box = keyboardVolume(points, tableY, yaw);
  if (!box) return null;
  return { ...box, part: 'extra', center: { ...box.center, y: tableY + minZoneHeight / 2 }, size: { ...box.size, y: minZoneHeight } };
}

let deviceSequence = 0;

function makeId(template: DeviceTemplate) {
  deviceSequence += 1;
  return `${template}-${Date.now().toString(36)}-${deviceSequence}`;
}

export function makeLaptop(corners: Vec3[], room: RoomModel, deckCorners: Vec3[] = []): DeviceRecord | null {
  const tableY = room.table?.topY ?? room.floor.y;
  const screen = screenVolume(corners, room.seat);
  if (!screen) return null;
  const measured = keyboardVolume(deckCorners, tableY, screen.yaw);
  const base: DeviceVolume = measured
    ? { ...measured, part: 'base', center: { ...measured.center, y: tableY + 0.01 }, size: { ...measured.size, y: 0.02 } }
    : laptopBase(screen, tableY);
  return {
    id: makeId('laptop'),
    template: 'laptop',
    label: 'Laptop',
    parts: [screen, base, typingVolume(base, tableY)],
    padding: defaultDevicePadding,
    createdAt: Date.now(),
    enabled: true,
  };
}

export function makeMonitor(corners: Vec3[], room: RoomModel, keyboardCorners: Vec3[] = [], screenOnly = false, keyboardYaw?: number): DeviceRecord | null {
  const tableY = room.table?.topY ?? room.floor.y;
  const screen = screenVolume(corners, room.seat);
  if (!screen) return null;
  const yaw = keyboardYaw ?? (room.table ? outlineBounds(room.table.polygon).yaw : 0);
  const keyboard = keyboardCorners.length === 2 ? keyboardVolume(keyboardCorners, tableY, yaw) : null;
  const parts = [screen];
  if (keyboard) parts.push(keyboard, typingVolume(keyboard, tableY));
  return {
    id: makeId(screenOnly ? 'monitor' : 'monitor-keyboard'),
    template: screenOnly ? 'monitor' : 'monitor-keyboard',
    label: screenOnly ? 'Monitor' : keyboard ? 'Desktop + keyboard' : 'Desktop display',
    parts,
    padding: defaultDevicePadding,
    createdAt: Date.now(),
    enabled: true,
  };
}

export function makeExtra(points: Vec3[], room: RoomModel, rotation?: number): DeviceRecord | null {
  const tableY = room.table?.topY ?? room.floor.y;
  const yaw = rotation ?? (room.table ? outlineBounds(room.table.polygon).yaw : 0);
  const box = extraVolume(points, tableY, yaw);
  if (!box) return null;
  return {
    id: makeId('extra'),
    template: 'extra',
    label: 'Extra zone',
    parts: [box],
    padding: defaultDevicePadding,
    createdAt: Date.now(),
    enabled: true,
  };
}

/** Plan-space footprint of a tilted screen slab. */
function planDepth(part: DeviceVolume) {
  if (part.part !== 'screen' || !part.tilt) return part.size.z;
  return Math.max(part.size.z, part.size.y * Math.abs(Math.sin(part.tilt)) + part.size.z);
}

export type DeviceObstacle = { center: Vec3; size: Vec3; yaw: number };

export function deviceObstacles(devices: DeviceRecord[]): DeviceObstacle[] {
  const result: DeviceObstacle[] = [];
  for (const device of devices) {
    if (!device.enabled) continue;
    for (const part of device.parts) {
      result.push({
        center: part.center,
        size: {
          x: part.size.x + device.padding * 2,
          y: part.size.y + device.padding * 2,
          z: planDepth(part) + device.padding * 2,
        },
        yaw: part.yaw,
      });
    }
  }
  return result;
}

export function deviceBounds(device: DeviceRecord) {
  const bounds = device.parts.reduce((box, part) => ({
    minX: Math.min(box.minX, part.center.x - part.size.x / 2),
    maxX: Math.max(box.maxX, part.center.x + part.size.x / 2),
    minY: Math.min(box.minY, part.center.y - part.size.y / 2),
    maxY: Math.max(box.maxY, part.center.y + part.size.y / 2),
    minZ: Math.min(box.minZ, part.center.z - planDepth(part) / 2),
    maxZ: Math.max(box.maxZ, part.center.z + planDepth(part) / 2),
  }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity });
  return {
    center: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, z: (bounds.minZ + bounds.maxZ) / 2 },
    size: { x: bounds.maxX - bounds.minX, y: bounds.maxY - bounds.minY, z: bounds.maxZ - bounds.minZ },
  };
}

export function nextDeviceState(signal: DeviceStateSignal): DeviceRuntimeState {
  if (!signal.anchorTracked) return 'lost';
  if (signal.trackingLimited) return 'uncertain';
  if (signal.standUpFade && (signal.headBelowSeat || (signal.distanceFromSeat ?? 0) > (signal.awayDistance ?? 1.2))) return 'away';
  return 'tracked';
}

export function devicesToSeat(room: RoomModel, devices: DeviceRecord[]): DeviceRecord[] {
  return devices.map(device => ({
    ...device,
    parts: device.parts.map(part => {
      const converted = worldToSeat(room, part.center, part.yaw);
      return { ...part, center: converted.point, yaw: converted.yaw };
    }),
  }));
}

export function devicesFromSeat(room: RoomModel, devices: DeviceRecord[]): DeviceRecord[] {
  return devices.map(device => ({
    ...device,
    parts: device.parts.map(part => {
      const converted = seatToWorld(room, part.center, part.yaw);
      return { ...part, center: converted.point, yaw: converted.yaw };
    }),
  }));
}

function deviceFrame(room: RoomModel, quarterTurn = 0) {
  const surface = room.table ? 'table' : 'floor';
  const outline = outlineBounds(room.table?.polygon ?? room.floor.polygon);
  const yaw = outline.yaw + quarterTurn * Math.PI / 2;
  const y = room.table?.topY ?? room.floor.y;
  // The placement origin is the measured surface, independent of head position.
  const frame = { ...room, seat: { ...outline.center, y }, floor: { ...room.floor, y }, forward: { x: -Math.sin(yaw), z: -Math.cos(yaw) } };
  const local = (point: { x: number; z: number }) => worldToSeat(frame, { ...point, y }, yaw).point;
  const floor = room.floor.polygon.map(local);
  const xs = floor.map(p => p.x), zs = floor.map(p => p.z);
  const openings = room.openings.flatMap(opening => {
    const wall = room.walls.find(candidate => candidate.id === opening.wallId);
    if (!wall || opening.center == null) return [];
    const dx = wall.p1.x - wall.p0.x, dz = wall.p1.z - wall.p0.z;
    const t = opening.center / (Math.hypot(dx, dz) || 1);
    return [{ type: opening.type, ...local({ x: wall.p0.x + dx * t, z: wall.p0.z + dz * t }) }];
  });
  const reference: DeviceReference = {
    surface,
    width: quarterTurn % 2 ? outline.depth : outline.width,
    depth: quarterTurn % 2 ? outline.width : outline.depth,
    roomEdges: [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs), y - room.floor.y],
    floorOutline: floor.map(({ x, z }) => ({ x, z })),
    openings,
  };
  return { frame, reference };
}

function referenceDistance(saved: DeviceReference, current: DeviceReference) {
  if (saved.surface !== current.surface) return Infinity;
  const dims = Math.max(Math.abs(saved.width - current.width), Math.abs(saved.depth - current.depth));
  const edges = Math.max(...saved.roomEdges.map((edge, i) => Math.abs(edge - current.roomEdges[i])));
  if (dims > 0.16 || edges > 0.20) return Infinity;
  const outlineDistance = (from: Vec2[], to: Vec2[]) => Math.max(...from.map(point =>
    Math.min(...to.map((a, i) => {
      const b = to[(i + 1) % to.length];
      const dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
      return Math.hypot(point.x - a.x - t * dx, point.z - a.z - t * dz);
    }))));
  const outline = saved.floorOutline && current.floorOutline
    ? Math.max(outlineDistance(saved.floorOutline, current.floorOutline), outlineDistance(current.floorOutline, saved.floorOutline)) : 0;
  if (outline > 0.20) return Infinity;
  let openingDistance = 0;
  for (const opening of saved.openings) {
    const options = current.openings.filter(other => other.type === opening.type);
    if (options.length) openingDistance = Math.max(openingDistance, Math.min(...options.map(other => Math.hypot(opening.x - other.x, opening.z - other.z))));
  }
  if (openingDistance > 0.28) return Infinity;
  return dims + edges + outline + openingDistance;
}

export function rememberDevice(room: RoomModel, device: DeviceRecord): DeviceMemory {
  const { frame, reference } = deviceFrame(room);
  return { device: devicesToSeat(frame, [device])[0], reference };
}

export function restoreDevice(room: RoomModel, memory: DeviceMemory): DeviceRecord | null {
  const candidates = [0, 1, 2, 3].map(turn => deviceFrame(room, turn))
    .map(({ frame, reference }) => ({ frame, error: referenceDistance(memory.reference, reference) }))
    .sort((a, b) => a.error - b.error);
  if (!Number.isFinite(candidates[0].error) || candidates[1].error - candidates[0].error < 0.10) return null;
  return devicesFromSeat(candidates[0].frame, [memory.device])[0];
}

function readCollection(): DeviceCollection | LegacyDeviceCollection | null {
  try {
    const raw = localStorage.getItem(deviceStorageKey);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveDeviceCollection(room: RoomModel, devices: DeviceRecord[], unverified: Set<string> = new Set()) {
  const previous = readCollection();
  const oldEntries = previous?.version === 2 && Array.isArray(previous.entries) ? previous.entries : [];
  const oldLegacy = previous?.version === 1 ? previous : previous?.legacy;
  const keep = new Set(devices.filter(device => unverified.has(device.id)).map(device => device.id));
  const edited = new Map(devices.map(device => [device.id, device]));
  const retainEnabled = (device: DeviceRecord) => ({ ...device, enabled: edited.get(device.id)?.enabled ?? device.enabled });
  const legacy = Array.isArray(oldLegacy?.devices) ? oldLegacy.devices.filter(device => keep.has(device.id)).map(retainEnabled) : undefined;
  const collection: DeviceCollection = {
    version: 2,
    entries: [
      ...oldEntries.filter(entry => keep.has(entry.device.id)).map(entry => ({ ...entry, device: retainEnabled(entry.device) })),
      ...devices.filter(device => !unverified.has(device.id)).map(device => rememberDevice(room, device)),
    ],
    legacy: oldLegacy && legacy?.length ? { ...oldLegacy, devices: legacy } : undefined,
  };
  try { localStorage.setItem(deviceStorageKey, JSON.stringify(collection)); } catch { /* private mode */ }
}

export function loadDeviceCollection(room: RoomModel) {
  const collection = readCollection();
  const devices: DeviceRecord[] = [];
  const unverified = new Set<string>();
  const entries = collection?.version === 2 && Array.isArray(collection.entries) ? collection.entries : [];
  for (const entry of entries) {
    if (!entry?.device || !entry.reference) continue;
    const resolved = restoreDevice(room, entry);
    devices.push(resolved ?? entry.device);
    if (!resolved) unverified.add(entry.device.id);
  }
  const legacy = collection?.version === 1 ? collection : collection?.legacy;
  if (legacy && Array.isArray(legacy.devices)) {
    devices.push(...legacy.devices);
    legacy.devices.forEach(device => unverified.add(device.id));
  }
  return { devices, unverified, fingerprintMatch: !unverified.size };
}

export function clearDeviceCollection() {
  try { localStorage.removeItem(deviceStorageKey); } catch { /* private mode */ }
}

export function deviceInsideTyping(device: DeviceRecord, point: Vec3) {
  for (const part of device.parts) {
    if (part.part !== 'typing') continue;
    const cos = Math.cos(part.yaw), sin = Math.sin(part.yaw);
    const dx = point.x - part.center.x, dz = point.z - part.center.z;
    const x = dx * cos - dz * sin;
    const z = dx * sin + dz * cos;
    if (Math.abs(x) <= part.size.x / 2 && Math.abs(z) <= part.size.z / 2
      && point.y >= part.center.y - part.size.y / 2 && point.y <= part.center.y + part.size.y / 2) return true;
  }
  return false;
}

export function deviceSummary(device: DeviceRecord) {
  const bounds = deviceBounds(device);
  return `${device.label}: ${(bounds.size.x * 100).toFixed(0)} x ${(bounds.size.z * 100).toFixed(0)} cm`;
}
