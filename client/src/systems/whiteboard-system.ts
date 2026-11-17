import { CanvasTexture, createSystem, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3 } from '@iwsdk/core';
import { emit, garageEvents } from '../events.js';
import { garageState } from '../garage-state.js';
import { registerGarageRoot, unregisterGarageRoot, garageRootsVisible } from '../garage-visibility.js';
import { slotRules } from '../slot-rules.js';
import { uiInputActive } from '../ui-press.js';

type Stroke = { color: string; points: { x: number; y: number }[] };
const key = 'garage-jam-whiteboard-v1';
const colors = ['#9b315d', '#245c73', '#65621f', '#443347'];
const legacyInk: Record<string, string> = {
  '#ff2d95': colors[0],
  '#19e3ff': colors[1],
  '#e8ff2a': colors[2],
  '#f5ecd7': colors[3],
};
const textureWidth = 768;
const inkWidth = 5;
const uploadInterval = 32;

function load(): Stroke[] {
  try { const value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : []; }
  catch { return []; }
}

export class WhiteboardSystem extends createSystem({}) {
  private root = new Group();
  private mesh?: Mesh;
  private texture?: CanvasTexture;
  private canvas?: HTMLCanvasElement;
  private width = 1.2;
  private height = 0.8;
  private strokes: Stroke[] = load();
  private drawing = false;
  private last = { x: 0, y: 0 };
  private colorIndex = 0;
  private lastUpload = 0;

  init() {
    this.root.name = 'Whiteboard ink';
    this.world.scene.add(this.root);
    registerGarageRoot(this.root);
    const onRevealed = () => this.build();
    const onClear = () => this.clear();
    const onReset = () => this.clear();
    garageEvents.addEventListener('garage-revealed', onRevealed);
    garageEvents.addEventListener('garage-props-rebuilt', onRevealed);
    garageEvents.addEventListener('garage-reset', onReset);
    garageEvents.addEventListener('whiteboard-clear', onClear);
    const stop = this.world.onXRFrame(frame => this.sample(frame));
    this.cleanupFuncs.push(() => {
      garageEvents.removeEventListener('garage-revealed', onRevealed);
      garageEvents.removeEventListener('garage-props-rebuilt', onRevealed);
      garageEvents.removeEventListener('garage-reset', onReset);
      garageEvents.removeEventListener('whiteboard-clear', onClear);
      stop();
      this.clearMeshes();
      this.root.removeFromParent();
      unregisterGarageRoot(this.root);
    });
    if (location.hostname === 'localhost') {
      const system = this;
      (window as any).garageWhiteboardDebug = {
        get strokes() { return system.strokes.length; },
        clear: () => system.clear(),
      };
    }
  }

  private clearMeshes() {
    this.mesh?.geometry.dispose();
    (this.mesh?.material as MeshBasicMaterial | undefined)?.dispose();
    this.texture?.dispose();
    this.mesh?.removeFromParent();
    this.mesh = undefined;
    this.texture = undefined;
    this.canvas = undefined;
    this.lastUpload = 0;
  }

