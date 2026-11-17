import { outlineBounds, pointInPolygon, roomFingerprint, type RoomModel, type Vec2, type Vec3 } from './room-model.js';

export const wallThickness = 0.1;
const wallClearance = 0.055;
const mountedClearance = 0.005;

export type SlotType = 'floor' | 'wall' | 'table' | 'ceiling';
export type SlotRule = {
  id: string;
  type: SlotType;
  priority: 0 | 1 | 2;
  reach: 'interact' | 'near' | 'decor';
  footprint: { width: number; depth: number };
  height: number;
  minGap?: number;
  canScale?: boolean;
  preferredHeight?: number;
};
export type Obstacle = { center: Vec3; size: Vec3; yaw: number };
export type SlotPlacement = {
  slotId: string; type: SlotType; position: Vec3; yaw: number; scale: number;
  footprint: SlotRule['footprint']; wallId?: string; score: number;
  breakdown: Record<string, number>; reason: string; locked: boolean;
  /** Fraction of the rule minimum gap used by this placement (1 = full gap). */
  gapScale?: number;
};
export type SolverSettings = { dominantSide?: 'left' | 'right'; gapScale?: number };
export type SolveReport = {
  zone: 'normal' | 'compact' | 'zoned';
  cautious: boolean;
  gridCells: number;
  blockedCells: number;
  unplaced: { slotId: string; reason: string }[];
  p0Unplaced: string[];
  durationMs: number;
  timings: Record<string, number>;
  valid: boolean;
  violations: string[];
};

