import {
  AdditiveBlending, BackSide, Box3, BoxGeometry, BufferAttribute, BufferGeometry, CanvasTexture, createSystem, DoubleSide, ExtrudeGeometry, Group,
  LineBasicMaterial, LineDashedMaterial, LineLoop, Mesh, MeshBasicMaterial, PhysicsBody, PhysicsShape, PhysicsShapeType, PhysicsState,
  PlaneGeometry, Points, PointsMaterial, Quaternion, RingGeometry, Shape, ShapeGeometry, SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace, Vector3,
} from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { addOutline, comicMaterial } from '../comic-style.js';
import { makeDemoRoom } from '../demo-room.js';
import { emit } from '../events.js';
import { garageState, saveLastRoom, savePreferences, setPreference, type TableView } from '../garage-state.js';
import { registerGarageRoot, unregisterGarageRoot } from '../garage-visibility.js';
import { isProductEntry } from '../app-flow/app-flow.js';
import { manualRoomStorageKey, outlineBounds, pointInPolygon, polygonArea, roomFingerprint, type RoomModel, type Vec2 } from '../room-model.js';
import { readPlaneSnapshots, readRoomFromFrame, type PlaneSnapshot, type ScanInfo } from '../room-scan.js';
import { solve, wallThickness, type Obstacle, type SlotPlacement, type SlotRule, type SlotType } from '../placement-solver.js';
import { slotRules } from '../slot-rules.js';
import { createPlaceholder, type Slot } from '../slot-manager.js';
import { applyRevealMaterial, createRevealSurface, projectionRange } from '../reveal/reveal-shader.js';
import type { RevealBlueprint, RevealDoor, RevealProp, RevealRuntime, RevealSticker, RevealSurface } from '../reveal/reveal-types.js';
const assetForSlot: Record<string, string> = {
  trash: 'SLOT_TrashCan',
  neon: 'SLOT_NeonSign',
  'stats-board': 'SLOT_StatsBoard',
  'calendar-board': 'SLOT_CalendarBoard',
  corkboard: 'SLOT_Corkboard',
  whiteboard: 'SLOT_Whiteboard',
  pegboard: 'SLOT_PegboardTools',
  shelf: 'SLOT_Shelf',
  crates: 'SLOT_Crates',
  tires: 'SLOT_TireStack',
  'mini-fridge': 'SLOT_MiniFridge',
  'paint-cans': 'SLOT_PaintCans',
  toolbox: 'SLOT_Toolbox',
  'patch-bay': 'SLOT_PatchBay',
  lamp: 'SLOT_Lamp',
  shutter: 'SLOT_MetalShutter',
  graffiti: 'SLOT_GraffitiDecals',
};

const tabletopThickness = 0.06;
const bounds = (points: Vec2[]) => points.reduce((box, point) => ({
  minX: Math.min(box.minX, point.x), maxX: Math.max(box.maxX, point.x),
  minZ: Math.min(box.minZ, point.z), maxZ: Math.max(box.maxZ, point.z),
}), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });

const overlapsBox = (a: Obstacle, b: Obstacle, gap = 0) => {
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

const pointSegmentDistance = (point: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) => {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(point.x - a.x - t * dx, point.z - a.z - t * dz);
};

type StickerWallInfo = {
  wall: RoomModel['walls'][number];
  length: number;
  dir: Vec2;
  normal: Vec2;
  openings: { center: number; width: number; sillY: number; topY: number }[];
  reserved: { along: number; width: number; y: number; height: number }[];
};

/** Keep the workbench's long side aligned with the table's long side. */
function tableFrame(polygon: Vec2[]) {
  const obb = outlineBounds(polygon);
  let width = obb.width, depth = obb.depth, yaw = obb.yaw;
  if (depth > width) {
    [width, depth] = [depth, width];
    yaw += Math.PI / 2;
  }
  return { center: obb.center, width, depth, yaw };
}

function polygonShape(points: Vec2[], thickness = 0) {
  const shape = new Shape();
  points.forEach((point, index) => index ? shape.lineTo(point.x, point.z) : shape.moveTo(point.x, point.z));
  shape.closePath();
  const geometry = thickness ? new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false }) : new ShapeGeometry(shape);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function countTriangles(root: Group) {
  let triangles = 0;
  root.traverse(object => {
    if (!(object instanceof Mesh)) return;
    const geometry = object.geometry;
    triangles += geometry.index ? geometry.index.count / 3 : (geometry.attributes.position?.count ?? 0) / 3;
  });
  return triangles;
}

function loadSavedRoom(): RoomModel | null {
  try {
    const stored = localStorage.getItem(manualRoomStorageKey);
    if (stored) {
      const room = JSON.parse(stored) as RoomModel;
      if (room?.floor?.polygon?.length >= 3 && room.walls?.length) return room;
    }
  } catch { /* no saved room */ }
  return null;
}

function wallLength(wall: RoomModel['walls'][number]) {
  return Math.hypot(wall.p1.x - wall.p0.x, wall.p1.z - wall.p0.z);
}

function wallPoint(wall: RoomModel['walls'][number], t: number) {
  const length = wallLength(wall) || 1;
  return {
    x: wall.p0.x + (wall.p1.x - wall.p0.x) * (t / length),
    z: wall.p0.z + (wall.p1.z - wall.p0.z) * (t / length),
  };
}

export class GarageBuildSystem extends createSystem({}) {
  private room: RoomModel = makeDemoRoom();
  private revealed = false;
  private ready = false;
  private building = false;
  private scanning = false;
  private deviceObstacles: Obstacle[] = [];
  private deviceSignature = '';
  private layoutResolveToken = 0;
  private root = new Group();
  private loader = new GLTFLoader();
  private surfaces: RevealSurface[] = [];
  private revealProps: RevealProp[] = [];
  private revealStickers: RevealSticker[] = [];
  private stickerTextures: any[] = [];
  private blueprint: RevealBlueprint | null = null;
  private doorRuntime: RevealDoor | null = null;
  private revealRuntime: RevealRuntime | null = null;
  private tableSurface?: RevealSurface;
  private doorFrameMaterial?: MeshBasicMaterial;
  private modelLoads: Promise<void>[] = [];
  private scanOverlay = new Group();
  private scanLabels = new Map<string, CanvasTexture>();
  private scanInfo: ScanInfo | null = null;
  private sourceLabel = 'DEMO';
  private tableMode: 'WINDOW' | 'SCAN' = 'SCAN';
  private slotConfig: Record<string, Slot> = {};
  private rules = slotRules;
  private placements: SlotPlacement[] = [];
  private tableGroup?: Group;
  private propGroup?: Group;
  private tableMaterial?: any;
  private tableCollider?: Entity;
  private tableOccluder?: Mesh;
  private tableEditToken = 0;
  private scanStartedAt = 0;
  private lastScanAt = 0;
  private stopScan?: () => void;
  private scanTimeout?: number;
  private scanErrorLogged = false;
  private scanCandidate: ReturnType<typeof readRoomFromFrame> = null;
  private candidateAt = -Infinity;
  private trackedScanFrame = false;
  private referenceSpace?: XRReferenceSpace;
  private buildGeneration = 0;
  private readonly onSpaceReset = () => {
    if (isProductEntry) emit('garage-space-reset');
    else {
      emit('room-manual-cancel');
      this.resetForRescan();
    }
  };

  init() {
    const shell = this.world.getSceneObject('garage-shell');
    if (shell) shell.visible = false;
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    this.root.name = 'Room-driven garage';
    this.world.createTransformEntity(this.root, { persistent: true });
    this.scanOverlay.name = 'Room scan overlay';
    this.world.scene.add(this.scanOverlay);
    registerGarageRoot(this.root);
    const stopTrackingSpace = this.world.onXRFrame(() => {
      const space = this.world.renderer.xr.getReferenceSpace();
      if (!space || space === this.referenceSpace) return;
      this.referenceSpace?.removeEventListener('reset', this.onSpaceReset);
      this.referenceSpace = space;
      space.addEventListener('reset', this.onSpaceReset);
    });
    const forced = new URLSearchParams(location.search).get('roomSource');
    if (isProductEntry) {
      // AppFlow owns S2/S3/S11 and calls beginRoomScan / startFromSavedRoom / startFromLastRoom.
      emit('status', 'Ready for room access');
    } else if (forced === 'demo') {
      this.buildRoom(makeDemoRoom(), 'DEMO', null);
    } else if (forced === 'manual') {
      const manual = loadSavedRoom();
      this.buildRoom(manual ?? makeDemoRoom(), manual ? 'MANUAL' : 'DEMO', null);
    } else {
      this.beginRoomScan();
    }
    this.cleanupFuncs.push(() => {
      stopTrackingSpace();
      this.referenceSpace?.removeEventListener('reset', this.onSpaceReset);
      this.stopScanning();
      this.removeTableCollider();
      this.clearScanOverlay(true);
      this.scanOverlay.removeFromParent();
      this.scanLabels.forEach(texture => texture.dispose());
      this.scanLabels.clear();
      unregisterGarageRoot(this.root);
      this.disposeGroup(this.root);
    });
  }

  cancelRoomScan() {
    this.stopScanning();
    this.clearScanOverlay(true);
  }

