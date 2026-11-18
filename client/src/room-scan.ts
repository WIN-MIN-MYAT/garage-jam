import { Quaternion, Vector3 } from 'three';
import { outlineBounds, pointInPolygon, polygonArea, wallsFromFloor, type Opening, type RoomModel, type Vec2, type Vec3 } from './room-model.js';

type PlanePoint = { x: number; y: number; z: number };
type PlaneLike = {
  planeSpace: XRSpace;
  polygon: ReadonlyArray<PlanePoint>;
  semanticLabel?: string;
  orientation?: string;
};

export type PlaneSnapshot = {
  label: string;
  orientation: 'horizontal' | 'vertical';
  area: number;
  y: number;
  center: Vec3;
  polygon: Vec3[];
  width: number;
  depth: number;
  minY: number;
  maxY: number;
};

export type ScanInfo = {
  planeCount: number;
  labels: Record<string, number>;
  floorSize: [number, number];
  floorY: number;
  ceilingY: number;
  tableTopY: number | null;
  tableCenter: Vec3 | null;
  tableCount: number;
  tableCandidateCount: number;
  openingCount: number;
};

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const distance2d = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.z - b.z);
const segmentDistance = (point: Vec2, a: Vec2, b: Vec2) => {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(point.x - a.x - t * dx, point.z - a.z - t * dz);
};
const projectOnWall = (point: Vec2, a: Vec2, b: Vec2) => {
  const dx = b.x - a.x, dz = b.z - a.z;
  return clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1) * Math.hypot(dx, dz);
};
const signedArea = (points: Vec2[]) => points.reduce((sum, point, i) => {
  const next = points[(i + 1) % points.length];
  return sum + point.x * next.z - next.x * point.z;
}, 0) / 2;

function normalizePolygon(points: Vec2[]) {
  const unique: Vec2[] = [];
  for (const point of points) {
    if (!unique.length || Math.hypot(point.x - unique[unique.length - 1].x, point.z - unique[unique.length - 1].z) > 0.001) unique.push(point);
  }
  if (unique.length > 1 && Math.hypot(unique[0].x - unique[unique.length - 1].x, unique[0].z - unique[unique.length - 1].z) < 0.001) unique.pop();
  if (unique.length < 3) return unique;
  return signedArea(unique) < 0 ? unique.reverse() : unique;
}

export function snapshotPlane(plane: PlaneLike, frame: XRFrame, referenceSpace: XRReferenceSpace): PlaneSnapshot | null {
  const pose = frame.getPose(plane.planeSpace, referenceSpace);
  if (!pose || !plane.polygon?.length) return null;
  const q = pose.transform.orientation;
  const position = pose.transform.position;
  const rotation = new Quaternion(q.x, q.y, q.z, q.w);
  const origin = new Vector3(position.x, position.y, position.z);
  const world = Array.from(plane.polygon, point => new Vector3(point.x, point.y, point.z).applyQuaternion(rotation).add(origin));
  if (world.length > 3 && world[0].distanceToSquared(world[world.length - 1]) < 1e-6) world.pop();
  const xs = world.map(point => point.x), ys = world.map(point => point.y), zs = world.map(point => point.z);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const center = world.reduce((sum, point) => sum.add(point), new Vector3()).multiplyScalar(1 / world.length);
  const horizontal = plane.orientation === 'horizontal' || (plane.orientation !== 'vertical' && maxY - minY < 0.08);
  const polygon = world.map(point => ({ x: point.x, y: point.y, z: point.z }));
  const flat = polygon.map(point => ({ x: point.x, z: point.z }));
  const width = Math.max(...xs) - Math.min(...xs);
  const depth = Math.max(...zs) - Math.min(...zs);
  return {
    label: (plane.semanticLabel || '').toLowerCase(),
    orientation: horizontal ? 'horizontal' : 'vertical',
    area: horizontal ? polygonArea(flat) : Math.hypot(width, depth) * (maxY - minY),
    y: center.y,
    center: { x: center.x, y: center.y, z: center.z },
    polygon,
    width,
    depth,
    minY,
    maxY,
  };
}

