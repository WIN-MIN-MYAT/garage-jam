import { CanvasTexture, createSystem, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Vector3 } from '@iwsdk/core';
import { emit, garageEvents } from '../events.js';
import { garageState } from '../garage-state.js';
import { registerGarageRoot, unregisterGarageRoot, garageRootsVisible } from '../garage-visibility.js';
import { slotRules } from '../slot-rules.js';

type Stroke = { color: string; points: { x: number; y: number }[] };
const key = 'garage-jam-whiteboard-v1';
const colors = ['#ff2d95', '#19e3ff', '#e8ff2a', '#f5ecd7'];

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

  init() {
    this.root.name = 'Whiteboard ink';
    this.world.scene.add(this.root);
    registerGarageRoot(this.root);
    const onRevealed = () => this.build();
    const onClear = () => this.clear();
    const onReset = () => this.clear();
    garageEvents.addEventListener('garage-revealed', onRevealed);
    garageEvents.addEventListener('garage-reset', onReset);
    garageEvents.addEventListener('whiteboard-clear', onClear);
    const stop = this.world.onXRFrame(frame => this.sample(frame));
    this.cleanupFuncs.push(() => {
      garageEvents.removeEventListener('garage-revealed', onRevealed);
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
  }

  private build() {
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
    canvas.width = 1024; canvas.height = Math.round(1024 * this.height / this.width);
    this.canvas = canvas;
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
    this.texture = texture;
    const mesh = new Mesh(new PlaneGeometry(this.width, this.height), new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: 2 }));
    mesh.name = 'Whiteboard marker layer';
    mesh.renderOrder = 4;
    mesh.position.set(placement.position.x + wall.normal.x * 0.045, placement.position.y, placement.position.z + wall.normal.z * 0.045);
    mesh.lookAt(placement.position.x + wall.normal.x, placement.position.y, placement.position.z + wall.normal.z);
    this.mesh = mesh;
    this.root.add(mesh);
    this.redraw();
  }

  private sample(frame: XRFrame) {
    const mesh = this.mesh;
    const session = this.world.session;
    const space = this.world.renderer.xr.getReferenceSpace();
    if (!mesh || !session || !space || !garageRootsVisible()) return;
    const side = garageState.preferences.dominantHand;
    const source = this.input.xr.getPrimaryInputSource?.(side) ?? Array.from(session.inputSources).find(input => input.handedness === side);
    if (!source?.targetRaySpace) { this.drawing = false; return; }
    const pose = frame.getPose(source.targetRaySpace, space);
    if (!pose) { this.drawing = false; return; }
    const { position, orientation } = pose.transform;
    const direction = new Vector3(0, 0, -1).applyQuaternion(new Quaternion(orientation.x, orientation.y, orientation.z, orientation.w));
    const origin = new Vector3(position.x, position.y, position.z);
    mesh.updateMatrixWorld(true);
    const normal = new Vector3(0, 0, 1).applyQuaternion(mesh.getWorldQuaternion(new Quaternion()));
    const denom = direction.dot(normal);
    if (Math.abs(denom) < 1e-4) { this.drawing = false; return; }
    const toPlane = mesh.getWorldPosition(new Vector3()).sub(origin);
    const t = toPlane.dot(normal) / denom;
    if (t <= 0 || t > 3) { this.drawing = false; return; }
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
      this.strokes.push({ color: colors[this.colorIndex++ % colors.length], points: [point] });
      this.last = point;
      this.redraw();
    } else if (Math.hypot(point.x - this.last.x, point.y - this.last.y) > 0.006) {
      this.strokes[this.strokes.length - 1].points.push(point);
      this.last = point;
      this.redraw();
    }
  }

  private finish() {
    this.drawing = false;
    this.strokes = this.strokes.slice(-40);
    try { localStorage.setItem(key, JSON.stringify(this.strokes)); } catch { /* private mode */ }
    this.redraw();
  }

  private redraw() {
    if (!this.canvas || !this.texture) return;
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const stroke of this.strokes) {
      if (!stroke.points.length) continue;
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = 7;
      ctx.beginPath();
      stroke.points.forEach((point, index) => {
        const x = point.x * this.canvas!.width;
        const y = point.y * this.canvas!.height;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    this.texture.needsUpdate = true;
  }

  private clear() {
    this.strokes = [];
    this.drawing = false;
    try { localStorage.removeItem(key); } catch { /* private mode */ }
    this.redraw();
    emit('status', 'Whiteboard cleared');
  }
}