  private scanLabel(text: string, color: string) {
    const key = `${text}|${color}`;
    const cached = this.scanLabels.get(key);
    if (cached) return cached;
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = 'rgba(10,12,17,0.86)';
    ctx.fillRect(4, 4, 504, 120);
    ctx.strokeStyle = color; ctx.lineWidth = 7; ctx.strokeRect(4, 4, 504, 120);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 48px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 66, 460);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    this.scanLabels.set(key, texture);
    return texture;
  }

  private updateScanOverlay(snapshots: PlaneSnapshot[], selected: ScanInfo['tableCenter']) {
    this.clearScanOverlay(false);
    this.scanOverlay.visible = true;
    for (const plane of snapshots) {
      const label = plane.label;
      const chosen = selected && Math.hypot(plane.center.x - selected.x, plane.center.y - selected.y, plane.center.z - selected.z) < 0.01;
      const color = chosen ? '#e8ff2a' : label.includes('floor') ? '#19e3ff'
        : /table|desk/.test(label) ? '#dba6f7'
        : label.includes('door') || label.includes('window') ? '#ffffff'
        : label.includes('wall') ? '#ff3d9f'
        : label ? '#ff8a1f' : '#8fa3b8';
      if (plane.polygon.length >= 3) {
        const geometry = new BufferGeometry().setFromPoints(plane.polygon.map(point => new Vector3(point.x, point.y, point.z)));
        const isOpening = label.includes('door') || label.includes('window');
        const lineMaterial = isOpening
          ? new LineDashedMaterial({ color, dashSize: 0.06, gapSize: 0.04, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false })
          : new LineBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false });
        const line = new LineLoop(geometry, lineMaterial);
        if (isOpening) line.computeLineDistances();
        line.name = `Scan plane ${label || 'unlabeled'}`;
        line.renderOrder = 995;
        this.scanOverlay.add(line);
      }
      const text = chosen ? 'SELECTED TABLE' : label.includes('floor') ? 'FLOOR'
        : /table|desk/.test(label) ? 'TABLE'
        : label.includes('door') ? 'DOOR'
        : label.includes('window') ? 'WINDOW'
        : label.includes('wall') ? 'WALL'
        : label ? 'FURNITURE' : 'SURFACE';
      const texture = this.scanLabel(text, color);
      const material = new SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
      const sprite = new Sprite(material);
      const center = plane.center;
      sprite.position.set(center.x, center.y + (label.includes('floor') ? 0.12 : 0), center.z);
      sprite.scale.set(0.48, 0.12, 1);
      sprite.renderOrder = 996;
      this.scanOverlay.add(sprite);
    }
  }

  private clearScanOverlay(hide: boolean) {
    for (const child of [...this.scanOverlay.children]) {
      this.scanOverlay.remove(child);
      if (child instanceof Mesh || child instanceof LineLoop) child.geometry.dispose();
      if ((child as any).material) {
        const list = Array.isArray((child as any).material) ? (child as any).material : [(child as any).material];
        list.forEach((material: any) => material.dispose?.());
      }
    }
    if (hide) this.scanOverlay.visible = false;
  }

  beginRoomScan() {
    if (this.ready || this.building || this.scanning) return;
    this.scanning = true;
    this.scanStartedAt = 0;
    this.lastScanAt = 0;
    this.scanCandidate = null;
    this.candidateAt = -Infinity;
    this.trackedScanFrame = false;
    this.scanErrorLogged = false;
    this.scanOverlay.visible = true;
    emit('status', 'SCANNING ROOM... move around lightly so Quest can detect the floor and table');
    this.stopScan = this.world.onXRFrame(frame => this.scanFrame(frame));
  }

  async requestRoomCapture() {
    const capture = (this.world.session as any)?.initiateRoomCapture;
    if (typeof capture !== 'function') {
      emit('status', 'Room capture is unavailable in this session');
      return false;
    }
    try {
      emit('status', 'Opening Space Setup…');
      await capture.call(this.world.session);
      emit('status', 'Space Setup finished. Looking for the room…');
      this.beginRoomScan();
      return true;
    } catch (error) {
      emit('status', `Room capture failed: ${String(error)}`);
      return false;
    }
  }

  startFromManualRoom(manual: RoomModel) {
    // A fresh touch calibration already contains the user's table height; do not
    // overwrite it with a height stored from a previous session.
    this.buildRoom(manual, 'MANUAL', null, false);
  }

  useLiveScan(withTable: boolean) {
    const candidate = this.scanCandidate;
    if (!this.scanning || !candidate || performance.now() - this.candidateAt > 1000 || (withTable && !candidate.room.table)) return false;
    this.stopScanning();
    const room = withTable ? candidate.room : { ...candidate.room, table: null };
    this.buildRoom(room, 'SCAN', withTable ? candidate.info : { ...candidate.info, tableTopY: null, tableCenter: null });
    return true;
  }

  startDemoRoom() {
    this.buildRoom(makeDemoRoom(), 'DEMO', null);
  }

  private scanFrame(frame: XRFrame) {
    if (!this.scanning || this.ready || this.building) return;
    const now = performance.now();
    if (!this.scanStartedAt) {
      this.scanStartedAt = now;
      this.scanTimeout = window.setTimeout(() => this.scanFallback(), 10000);
    }
    if (now - this.lastScanAt < 200) return;
    this.lastScanAt = now;
    const referenceSpace = this.world.renderer.xr.getReferenceSpace();
    if (!referenceSpace) return;
    let scan: ReturnType<typeof readRoomFromFrame>;
    try {
      const viewer = frame.getViewerPose(referenceSpace);
      if (!viewer || viewer.emulatedPosition) {
        this.trackedScanFrame = false;
        this.scanCandidate = null;
        this.candidateAt = -Infinity;
        this.clearScanOverlay(false);
        if (now - this.scanStartedAt >= 2500) emit('room-tracking-pending');
        return;
      }
      this.trackedScanFrame = true;
      const snapshots = readPlaneSnapshots(frame, referenceSpace);
      scan = readRoomFromFrame(frame, referenceSpace, snapshots, isProductEntry, this.scanCandidate?.info.tableCenter ?? undefined);
      this.updateScanOverlay(snapshots, scan?.info.tableCenter ?? null);
    } catch (error) {
      if (!this.scanErrorLogged) {
        this.scanErrorLogged = true;
        console.warn('[garage-build] plane conversion failed', error);
        emit('status', `Room scan read failed: ${String(error)}`);
      }
      return;
    }
    if (!scan) {
      if (now - this.scanStartedAt > 10000) this.scanFallback();
      return;
    }
    this.scanCandidate = scan;
    this.candidateAt = now;
    this.scanInfo = scan.info;
    const width = scan.info.floorSize[0].toFixed(1), depth = scan.info.floorSize[1].toFixed(1);
    const table = scan.room.table ? `table ${(scan.room.table.topY - scan.room.floor.y).toFixed(2)} m` : 'table not detected';
    emit('status', `ROOM SCAN: floor ${width} x ${depth} m | ${table} | ${scan.info.planeCount} planes`);
    const hasFloor = scan.info.planeCount > 0;
    const hasWalls = scan.room.walls.length >= 2 && scan.info.planeCount >= 3;
    const hasTable = !!scan.room.table;
    const progress = (hasFloor ? 1 : 0) + (hasWalls ? 1 : 0) + (hasTable ? 1 : 0);
    const elapsed = now - this.scanStartedAt;
    const needsChoice = isProductEntry && elapsed >= 2500 && (scan.info.tableCount !== 1 || !hasTable);
    emit('scan-progress', { info: scan.info, hasFloor, hasWalls, hasTable, progress, needsChoice });
    if (elapsed < 2500 || needsChoice || (elapsed < 8000 && !scan.info.tableCount)) return;
    this.useLiveScan(hasTable);
  }

  private scanFallback() {
    if (!this.scanning || this.ready || this.building) return;
    if (isProductEntry && !this.trackedScanFrame) {
      emit('room-tracking-pending');
      return;
    }
    if (isProductEntry && this.scanCandidate && performance.now() - this.candidateAt < 1000) return;
    this.stopScanning();
    this.clearScanOverlay(true);
    if (isProductEntry) {
      emit('room-scan-missing');
      emit('status', 'No room scan found. Run Space Setup or mark the room by touching.');
      return;
    }
    emit('status', 'Room scan unavailable; using demo room');
    this.buildRoom(makeDemoRoom(), 'DEMO', null);
  }

  private stopScanning() {
    this.scanning = false;
    this.stopScan?.();
    this.stopScan = undefined;
    if (this.scanTimeout != null) window.clearTimeout(this.scanTimeout);
    this.scanTimeout = undefined;
    this.scanCandidate = null;
  }

  private buildRoom(room: RoomModel, sourceLabel: string, scanInfo: ScanInfo | null, applySavedTable = true) {
    if (this.ready || this.building) return;
    this.building = true;
    this.scanning = false;
    this.clearScanOverlay(true);
    if (applySavedTable && room.source !== 'webxr' && garageState.preferences.tableConfirmed && garageState.preferences.tableHeight != null && room.table) {
      room = { ...room, table: { ...room.table, topY: room.floor.y + garageState.preferences.tableHeight } };
    }
    this.room = room;
    this.sourceLabel = sourceLabel;
    this.scanInfo = scanInfo;
    this.tableMode = 'SCAN';
    const generation = ++this.buildGeneration;
    void this.build(generation).then(() => {
      if (generation === this.buildGeneration) this.building = false;
    }).catch(error => {
      if (generation !== this.buildGeneration) return;
      this.building = false;
      emit('status', `Garage build failed: ${String(error)}`);
      console.error('[garage-build]', error);
    });
  }

  roomDiagonal() {
    const box = outlineBounds(this.room.floor.polygon);
    return Math.hypot(box.width, box.depth);
  }

  private exitPoint(): Vec2 | null {
    const doorWalls = this.room.openings
      .filter(opening => opening.type === 'door')
      .map(opening => this.room.walls.find(wall => wall.id === opening.wallId))
      .filter((wall): wall is NonNullable<typeof wall> => !!wall);
    const walls = doorWalls.length ? doorWalls : this.room.walls;
    if (!walls.length) return null;
    return walls.reduce((nearest, wall) => {
      const mid = { x: (wall.p0.x + wall.p1.x) / 2, z: (wall.p0.z + wall.p1.z) / 2 };
      const distance = Math.hypot(mid.x - this.room.seat.x, mid.z - this.room.seat.z);
      const nearestDistance = nearest ? Math.hypot(nearest.x - this.room.seat.x, nearest.z - this.room.seat.z) : Infinity;
      return distance < nearestDistance ? mid : nearest;
    }, null as Vec2 | null);
  }

  private footprintInside(center: Vec2, width: number, depth: number, yaw: number, clearance = 0) {
    const halfW = width / 2 + clearance, halfD = depth / 2 + clearance;
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    const corners = [[-halfW, -halfD], [halfW, -halfD], [halfW, halfD], [-halfW, halfD]];
    return corners.every(([lx, lz]) => pointInPolygon({
      x: center.x + cos * lx + sin * lz,
      z: center.z - sin * lx + cos * lz,
    }, this.room.floor.polygon));
  }

  private anchorFree(center: Vec2, width: number, depth: number, yaw: number, height: number, gap = 0.08) {
    const body: Obstacle = {
      center: { x: center.x, y: this.room.floor.y + height / 2, z: center.z },
      size: { x: width, y: height, z: depth },
      yaw,
    };
    if (this.room.furniture.some(item => overlapsBox(body, item, gap))) return false;
    if (this.deviceObstacles.some(item => overlapsBox(body, item, gap))) return false;
    if (this.room.table) {
      const tableBounds = bounds(this.room.table.polygon);
      const tableBody: Obstacle = {
        center: {
          x: (tableBounds.minX + tableBounds.maxX) / 2,
          y: this.room.floor.y + (this.room.table.topY - this.room.floor.y) / 2,
          z: (tableBounds.minZ + tableBounds.maxZ) / 2,
        },
        size: {
          x: tableBounds.maxX - tableBounds.minX,
          y: this.room.table.topY - this.room.floor.y,
          z: tableBounds.maxZ - tableBounds.minZ,
        },
        yaw: 0,
      };
      if (overlapsBox(body, tableBody, gap)) return false;
    }
    const exit = this.exitPoint();
    if (exit && pointSegmentDistance(center, this.room.seat, exit) < 0.3 + Math.min(width, depth) / 2 + 0.04) return false;
    return true;
  }

  /** The storage shelf belongs against the wall behind the seat, tucked into a corner. */
  private backCornerShelf(rule: SlotRule): SlotPlacement | null {
    const seat = this.room.seat;
    const forward = this.room.forward;
    const walls = this.room.walls.map(wall => {
      const dx = wall.p1.x - wall.p0.x, dz = wall.p1.z - wall.p0.z;
      const length = Math.hypot(dx, dz) || 1;
      const mid = { x: (wall.p0.x + wall.p1.x) / 2, z: (wall.p0.z + wall.p1.z) / 2 };
      const toSeat = { x: seat.x - mid.x, z: seat.z - mid.z };
      const toSeatLength = Math.hypot(toSeat.x, toSeat.z) || 1;
      const facing = (wall.normal.x * toSeat.x + wall.normal.z * toSeat.z) / toSeatLength;
      const behind = -(((mid.x - seat.x) * forward.x + (mid.z - seat.z) * forward.z) / toSeatLength);
      return { wall, length, facing, behind };
    }).filter(item => item.length >= rule.footprint.width + 0.2 && item.facing > 0.15)
      .sort((a, b) => (b.behind * 2 + b.facing) - (a.behind * 2 + a.facing));

    for (const item of walls) {
      const wall = item.wall;
      const normalLength = Math.hypot(wall.normal.x, wall.normal.z) || 1;
      const nx = wall.normal.x / normalLength, nz = wall.normal.z / normalLength;
      const dx = wall.p1.x - wall.p0.x, dz = wall.p1.z - wall.p0.z;
      const length = Math.hypot(dx, dz) || 1;
      const wallDir = { x: dx / length, z: dz / length };
      const yaw = Math.atan2(nx, nz);
      for (const [endpoint, direction] of [
        [wall.p0, 1],
        [wall.p1, -1],
      ] as const) {
        const center = {
          x: endpoint.x + wallDir.x * direction * (rule.footprint.width / 2 + 0.08) + nx * (rule.footprint.depth / 2 + 0.08),
          z: endpoint.z + wallDir.z * direction * (rule.footprint.width / 2 + 0.08) + nz * (rule.footprint.depth / 2 + 0.08),
        };
        if (!this.footprintInside(center, rule.footprint.width, rule.footprint.depth, yaw, 0)) continue;
        const along = (center.x - wall.p0.x) * wallDir.x + (center.z - wall.p0.z) * wallDir.z;
        const start = along - rule.footprint.width / 2, end = along + rule.footprint.width / 2;
        const blocked = this.room.openings.filter(opening => opening.wallId === wall.id).some(opening => {
          if (opening.center == null || opening.width == null) return false;
          const openStart = opening.center - opening.width / 2, openEnd = opening.center + opening.width / 2;
          const yOverlap = this.room.floor.y < opening.topY && this.room.floor.y + rule.height > opening.sillY;
          return yOverlap && end > openStart - 0.08 && start < openEnd + 0.08;
        });
        if (blocked) continue;
        if (!this.anchorFree(center, rule.footprint.width, rule.footprint.depth, yaw, rule.height, 0.1)) continue;
        return {
          slotId: 'shelf', type: 'floor',
          position: { x: center.x, y: this.room.floor.y, z: center.z },
          yaw, scale: 1, footprint: rule.footprint, wallId: wall.id,
          score: 1, breakdown: { anchored: 1 }, reason: 'anchored back corner', locked: true, gapScale: 1,
        };
      }
    }
    return null;
  }

  /** Keep the trash beside the seat, on the dominant-hand side when space allows. */
  private seatSideTrash(rule: SlotRule): SlotPlacement | null {
    const seat = this.room.seat;
    const forward = this.room.forward;
    const right = { x: -forward.z, z: forward.x };
    const preferred = garageState.preferences.dominantHand === 'left' ? -1 : 1;
    for (const side of [preferred, -preferred]) {
      for (const distanceFromSeat of [0.6, 0.74, 0.88]) {
        for (const ahead of [0.05, -0.25, 0.3, -0.5, -0.7]) {
          const center = {
            x: seat.x + right.x * distanceFromSeat * side + forward.x * ahead,
            z: seat.z + right.z * distanceFromSeat * side + forward.z * ahead,
          };
          const yaw = Math.atan2(seat.x - center.x, seat.z - center.z);
          if (!this.footprintInside(center, rule.footprint.width, rule.footprint.depth, yaw, 0.1)) continue;
          if (!this.anchorFree(center, rule.footprint.width, rule.footprint.depth, yaw, rule.height, 0.08)) continue;
          return {
            slotId: 'trash', type: 'floor',
            position: { x: center.x, y: this.room.floor.y, z: center.z },
            yaw, scale: 1, footprint: rule.footprint,
            score: 1, breakdown: { anchored: 1 }, reason: 'anchored beside the seat', locked: true, gapScale: 1,
          };
        }
      }
    }
    return null;
  }

  private anchoredPlacements(): SlotPlacement[] {
    const anchored: SlotPlacement[] = [];
    const shelfRule = this.rules.find(rule => rule.id === 'shelf');
    const trashRule = this.rules.find(rule => rule.id === 'trash');
    if (shelfRule) {
      const shelf = this.backCornerShelf(shelfRule);
      if (shelf) anchored.push(shelf);
    }
    if (trashRule) {
      const trash = this.seatSideTrash(trashRule);
      if (trash) anchored.push(trash);
    }
    return anchored;
  }

  private async build(generation: number) {
    let config: Record<string, Slot> = {};
    try { config = await (await fetch('/assets/assets.config.json')).json(); } catch { /* placeholders use rule sizes */ }
    if (generation !== this.buildGeneration) return;
    this.rules = slotRules.map(rule => {
      const target = config[assetForSlot[rule.id]]?.targetSize;
      if (!target?.every(dimension => Number.isFinite(dimension) && dimension > 0)) return rule;
      const [width, height, depth] = target;
      return { ...rule, height, footprint: { width, depth } };
    });
    const anchored = this.anchoredPlacements();
    const { placements, report } = solve(this.room, this.rules, this.deviceObstacles, anchored, {}, 413);
    const door = placements.find(placement => placement.slotId === 'door');
    const floorGroup = new Group(); floorGroup.name = 'Garage floor';
    const wallGroup = new Group(); wallGroup.name = 'Garage walls';
    const ceilingGroup = new Group(); ceilingGroup.name = 'Garage ceiling';
    const tableGroup = new Group(); tableGroup.name = 'Workbench';
    const propGroup = new Group(); propGroup.name = 'Garage props';
    const stickerGroup = new Group(); stickerGroup.name = 'Wall stickers';
    const skyGroup = new Group(); skyGroup.name = 'Golden hour backdrop';
    [floorGroup, wallGroup, ceilingGroup, tableGroup, propGroup, stickerGroup, skyGroup].forEach(group => this.root.add(group));
    this.slotConfig = config;
    this.placements = placements;
    this.tableGroup = tableGroup;
    this.propGroup = propGroup;

    this.surfaces = [];
    this.revealProps = [];
    this.blueprint = null;
    this.doorRuntime = null;
    this.modelLoads = [];
    const floorMaterial = comicMaterial(0x34383f);
    const wallMaterial = comicMaterial(0x464b54);
    const ceilingMaterial = comicMaterial(0x30343c);
    const tableMaterial = comicMaterial(0x7a573b);
    this.tableMaterial = tableMaterial;
    const trimMaterial = comicMaterial(0x101318);
    (floorMaterial as any).side = DoubleSide;
    (ceilingMaterial as any).side = DoubleSide;
    (tableMaterial as any).side = DoubleSide;
    const seat = new Vector3(this.room.seat.x, this.room.floor.y, this.room.seat.z);
    const radius = Math.max(...this.room.floor.polygon.map(point => Math.hypot(point.x - this.room.seat.x, point.z - this.room.seat.z))) + 0.7;

    const floorSurface = createRevealSurface('floor', 'floor', 'radial', 0);
    floorSurface.uniforms.uRevealOrigin.value.copy(seat);
    floorSurface.uniforms.uRevealRange.value.set(0, radius);
    applyRevealMaterial(floorMaterial, floorSurface);
    this.surfaces.push(floorSurface);

    const ceilingRange = projectionRange(this.room.floor.polygon, this.room.forward);
    const ceilingSurface = createRevealSurface('ceiling', 'ceiling', 'directional', 0);
    ceilingSurface.uniforms.uRevealOrigin.value.copy(seat);
    ceilingSurface.uniforms.uRevealDir.value.copy(ceilingRange.dir);
    ceilingSurface.uniforms.uRevealRange.value.set(ceilingRange.min, ceilingRange.max);
    applyRevealMaterial(ceilingMaterial, ceilingSurface);
    this.surfaces.push(ceilingSurface);

    if (this.room.table) {
      const frame = tableFrame(this.room.table.polygon);
      const tableRange = projectionRange(this.room.table.polygon, { x: Math.cos(frame.yaw), z: -Math.sin(frame.yaw) });
      const tableSurface = createRevealSurface('table', 'table', 'directional', 0);
      tableSurface.uniforms.uRevealOrigin.value.copy(seat);
      tableSurface.uniforms.uRevealDir.value.copy(tableRange.dir);
      tableSurface.uniforms.uRevealRange.value.set(tableRange.min, tableRange.max);
      applyRevealMaterial(tableMaterial, tableSurface);
      this.surfaces.push(tableSurface);
      this.tableSurface = tableSurface;
    } else {
      this.tableSurface = undefined;
    }

    const trimSurface = createRevealSurface('trim', 'walls', 'vertical', 0);
    trimSurface.uniforms.uRevealRange.value.set(this.room.floor.y, this.room.ceilingY);
    applyRevealMaterial(trimMaterial, trimSurface);
    this.surfaces.push(trimSurface);

    this.doorFrameMaterial = new MeshBasicMaterial({ color: 0x0d0d10, transparent: true, opacity: 0, depthWrite: false });

    const floor = new Mesh(polygonShape(this.room.floor.polygon), floorMaterial);
    floor.name = 'Room floor skin'; floor.position.y = this.room.floor.y + 0.002;
    floorGroup.add(floor);
    const ceiling = new Mesh(polygonShape(this.room.floor.polygon), ceilingMaterial);
    ceiling.name = 'Room ceiling skin'; ceiling.position.y = this.room.ceilingY;
    ceilingGroup.add(ceiling);

    this.buildWalls(wallGroup, wallMaterial, door);
    this.buildTrim(wallGroup, trimMaterial);
    this.buildTable(tableGroup, tableMaterial, placements, config);
    await this.buildProps(propGroup, placements, config);
    await this.buildStickers(stickerGroup, placements);
    if (generation !== this.buildGeneration) return;
    if (door) this.buildSky(skyGroup, door);
    else this.buildSky(skyGroup, null);
    await this.waitForModels();
    if (generation !== this.buildGeneration) return;
    this.buildTableCollider();
    this.buildTableOccluder();
    this.applyTableVisibility();
    this.blueprint = this.buildBlueprint(seat);
    this.root.add(this.blueprint.group);
    garageState.room = this.room;
    garageState.placements = placements;
    try {
      const renderer = this.world.renderer as any;
      if (renderer.compileAsync) await renderer.compileAsync(this.root, this.world.camera);
      else renderer.compile(this.root, this.world.camera);
    } catch { /* compile is best effort */ }
    if (generation !== this.buildGeneration) return;

    this.prepareRevealRuntime(seat, radius);
    this.setOutlines(garageState.preferences.outlines);
    const size = outlineBounds(this.room.floor.polygon);
    const width = size.width.toFixed(1), depth = size.depth.toFixed(1);
    const unplaced = report.unplaced.map(item => item.slotId).join(', ') || 'none';
    const table = this.room.table ? ` | table ${(this.room.table.topY - this.room.floor.y).toFixed(2)} m @${this.tableMode.toLowerCase()}` : ' | no table';
    const triangles = Math.round(countTriangles(this.root));
    emit('slots', { records: placements.map(placement => ({ slot: placement.slotId, status: 'placed', triangles: 0, outline: 0 })), totalTriangles: triangles, outlineTriangles: 0, solverMs: report.durationMs });
    emit('status', `ROOM BUILT [${this.sourceLabel}] ${width} x ${depth} m${table} | ${placements.length} props | solver ${report.durationMs.toFixed(1)} ms | unplaced: ${unplaced}`);
    this.ready = true;
    saveLastRoom(this.room);
    emit('garage-built', { room: this.room, placements });
    if (location.hostname === 'localhost') {
      (window as any).garageBuildDebug = {
        room: this.room, placements, report, ready: true, root: this.root,
        source: this.sourceLabel, tableMode: this.tableMode, scan: this.scanInfo,
        getTableInfo: () => this.getTableInfo(),
        tableFrame: () => this.room.table ? tableFrame(this.room.table.polygon) : null,
        setTableHeight: (height: number) => this.setTableHeight(this.room.floor.y + height),
        setTableTopY: (topY: number) => this.setTableHeight(topY),
        confirmTable: () => this.confirmTable(),
        setTableView: (view: TableView) => this.setTableView(view),
        getRevealRuntime: () => this.revealRuntime,
        stickers: this.revealStickers,
        stickerCount: this.revealStickers.length,
        rearrange: () => this.rearrangeProps(),
      };
      (window as any).garageRevealShaders = this.surfaces.map(surface => () => ({
        surface: surface.id,
        materials: surface.materials.length,
        vertex: surface.materials.every((material: any) => material.userData.__gjRevealInjected !== false),
        fragment: surface.materials.every((material: any) => material.userData.__gjRevealInjected !== false),
      }));
    }
  }

  getRevealRuntime() {
    return this.revealRuntime;
  }

  private async buildStickers(group: Group, placements: SlotPlacement[]) {
    this.revealStickers = [];
    this.stickerTextures = [];
    const scene = await new Promise<Group | null>(resolve => {
      this.loader.load('/assets/models/optimized/stickers.glb', gltf => resolve(gltf.scene), undefined, error => {
        console.warn('Wall sticker pack failed', error);
        resolve(null);
      });
    });
    if (!scene) return;
    scene.updateMatrixWorld(true);
    const sources: Mesh[] = [];
    scene.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const material = Array.isArray(object.material) ? object.material[0] : object.material;
      if (!(material as any)?.map) return;
      if (/^(Cylinder|Plane)/.test(object.name)) return;
      sources.push(object);
    });
    if (!sources.length) return;
    sources.sort((a, b) => {
      const aBox = new Box3().setFromObject(a, true);
      const bBox = new Box3().setFromObject(b, true);
      const aSize = aBox.getSize(new Vector3()), bSize = bBox.getSize(new Vector3());
      return bSize.x * bSize.z - aSize.x * aSize.z;
    });
    const rand = this.stickerRandom();
    const targetCount = 42;
    const candidates = this.stickerCandidates(placements, rand, targetCount);
    const count = Math.min(candidates.length, targetCount);
    if (!count) return;
    const sourceOrder: Mesh[] = [];
    while (sourceOrder.length < count) {
      const cycle = sources.slice();
      this.shuffleStickers(cycle, rand);
      sourceOrder.push(...cycle);
    }
    const materialCache = new Map<any, MeshBasicMaterial>();
    for (let index = 0; index < count; index++) {
      const source = sourceOrder[index];
      const sourceMaterial = Array.isArray(source.material) ? source.material[0] : source.material;
      const map = (sourceMaterial as any)?.map;
      if (!map) continue;
      const geometry = source.geometry.clone();
      geometry.applyMatrix4(source.matrixWorld);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      if (!box) continue;
      const size = box.getSize(new Vector3());
      const center = box.getCenter(new Vector3());
      geometry.translate(-center.x, -center.y, -center.z);
      const flat = size.y <= Math.min(size.x, size.z) * 0.35;
      const vertical = size.z <= Math.min(size.x, size.y) * 0.35;
      const long = flat ? Math.max(size.x, size.z) : vertical ? Math.max(size.x, size.y) : Math.max(size.x, size.z);
      const targetLong = 0.12 + Math.pow(rand(), 1.35) * 0.24 + (rand() < 0.07 ? 0.05 : 0);
      const scale = Math.max(0.08, Math.min(1.8, Math.min(0.38, targetLong) / Math.max(long, 0.001)));
      let material = materialCache.get(map);
      if (!material) {
        material = new MeshBasicMaterial({
          map,
          side: DoubleSide,
          depthWrite: true,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        });
        (map as any).anisotropy = Math.max((map as any).anisotropy ?? 1, 8);
        materialCache.set(map, material);
        this.stickerTextures.push(map);
      }
      const patch = new Mesh(geometry, material);
      patch.name = `Sticker patch ${index + 1}`;
      if (flat) patch.rotation.x = Math.PI / 2;
      else if (!vertical) patch.rotation.y = Math.PI / 2;
      patch.updateMatrixWorld(true);
      const candidate = candidates[index];
      const rollPick = rand();
      const baseRoll = rollPick < 0.06
        ? Math.PI + (rand() - 0.5) * 0.3
        : rollPick < 0.16
          ? (rand() < 0.5 ? -1 : 1) * (0.8 + rand() * 0.35)
          : (rand() - 0.5) * 0.8;
      const peel = rand() < 0.13 ? (rand() < 0.5 ? -1 : 1) * (0.04 + rand() * 0.05) : 0;
      const lift = 0.006 + (candidate.depth ?? 0) + Math.abs(peel) * 0.12;
      const sticker = new Group();
      sticker.name = `Sticker ${index + 1}`;
      sticker.position.set(
        candidate.point.x + candidate.normal.x * lift,
        candidate.point.y,
        candidate.point.z + candidate.normal.z * lift,
      );
      sticker.lookAt(
        candidate.point.x + candidate.normal.x,
        candidate.point.y,
        candidate.point.z + candidate.normal.z,
      );
      sticker.rotateZ(baseRoll);
      if (peel) sticker.rotateX(peel);
      sticker.scale.setScalar(scale);
      sticker.add(patch);
      sticker.visible = false;
      group.add(sticker);
      this.revealStickers.push({
        id: `sticker-${index + 1}`,
        object: sticker,
        basePosition: sticker.position.clone(),
        baseQuaternion: sticker.quaternion.clone(),
        baseScale: sticker.scale.clone(),
        normal: new Vector3(candidate.normal.x, 0, candidate.normal.z),
        roll: (rand() - 0.5) * 0.18,
        start: 0,
        duration: 0.22,
        landed: false,
      });
    }
  }

  private stickerRandom() {
    let state = 2166136261;
    for (const char of roomFingerprint(this.room)) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
    return () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  private shuffleStickers<T>(list: T[], rand: () => number) {
    for (let index = list.length - 1; index > 0; index--) {
      const swap = Math.floor(rand() * (index + 1));
      [list[index], list[swap]] = [list[swap], list[index]];
    }
  }

  private stickerCandidates(placements: SlotPlacement[], rand: () => number, targetCount: number) {
    const floorY = this.room.floor.y;
    const wallInfos = this.room.walls.map(wall => {
      const dx = wall.p1.x - wall.p0.x, dz = wall.p1.z - wall.p0.z;
      const length = Math.hypot(dx, dz) || 1;
      if (length < 0.8) return null;
      const dir = { x: dx / length, z: dz / length };
      const normalLength = Math.hypot(wall.normal.x, wall.normal.z) || 1;
      const normal = { x: wall.normal.x / normalLength, z: wall.normal.z / normalLength };
      const openings = this.room.openings
        .filter(opening => opening.wallId === wall.id)
        .map(opening => ({ center: opening.center, width: opening.width, sillY: opening.sillY, topY: opening.topY }))
        .filter((opening): opening is { center: number; width: number; sillY: number; topY: number } =>
          typeof opening.center === 'number' && typeof opening.width === 'number');
      const reserved = placements
        .filter(placement => (placement.type === 'wall' || placement.slotId === 'shelf') && placement.wallId === wall.id)
        .map(placement => {
          const rule = this.rules.find(item => item.id === placement.slotId);
          const along = (placement.position.x - wall.p0.x) * dir.x + (placement.position.z - wall.p0.z) * dir.z;
          return {
            along,
            width: placement.footprint.width * placement.scale,
            y: placement.position.y,
            height: (rule?.height ?? 0.6) * placement.scale,
          };
        });
      return { wall, length, dir, normal, openings, reserved } as StickerWallInfo;
    }).filter((info): info is StickerWallInfo => info !== null);
    if (!wallInfos.length) return [];

    const minHeight = floorY + 0.85;
    const maxHeight = Math.min(1.9, this.room.ceilingY - 0.32);
    const totalLength = wallInfos.reduce((sum, info) => sum + info.length, 0);
    const pickWall = (): StickerWallInfo => {
      let pick = rand() * totalLength;
      for (const info of wallInfos) {
        pick -= info.length;
        if (pick <= 0) return info;
      }
      return wallInfos[wallInfos.length - 1];
    };
    const valid = (info: StickerWallInfo, along: number, height: number) => {
      if (along < 0.25 || along > info.length - 0.25) return false;
      if (height < minHeight || height > maxHeight) return false;
      if (info.openings.some(opening => Math.abs(along - opening.center) < opening.width / 2 + 0.22
        && height > opening.sillY - 0.2 && height < opening.topY + 0.2)) return false;
      if (info.reserved.some(item => Math.abs(along - item.along) < item.width / 2 + 0.22
        && height > item.y - 0.2 && height < item.y + item.height + 0.2)) return false;
      return true;
    };

    type Placement = { point: Vector3; normal: Vector3; wallId: string; along: number; height: number; depth: number };
    const result: Placement[] = [];
    const add = (info: StickerWallInfo, along: number, height: number) => {
      if (result.length >= targetCount || !valid(info, along, height)) return;
      if (result.some(item => item.wallId === info.wall.id && Math.hypot(item.along - along, item.height - height) < 0.23)) return;
      const depth = 0.0008 + (result.length % 9) * 0.0007 + rand() * 0.0003;
      result.push({
        point: new Vector3(info.wall.p0.x + info.dir.x * along, height, info.wall.p0.z + info.dir.z * along),
        normal: new Vector3(info.normal.x, 0, info.normal.z),
        wallId: info.wall.id,
        along,
        height,
        depth,
      });
    };

    const quotas = wallInfos.map(info => Math.floor(targetCount * info.length / totalLength));
    let remaining = targetCount - quotas.reduce((sum, value) => sum + value, 0);
    for (let index = 0; remaining > 0; index = (index + 1) % quotas.length, remaining--) quotas[index]++;
    for (let wallIndex = 0; wallIndex < wallInfos.length; wallIndex++) {
      const info = wallInfos[wallIndex];
      for (let count = 0; count < quotas[wallIndex] && result.length < targetCount; count++) {
        for (let attempt = 0; attempt < 60; attempt++) {
          const along = 0.25 + rand() * Math.max(0.01, info.length - 0.5);
          const height = minHeight + rand() * Math.max(0.01, maxHeight - minHeight);
          const before = result.length;
          add(info, along, height);
          if (result.length > before) break;
        }
      }
    }
    let guard = 0;
    while (result.length < targetCount && guard++ < 600) {
      const info = pickWall();
      add(info, 0.25 + rand() * Math.max(0.01, info.length - 0.5), minHeight + rand() * Math.max(0.01, maxHeight - minHeight));
    }
    return result;
  }

  private async waitForModels() {
    if (!this.modelLoads.length) return;
    const loads = [...this.modelLoads];
    this.modelLoads = [];
    await Promise.race([
      Promise.allSettled(loads),
      new Promise(resolve => window.setTimeout(resolve, 12000)),
    ]);
  }

  private prepareRevealRuntime(seat: Vector3, radius: number) {
    const propGroup = this.propGroup;
    this.revealProps = [];
    if (propGroup) {
      for (const child of propGroup.children) {
        if (!(child instanceof Group)) continue;
        const id = child.name.replace(/^PLACED_/, '');
        const placement = this.placements.find(item => item.slotId === id);
        const tableProp = placement?.type === 'table';
        const finalVisible = !(tableProp && garageState.preferences.tableView === 'real');
        this.revealProps.push({
          id,
          object: child,
          basePosition: child.position.clone(),
          baseScale: child.scale.clone(),
          finalVisible,
          start: 0,
          dropDuration: 0.42,
          landed: false,
          priority: placement?.type === 'floor' ? 0 : 1,
        });
        child.visible = false;
      }
    }
    if (this.doorRuntime) this.doorRuntime.group.visible = false;
    if (this.blueprint) {
      this.blueprint.group.visible = true;
      (this.blueprint.lineMaterial as any).opacity = 0;
      (this.blueprint.ringMaterial as any).opacity = 0;
    }
    this.revealRuntime = {
      seat: seat.clone(),
      floorY: this.room.floor.y,
      ceilingY: this.room.ceilingY,
      radius,
      surfaces: this.surfaces,
      props: this.revealProps,
      stickers: this.revealStickers,
      blueprint: this.blueprint,
      door: this.doorRuntime,
      hiddenAtBuild: true,
    };
  }

  completeReveal() {
    if (this.revealed) return;
    this.revealed = true;
    if (this.revealRuntime) this.revealRuntime.hiddenAtBuild = false;
    if (this.blueprint) this.blueprint.group.visible = false;
    this.applyTableVisibility();
    const size = outlineBounds(this.room.floor.polygon);
    const width = size.width.toFixed(1), depth = size.depth.toFixed(1);
    const table = this.room.table ? ` | table ${(this.room.table.topY - this.room.floor.y).toFixed(2)} m @${this.tableMode.toLowerCase()}` : '';
    emit('status', `GARAGE LOCKED [${this.sourceLabel}] ${width} x ${depth} m${table} | ${(this.room.ceilingY - this.room.floor.y).toFixed(1)} m ceiling`);
    emit('garage-revealed', { room: this.room, placements: this.placements });
  }

  private buildTrim(group: Group, material: any) {
    const floorY = this.room.floor.y, ceilingY = this.room.ceilingY;
    for (const wall of this.room.walls) {
      const dx = wall.p1.x - wall.p0.x, dz = wall.p1.z - wall.p0.z;
      const length = Math.hypot(dx, dz);
      if (length < 0.05) continue;
      const yaw = Math.atan2(-dz, dx);
      for (const [y, height, depth] of [[floorY + 0.045, 0.09, 0.16], [ceilingY - 0.04, 0.07, 0.14]]) {
        const trim = new Mesh(new BoxGeometry(length, height, depth), material);
        trim.name = 'Ink wall trim';
        const offset = -depth / 2 + 0.003;
        trim.position.set((wall.p0.x + wall.p1.x) / 2 + wall.normal.x * offset, y, (wall.p0.z + wall.p1.z) / 2 + wall.normal.z * offset);
        trim.rotation.y = yaw;
        group.add(trim);
      }
    }
  }

  private buildWalls(group: Group, baseMaterial: any, door?: SlotPlacement) {
    const floorY = this.room.floor.y, ceilingY = this.room.ceilingY;
    const doorRule = slotRules.find(rule => rule.id === 'door');
    const ordered = this.room.walls
      .map((wall, index) => ({ wall, index, distance: Math.hypot((wall.p0.x + wall.p1.x) / 2 - this.room.seat.x, (wall.p0.z + wall.p1.z) / 2 - this.room.seat.z) }))
      .sort((a, b) => a.distance - b.distance);
    for (let order = 0; order < ordered.length; order++) {
      const { wall } = ordered[order];
      const dx = wall.p1.x - wall.p0.x, dz = wall.p1.z - wall.p0.z;
      const length = Math.hypot(dx, dz);
      if (length < 0.05) continue;
      const yaw = Math.atan2(-dz, dx);
      const material = baseMaterial.clone ? baseMaterial.clone() : baseMaterial;
      const surface = createRevealSurface(`wall-${wall.id}`, 'walls', 'vertical', order);
      surface.uniforms.uRevealRange.value.set(floorY, ceilingY);
      applyRevealMaterial(material, surface);
      this.surfaces.push(surface);
      const addSegment = (start: number, end: number, y0: number, y1: number) => {
        const segment = end - start;
        if (segment <= 0.02 || y1 - y0 <= 0.02) return;
        const centre = (start + end) / 2;
        const mesh = new Mesh(new BoxGeometry(segment, y1 - y0, wallThickness), material);
        mesh.name = `Wall ${wall.id} ${start.toFixed(2)}-${end.toFixed(2)}`;
        const point = wallPoint(wall, centre);
        // Place the inside face on the scanned wall plane.
        mesh.position.set(point.x - wall.normal.x * wallThickness / 2, (y0 + y1) / 2, point.z - wall.normal.z * wallThickness / 2);
        mesh.rotation.y = yaw;
        group.add(mesh);
      };
      const opening = door && door.wallId === wall.id ? door : null;
      if (!opening) {
        addSegment(0, length, floorY, ceilingY);
        continue;
      }
      const t = ((opening.position.x - wall.p0.x) * dx + (opening.position.z - wall.p0.z) * dz) / (length * length) * length;
      const half = opening.footprint.width * opening.scale / 2 + 0.08;
      const start = Math.max(0, t - half), end = Math.min(length, t + half);
      const doorTop = Math.min(ceilingY, floorY + (doorRule?.height ?? 2.2) * opening.scale);
      addSegment(0, start, floorY, ceilingY);
      addSegment(end, length, floorY, ceilingY);
      addSegment(start, end, doorTop, ceilingY);

      const frameMaterial = this.doorFrameMaterial ?? new MeshBasicMaterial({ color: 0x0d0d10 });
      const frameDepth = 0.18, frameWidth = 0.08, inset = -frameDepth / 2 + 0.003;
      const addFrame = (width: number, height: number, t: number, y: number) => {
        const point = wallPoint(wall, t);
        const mesh = new Mesh(new BoxGeometry(width, height, frameDepth), frameMaterial);
        mesh.name = 'Garage door frame';
        mesh.position.set(point.x + wall.normal.x * inset, y, point.z + wall.normal.z * inset);
        mesh.rotation.y = yaw;
        group.add(mesh);
      };
      addFrame(frameWidth, doorTop - floorY, start, (floorY + doorTop) / 2);
      addFrame(frameWidth, doorTop - floorY, end, (floorY + doorTop) / 2);
      addFrame(Math.max(0, end - start), frameWidth, (start + end) / 2, doorTop);
      addFrame(Math.max(0, end - start), 0.04, (start + end) / 2, floorY + 0.02);
    }
  }

  isRevealed() {
    return this.revealed;
  }

  getTableInfo() {
    const table = this.room.table;
    if (!table) return null;
    const size = tableFrame(table.polygon);
    const roomSize = outlineBounds(this.room.floor.polygon);
    return {
      topY: table.topY,
      floorY: this.room.floor.y,
      height: table.topY - this.room.floor.y,
      width: size.width,
      depth: size.depth,
      roomWidth: roomSize.width,
      roomDepth: roomSize.depth,
      tableView: garageState.preferences.tableView,
      units: garageState.preferences.units,
      confirmed: garageState.preferences.tableConfirmed,
    };
  }

  setTableView(view: TableView) {
    setPreference('tableView', view);
    this.applyTableVisibility();
    emit('table-view-changed', view);
    emit('status', view === 'real' ? 'Table view: real table passthrough' : 'Table view: workbench skin');
  }

  setOutlines(visible: boolean) {
    this.root.traverse(object => {
      if (object.name.endsWith(' ink outline')) object.visible = visible;
    });
  }

  confirmTable() {
    const info = this.getTableInfo();
    if (!info) return;
    garageState.preferences = {
      ...garageState.preferences,
      tableHeight: info.height,
      tableConfirmed: true,
    };
    savePreferences();
    saveLastRoom(this.room);
    emit('table-confirmed', info);
    emit('status', `Table confirmed: ${(info.height * 100).toFixed(1)} cm`);
  }

  setTableHeight(topY: number) {
    const table = this.room.table;
    if (!table) return;
    const height = Math.max(0.3, Math.min(1.5, topY - this.room.floor.y));
    this.replaceTable({ ...table, topY: this.room.floor.y + height });
    emit('status', `Table height ${(height * 100).toFixed(1)} cm — YEP to store`);
  }

  setTableOutline(table: NonNullable<RoomModel['table']>) {
    this.replaceTable(table);
    this.confirmTable();
  }

  private replaceTable(table: NonNullable<RoomModel['table']>) {
    const oldTablePlacements = this.placements.filter(placement => placement.type === 'table' && placement.slotId !== 'paper-zone');
    this.room = { ...this.room, table };
    garageState.preferences = { ...garageState.preferences, tableHeight: table.topY - this.room.floor.y, tableConfirmed: false };
    savePreferences();
    const anchored = this.anchoredPlacements();
    const anchoredIds = new Set(anchored.map(placement => placement.slotId));
    const locked = [...this.placements.filter(placement => placement.type !== 'table' && !anchoredIds.has(placement.slotId)), ...anchored];
    const result = solve(this.room, this.rules, this.deviceObstacles, locked, {}, 413);
    const tablePlacements = result.placements.filter(placement => placement.type === 'table');
    this.placements = [...locked, ...tablePlacements];
    garageState.room = this.room;
    garageState.placements = this.placements;
    for (const placement of oldTablePlacements) {
      const node = this.propGroup?.getObjectByName(`PLACED_${placement.slotId}`);
      if (node) {
        node.removeFromParent();
        if (node instanceof Group) this.disposeGroup(node);
      }
    }
    if (this.tableGroup) {
      for (const child of [...this.tableGroup.children]) {
        this.tableGroup.remove(child);
        if (child instanceof Group) this.disposeGroup(child);
        else if (child instanceof Mesh) {
          child.geometry.dispose();
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach(material => { if (material !== this.tableMaterial) (material as any)?.dispose?.(); });
        }
      }
      this.tableEditToken++;
      this.buildTable(this.tableGroup, this.tableMaterial, this.placements, this.slotConfig, this.tableEditToken);
    }
    if (this.propGroup) {
      const tableProps = this.placements.filter(placement => placement.type === 'table' && placement.slotId !== 'paper-zone');
      if (tableProps.length) void this.buildProps(this.propGroup, tableProps, this.slotConfig);
    }
    this.buildTableCollider();
    this.buildTableOccluder();
    this.applyTableVisibility();
    this.setOutlines(garageState.preferences.outlines);
    emit('table-updated', this.getTableInfo());
  }

  private removeTableCollider() {
    const mesh = this.tableCollider?.object3D;
    this.tableCollider?.destroy();
    this.tableCollider = undefined;
    if (mesh instanceof Mesh) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }

  private buildTableCollider() {
    this.removeTableCollider();
    const table = this.room.table;
    if (!table) return;
    const mesh = new Mesh(polygonShape(table.polygon, tabletopThickness), new MeshBasicMaterial({ visible: false }));
    mesh.name = 'Table collider';
    mesh.position.y = table.topY;
    const entity = this.world.createTransformEntity(mesh);
    entity.addComponent(PhysicsShape, { shape: PhysicsShapeType.TriMesh, friction: 0.8 });
    entity.addComponent(PhysicsBody, { state: PhysicsState.Static });
    this.tableCollider = entity;
  }

  private buildTableOccluder() {
    if (this.tableOccluder) {
      this.tableOccluder.removeFromParent();
      this.tableOccluder.geometry.dispose();
      (this.tableOccluder.material as any)?.dispose?.();
      this.tableOccluder = undefined;
    }
    const table = this.room.table;
    if (!table) return;
    const material = new MeshBasicMaterial();
    material.colorWrite = false;
    material.depthWrite = true;
    material.depthTest = true;
    material.side = DoubleSide;
    const slab = new Mesh(polygonShape(table.polygon, tabletopThickness), material);
    slab.name = 'Real table passthrough slab';
    slab.position.y = table.topY;
    slab.renderOrder = -1000;
    slab.visible = garageState.preferences.tableView === 'real';
    this.root.add(slab);
    this.tableOccluder = slab;
  }

  private applyTableVisibility() {
    const real = garageState.preferences.tableView === 'real';
    if (this.tableGroup) this.tableGroup.visible = !real;
    if (this.tableOccluder) this.tableOccluder.visible = real;
    for (const placement of this.placements.filter(item => item.type === 'table')) {
      const node = this.propGroup?.getObjectByName(`PLACED_${placement.slotId}`);
      if (node) node.visible = !real;
    }
  }

  private buildTable(group: Group, material: any, placements: SlotPlacement[], config: Record<string, Slot>, token = this.tableEditToken) {
    const table = this.room.table;
    if (!table) return;
    const { center, width, depth, yaw } = tableFrame(table.polygon);
    const height = table.topY - this.room.floor.y;
    const workbench = config['SLOT_Workbench'];
    if (this.room.source === 'mock' && workbench?.model && Math.abs(width * depth - polygonArea(table.polygon)) < width * depth * 0.01) {
      const root = new Group();
      root.name = 'Workbench model root';
      root.position.set(center.x, this.room.floor.y, center.z);
      const seatSide = (this.room.seat.x - center.x) * Math.sin(yaw) + (this.room.seat.z - center.z) * Math.cos(yaw);
      root.rotation.y = seatSide < 0 ? yaw + Math.PI : yaw;
      group.add(root);
      this.loadWorkbenchModel(root, workbench, [width, height, depth], () => this.addProceduralTable(group, table, material), token);
    } else {
      this.addProceduralTable(group, table, material);
    }
    const paper = placements.find(placement => placement.slotId === 'paper-zone');
    if (paper) {
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 384;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, 512, 384);
      ctx.setLineDash([18, 12]); ctx.strokeStyle = '#e8ff2a'; ctx.lineWidth = 8; ctx.strokeRect(12, 12, 488, 360);
      ctx.setLineDash([]); ctx.fillStyle = '#e8ff2a'; ctx.font = 'bold 40px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('PAPER ZONE', 256, 196);
      const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
      const material = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
      if (this.tableSurface) applyRevealMaterial(material, this.tableSurface);
      const plane = new Mesh(new PlaneGeometry(paper.footprint.width * paper.scale, paper.footprint.depth * paper.scale), material);
      plane.name = 'Paper zone marker';
      plane.rotation.set(-Math.PI / 2, paper.yaw, 0, 'YXZ');
      plane.position.set(paper.position.x, table.topY + 0.006, paper.position.z);
      group.add(plane);
    }
  }

  private addProceduralTable(group: Group, table: NonNullable<RoomModel['table']>, material: any) {
    const height = table.topY - this.room.floor.y - tabletopThickness;
    const top = new Mesh(polygonShape(table.polygon, tabletopThickness), material);
    top.name = 'Workbench top';
    top.position.y = table.topY;
    group.add(top);
    const legMaterial = comicMaterial(0x3a2a20);
    if (this.tableSurface) applyRevealMaterial(legMaterial, this.tableSurface);
    const { center, yaw } = outlineBounds(table.polygon);
    for (const corner of table.polygon) {
      const distance = Math.hypot(center.x - corner.x, center.z - corner.z);
      const inset = Math.min(0.1 / (distance || 1), 0.5);
      const x = corner.x + (center.x - corner.x) * inset, z = corner.z + (center.z - corner.z) * inset;
      if (!pointInPolygon({ x, z }, table.polygon)) continue;
      const leg = new Mesh(new BoxGeometry(0.06, height, 0.06), legMaterial);
      leg.name = 'Workbench leg';
      leg.position.set(x, this.room.floor.y + height / 2, z);
      leg.rotation.y = yaw;
      group.add(leg);
    }
  }

  private findTopSurface(model: Group) {
    model.updateMatrixWorld(true);
    const buckets = new Map<number, { area: number; minX: number; maxX: number; minZ: number; maxZ: number }>();
    const a = new Vector3(), b = new Vector3(), c = new Vector3();
    const ab = new Vector3(), ac = new Vector3(), normal = new Vector3();
    model.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const geometry = object.geometry;
      const position = geometry.attributes.position;
      if (!position) return;
      const index = geometry.index;
      const count = index ? index.count : position.count;
      for (let i = 0; i < count; i += 3) {
        const ia = index ? index.getX(i) : i;
        const ib = index ? index.getX(i + 1) : i + 1;
        const ic = index ? index.getX(i + 2) : i + 2;
        a.fromBufferAttribute(position, ia).applyMatrix4(object.matrixWorld);
        b.fromBufferAttribute(position, ib).applyMatrix4(object.matrixWorld);
        c.fromBufferAttribute(position, ic).applyMatrix4(object.matrixWorld);
        ab.subVectors(b, a); ac.subVectors(c, a); normal.crossVectors(ab, ac);
        const length = normal.length();
        if (length < 1e-6 || normal.y / length < 0.5) continue;
        const y = Math.round(((a.y + b.y + c.y) / 3) * 200) / 200;
        const bucket = buckets.get(y) ?? { area: 0, minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
        bucket.area += length / 2;
        for (const point of [a, b, c]) {
          bucket.minX = Math.min(bucket.minX, point.x); bucket.maxX = Math.max(bucket.maxX, point.x);
          bucket.minZ = Math.min(bucket.minZ, point.z); bucket.maxZ = Math.max(bucket.maxZ, point.z);
        }
        buckets.set(y, bucket);
      }
    });
    let best: { y: number; area: number; minX: number; maxX: number; minZ: number; maxZ: number } | null = null;
    for (const [y, bucket] of buckets) if (!best || bucket.area > best.area) best = { y, ...bucket };
    if (!best) return null;
    return {
      y: best.y,
      size: { x: best.maxX - best.minX, z: best.maxZ - best.minZ },
      center: { x: (best.minX + best.maxX) / 2, z: (best.minZ + best.maxZ) / 2 },
    };
  }

  private loadWorkbenchModel(root: Group, slot: Slot, target: [number, number, number], fallback: () => void, token = this.tableEditToken) {
    const load = new Promise<void>(resolve => {
      this.loader.load(slot.model!, gltf => {
        if (token !== this.tableEditToken) { resolve(); return; }
        const model = gltf.scene;
        model.name = 'SLOT_Workbench model';
        // The model bounding box includes the vise above the worktop. Anchor the
        // large flat worktop surface at the scanned table height instead.
        const physical = new Box3().setFromObject(model, true);
        const surface = this.findTopSurface(model);
        if (!surface) { fallback(); resolve(); return; }
        const surfaceHeight = surface.y - physical.min.y;
        if (surfaceHeight < 0.001 || surface.size.x < 0.001 || surface.size.z < 0.001) { fallback(); resolve(); return; }
        const meshes: Mesh[] = [];
        model.traverse(object => { if (object instanceof Mesh) meshes.push(object); });
        meshes.forEach(mesh => {
          const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
          const next = comicMaterial((material as any)?.color ?? 0xffffff, (material as any)?.map ?? null);
          if (this.tableSurface) applyRevealMaterial(next, this.tableSurface);
          mesh.material = next;
          addOutline(mesh, 'SLOT_Workbench');
        });
        const frame = new Group();
        frame.add(model);
        const scaleX = target[0] / surface.size.x;
        const scaleY = target[1] / surfaceHeight;
        const scaleZ = target[2] / surface.size.z;
        frame.scale.set(scaleX, scaleY, scaleZ);
        // Align the actual worktop face, not the bounding box that includes the vise.
        frame.position.set(-surface.center.x * scaleX, -physical.min.y * scaleY, -surface.center.z * scaleZ);
        root.add(frame);
        resolve();
      }, undefined, error => {
        if (token === this.tableEditToken) {
          console.warn('SLOT_Workbench model failed, using procedural table', error);
          fallback();
        }
        resolve();
      });
    });
    this.modelLoads.push(load);
    return load;
  }

  private async buildProps(group: Group, placements: SlotPlacement[], config: Record<string, Slot>) {
    for (const placement of placements) {
      if (placement.slotId === 'paper-zone' || placement.slotId === 'door') continue;
      const assetId = assetForSlot[placement.slotId] ?? `SLOT_${placement.slotId}`;
      const slot = config[assetId];
      const rule = this.rules.find(item => item.id === placement.slotId);
      if (!rule) continue;
      const target: [number, number, number] = [rule.footprint.width, rule.height, rule.footprint.depth];
      const pivot: Slot['pivot'] = slot?.pivot ?? (placement.type === 'wall' || placement.type === 'ceiling' ? 'center' : 'bottom');
      const placeholder = createPlaceholder(assetId, target, pivot);
      const prop = new Group();
      prop.name = `PLACED_${placement.slotId}`;
      prop.position.set(placement.position.x, placement.position.y, placement.position.z);
      prop.rotation.y = placement.yaw;
      prop.scale.setScalar(placement.scale);
      prop.add(this.fitProp(placeholder, target, placement.type, 1));
      if (placement.slotId === 'lamp') {
        const glowMaterial = new MeshBasicMaterial({ color: 0xffd38a, transparent: true, opacity: 0, depthWrite: false });
        const glow = new Mesh(new SphereGeometry(0.055, 10, 8), glowMaterial);
        glow.name = 'Lamp glow';
        glow.position.set(0, -0.08, 0);
        prop.add(glow);
      }
      group.add(prop);
      if (slot?.model) this.loadPropModel(prop, slot, assetId, target, placement.type);
    }
  }

  private fitProp(model: Group, target: [number, number, number], type: SlotType, maxScale = Infinity) {
    const [width, height, depth] = target;
    const box = new Box3().setFromObject(model, true);
    const size = box.getSize(new Vector3()), center = box.getCenter(new Vector3());
    const scale = Math.min(width / Math.max(size.x, 0.001), height / Math.max(size.y, 0.001), depth / Math.max(size.z, 0.001), maxScale);
    const frame = new Group();
    frame.scale.setScalar(scale);
    const y = type === 'ceiling' ? height - box.max.y * scale : -box.min.y * scale;
    const z = type === 'wall' ? -depth / 2 - box.min.z * scale : -center.z * scale;
    frame.position.set(-center.x * scale, y, z);
    frame.add(model);
    return frame;
  }

  private loadPropModel(root: Group, slot: Slot, id: string, target: [number, number, number], type: SlotType) {
    const load = new Promise<void>(resolve => {
      this.loader.load(slot.model!, gltf => {
        const model = gltf.scene;
        if (!root.parent?.parent) { this.disposeGroup(model); resolve(); return; }
        model.name = `${id} model`;
        const meshes: Mesh[] = [];
        model.traverse(object => { if (object instanceof Mesh) meshes.push(object); });
        meshes.forEach(mesh => {
          const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
          mesh.material = comicMaterial((material as any)?.color ?? 0xffffff, (material as any)?.map ?? null);
          addOutline(mesh, id);
        });
        for (const child of [...root.children]) {
          if (child instanceof Group) this.disposeGroup(child);
          root.remove(child);
        }
        const frame = this.fitProp(model, target, type);
        frame.name = `${id} model frame`;
        root.add(frame);
        resolve();
      }, undefined, error => {
        console.warn(`${id} model failed, using placeholder`, error);
        resolve();
      });
    });
    this.modelLoads.push(load);
    return load;
  }

  private buildSky(group: Group, door: SlotPlacement | null) {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 768;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 0, 768);
    gradient.addColorStop(0, '#3a2b5c'); gradient.addColorStop(0.48, '#c75b4d'); gradient.addColorStop(1, '#ffb45e');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1024, 768);
    ctx.fillStyle = 'rgba(255,231,168,0.95)'; ctx.beginPath(); ctx.arc(650, 300, 78, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(64,45,66,0.35)';
    for (const [x, y, w] of [[120, 240, 220], [380, 170, 180], [760, 190, 200]]) {
      ctx.beginPath(); ctx.ellipse(x, y, w / 2, 26, 0, 0, Math.PI * 2); ctx.fill();
    }
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
    const enclosureMaterial = new MeshBasicMaterial({ map: texture, side: BackSide, transparent: true, opacity: 0, depthWrite: false });
    // A large inward-facing sky shell closes every seam, so an oblique view can never
    // leak passthrough through the wall/backdrop edges.
    const enclosure = new Mesh(new BoxGeometry(40, 24, 40), enclosureMaterial);
    enclosure.name = 'Sky enclosure (gap cover)';
    const roomBox = bounds(this.room.floor.polygon);
    enclosure.position.set((roomBox.minX + roomBox.maxX) / 2, this.room.floor.y + 10, (roomBox.minZ + roomBox.maxZ) / 2);
    group.add(enclosure);
    const material = new MeshBasicMaterial({ map: texture, side: DoubleSide, transparent: true, opacity: 0, depthWrite: false });
    const plane = new Mesh(new PlaneGeometry(9, 6), material);
    plane.name = 'Golden hour sky';
    if (door) {
      const wall = this.room.walls.find(item => item.id === door.wallId);
      if (wall) {
        const dx = wall.p1.x - wall.p0.x, dz = wall.p1.z - wall.p0.z;
        const length = Math.hypot(dx, dz) || 1;
        const t = ((door.position.x - wall.p0.x) * (dx / length) + (door.position.z - wall.p0.z) * (dz / length));
        plane.position.set(wall.p0.x + dx / length * t - wall.normal.x * 4, this.room.floor.y + 2.1, wall.p0.z + dz / length * t - wall.normal.z * 4);
        plane.rotation.y = Math.atan2(wall.normal.x, wall.normal.z);
      } else {
        plane.position.set(0, 2.1, -5);
      }
    } else {
      plane.position.set(0, 2.1, -5);
    }
    group.add(plane);

    const beamCanvas = document.createElement('canvas'); beamCanvas.width = 256; beamCanvas.height = 256;
    const beamCtx = beamCanvas.getContext('2d')!;
    const beamGradient = beamCtx.createRadialGradient(128, 216, 8, 128, 216, 190);
    beamGradient.addColorStop(0, 'rgba(255,236,176,0.95)');
    beamGradient.addColorStop(0.45, 'rgba(255,196,112,0.38)');
    beamGradient.addColorStop(1, 'rgba(255,196,112,0)');
    beamCtx.fillStyle = beamGradient; beamCtx.fillRect(0, 0, 256, 256);
    const beamTexture = new CanvasTexture(beamCanvas); beamTexture.colorSpace = SRGBColorSpace;
    const beamMaterial = new MeshBasicMaterial({ map: beamTexture, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide, blending: AdditiveBlending });
    const beam = new Mesh(new PlaneGeometry(3.2, 2.6), beamMaterial);
    beam.name = 'Sun beam';
    beam.position.copy(plane.position);
    beam.position.y -= 0.35;
    if (door) {
      const wall = this.room.walls.find(item => item.id === door.wallId);
      if (wall) beam.position.add(new Vector3(wall.normal.x * 0.6, 0, wall.normal.z * 0.6));
    }
    beam.rotation.y = plane.rotation.y;
    group.add(beam);

    const dustGeometry = new BufferGeometry();
    const dustCount = 70;
    const dustPositions = new Float32Array(dustCount * 3);
    for (let i = 0; i < dustCount; i++) {
      dustPositions[i * 3] = plane.position.x + (Math.random() - 0.5) * 2.6;
      dustPositions[i * 3 + 1] = this.room.floor.y + 0.3 + Math.random() * 2.2;
      dustPositions[i * 3 + 2] = plane.position.z + (Math.random() - 0.5) * 2.6;
    }
    dustGeometry.setAttribute('position', new BufferAttribute(dustPositions, 3));
    const dustMaterial = new PointsMaterial({ color: 0xffe5a4, size: 0.016, transparent: true, opacity: 0, depthWrite: false });
    const dust = new Points(dustGeometry, dustMaterial);
    dust.name = 'Dust motes in the sun beam';
    group.add(dust);

    this.doorRuntime = {
      group,
      materials: [enclosureMaterial, material, ...(this.doorFrameMaterial ? [this.doorFrameMaterial] : [])],
      beams: [beam],
      dust,
      opacity: 0,
    };
  }

  private buildBlueprint(seat: Vector3): RevealBlueprint {
    const group = new Group();
    group.name = 'Reveal blueprint';
    const lineMaterial = new LineDashedMaterial({ color: 0x19e3ff, dashSize: 0.07, gapSize: 0.05, transparent: true, opacity: 0, depthWrite: false });
    const floorPoints = this.room.floor.polygon.map(point => new Vector3(point.x, this.room.floor.y + 0.018, point.z));
    if (floorPoints.length >= 3) {
      const line = new LineLoop(new BufferGeometry().setFromPoints(floorPoints), lineMaterial);
      line.computeLineDistances();
      group.add(line);
    }
    if (this.room.table?.polygon.length && this.room.table.polygon.length >= 3) {
      const tablePoints = this.room.table.polygon.map(point => new Vector3(point.x, this.room.table!.topY + 0.008, point.z));
      const line = new LineLoop(new BufferGeometry().setFromPoints(tablePoints), lineMaterial);
      line.computeLineDistances();
      group.add(line);
    }
    const ringMaterial = new MeshBasicMaterial({ color: 0xe8ff2a, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide });
    const ring = new Mesh(new RingGeometry(0.18, 0.23, 32), ringMaterial);
    ring.name = 'Seat marker';
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(seat.x, this.room.floor.y + 0.022, seat.z);
    group.add(ring);
    return { group, lineMaterial, ring, ringMaterial };
  }

  resetForRescan(startScan = true) {
    this.buildGeneration++;
    this.layoutResolveToken++;
    this.stopScanning();
    this.clearScanOverlay(true);
    this.tableEditToken++;
    this.removeTableCollider();
    for (const texture of this.stickerTextures) texture.dispose?.();
    this.stickerTextures = [];
    this.revealStickers = [];
    for (const child of [...this.root.children]) {
      this.root.remove(child);
      if (child instanceof Group) this.disposeGroup(child);
    }
    this.ready = false;
    this.revealed = false;
    this.building = false;
    this.surfaces = [];
    this.revealProps = [];
    this.blueprint = null;
    this.doorRuntime = null;
    this.revealRuntime = null;
    this.tableGroup = undefined;
    this.propGroup = undefined;
    this.tableOccluder = undefined;
    this.tableSurface = undefined;
    this.doorFrameMaterial = undefined;
    this.placements = [];
    this.deviceObstacles = [];
    this.deviceSignature = '';
    this.modelLoads = [];
    garageState.room = null;
    garageState.placements = [];
    if (location.hostname === 'localhost') (window as any).garageBuildDebug = null;
    emit('garage-reset');
    if (startScan) this.beginRoomScan();
  }

  setDeviceObstacles(obstacles: Obstacle[]) {
    const signature = JSON.stringify(obstacles);
    this.deviceObstacles = obstacles;
    if (signature === this.deviceSignature) return;
    this.deviceSignature = signature;
    if (this.ready && this.propGroup && this.revealed) void this.rebuildLayout(413, true);
  }

  forceDeviceResolve() {
    if (this.ready && this.propGroup && this.revealed) void this.rebuildLayout(413, true);
  }

  async rearrangeProps() {
    return this.rebuildLayout(Math.floor(Math.random() * 100000));
  }

  private async rebuildLayout(seed: number, deviceDriven = false) {
    if (!this.ready || !this.propGroup || !this.revealed) return;
    const token = ++this.layoutResolveToken;
    for (const child of [...this.propGroup.children]) {
      this.propGroup.remove(child);
      if (child instanceof Group) this.disposeGroup(child);
    }
    const locked = [...this.anchoredPlacements(), ...this.placements.filter(placement => placement.type === 'table' || placement.slotId === 'door')];
    const result = solve(this.room, this.rules, this.deviceObstacles, locked, {}, seed);
    if (token !== this.layoutResolveToken) return;
    this.placements = result.placements;
    garageState.placements = this.placements;
    this.modelLoads = [];
    await this.buildProps(this.propGroup, result.placements, this.slotConfig);
    await this.waitForModels();
    if (token !== this.layoutResolveToken) return;
    const props: RevealProp[] = [];
    for (const child of this.propGroup.children) {
      if (!(child instanceof Group)) continue;
      const id = child.name.replace(/^PLACED_/, '');
      const placement = this.placements.find(item => item.slotId === id);
      const tableProp = placement?.type === 'table';
      props.push({
        id,
        object: child,
        basePosition: child.position.clone(),
        baseScale: child.scale.clone(),
        finalVisible: !(tableProp && garageState.preferences.tableView === 'real'),
        start: 0,
        dropDuration: 0.42,
        landed: false,
        priority: placement?.type === 'floor' ? 0 : 1,
      });
      child.visible = false;
    }
    if (this.revealRuntime) {
      this.revealRuntime.props = props;
      this.revealRuntime.hiddenAtBuild = true;
    }
    this.revealProps = props;
    if (this.revealed) {
      for (const prop of props) prop.object.visible = prop.finalVisible;
      if (this.revealRuntime) this.revealRuntime.hiddenAtBuild = false;
    }
    this.setOutlines(garageState.preferences.outlines);
    emit('garage-props-rebuilt');
    emit('status', deviceDriven ? 'Props adjusted around your devices' : `Props rearranged | seed ${seed}`);
  }

  private disposeGroup(group: Group) {
    group.traverse(object => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.forEach(material => (material as any).dispose?.());
      }
    });
  }
}