function findFloor(horizontal: PlaneSnapshot[], viewer: Vec3) {
  const underViewer = horizontal.filter(plane => plane.area > 0.5 && plane.y < viewer.y && pointInPolygon(viewer, plane.polygon));
  return underViewer.filter(plane => plane.label.includes('floor')).sort((a, b) => Math.abs(a.y) - Math.abs(b.y) || b.area - a.area)[0]
    ?? underViewer.filter(plane => !plane.label && Math.abs(plane.y) < 0.25).sort((a, b) => b.area - a.area)[0]
    ?? null;
}

const isTableLabel = (label: string) => /(?:^|[ _-])(?:table(?:top)?|desk)(?:$|[ _-])/.test(label);

type ScanViewer = { position: Vec3; forward: Vec2; lookY?: number };

function findTable(horizontal: PlaneSnapshot[], floor: Vec2[], floorY: number, viewer: ScanViewer, previousTarget?: Vec3) {
  const candidates = horizontal.filter(plane =>
    plane.y > floorY + 0.25 && plane.y < floorY + 1.5 && plane.area > 0.08 &&
    plane.maxY - plane.minY < 0.08 &&
    (isTableLabel(plane.label) || (!plane.label && plane.area < 6)) && pointInPolygon(plane.center, floor),
  );
  const labeled = candidates.filter(plane => isTableLabel(plane.label));
  const choices = labeled.length ? labeled : candidates;
  const { position, forward, lookY } = viewer;
  const score = (plane: PlaneSnapshot) => {
    const distance = distance2d(plane.center, position);
    const facing = ((plane.center.x - position.x) * forward.x + (plane.center.z - position.z) * forward.z) / (distance || 1);
    const deskHeight = plane.y > floorY + 0.55 && plane.y < floorY + 1.15 ? 1.5 : 0;
    return deskHeight + 0.75 * (1 - clamp(distance / 4, 0, 1)) + 0.35 * facing;
  };
  let pointed: PlaneSnapshot | undefined;
  if (lookY != null && Math.abs(lookY) > 0.02) {
    let nearest = Infinity;
    for (const plane of choices) {
      const distance = (plane.y - position.y) / lookY;
      const hit = { x: position.x + distance * forward.x, z: position.z + distance * forward.z };
      if (distance > 0 && distance < nearest && pointInPolygon(hit, plane.polygon)) {
        nearest = distance;
        pointed = plane;
      }
    }
  }
  const previous = previousTarget && choices.find(plane =>
    distance2d(plane.center, previousTarget) < 0.10 && Math.abs(plane.y - previousTarget.y) < 0.07);
  const best = choices.sort((a, b) => score(b) - score(a))[0];
  // A single labelled surface is usable immediately. Ambiguous surfaces need a real look hit.
  const table = pointed ?? previous ?? (lookY == null || labeled.length === 1 ? best : undefined);
  return { table, labeledCount: labeled.length, choices };
}

function scannedTable(plane: PlaneSnapshot): NonNullable<RoomModel['table']> | null {
  const polygon = normalizePolygon(plane.polygon.map(({ x, z }) => ({ x, z })));
  return polygon.length >= 3
    ? { topY: plane.y, polygon, label: plane.label || 'unlabeled surface', confidence: plane.label ? 0.85 : 0.55 }
    : null;
}

export function withScannedTable(room: RoomModel, table: RoomModel['table']): RoomModel {
  if (!table) return { ...room, table };
  const center = outlineBounds(table.polygon).center;
  const x = center.x - room.seat.x, z = center.z - room.seat.z;
  const length = Math.hypot(x, z);
  return { ...room, table, forward: length > 0.05 ? { x: x / length, z: z / length } : room.forward };
}