const clamp = (v: number, low: number, high: number) => Math.max(low, Math.min(high, v));
const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const distanceSq = (a: Vec2, b: Vec2) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const segmentDistance = (point: Vec2, a: Vec2, b: Vec2) => {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(point.x - a.x - t * dx, point.z - a.z - t * dz);
};
const facingYaw = (point: Vec2, seat: Vec2) => Math.atan2(seat.x - point.x, seat.z - point.z);
const rectCorners = (center: Vec2, width: number, depth: number, yaw: number): Vec2[] => {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => ({
    x: center.x + c * sx * width / 2 + s * sz * depth / 2,
    z: center.z - s * sx * width / 2 + c * sz * depth / 2,
  }));
};
const overlap = (a: Obstacle, b: Obstacle, gap = 0) => {
  if (a.center.y + a.size.y / 2 <= b.center.y - b.size.y / 2 || b.center.y + b.size.y / 2 <= a.center.y - a.size.y / 2) return false;
  if (a.yaw === 0 && b.yaw === 0) return Math.abs(a.center.x - b.center.x) < (a.size.x + b.size.x) / 2 + gap && Math.abs(a.center.z - b.center.z) < (a.size.z + b.size.z) / 2 + gap;
  const cos = Math.abs(Math.cos(a.yaw - b.yaw)), sin = Math.abs(Math.sin(a.yaw - b.yaw));
  const dx = b.center.x - a.center.x, dz = b.center.z - a.center.z;
  const aw = (a.size.x + gap) / 2, ad = (a.size.z + gap) / 2;
  const bw = (b.size.x + gap) / 2, bd = (b.size.z + gap) / 2;
  const ac = Math.cos(a.yaw), as = Math.sin(a.yaw), bc = Math.cos(b.yaw), bs = Math.sin(b.yaw);
  return Math.abs(dx * ac - dz * as) < aw + bw * cos + bd * sin
    && Math.abs(dx * as + dz * ac) < ad + bw * sin + bd * cos
    && Math.abs(dx * bc - dz * bs) < bw + aw * cos + ad * sin
    && Math.abs(dx * bs + dz * bc) < bd + aw * sin + ad * cos;
};
const hashSeed = (seed: number, id: string) => {
  let h = seed >>> 0;
  for (const char of id) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return h;
};
const hashPosition = (seed: number, x: number, z: number) => {
  let h = Math.imul(seed ^ Math.round(x * 100), 16777619);
  h = Math.imul(h ^ Math.round(z * 100), 16777619);
  return (h >>> 0) / 4294967296;
};
const roomSeed = (room: RoomModel) => {
  let h = 2166136261;
  for (const char of roomFingerprint(room)) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  return h >>> 0;
};
const bounds = (polygon: Vec2[]) => ({
  minX: Math.min(...polygon.map(p => p.x)), maxX: Math.max(...polygon.map(p => p.x)),
  minZ: Math.min(...polygon.map(p => p.z)), maxZ: Math.max(...polygon.map(p => p.z)),
});
const isAxisAlignedRect = (polygon: Vec2[], box: ReturnType<typeof bounds>) => polygon.length === 4 && polygon.every(point => (point.x === box.minX || point.x === box.maxX) && (point.z === box.minZ || point.z === box.maxZ));
function containsFootprint(center: Vec2, width: number, depth: number, yaw: number, polygon: Vec2[], box: ReturnType<typeof bounds>, rectangle: boolean, clearance = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  if (rectangle) {
    const hx = (Math.abs(c) * width + Math.abs(s) * depth) / 2 + clearance;
    const hz = (Math.abs(s) * width + Math.abs(c) * depth) / 2 + clearance;
    return center.x - hx > box.minX && center.x + hx < box.maxX && center.z - hz > box.minZ && center.z + hz < box.maxZ;
  }
  const halfWidth = width / 2 + clearance, halfDepth = depth / 2 + clearance;
  if (!rectCorners(center, halfWidth * 2, halfDepth * 2, yaw).every(corner => pointInPolygon(corner, polygon))) return false;
  // A wall can cut through a footprint in a concave room even when all four corners are inside.
  let previous = polygon[polygon.length - 1];
  for (const point of polygon) {
    const x = point.x - center.x, z = point.z - center.z;
    const px = previous.x - center.x, pz = previous.z - center.z;
    const u = x * c - z * s, v = x * s + z * c;
    const pu = px * c - pz * s, pv = px * s + pz * c;
    previous = point;
    if (Math.min(u, pu) >= halfWidth || Math.max(u, pu) <= -halfWidth || Math.min(v, pv) >= halfDepth || Math.max(v, pv) <= -halfDepth) continue;
    const du = u - pu, dv = v - pv;
    const start = Math.max(0, du ? (-Math.sign(du) * halfWidth - pu) / du : 0, dv ? (-Math.sign(dv) * halfDepth - pv) / dv : 0);
    const end = Math.min(1, du ? (Math.sign(du) * halfWidth - pu) / du : 1, dv ? (Math.sign(dv) * halfDepth - pv) / dv : 1);
    if (start < end) return false;
  }
  return true;
}
const toObstacle = (placement: SlotPlacement, rule: SlotRule): Obstacle => ({
  center: { x: placement.position.x, y: placement.position.y + rule.height * placement.scale / 2, z: placement.position.z },
  size: { x: rule.footprint.width * placement.scale, y: rule.height * placement.scale, z: rule.footprint.depth * placement.scale }, yaw: placement.yaw,
});
const tableObstacle = (room: RoomModel): Obstacle | null => {
  if (!room.table) return null;
  const { center, width, depth, yaw } = outlineBounds(room.table.polygon);
  const height = room.table.topY - room.floor.y;
  return { center: { ...center, y: room.floor.y + height / 2 }, size: { x: width, y: height, z: depth }, yaw };
};
const wallLength = (wall: RoomModel['walls'][number]) => distance(wall.p0, wall.p1);
const pointOnWall = (wall: RoomModel['walls'][number], t: number): Vec2 => {
  const length = wallLength(wall) || 1;
  return { x: wall.p0.x + (wall.p1.x - wall.p0.x) * (t / length), z: wall.p0.z + (wall.p1.z - wall.p0.z) * (t / length) };
};
const positionAlongWall = (wall: RoomModel['walls'][number], point: Vec2) => {
  const length = wallLength(wall) || 1;
  const dx = wall.p1.x - wall.p0.x, dz = wall.p1.z - wall.p0.z;
  return clamp(((point.x - wall.p0.x) * dx + (point.z - wall.p0.z) * dz) / (length * length), 0, 1) * length;
};
const openingRanges = (room: RoomModel, wallId: string) => room.openings
  .filter(opening => opening.wallId === wallId && opening.width != null && opening.center != null)
  .map(opening => ({ start: opening.center! - opening.width! / 2, end: opening.center! + opening.width! / 2 }));

