import { Box3, BoxGeometry, CylinderGeometry, DoubleSide, Group, IcosahedronGeometry, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3, PhysicsBody, PhysicsShape, PhysicsShapeType, PhysicsState, CanvasTexture, SRGBColorSpace } from '@iwsdk/core';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { addOutline, comicMaterial } from './comic-style.js';
import { emit } from './events.js';
import type { World } from '@iwsdk/core';

export type Slot = { model: string | null; targetSize: [number, number, number]; pivot: 'bottom' | 'center'; collider: 'none' | 'box' | 'capsule' | 'sphere' | 'convex'; position: [number, number, number]; rotation: [number, number, number] };
type SlotManifest = Record<string, Slot>;
const skip = new Set(['SLOT_Backdrop', 'SLOT_PaperCrumpled']);
function labelTexture(text: string) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
  const c = canvas.getContext('2d')!; c.fillStyle = '#19212a'; c.fillRect(0, 0, 512, 256);
  c.lineWidth = 16; c.strokeStyle = '#f94eaa'; c.strokeRect(12, 12, 488, 232);
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.font = 'bold 54px sans-serif'; c.fillStyle = '#ffdc6c'; c.fillText(text, 256, 128);
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; return texture;
}
export function createPlaceholder(id: string, size: [number, number, number], pivot: Slot['pivot']) {
  const [w, h, d] = size; const group = new Group(); group.name = `PH_${id}`;
  if (id === 'SLOT_GraffitiDecals') {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 768;
    const c = canvas.getContext('2d')!;
    c.clearRect(0, 0, 1024, 768);
    c.fillStyle = 'rgba(13,13,16,0.55)';
    for (const [x, y, r] of [[140, 120, 7], [190, 170, 5], [820, 560, 8], [760, 620, 5], [470, 120, 6]]) {
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    }
    c.save(); c.translate(170, 430); c.rotate(-0.08);
    c.font = '900 260px Anton, sans-serif'; c.lineWidth = 24; c.strokeStyle = '#0d0d10'; c.lineJoin = 'round';
    c.strokeText('JAM', 0, 0);
    c.fillStyle = '#ff2d95'; c.fillText('JAM', 0, 0);
    c.fillStyle = '#19e3ff'; c.globalAlpha = 0.8; c.fillText('JAM', -14, -12);
    c.restore();
    c.strokeStyle = '#ff2d95'; c.lineWidth = 12; c.lineCap = 'round';
    for (const [x, y, dx, dy] of [[230, 450, -8, 90], [340, 450, 5, 120], [710, 190, 12, 80], [780, 230, -8, 60]]) {
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + dx, y + dy * 0.6, x + dx, y + dy); c.stroke();
    }
    c.strokeStyle = '#e8ff2a'; c.lineWidth = 8;
    c.beginPath(); c.arc(760, 160, 60, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.moveTo(720, 160); c.lineTo(800, 160); c.moveTo(760, 120); c.lineTo(760, 200); c.stroke();
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
    const decal = new Mesh(new PlaneGeometry(Math.max(w, 0.5), Math.max(h, 0.5)), new MeshBasicMaterial({ map: texture, transparent: true, side: DoubleSide, depthWrite: false }));
    decal.name = 'PH_SLOT_GraffitiDecals_decal'; group.add(decal);
    return group;
  }
  if (id === 'SLOT_TireStack') {
    const rubber = comicMaterial(0x47414d);
    const tread = comicMaterial(0x655b64);
    const radius = Math.min(w, d) / 2;
    const centerY = pivot === 'bottom' ? h / 2 : 0;
    for (let i = 0; i < 3; i++) {
      const tire = new Mesh(new CylinderGeometry(radius, radius, h * 0.30, 18), rubber);
      tire.position.y = centerY + (i - 1) * h * 0.33;
      group.add(tire);
      const band = new Mesh(new CylinderGeometry(radius * 1.005, radius * 1.005, h * 0.04, 18), tread);
      band.position.y = tire.position.y;
      group.add(band);
    }
    const hub = new Mesh(new CylinderGeometry(radius * 0.62, radius * 0.62, h * 0.006, 18), comicMaterial(0x211b28));
    hub.position.y = centerY + h * 0.482;
    group.add(hub);
    return group;
  }
  const isCylinder = /TrashCan|Marker/.test(id);
  const geometry = isCylinder ? new CylinderGeometry(Math.max(w, d) / 2, Math.max(w, d) / 2, h, 12, 1, id === 'SLOT_TrashCan') : new BoxGeometry(Math.max(w, 0.01), Math.max(h, 0.01), Math.max(d, 0.01));
  const cabinet = id === 'SLOT_MiniFridge' || id === 'SLOT_Crates' || id === 'SLOT_Toolbox';
  const bodyColor = id === 'SLOT_MiniFridge' ? 0x756378 : id === 'SLOT_Crates' ? 0x8c614d
    : id === 'SLOT_Toolbox' ? 0x844657 : id === 'SLOT_TrashCan' ? 0x313c44 : 0x39444b;
  const mesh = new Mesh(geometry, comicMaterial(bodyColor));
  mesh.name = `PH_${id}_body`; mesh.position.y = pivot === 'bottom' ? h / 2 : 0; group.add(mesh); addOutline(mesh, id);
  if (cabinet) {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const panel = ctx.createLinearGradient(0, 0, 256, 256);
    panel.addColorStop(0, id === 'SLOT_MiniFridge' ? '#a991a0' : id === 'SLOT_Crates' ? '#b08360' : '#a76272');
    panel.addColorStop(1, id === 'SLOT_MiniFridge' ? '#5c4e68' : id === 'SLOT_Crates' ? '#705046' : '#643849');
    ctx.fillStyle = panel; ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = 'rgba(255,228,192,0.44)'; ctx.lineWidth = 3; ctx.strokeRect(11, 11, 234, 234);
    ctx.strokeStyle = 'rgba(35,24,35,0.68)'; ctx.lineWidth = 4;
    for (const y of id === 'SLOT_Crates' ? [68, 132, 195] : id === 'SLOT_Toolbox' ? [75, 128, 181] : [80]) {
      ctx.beginPath(); ctx.moveTo(14, y); ctx.lineTo(242, y); ctx.stroke();
    }
    ctx.fillStyle = '#3d303b';
    for (const y of id === 'SLOT_Crates' ? [33] : id === 'SLOT_Toolbox' ? [97, 150, 204] : [44, 106]) {
      const x = id === 'SLOT_MiniFridge' ? 179 : 91;
      ctx.beginPath(); ctx.roundRect(x, y, id === 'SLOT_MiniFridge' ? 40 : 74, 11, 4); ctx.fill();
      ctx.fillStyle = '#ddbcab'; ctx.fillRect(x + 4, y + 1, id === 'SLOT_MiniFridge' ? 32 : 66, 2);
      ctx.fillStyle = '#3d303b';
    }
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
    const faceMaterial = new MeshBasicMaterial({ map: texture, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    faceMaterial.userData.ownedTexture = texture;
    const face = new Mesh(new PlaneGeometry(w, h), faceMaterial);
    face.position.set(0, mesh.position.y, d / 2);
    group.add(face);
  }
  if (id === 'SLOT_NeonSign') {
    const sign = new Mesh(new PlaneGeometry(w * 0.95, h * 0.8), new MeshBasicMaterial({ map: labelTexture('GARAGE JAM') }));
    sign.position.z = d / 2 + 0.011; group.add(sign);
  }
  if (id === 'SLOT_TrashCan') {
    const rim = new Mesh(new CylinderGeometry(w / 2, w / 2, 0.03, 16, 1, true), comicMaterial(0xf2b957));
    rim.position.y = h - 0.02; group.add(rim);
  }
  if (id === 'SLOT_Lamp') mesh.material = new MeshBasicMaterial({ color: 0xfff4d3 });
  if (id === 'SLOT_PaperCrumpled') group.add(new Mesh(new IcosahedronGeometry(0.045, 1), comicMaterial(0xf7e9c9)));
  return group;
}
export class SlotManager {
  private slots = new Map<string, { status: string; triangles: number; outline: number }>();
  private roots: Group[] = [];
  private loader = new GLTFLoader();
  setVisible(visible: boolean) { this.roots.forEach(root => { root.visible = visible; }); }
  async create(world: World) {
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    const response = await fetch('/assets/assets.config.json');
    if (!response.ok) throw new Error('Slot manifest unavailable');
    const manifest = await response.json() as SlotManifest;
    for (const [id, slot] of Object.entries(manifest)) {
      if (skip.has(id)) continue;
      const root = new Group(); root.name = id;
      root.position.set(...slot.position); root.rotation.set(...slot.rotation);
      this.roots.push(root);
      const ph = createPlaceholder(id, slot.targetSize, slot.pivot); root.add(ph);
      world.createTransformEntity(root);
      const [w, h, d] = slot.targetSize;
      if (slot.collider !== 'none' && id !== 'SLOT_Workbench') {
        const colliderMesh = new Mesh(new BoxGeometry(0.01, 0.01, 0.01), new MeshBasicMaterial({ visible: false }));
        colliderMesh.name = `${id} collider`;
        colliderMesh.position.set(slot.position[0], slot.position[1] + (slot.pivot === 'bottom' ? h / 2 : 0), slot.position[2]);
        const entity = world.createTransformEntity(colliderMesh);
        const shape = slot.collider === 'sphere' ? PhysicsShapeType.Sphere : slot.collider === 'capsule' ? PhysicsShapeType.Capsules : PhysicsShapeType.Box;
        entity.addComponent(PhysicsShape, { shape, dimensions: slot.collider === 'sphere' ? [w / 2, 0, 0] : slot.collider === 'capsule' ? [w / 2, Math.max(h, w), 0] : [w, h, d], friction: 0.8 });
        entity.addComponent(PhysicsBody, { state: PhysicsState.Static });
      }
      let placeholderTriangles = 0, placeholderOutline = 0;
      ph.traverse(object => { if (object instanceof Mesh) { const geo = object.geometry; const count = geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3; placeholderTriangles += count; if (object.name.endsWith('ink outline')) placeholderOutline += count; } });
      this.slots.set(id, { status: 'placeholder', triangles: placeholderTriangles, outline: placeholderOutline });
      if (slot.model) {
        this.loader.load(slot.model, gltf => {
          const model = gltf.scene;
          model.name = id + ' model';
          const bounds = new Box3().setFromObject(model);
          const actual = bounds.getSize(new Vector3());
          const scale = Math.min(w / Math.max(actual.x, 0.001), h / Math.max(actual.y, 0.001), d / Math.max(actual.z, 0.001));
          model.scale.setScalar(scale);
          const scaled = new Box3().setFromObject(model);
          const center = scaled.getCenter(new Vector3());
          model.position.set(-center.x, slot.pivot === 'bottom' ? -scaled.min.y : -center.y, -center.z);
          let triangles = 0, outline = 0;
          const meshes: Mesh[] = [];
          model.traverse(object => { if (object instanceof Mesh) meshes.push(object); });
          meshes.forEach(object => {
            const material = Array.isArray(object.material) ? object.material[0] : object.material;
            object.material = comicMaterial((material as any).color || 0xffffff, (material as any).map);
            const map = (material as any).map;
            if (map?.image?.width > 1024 || map?.image?.height > 1024) console.warn(`${id} texture exceeds 1024 px: ${map.image.width}x${map.image.height}`);
            const geo = object.geometry; triangles += geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
            outline += addOutline(object, id);
          });
          root.remove(ph); root.add(model);
          this.slots.set(id, { status: 'model', triangles, outline });
          emit('slots', this.validate());
          if (triangles > (id === 'SLOT_Workbench' || id === 'SLOT_TrashCan' ? 8000 : 3000)) console.warn(`${id} exceeds its triangle budget: ${triangles}`);
        }, undefined, error => console.warn(`${id} model failed, using placeholder`, error));
      }
    }
    return this.validate();
  }
  validate() {
    const records = [...this.slots].map(([slot, data]) => ({ slot, ...data }));
    const totalTriangles = records.reduce((sum, record) => sum + record.triangles, 0);
    const outlineTriangles = records.reduce((sum, record) => sum + record.outline, 0);
    if (totalTriangles > 100000) console.warn(`Scene slot budget exceeded: ${totalTriangles} triangles`);
    if (new URLSearchParams(location.search).has('debug')) console.table(records);
    return { records, totalTriangles, outlineTriangles };
  }
}