function wallOutline(vertical: PlaneSnapshot[], floor: Vec2[], floorY: number, viewer: Vec3) {
  const tolerance = 0.18;
  const segments: { a: Vec2; b: Vec2; top: number }[] = [];
  for (const plane of vertical) {
    if (!/^wall(?:$|[_ -]face$)/.test(plane.label) || Math.abs(plane.minY - floorY) > 0.3 || plane.maxY - floorY < 1.6) continue;
    let a = plane.polygon[0], b = a, length = 0;
    for (const p of plane.polygon) for (const q of plane.polygon) {
      const distance = distance2d(p, q);
      if (distance > length) { a = p; b = q; length = distance; }
    }
    if (length < 0.3) continue;
    const nearFloor = (point: Vec2) => pointInPolygon(point, floor)
      || floor.some((p, i) => segmentDistance(point, p, floor[(i + 1) % floor.length]) < 0.3);
    if (nearFloor(a) && nearFloor(b)) segments.push({ a, b, top: plane.maxY });
  }
  const floorArea = polygonArea(floor);
  for (const first of segments) {
    const used = new Set([first]);
    const vertices: Vec2[] = [];
    let end = first.b;
    while (distance2d(end, first.a) > tolerance) {
      const next = segments
        .filter(segment => !used.has(segment))
        .map(segment => distance2d(end, segment.a) < distance2d(end, segment.b) ? segment : { a: segment.b, b: segment.a, top: segment.top, original: segment })
        .filter(segment => distance2d(end, segment.a) <= tolerance);
      if (next.length !== 1) break;
      const segment = next[0];
      vertices.push({ x: (end.x + segment.a.x) / 2, z: (end.z + segment.a.z) / 2 });
      end = segment.b;
      used.add('original' in segment ? segment.original : segment);
    }
    if (vertices.length < 2 || distance2d(end, first.a) > tolerance) continue;
    vertices.push({ x: (end.x + first.a.x) / 2, z: (end.z + first.a.z) / 2 });
    const polygon = normalizePolygon(vertices);
    const area = polygonArea(polygon);
    if (area < floorArea * 0.45 || area > floorArea * 1.15 || !pointInPolygon(viewer, polygon)) continue;
    const tops = [...used].map(segment => segment.top).sort((a, b) => a - b);
    return { polygon, ceilingY: tops[Math.floor(tops.length / 2)] };
  }
  return null;
}

function mapOpenings(vertical: PlaneSnapshot[], room: RoomModel): Opening[] {
  const openings: Opening[] = [];
  for (const plane of vertical) {
    const type = plane.label.includes('door') ? 'door' : plane.label.includes('window') ? 'window' : null;
    if (!type) continue;
    let nearest: { wall: RoomModel['walls'][number]; distance: number; t: number } | null = null;
    for (const wall of room.walls) {
      const distance = segmentDistance(plane.center, wall.p0, wall.p1);
      if (!nearest || distance < nearest.distance) nearest = { wall, distance, t: projectOnWall(plane.center, wall.p0, wall.p1) };
    }
    if (!nearest || nearest.distance > 0.65) continue;
    const wallLength = Math.hypot(nearest.wall.p1.x - nearest.wall.p0.x, nearest.wall.p1.z - nearest.wall.p0.z);
    const width = Math.min(Math.hypot(plane.width, plane.depth) * 0.9, wallLength * 0.85);
    if (width < 0.4 || wallLength < 0.6) continue;
    const opening: Opening = {
      type,
      wallId: nearest.wall.id,
      sillY: Math.max(room.floor.y, plane.minY),
      topY: Math.min(room.ceilingY, plane.maxY),
      center: clamp(nearest.t, width / 2, wallLength - width / 2),
      width,
    };
    if (!openings.some(other => other.wallId === opening.wallId && Math.abs((other.center ?? 0) - (opening.center ?? 0)) < 0.2)) openings.push(opening);
  }
  return openings;
}