  private build() {
    if (this.drawing) this.finish();
    this.clearMeshes();
    const placement = garageState.placements.find(item => item.slotId === 'whiteboard');
    const room = garageState.room;
    if (!placement || !room) return;
    const wall = room.walls.find(item => item.id === placement.wallId);
    if (!wall) return;
    const rule = slotRules.find(item => item.id === 'whiteboard');
    this.width = rule?.footprint.width ?? 1.2;
    this.height = rule?.height ?? 0.8;
    const canvas = document.createElement('canvas');
    canvas.width = textureWidth;
    canvas.height = Math.max(1, Math.round(textureWidth * this.height / this.width));
    this.canvas = canvas;
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
    this.texture = texture;
    const mesh = new Mesh(new PlaneGeometry(this.width, this.height), new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: 2 }));
    mesh.name = 'Whiteboard marker layer';
    mesh.renderOrder = 4;
    const centerY = placement.position.y + this.height * placement.scale / 2;
    const offset = placement.footprint.depth * placement.scale / 2 + 0.015;
    mesh.position.set(placement.position.x + wall.normal.x * offset, centerY, placement.position.z + wall.normal.z * offset);
    mesh.lookAt(placement.position.x + wall.normal.x, centerY, placement.position.z + wall.normal.z);
    mesh.scale.setScalar(placement.scale);
    this.mesh = mesh;
    this.root.add(mesh);
    this.redraw();
  }

  private sample(frame: XRFrame) {
    const mesh = this.mesh;
    const session = this.world.session;
    const space = this.world.renderer.xr.getReferenceSpace();
    if (!mesh || !session || !space || !garageRootsVisible()) { if (this.drawing) this.finish(); return; }
    if (uiInputActive()) { if (this.drawing) this.finish(); return; }
    const side = garageState.preferences.dominantHand;
    const source = this.input.xr.getPrimaryInputSource?.(side) ?? Array.from(session.inputSources).find(input => input.handedness === side);
    if (!source?.targetRaySpace) { if (this.drawing) this.finish(); return; }
    const pose = frame.getPose(source.targetRaySpace, space);
    if (!pose) { if (this.drawing) this.finish(); return; }
    const { position, orientation } = pose.transform;
    const direction = new Vector3(0, 0, -1).applyQuaternion(new Quaternion(orientation.x, orientation.y, orientation.z, orientation.w));
    const origin = new Vector3(position.x, position.y, position.z);
    mesh.updateMatrixWorld(true);
    const normal = new Vector3(0, 0, 1).applyQuaternion(mesh.getWorldQuaternion(new Quaternion()));
    const denom = direction.dot(normal);
    if (Math.abs(denom) < 1e-4) { if (this.drawing) this.finish(); return; }
    const toPlane = mesh.getWorldPosition(new Vector3()).sub(origin);
    const t = toPlane.dot(normal) / denom;
    if (t <= 0 || t > 3) { if (this.drawing) this.finish(); return; }
    const hit = origin.addScaledVector(direction, t);
    const local = mesh.worldToLocal(hit.clone());
    const inside = Math.abs(local.x) <= this.width / 2 && Math.abs(local.y) <= this.height / 2;
    const pressed = source.hand
      ? (this.input.xr.visualAdapters.hand[side]?.getPinchStrength?.() ?? 0) > 0.6 || this.input.xr.getSelectState?.(side)?.active
      : source.gamepad?.buttons[0]?.pressed ?? false;
    if (!inside || !pressed) {
      if (this.drawing) this.finish();
      return;
    }
    const point = {
      x: Math.max(0, Math.min(1, local.x / this.width + 0.5)),
      y: Math.max(0, Math.min(1, 1 - (local.y / this.height + 0.5))),
    };
    if (!this.drawing) {
      this.drawing = true;
      const stroke: Stroke = { color: colors[this.colorIndex++ % colors.length], points: [point] };
      this.strokes.push(stroke);
      this.last = point;
      this.drawDot(stroke, point);
      this.markTexture(true);
    } else if (Math.hypot(point.x - this.last.x, point.y - this.last.y) > 0.006) {
      const stroke = this.strokes[this.strokes.length - 1];
      stroke.points.push(point);
      this.drawSegment(stroke, this.last, point);
      this.last = point;
      this.markTexture();
    }
  }

  private finish() {
    this.drawing = false;
    const before = this.strokes.length;
    this.strokes = this.strokes.slice(-40);
    try { localStorage.setItem(key, JSON.stringify(this.strokes)); } catch { /* private mode */ }
    if (before > 40) this.redraw();
    else this.markTexture(true);
  }

  private inkFor(stroke: Stroke) {
    return legacyInk[stroke.color] ?? stroke.color;
  }

  private drawDot(stroke: Stroke, point: { x: number; y: number }) {
    const canvas = this.canvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const x = point.x * canvas.width;
    const y = point.y * canvas.height;
    ctx.fillStyle = this.inkFor(stroke);
    ctx.beginPath();
    ctx.arc(x, y, inkWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawSegment(stroke: Stroke, from: { x: number; y: number }, to: { x: number; y: number }) {
    const canvas = this.canvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = this.inkFor(stroke);
    ctx.lineWidth = inkWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x * canvas.width, from.y * canvas.height);
    ctx.lineTo(to.x * canvas.width, to.y * canvas.height);
    ctx.stroke();
  }

  private markTexture(force = false) {
    if (!this.texture) return;
    const now = performance.now();
    if (!force && now - this.lastUpload < uploadInterval) return;
    this.lastUpload = now;
    this.texture.needsUpdate = true;
  }

  private redraw() {
    if (!this.canvas || !this.texture) return;
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const stroke of this.strokes) {
      if (!stroke.points.length) continue;
      if (stroke.points.length === 1) {
        this.drawDot(stroke, stroke.points[0]);
        continue;
      }
      ctx.strokeStyle = this.inkFor(stroke);
      ctx.lineWidth = inkWidth;
      ctx.beginPath();
      stroke.points.forEach((point, index) => {
        const x = point.x * this.canvas!.width;
        const y = point.y * this.canvas!.height;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    this.markTexture(true);
  }

  private clear() {
    this.strokes = [];
    this.drawing = false;
    try { localStorage.removeItem(key); } catch { /* private mode */ }
    this.redraw();
    emit('status', 'Whiteboard cleared');
  }
}
