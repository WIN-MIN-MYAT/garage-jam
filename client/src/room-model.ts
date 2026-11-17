export const manualRoomStorageKey = 'garage-jam-manual-room-v1';

export type Vec2 = { x: number; z: number };
export type Vec3 = { x: number; y: number; z: number };
export type WallSpan = { id: string; p0: Vec2; p1: Vec2; normal: Vec2; minY: number; maxY: number; openings: string[]; isVirtual: boolean };
export type Opening = {
  type: 'door' | 'window';
  wallId: string;
  sillY: number;
  topY: number;
  /** Optional centre position in metres from the wall's p0 corner. */
  center?: number;
  /** Optional opening width in metres. */
  width?: number;
};
export type RoomModel = {
  floor: { y: number; polygon: Vec2[] };
  ceilingY: number;
  walls: WallSpan[];
  openings: Opening[];
  furniture: { center: Vec3; size: Vec3; yaw: number; label: string; confidence: number }[];
  table: { topY: number; polygon: Vec2[]; label: string; confidence: number } | null;
  seat: Vec3;
  forward: Vec2;
  confidence: number;
  source: 'webxr' | 'manual' | 'mock';
};

export function polygonArea(points: Vec2[]) {
  return Math.abs(points.reduce((sum, point, i) => {
    const next = points[(i + 1) % points.length];
    return sum + point.x * next.z - next.x * point.z;
  }, 0)) / 2;
}

export function pointInPolygon(point: Vec2, polygon: Vec2[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.z > point.z) !== (b.z > point.z) && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Measure an outline along its own axes, independent of the headset's starting yaw. */
export function outlineBounds(polygon: Vec2[]) {
  let best = { center: { x: 0, z: 0 }, width: 0, depth: 0, yaw: 0 };
  let bestArea = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 0.001) continue;
    let c = (b.x - a.x) / length, s = (a.z - b.z) / length;
    let xs = polygon.map(point => point.x * c - point.z * s);
    let zs = polygon.map(point => point.x * s + point.z * c);
    if (Math.max(...xs) - Math.min(...xs) < Math.max(...zs) - Math.min(...zs) - 0.0001) {
      [c, s] = [s, -c];
      [xs, zs] = [zs, xs.map(x => -x)];
    }
    if (c < -0.0001 || (Math.abs(c) <= 0.0001 && s < 0)) {
      c = -c; s = -s;
      xs = xs.map(x => -x); zs = zs.map(z => -z);
    }
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const width = maxX - minX, depth = maxZ - minZ;
    const area = width * depth;
    const yaw = Math.atan2(s, c);
    if (area > bestArea + 0.0001 || (Math.abs(area - bestArea) <= 0.0001 && Math.abs(yaw) >= Math.abs(best.yaw))) continue;
    const x = (minX + maxX) / 2, z = (minZ + maxZ) / 2;
    best = { center: { x: x * c + z * s, z: -x * s + z * c }, width, depth, yaw };
    bestArea = area;
  }
  return best;
}

export function wallsFromFloor(polygon: Vec2[], floorY: number, ceilingY: number, isVirtual = false): WallSpan[] {
  const clockwise = polygon.reduce((area, point, i) => {
    const next = polygon[(i + 1) % polygon.length];
    return area + point.x * next.z - next.x * point.z;
  }, 0) < 0;
  const inward = clockwise ? -1 : 1;
  return polygon.map((point, i) => {
    const next = polygon[(i + 1) % polygon.length];
    const ex = next.x - point.x, ez = next.z - point.z;
    const edgeLength = Math.hypot(ex, ez) || 1;
    return {
      id: `wall-${i}`,
      p0: point,
      p1: next,
      normal: { x: -ez / edgeLength * inward, z: ex / edgeLength * inward },
      minY: floorY,
      maxY: ceilingY,
      openings: [],
      isVirtual,
    };
  });
}

/** Fallback room used when Space Setup has no usable floor or the user skips manual calibration. */
export function createDefaultRoom(seat: Vec3, forward: Vec2, table: RoomModel['table'] = null): RoomModel {
  const half = 2.5;
  const floorY = seat.y;
  const polygon: Vec2[] = [
    { x: seat.x - half, z: seat.z - half },
    { x: seat.x + half, z: seat.z - half },
    { x: seat.x + half, z: seat.z + half },
    { x: seat.x - half, z: seat.z + half },
  ];
  return {
    floor: { y: floorY, polygon },
    ceilingY: floorY + 2.6,
    walls: wallsFromFloor(polygon, floorY, floorY + 2.6, true),
    openings: [],
    furniture: [],
    table,
    seat: { x: seat.x, y: floorY, z: seat.z },
    forward,
    confidence: 0.25,
    source: 'mock',
  };
}