export function validatePlacements(room: RoomModel, rules: SlotRule[], placements: SlotPlacement[], devices: Obstacle[] = []) {
  const violations: string[] = [];
  const ruleMap = new Map(rules.map(rule => [rule.id, rule]));
  const tableBody = tableObstacle(room);
  const fixed = [...room.furniture, ...devices, ...(tableBody ? [tableBody] : [])];
  const floorBox = bounds(room.floor.polygon), floorRect = isAxisAlignedRect(room.floor.polygon, floorBox);
  const tableBox = room.table ? bounds(room.table.polygon) : null;
  const tableRect = !!room.table && !!tableBox && isAxisAlignedRect(room.table.polygon, tableBox);
  const wallMap = new Map(room.walls.map(wall => [wall.id, wall]));
  const exit = nearestWallPoint(room);
  for (let i = 0; i < placements.length; i++) {
    const placement = placements[i], rule = ruleMap.get(placement.slotId);
    if (!rule) { violations.push(`${placement.slotId}: unknown rule`); continue; }
    const body = toObstacle(placement, rule);
    if (placement.position.y < room.floor.y - 0.02 || placement.position.y + rule.height * placement.scale > room.ceilingY + 0.02) violations.push(`${rule.id}: outside height range`);
    const clearance = rule.type === 'wall' ? mountedClearance : wallClearance;
    if (rule.id !== 'door' && !containsFootprint(placement.position, body.size.x, body.size.z, placement.yaw, room.floor.polygon, floorBox, floorRect, clearance)) violations.push(`${rule.id}: crosses room boundary`);
    if (rule.type === 'table' && (!room.table || !tableBox || !containsFootprint(placement.position, body.size.x, body.size.z, placement.yaw, room.table.polygon, tableBox, tableRect))) violations.push(`${rule.id}: outside table`);
    if (rule.type === 'ceiling' && (placement.position.y + body.size.y > room.ceilingY + 0.02)) violations.push(`${rule.id}: above ceiling`);
    if (rule.reach === 'interact') {
      const horizontal = distance(placement.position, room.seat);
      const centreY = placement.position.y + rule.height * placement.scale / 2;
      if (horizontal < 0.35 || horizontal > 1.5) violations.push(`${rule.id}: out of reach`);
      if (centreY < room.floor.y + 0.15 || centreY > room.floor.y + 1.8) violations.push(`${rule.id}: outside reach height`);
    }
    const placementGap = (rule.minGap ?? 0.15) * (placement.gapScale ?? 1);
    if (rule.type === 'floor' || rule.type === 'table') {
      if (fixed.some(obstacle => overlap(body, obstacle, placementGap))) violations.push(`${rule.id}: obstacle overlap`);
    } else if (fixed.some(obstacle => overlap(body, obstacle, Math.min(placementGap, 0.03)))) {
      violations.push(`${rule.id}: obstacle overlap`);
    }
    if (rule.type === 'wall' && placement.wallId && rule.id !== 'door') {
      const wall = wallMap.get(placement.wallId);
      if (wall) {
        const t = positionAlongWall(wall, placement.position);
        const half = rule.footprint.width * placement.scale / 2;
        if (openingRanges(room, wall.id).some(range => t + half > range.start - 0.1 && t - half < range.end + 0.1)) violations.push(`${rule.id}: blocks an opening`);
      }
    }
    if (rule.type === 'floor' && exit && segmentDistance(placement.position, room.seat, exit) < 0.3 + Math.min(body.size.x, body.size.z) / 2) violations.push(`${rule.id}: blocks exit corridor`);
    for (let j = i + 1; j < placements.length; j++) {
      const other = placements[j], otherRule = ruleMap.get(other.slotId);
      if (!otherRule) continue;
      const otherGap = (otherRule.minGap ?? 0.15) * (other.gapScale ?? 1);
      if (overlap(body, toObstacle(other, otherRule), Math.max(placementGap, otherGap))) violations.push(`${rule.id}/${other.slotId}: overlap`);
    }
  }
  return violations;
}