export function roomFromSnapshots(snapshots: PlaneSnapshot[], viewer: ScanViewer, previousTarget?: Vec3) {
  const horizontal = snapshots.filter(plane => plane.orientation === 'horizontal');
  const vertical = snapshots.filter(plane => plane.orientation === 'vertical');
  const floor = findFloor(horizontal, viewer.position);
  if (!floor) return null;
  const floorY = floor.y;
  const scannedFloor = normalizePolygon(floor.polygon.map(point => ({ x: point.x, z: point.z })));
  if (scannedFloor.length < 3 || polygonArea(scannedFloor) < 0.5) return null;
  // Quest may expose an enclosing rectangle for a room with more than four walls.
  const boundary = scannedFloor.length === 4 ? wallOutline(vertical, scannedFloor, floorY, viewer.position) : null;
  const floorPolygon = boundary?.polygon ?? scannedFloor;
  const ceiling = horizontal.filter(plane =>
    plane.label.includes('ceiling') && plane.y > floorY + 1.6 && pointInPolygon(viewer.position, plane.polygon),
  ).sort((a, b) => b.area - a.area)[0];
  const ceilingY = ceiling?.y ?? boundary?.ceilingY ?? floorY + 2.6;
  const { table, labeledCount, choices } = findTable(horizontal, floorPolygon, floorY, viewer, previousTarget);
  const seat = { x: viewer.position.x, y: floorY, z: viewer.position.z };
  const forward = viewer.forward;
  const forwardLength = Math.hypot(forward.x, forward.z) || 1;
  const room = withScannedTable({
    floor: { y: floorY, polygon: floorPolygon },
    ceilingY,
    walls: wallsFromFloor(floorPolygon, floorY, ceilingY),
    openings: [],
    furniture: [],
    table: null,
    seat,
    forward: { x: forward.x / forwardLength, z: forward.z / forwardLength },
    confidence: 0.85,
    source: 'webxr',
  }, table ? scannedTable(table) : null);
  room.openings = mapOpenings(vertical, room);
  const labels = snapshots.reduce((counts, plane) => {
    counts[plane.label || 'unlabeled'] = (counts[plane.label || 'unlabeled'] ?? 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  const { width, depth } = outlineBounds(floorPolygon);
  return {
    room,
    tables: choices.flatMap(plane => {
      const candidate = scannedTable(plane);
      return candidate ? [{ table: candidate, center: plane.center }] : [];
    }),
    info: {
      planeCount: snapshots.length,
      labels,
      floorSize: [width, depth],
      floorY,
      ceilingY,
      tableTopY: room.table?.topY ?? null,
      tableCenter: table ? { ...table.center } : null,
      tableCount: labeledCount,
      tableCandidateCount: choices.length,
      openingCount: room.openings.length,
    } satisfies ScanInfo,
  };
}

export function readPlaneSnapshots(frame: XRFrame, referenceSpace: XRReferenceSpace) {
  const planes = [...(frame.detectedPlanes ?? [])];
  return planes
    .map(plane => snapshotPlane(plane as unknown as PlaneLike, frame, referenceSpace))
    .filter((plane): plane is PlaneSnapshot => !!plane);
}

export function readRoomFromFrame(frame: XRFrame, referenceSpace: XRReferenceSpace, snapshots = readPlaneSnapshots(frame, referenceSpace), aimTable = false, previousTarget?: Vec3) {
  const viewerPose = frame.getViewerPose(referenceSpace);
  if (!viewerPose || viewerPose.emulatedPosition || !snapshots.length) return null;
  const position = viewerPose.transform.position;
  const orientation = viewerPose.transform.orientation;
  const direction = new Vector3(0, 0, -1).applyQuaternion(new Quaternion(orientation.x, orientation.y, orientation.z, orientation.w));
  return roomFromSnapshots(snapshots, {
    position: { x: position.x, y: position.y, z: position.z },
    forward: { x: direction.x, z: direction.z },
    lookY: aimTable ? direction.y : undefined,
  }, previousTarget);
}