export function makeManualRoom(floorPoints: Vec3[], tablePoints: Vec3[], seat: Vec3): RoomModel {
  if (floorPoints.length < 3) throw new Error('Mark at least three floor corners');
  const floor = floorPoints.map(({ x, z }) => ({ x, z }));
  if (polygonArea(floor) < 2.5) throw new Error('Floor outline is too small or corners are out of order');
  const floorY = floorPoints.reduce((sum, point) => sum + point.y, 0) / floorPoints.length;
  const tablePolygon = tablePoints.map(({ x, z }) => ({ x, z }));
  if (tablePoints.length && (tablePoints.length < 3 || polygonArea(tablePolygon) < 0.12)) throw new Error('Mark at least three table corners in order');
  const tableY = tablePoints.length ? tablePoints.reduce((sum, point) => sum + point.y, 0) / tablePoints.length : null;
  if (tableY !== null && (tableY - floorY < 0.3 || tableY - floorY > 1.5)) throw new Error('Table height is outside the expected range');
  const tableCenter = tablePolygon.length ? tablePolygon.reduce((sum, point) => ({ x: sum.x + point.x / tablePolygon.length, z: sum.z + point.z / tablePolygon.length }), { x: 0, z: 0 }) : null;
  const dx = (tableCenter?.x ?? seat.x) - seat.x;
  const dz = (tableCenter?.z ?? seat.z - 1) - seat.z;
  const length = Math.hypot(dx, dz) || 1;
  return {
    floor: { y: floorY, polygon: floor },
    ceilingY: floorY + 2.6,
    walls: wallsFromFloor(floor, floorY, floorY + 2.6),
    openings: [],
    furniture: [],
    table: tableY === null ? null : { topY: tableY, polygon: tablePolygon, label: 'manual table', confidence: 0.65 },
    seat: { x: seat.x, y: floorY, z: seat.z },
    forward: { x: dx / length, z: dz / length },
    confidence: 0.55,
    source: 'manual',
  };
}

export function validateCalibrationCorners(points: Vec3[], surface: 'floor' | 'table') {
  if (points.length !== 4 || points.some(point => ![point.x, point.y, point.z].every(Number.isFinite))) {
    throw new Error('Mark four corners to continue.');
  }
  const minEdge = surface === 'floor' ? 0.25 : 0.10;
  if (points.some((point, i) => points.slice(i + 1).some(other => Math.hypot(point.x - other.x, point.z - other.z) < minEdge))) {
    throw new Error('Two corners are too close. Move to a different corner.');
  }
  const cross = (a: Vec2, b: Vec2, c: Vec2) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const crosses = (a: Vec2, b: Vec2, c: Vec2, d: Vec2) => cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
  const [a, b, c, d] = points;
  if (crosses(a, b, c, d) || crosses(b, c, d, a) || polygonArea(points) < (surface === 'floor' ? 2.5 : 0.12)) {
    throw new Error('Follow the perimeter in order and check the outline.');
  }
}

export function withMarkedTable(room: RoomModel, points: Vec3[]): RoomModel {
  validateCalibrationCorners(points, 'table');
  const topY = points.reduce((total, point) => total + point.y, 0) / points.length;
  if (topY - room.floor.y < 0.3 || topY - room.floor.y > 1.5) throw new Error('Touch the top surface at each table corner.');
  const polygon = points.map(({ x, z }) => ({ x, z }));
  return { ...room, table: { polygon, topY, label: 'manual table', confidence: 0.9 } };
}

/** Stable room identity used to seed the placement solver. */
export function roomFingerprint(room: RoomModel) {
  const b = (points: Vec2[]) => points.reduce((box, point) => ({
    minX: Math.min(box.minX, point.x), maxX: Math.max(box.maxX, point.x),
    minZ: Math.min(box.minZ, point.z), maxZ: Math.max(box.maxZ, point.z),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
  const floor = b(room.floor.polygon);
  const table = room.table ? b(room.table.polygon) : null;
  return [
    (floor.maxX - floor.minX).toFixed(2), (floor.maxZ - floor.minZ).toFixed(2),
    room.ceilingY.toFixed(2), room.seat.x.toFixed(2), room.seat.z.toFixed(2),
    room.forward.x.toFixed(2), room.forward.z.toFixed(2),
    table ? (table.maxX - table.minX).toFixed(2) : 'no-table',
    table ? (table.maxZ - table.minZ).toFixed(2) : 'no-table',
    room.furniture.length,
  ].join('|');
}