function nearestWallPoint(room: RoomModel): Vec2 | null {
  const doorWalls = room.openings.filter(opening => opening.type === 'door').map(opening => room.walls.find(wall => wall.id === opening.wallId)).filter((wall): wall is NonNullable<typeof wall> => !!wall);
  const walls = doorWalls.length ? doorWalls : room.walls;
  if (!walls.length) return null;
  return walls.reduce((nearest, wall) => {
    const mid = { x: (wall.p0.x + wall.p1.x) / 2, z: (wall.p0.z + wall.p1.z) / 2 };
    return !nearest || distance(mid, room.seat) < distance(nearest, room.seat) ? mid : nearest;
  }, null as Vec2 | null);
}

export function solve(room: RoomModel, rules: SlotRule[], devices: Obstacle[] = [], locked: SlotPlacement[] = [], settings: SolverSettings = {}, seed?: number): { placements: SlotPlacement[]; report: SolveReport } {
  const started = performance.now();
  const cautious = room.confidence < 0.5;
  const seedValue = seed ?? roomSeed(room);
  const baseGapScale = settings.gapScale ?? (cautious ? 2 : 1);
  const activeRules = cautious ? rules.filter(rule => rule.priority < 2) : rules;
  const box = bounds(room.floor.polygon);
  const floorRect = isAxisAlignedRect(room.floor.polygon, box);
  const tableBox = room.table ? bounds(room.table.polygon) : null;
  const tableRect = !!room.table && !!tableBox && isAxisAlignedRect(room.table.polygon, tableBox);
  const { width, depth } = outlineBounds(room.floor.polygon);
  const zone: SolveReport['zone'] = Math.min(width, depth) < 2.5 ? 'compact' : width > 6 || depth > 6 ? 'zoned' : 'normal';
  const minX = Math.max(box.minX, room.seat.x - 3), maxX = Math.min(box.maxX, room.seat.x + 3);
  const minZ = Math.max(box.minZ, room.seat.z - 3), maxZ = Math.min(box.maxZ, room.seat.z + 3);
  const zoneBox = { minX, maxX, minZ, maxZ };
  const candidateWalls = room.walls;
  const wallById = new Map(candidateWalls.map(wall => [wall.id, wall]));
  const wallLengths = new Map(candidateWalls.map(wall => [wall.id, wallLength(wall)]));
  const openingRangeMap = new Map(candidateWalls.map(wall => [wall.id, openingRanges(room, wall.id)]));
  const exitWall = nearestWallPoint(room);
  const tableBody = tableObstacle(room);
  const fixedObstacles = [...room.furniture, ...devices, ...(tableBody ? [tableBody] : [])];
  const grid: { x: number; z: number; wallDist: number; forwardDot: number }[] = [];
  let blockedCells = 0;
  const gridStart = performance.now();
  for (let ix = 0; ix <= Math.floor((maxX - minX) / 0.1); ix++) for (let iz = 0; iz <= Math.floor((maxZ - minZ) / 0.1); iz++) {
    const point = { x: minX + ix * 0.1, z: minZ + iz * 0.1 };
    const inRoom = floorRect ? point.x > box.minX && point.x < box.maxX && point.z > box.minZ && point.z < box.maxZ : pointInPolygon(point, room.floor.polygon);
    const bySeat = distanceSq(point, room.seat) < 0.64;
    const byExit = !!exitWall && segmentDistance(point, room.seat, exitWall) < 0.3;
    const byTable = !!room.table && (tableRect && tableBox ? point.x > tableBox.minX && point.x < tableBox.maxX && point.z > tableBox.minZ && point.z < tableBox.maxZ : pointInPolygon(point, room.table.polygon));
    const byFurniture = room.furniture.some(item => item.size.y >= 0.1 && overlap({ center: { ...point, y: room.floor.y + 0.5 }, size: { x: 0.1, y: 1, z: 0.1 }, yaw: 0 }, item, 0.25));
    const byDevice = devices.some(device => overlap({ center: { ...point, y: device.center.y }, size: { x: 0.1, y: 0.1, z: 0.1 }, yaw: 0 }, device, 0.02));
    if (!inRoom || bySeat || byExit || byTable || byFurniture || byDevice) blockedCells++;
    else {
      const wallDist = Math.min(point.x - minX, maxX - point.x, point.z - minZ, maxZ - point.z);
      const dx = point.x - room.seat.x, dz = point.z - room.seat.z, length = Math.hypot(dx, dz) || 1;
      grid.push({ ...point, wallDist, forwardDot: (dx * room.forward.x + dz * room.forward.z) / length });
    }
  }
  const totalCells = grid.length + blockedCells;
  const timings: Record<string, number> = { grid: performance.now() - gridStart };

  const gridCandidates = grid.map(point => ({
    x: point.x, z: point.z, y: room.floor.y, yaw: facingYaw(point, room.seat), wallDist: point.wallDist, forwardDot: point.forwardDot,
  }));
  const decorGridCandidates = gridCandidates.filter(point => point.wallDist <= 0.45);
  const interactGridCandidates = gridCandidates.filter(point => {
    const d = Math.hypot(point.x - room.seat.x, point.z - room.seat.z);
    return d >= 0.4 && d <= 1.5;
  });
  const placements: SlotPlacement[] = [...locked];
  const lockedIds = new Set(locked.map(placement => placement.slotId));
  const placedBodies = locked.flatMap(placement => {
    const rule = activeRules.find(item => item.id === placement.slotId) ?? rules.find(item => item.id === placement.slotId);
    return rule ? [{ placement, rule, body: toObstacle(placement, rule) }] : [];
  });
  const unplaced = new Map<string, string>();
  const ruleMap = new Map(activeRules.map(rule => [rule.id, rule]));
  const tableCandidates: { x: number; z: number; y: number; yaw: number }[] = [];
  if (room.table && tableBox) {
    for (let x = tableBox.minX + 0.03; x <= tableBox.maxX - 0.03; x += 0.05) {
      for (let z = tableBox.minZ + 0.03; z <= tableBox.maxZ - 0.03; z += 0.05) {
        tableCandidates.push({ x, z, y: room.table.topY, yaw: facingYaw({ x, z }, room.seat) });
      }
    }
  }

  const candidatesFor = (rule: SlotRule, scale: number): { x: number; z: number; y: number; yaw: number; wallId?: string; wallT?: number; wallDist?: number; forwardDot?: number }[] => {
    if (rule.type === 'floor') return rule.reach === 'decor' ? decorGridCandidates : rule.reach === 'interact' ? interactGridCandidates : gridCandidates;
    if (rule.type === 'table') return tableCandidates;
    if (rule.type === 'ceiling') {
      const x = (minX + maxX) / 2, z = (minZ + maxZ) / 2;
      const y = room.ceilingY - rule.height * scale;
      return y >= room.floor.y ? [{ x, z, y, yaw: facingYaw({ x, z }, room.seat) }] : [];
    }
    const candidates: { x: number; z: number; y: number; yaw: number; wallId?: string; wallT?: number }[] = [];
    if (rule.reach === 'near' && !candidateWalls.some(wall => segmentDistance(room.seat, wall.p0, wall.p1) <= 2.2)) return candidates;
    const half = rule.footprint.width * scale / 2;
    for (const wall of candidateWalls) {
      const length = wallLengths.get(wall.id) ?? wallLength(wall);
      if (length < rule.footprint.width * scale + 0.2) continue;
      const ranges = rule.id === 'door' ? [] : openingRangeMap.get(wall.id) ?? [];
      const centreHeight = rule.preferredHeight ?? (rule.height > 1.6 ? rule.height / 2 : 1.5);
      const y = room.floor.y + centreHeight - rule.height * scale / 2;
      if (y < room.floor.y - 0.005 || y + rule.height * scale > room.ceilingY + 0.005) continue;
      for (let t = half + 0.1; t <= length - half - 0.1; t += 0.1) {
        if (ranges.some(range => t + half > range.start - 0.1 && t - half < range.end + 0.1)) continue;
        const along = pointOnWall(wall, t);
        const inset = rule.id === 'door' ? 0.08 : mountedClearance * Math.SQRT2 + rule.footprint.depth * scale / 2 + 0.001;
        candidates.push({ x: along.x + wall.normal.x * inset, z: along.z + wall.normal.z * inset, y, yaw: Math.atan2(wall.normal.x, wall.normal.z), wallId: wall.id, wallT: t });
      }
    }
    return candidates;
  };

  const evaluate = (rule: SlotRule, candidate: { x: number; z: number; y: number; yaw: number; wallId?: string; wallT?: number; wallDist?: number; forwardDot?: number }, scale: number, gapScale: number): SlotPlacement | null => {
    const boundaryClearance = rule.type === 'wall' ? mountedClearance : wallClearance;
    if (rule.id !== 'door' && !containsFootprint(candidate, rule.footprint.width * scale, rule.footprint.depth * scale, candidate.yaw, room.floor.polygon, box, floorRect, boundaryClearance)) return null;
    if (rule.type === 'table' && (!room.table || !tableBox || !containsFootprint(candidate, rule.footprint.width * scale, rule.footprint.depth * scale, candidate.yaw, room.table.polygon, tableBox, tableRect))) return null;
    if (candidate.y < room.floor.y - 0.02 || candidate.y + rule.height * scale > room.ceilingY + 0.02) return null;
    if (rule.type === 'wall' && candidate.wallId && rule.id !== 'door') {
      const wall = wallById.get(candidate.wallId);
      if (wall) {
        const t = candidate.wallT ?? positionAlongWall(wall, candidate);
        const half = rule.footprint.width * scale / 2;
        if ((openingRangeMap.get(wall.id) ?? []).some(range => t + half > range.start - 0.1 && t - half < range.end + 0.1)) return null;
      }
    }
    const d = distance(candidate, room.seat);
    const centreY = candidate.y + rule.height * scale / 2;
    if (rule.reach === 'interact' && (d < 0.4 || d > 1.5 || centreY < room.floor.y + 0.15 || centreY > room.floor.y + 1.8)) return null;
    if (rule.reach === 'near' && d > 2.2) return null;
    if (rule.type === 'floor' && exitWall) {
      const half = Math.min(rule.footprint.width, rule.footprint.depth) * scale / 2;
      if (segmentDistance(candidate, room.seat, exitWall) < 0.3 + half) return null;
    }
    const placement: SlotPlacement = {
      slotId: rule.id, type: rule.type, position: { x: candidate.x, y: candidate.y, z: candidate.z }, yaw: candidate.yaw, scale,
      footprint: rule.footprint, wallId: candidate.wallId, score: 0, breakdown: {}, reason: 'highest valid score', locked: false, gapScale,
    };
    const body = toObstacle(placement, rule);
    const gap = (rule.minGap ?? 0.15) * gapScale;
    if (fixedObstacles.some(obstacle => overlap(body, obstacle, rule.type === 'table' || rule.type === 'wall' || rule.type === 'ceiling' ? Math.min(gap, 0.03) : gap))) return null;
    if (placedBodies.some(other => overlap(body, other.body, Math.max(gap, (other.rule.minGap ?? 0.15) * (other.placement.gapScale ?? 1))))) return null;
    if (rule.type === 'floor' && d < 0.8) return null;

    let spacing = 1;
    if (placements.length) {
      let nearest = Infinity;
      for (const other of placements) nearest = Math.min(nearest, distanceSq(candidate, other.position));
      spacing = clamp(Math.sqrt(nearest) / 2, 0, 1);
    }
    let clearance = 1;
    if (fixedObstacles.length) {
      let nearest = Infinity;
      for (const obstacle of fixedObstacles) nearest = Math.min(nearest, distanceSq(candidate, obstacle.center));
      clearance = clamp(Math.sqrt(nearest) / 2, 0, 1);
    }
    const forwardDot = candidate.forwardDot ?? ((candidate.x - room.seat.x) * room.forward.x + (candidate.z - room.seat.z) * room.forward.z) / (d || 1);
    const reach = rule.reach === 'interact' ? 1 - Math.abs(d - 0.85) / 0.85 : clamp(1 - d / 3, 0, 1);
    const visibility = clamp((forwardDot + 1) / 2, 0, 1);
    const wall = candidate.wallId ? wallById.get(candidate.wallId) : undefined;
    const wallDist = candidate.wallDist ?? (wall ? Math.min(candidate.wallT ?? 0, (wallLengths.get(wall.id) ?? wallLength(wall)) - (candidate.wallT ?? 0)) : Math.min(candidate.x - minX, maxX - candidate.x, candidate.z - minZ, maxZ - candidate.z));
    const wallFit = rule.type === 'wall' ? 1 : rule.type === 'floor' && rule.reach === 'decor' ? 1 - clamp(wallDist / 1.5, 0, 1) : clamp(wallDist / 1.5, 0, 1);
    const balance = settings.dominantSide === 'left' ? candidate.x < room.seat.x ? 1 : 0.5 : candidate.x > room.seat.x ? 1 : 0.5;
    const corner = rule.type === 'wall' && wall && wallDist < 0.6 ? 1 : rule.type === 'floor' && rule.reach === 'decor' && wallDist < 0.35 ? 1 : 0;
    const sun = rule.type === 'wall' && candidate.wallId ? (room.openings.some(opening => opening.wallId === candidate.wallId) ? 1 : 0) : 0;
    const stability = hashPosition(hashSeed(seedValue, rule.id), candidate.x, candidate.z);
    placement.breakdown = { reach, visibility, wallFit, spacing, clearance, balance, corner, sun, stability };
    placement.score = 0.22 * reach + 0.18 * visibility + 0.14 * wallFit + 0.10 * spacing + 0.10 * clearance + 0.06 * balance + 0.05 * corner + 0.05 * sun + 0.10 * stability;
    return placement;
  };

  let lastCandidateCount = 0;
  const placeRule = (rule: SlotRule, gapScale: number): SlotPlacement | null => {
    let best: SlotPlacement | null = null;
    lastCandidateCount = 0;
    const scales = rule.canScale ? [1, 0.8, 0.65] : [1];
    for (const scale of scales) {
      const candidates = candidatesFor(rule, scale);
      lastCandidateCount += candidates.length;
      for (const candidate of candidates) {
        const placement = evaluate(rule, candidate, scale, gapScale);
        if (placement && (!best || placement.score > best.score)) best = placement;
      }
      if (best) break;
    }
    return best;
  };

  const ordered = [...activeRules].filter(rule => !lockedIds.has(rule.id)).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  for (const rule of ordered) {
    const slotStart = performance.now();
    const first = placeRule(rule, baseGapScale);
    const best = first ?? (lastCandidateCount ? placeRule(rule, baseGapScale * 0.7) : null);
    if (best) {
      placements.push(best);
      placedBodies.push({ placement: best, rule, body: toObstacle(best, rule) });
    } else {
      unplaced.set(rule.id, rule.type === 'table' && !room.table ? 'no table; side-tray fallback required' : 'no valid candidate after gap/scale fallback');
    }
    timings[rule.id] = performance.now() - slotStart;
  }

  // P0 recovery: drop up to two optional props that may be boxing in a required slot, then retry once.
  for (const rule of ordered.filter(item => item.priority === 0 && unplaced.has(item.id))) {
    let removed = 0;
    for (let i = placements.length - 1; i >= 0 && removed < 2; i--) {
      const optionalRule = ruleMap.get(placements[i].slotId);
      if (optionalRule && optionalRule.priority > 0 && !lockedIds.has(placements[i].slotId)) {
        unplaced.set(placements[i].slotId, `removed to make room for P0 ${rule.id}`);
        placements.splice(i, 1);
        removed++;
      }
    }
    if (!removed) continue;
    placedBodies.length = 0;
    for (const placement of placements) {
      const placementRule = ruleMap.get(placement.slotId);
      if (placementRule) placedBodies.push({ placement, rule: placementRule, body: toObstacle(placement, placementRule) });
    }
    const best = placeRule(rule, baseGapScale * 0.5);
    if (best) {
      placements.push(best);
      placedBodies.push({ placement: best, rule, body: toObstacle(best, rule) });
      unplaced.delete(rule.id);
    }
  }

  const validationStart = performance.now();
  const violations = validatePlacements(room, rules, placements, devices);
  const p0Unplaced = ordered.filter(rule => rule.priority === 0 && unplaced.has(rule.id)).map(rule => rule.id);
  timings.validation = performance.now() - validationStart;
  return {
    placements,
    report: {
      zone, cautious, gridCells: totalCells, blockedCells,
      unplaced: [...unplaced].map(([slotId, reason]) => ({ slotId, reason })),
      p0Unplaced, durationMs: performance.now() - started, timings,
      valid: violations.length === 0, violations,
    },
  };
}
