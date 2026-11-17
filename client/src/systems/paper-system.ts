import { BoxGeometry, BufferGeometry, CanvasTexture, createSystem, DistanceGrabbable, Grabbed, Group, IcosahedronGeometry, InputComponent, Mesh, MeshBasicMaterial, OneHandGrabbable, PhysicsBody, PhysicsManipulation, PhysicsShape, PhysicsShapeType, PhysicsState, PhysicsSystem, RayInteractable, SRGBColorSpace, VisibilityState, Vector3 } from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';
import { addOutline, comicMaterial } from '../comic-style.js';
import { PaperTask } from '../paper-component.js';
import { roomConfig } from '../room-config.js';
import { emit, garageEvents } from '../events.js';
import { garageState } from '../garage-state.js';
import { addCompletion, loadProgress, setPinned } from '../progress-store.js';
import { revealAudio } from '../reveal/RevealAudio.js';
import { outlineBounds } from '../room-model.js';

type Task = { id: string; title: string; priority?: string | null; due?: string | null; source?: string; starter?: boolean };
const ink = '#161922';
const paperLimit = 25;
const starterTasks: Task[] = [
  { id: 'starter-welcome', title: 'Welcome to Garage Jam', priority: 'High', due: null, source: 'starter', starter: true },
  { id: 'starter-try', title: 'Try crumpling me', priority: 'Low', due: null, source: 'starter', starter: true },
];

function paperTexture(task: Task) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 640;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#f5ecd7'; c.fillRect(0, 0, 512, 640);
  c.strokeStyle = '#25232a'; c.lineWidth = 15; c.strokeRect(15, 15, 482, 610);
  c.fillStyle = '#dfc58a'; c.fillRect(191, 4, 130, 36);
  c.fillStyle = ink; c.font = 'bold 28px "GarageDisplay", sans-serif'; c.fillText('GARAGE JAM / TASK', 42, 95);
  c.fillStyle = task.priority?.toLowerCase() === 'high' ? '#f058a1' : task.priority?.toLowerCase() === 'medium' ? '#ff8a1f' : '#3bc9d9';
  c.beginPath(); c.arc(438, 82, 40, 0, Math.PI * 2); c.fill();
  c.fillStyle = ink; c.font = 'bold 17px sans-serif'; c.textAlign = 'center'; c.fillText((task.priority || 'GO').toUpperCase().slice(0, 6), 438, 88);
  if (task.source && task.source !== 'notion') {
    c.fillStyle = '#e8ff2a'; c.fillRect(42, 516, 150, 26);
    c.fillStyle = ink; c.font = 'bold 15px sans-serif'; c.textAlign = 'left'; c.fillText(task.source.toUpperCase().slice(0, 12), 52, 535);
  }
  c.textAlign = 'left'; c.save(); c.translate(42, 174); c.rotate((Math.random() - 0.5) * 0.06);
  const title = task.title.toLocaleUpperCase();
  let fontSize = 42, lines: string[] = [];
  do {
    c.font = `bold ${fontSize}px "GarageDisplay", "GarageCJK", sans-serif`;
    lines = []; let line = '';
    for (const character of Array.from(title)) {
      const candidate = line + character;
      if (c.measureText(candidate).width > 420 && line) { lines.push(line.trim()); line = character; }
      else line = candidate;
    }
    if (line.trim()) lines.push(line.trim());
    fontSize -= 2;
  } while (lines.length > 5 && fontSize >= 24);
  const overflow = lines.length > 5;
  lines = lines.slice(0, 5);
  if (overflow) {
    while (lines[4].length && c.measureText(lines[4] + '…').width > 420) lines[4] = lines[4].slice(0, -1);
    lines[4] += '…';
  }
  c.fillStyle = ink; c.strokeStyle = '#f7f0da'; c.lineWidth = 5; c.lineJoin = 'round';
  lines.forEach((line, i) => { c.strokeText(line, 0, i * 66); c.fillText(line, 0, i * 66); });
  c.restore();
  if (task.due) { c.fillStyle = '#24252c'; c.fillRect(35, 545, 250, 52); c.fillStyle = '#fff5df'; c.font = 'bold 24px sans-serif'; c.fillText(`DUE ${task.due.slice(0, 10)}`, 48, 579); }
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.generateMipmaps = true; return texture;
}

function polygonCenter(points: { x: number; z: number }[]) {
  const sum = points.reduce((box, point) => ({ x: box.x + point.x / points.length, z: box.z + point.z / points.length }), { x: 0, z: 0 });
  return sum;
}

export class PaperSystem extends createSystem({ papers: { required: [PaperTask] }, held: { required: [PaperTask, Grabbed] } }) {
  private demo = new URLSearchParams(location.search).get('demo') === '1';
  private started = false;
  private previous = new Map<number, Vector3>();
  private motion = new Map<number, { samples: Float32Array; next: number; count: number }>();
  private trash = new Vector3(roomConfig.trash[0], 0.55, roomConfig.trash[2]);
  private position = new Vector3();
  private loaded = false;
  private loading = false;
  private crumpledTemplate?: Group;
  private paperLoader = new GLTFLoader();
  private tasks = new Map<string, Task>();
  private roomHidden = false;

  init() {
    this.paperLoader.setMeshoptDecoder(MeshoptDecoder);
    this.paperLoader.load('/assets/models/optimized/crumpled-paper.glb', gltf => {
      const model = gltf.scene;
      model.name = 'Crumpled paper model';
      model.traverse(object => {
        if (!(object instanceof Mesh)) return;
        const material = Array.isArray(object.material) ? object.material[0] : object.material;
        object.material = comicMaterial((material as any)?.color ?? 0xf3e2b8, (material as any)?.map ?? null);
        addOutline(object, 'SLOT_PaperCrumpled');
      });
      this.crumpledTemplate = model;
    }, undefined, error => console.warn('Crumpled paper model failed, using procedural sphere', error));
    const onRevealed = () => { this.started = true; this.layoutFromRoom(); void this.loadTasks(); };
    const onCreated = (event: Event) => {
      const task = (event as CustomEvent<Task>).detail;
      if (!task?.id || !this.started) return;
      this.tasks.set(task.id, task);
      if (this.queries.papers.entities.size < paperLimit) this.spawn(task, this.queries.papers.entities.size);
      emit('tasks-updated', { tasks: [...this.tasks.values()], offline: false });
    };
    const onReset = () => {
      this.loaded = false; this.loading = false;
      for (const entity of this.queries.papers.entities) {
        (entity.object3D as Mesh)?.userData.paperTexture?.dispose?.();
        entity.dispose();
      }
      this.previous.clear(); this.motion.clear(); this.tasks.clear();
    };
    const onRoomHidden = () => { this.roomHidden = true; for (const entity of this.queries.papers.entities) entity.object3D?.visible && (entity.object3D.visible = false); };
    const onRoomShown = () => { this.roomHidden = false; for (const entity of this.queries.papers.entities) entity.object3D && (entity.object3D.visible = true); };
    garageEvents.addEventListener('garage-revealed', onRevealed);
    garageEvents.addEventListener('garage-reset', onReset);
    garageEvents.addEventListener('task-created', onCreated);
    garageEvents.addEventListener('room-hidden', onRoomHidden);
    garageEvents.addEventListener('room-shown', onRoomShown);
    if (location.hostname === 'localhost') Object.assign(((window as any).garageDebug ??= {}), {
      papers: () => [...this.queries.papers.entities].map(entity => ({ id: entity.getValue(PaperTask, 'taskId'), state: entity.getValue(PaperTask, 'state') })),
      crumpleFirst: () => { const first = this.queries.papers.entities.values().next().value; if (first) this.crumple(first); },
      dropFirstInTrash: () => {
        const first = [...this.queries.papers.entities].find(entity => entity.getValue(PaperTask, 'state') === 'crumpled');
        if (first) this.world.getSystem(PhysicsSystem)?.setBodyTransform(first, { position: [this.trash.x, this.trash.y + 0.03, this.trash.z], quaternion: [0, 0, 0, 1] });
      },
      completeFirst: () => {
        const first = [...this.queries.papers.entities].find(entity => entity.getValue(PaperTask, 'state') === 'crumpled');
        if (first) void this.complete(first);
      },
      addTask: (title: string) => { if (typeof title === 'string' && title.trim() && this.started) this.spawn({ id: `starter-${Date.now()}`, title: title.trim(), source: 'local', starter: true }, this.queries.papers.entities.size); },
    });
    this.cleanupFuncs.push(() => garageEvents.removeEventListener('garage-revealed', onRevealed));
    this.cleanupFuncs.push(() => garageEvents.removeEventListener('garage-reset', onReset));
    this.cleanupFuncs.push(() => garageEvents.removeEventListener('task-created', onCreated));
    this.cleanupFuncs.push(() => garageEvents.removeEventListener('room-hidden', onRoomHidden));
    this.cleanupFuncs.push(() => garageEvents.removeEventListener('room-shown', onRoomShown));
    this.cleanupFuncs.push(this.world.visibilityState.subscribe(state => {
      if (state === VisibilityState.Visible && (this.demo || garageState.room) && !this.started) {
        this.started = true;
        this.layoutFromRoom();
        void this.loadTasks();
      }
      if (state === VisibilityState.NonImmersive && this.started) {
        this.started = false; this.loaded = false; this.loading = false;
        for (const entity of this.queries.papers.entities) {
          (entity.object3D as Mesh)?.userData.paperTexture?.dispose?.();
          entity.dispose();
        }
        this.previous.clear();
        this.motion.clear();
        this.tasks.clear();
      }
    }));
    const onRelease = (entity: Entity) => {
      if (!entity.hasComponent(PaperTask) || !entity.hasComponent(PhysicsBody)) return;
      if (entity.getValue(PaperTask, 'state') === 'flat') {
        const board = garageState.placements.find(placement => placement.slotId === 'corkboard');
        entity.object3D?.getWorldPosition(this.position);
        if (board && Math.hypot(this.position.x - board.position.x, this.position.y - board.position.y, this.position.z - board.position.z) < 0.65) {
          const id = String(entity.getValue(PaperTask, 'taskId'));
          const progress = loadProgress();
          setPinned(progress, [id, ...progress.pinned.filter(item => item !== id)]);
          emit('progress-updated', progress);
          emit('status', 'Pinned to Today / Top 3');
        }
      }
      const samples = this.motion.get(entity.index);
      if (!samples || samples.count < 2) return;
      const newest = (samples.next + 4) % 5;
      const oldest = samples.count === 5 ? samples.next : 0;
      const a = oldest * 4, b = newest * 4;
      const dt = (samples.samples[b + 3] - samples.samples[a + 3]) / 1000;
      if (dt < 0.01) return;
      const vx = Math.max(-8, Math.min(8, (samples.samples[b] - samples.samples[a]) / dt));
      const vy = Math.max(-8, Math.min(8, (samples.samples[b + 1] - samples.samples[a + 1]) / dt));
      const vz = Math.max(-8, Math.min(8, (samples.samples[b + 2] - samples.samples[a + 2]) / dt));
      const current = entity.getVectorView(PhysicsBody, '_linearVelocity');
      if (vx * vx + vy * vy + vz * vz > 0.25 && current[0] ** 2 + current[1] ** 2 + current[2] ** 2 < 0.25) {
        entity.addComponent(PhysicsManipulation, { linearVelocity: [vx, vy, vz] });
        revealAudio.playPaperThrow({ x: this.position.x, y: this.position.y, z: this.position.z });
      }
      samples.count = 0;
    };
    this.cleanupFuncs.push(this.queries.held.subscribe('disqualify', onRelease));
    this.cleanupFuncs.push(this.queries.held.subscribe('qualify', () => revealAudio.playPaperGrab()));
  }

  private layoutFromRoom() {
    const room = garageState.room;
    if (!room) return;
    const trash = garageState.placements.find(placement => placement.slotId === 'trash');
    const point = trash?.position;
    this.trash.set(point?.x ?? room.seat.x + 0.7, (point?.y ?? room.floor.y) + 0.52, point?.z ?? room.seat.z - 0.4);
  }

  private paperZone() {
    const room = garageState.room;
    const placement = garageState.placements.find(item => item.slotId === 'paper-zone');
    if (placement) return { x: placement.position.x, z: placement.position.z };
    if (room?.table) {
      const center = polygonCenter(room.table.polygon);
      return center;
    }
    return { x: roomConfig.workbench[0], z: roomConfig.workbench[2] };
  }

  private async loadTasks() {
    if (this.loaded || this.loading) return;
    this.loading = true;
    try {
      const [response] = await Promise.all([
        fetch('/api/tasks'),
        document.fonts.load('bold 42px GarageDisplay'),
        document.fonts.load('bold 42px GarageCJK'),
      ]);
      if (!response.ok) throw new Error(`Tasks HTTP ${response.status}`);
      const result = await response.json() as { tasks: Task[]; offline: boolean; message?: string; notion?: { configured?: boolean } };
      const remote = result.tasks ?? [];
      const tasks = remote.length ? remote : this.demo ? [
        { id: 'demo-1', title: 'Finish the garage demo', priority: 'High', due: null, source: 'demo', starter: true },
        { id: 'demo-2', title: 'Sketch the next big idea', priority: 'Medium', due: null, source: 'demo', starter: true },
        { id: 'demo-3', title: 'Ship one small thing today', priority: 'Low', due: null, source: 'demo', starter: true },
      ] : starterTasks;
      emit('status', !result.notion?.configured ? `${tasks.length} local tasks ready` : result.offline ? `Notion offline; showing ${tasks.length} cached tasks` : `${tasks.length} tasks from Notion`);
      const source = tasks.slice(0, paperLimit);
      source.forEach(task => this.tasks.set(task.id, task));
      emit('tasks-updated', { tasks: source, offline: !!result.offline });
      this.loaded = true;
      source.forEach((task, index) => setTimeout(() => {
        if (this.started && this.queries.papers.entities.size < paperLimit) this.spawn(task, index);
      }, index * 60));
      if (tasks.length > paperLimit) emit('status', `${paperLimit} papers, +${tasks.length - paperLimit} more`);
    } catch (error) {
      emit('status', `Tasks unavailable: ${(error as Error).message}`);
      this.loading = false;
    } finally { this.loading = false; }
  }

  private spawn(task: Task, index: number) {
    const texture = paperTexture(task);
    const zone = this.paperZone();
    const room = garageState.room;
    const top = room?.table?.topY ?? 0.75;
    const yaw = room?.table ? outlineBounds(room.table.polygon).yaw : 0;
    const edge = new MeshBasicMaterial({ color: 0xf0dfbd });
    const face = new MeshBasicMaterial({ map: texture });
    const mesh = new Mesh(new BoxGeometry(0.22, 0.008, 0.28), [edge, edge, face, edge, edge, edge]);
    mesh.name = `Paper ${task.title}`;
    mesh.position.set(
      zone.x + ((index % 5) - 2) * 0.018,
      top + 0.012 + index * 0.009,
      zone.z + ((index % 3) - 1) * 0.016,
    );
    mesh.rotation.y = yaw + (index % 7 - 3) * 0.045;
    mesh.userData.paperTexture = texture;
    const entity = this.world.createTransformEntity(mesh);
    entity.addComponent(PaperTask, { taskId: task.id, state: 'flat', completed: false });
    entity.addComponent(RayInteractable, {});
    entity.addComponent(OneHandGrabbable, {});
    entity.addComponent(DistanceGrabbable, { movementMode: 'MoveFromTarget' });
    entity.addComponent(PhysicsShape, { shape: PhysicsShapeType.Box, dimensions: [0.22, 0.008, 0.28], density: 0.25, friction: 0.8 });
    entity.addComponent(PhysicsBody, { state: PhysicsState.Dynamic, linearDamping: 0.12, angularDamping: 0.2 });
    this.previous.set(entity.index, mesh.position.clone());
    this.motion.set(entity.index, { samples: new Float32Array(20), next: 0, count: 0 });
    mesh.visible = !this.roomHidden;
  }

  private crumple(entity: Entity) {
    if (entity.getValue(PaperTask, 'state') !== 'flat') return;
    const mesh = entity.object3D as Mesh;
    const texture = mesh.userData.paperTexture as CanvasTexture;
    texture.dispose();
    mesh.geometry.dispose();
    if (this.crumpledTemplate) {
      const visual = this.crumpledTemplate.clone(true);
      visual.name = 'Crumpled paper visual';
      visual.scale.setScalar(0.09);
      visual.position.y = -0.045;
      mesh.geometry = new BufferGeometry();
      mesh.material = new MeshBasicMaterial({ visible: false });
      mesh.add(visual);
    } else {
      mesh.geometry = new IcosahedronGeometry(0.045, 1);
      mesh.material = new MeshBasicMaterial({ color: 0xf4dfbb });
    }
    entity.setValue(PaperTask, 'state', 'crumpled');
    entity.setValue(PhysicsShape, 'shape', PhysicsShapeType.Sphere);
    const dimensions = entity.getVectorView(PhysicsShape, 'dimensions');
    dimensions[0] = 0.045; dimensions[1] = 0; dimensions[2] = 0;
    emit('status', 'CRUNCH! Throw it in the trash');
    emit('paper-crumpled', { id: entity.getValue(PaperTask, 'taskId') });
    revealAudio.playPaperCrumple({ x: this.position.x, y: this.position.y, z: this.position.z });
    this.pulse(0.32, 45);
  }

  private pulse(duration = 0.32, ms = 45) {
    [this.input.xr.gamepads.left, this.input.xr.gamepads.right].forEach(pad => {
      const actuator = (pad as any)?.gamepad?.hapticActuators?.[0];
      actuator?.pulse?.(duration, ms);
    });
  }

  private async complete(entity: Entity) {
    if (entity.getValue(PaperTask, 'completed')) return;
    entity.setValue(PaperTask, 'completed', true);
    const id = String(entity.getValue(PaperTask, 'taskId'));
    const task = this.tasks.get(id);
    try {
      if (task?.starter || String(id).startsWith('demo-') || String(id).startsWith('starter-')) {
        emit('status', 'DONE! Task finished');
        this.finishTask(entity, id, task, true);
        return;
      }
      const response = await fetch(`/api/tasks/${encodeURIComponent(String(id))}/done`, { method: 'POST' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      emit('status', result.synced ? 'DONE! Saved to Notion' : 'DONE! Sync queued for retry');
      this.finishTask(entity, id, task, !!result.synced);
    } catch (error) {
      entity.setValue(PaperTask, 'completed', false);
      emit('status', `Write-back failed: ${(error as Error).message}`);
      revealAudio.playStreamCue(false);
    }
  }

  private finishTask(entity: Entity, id: string, task: Task | undefined, synced: boolean) {
    emit('task-done', { id, title: task?.title ?? 'Task', source: task?.source, synced });
    this.tasks.delete(id);
    emit('tasks-updated', { tasks: [...this.tasks.values()], offline: false });
    const progress = loadProgress();
    addCompletion(progress);
    emit('progress-updated', progress);
    this.previous.delete(entity.index);
    this.motion.delete(entity.index);
    entity.dispose();
    revealAudio.playTrash({ x: this.trash.x, y: this.trash.y, z: this.trash.z });
    revealAudio.playTaskDone({ x: this.trash.x, y: this.trash.y, z: this.trash.z });
    this.pulse(0.45, 55);
  }

  update() {
    if (this.queries.held.entities.size && (this.input.xr.gamepads.left?.getButtonDown(InputComponent.Trigger) || this.input.xr.gamepads.right?.getButtonDown(InputComponent.Trigger))) {
      this.crumple(this.queries.held.entities.values().next().value!);
    }
    for (const entity of this.queries.papers.entities) {
      entity.object3D?.getWorldPosition(this.position);
      const last = this.previous.get(entity.index);
      if (this.queries.held.entities.has(entity)) {
        const history = this.motion.get(entity.index);
        if (history) {
          const offset = history.next * 4;
          history.samples[offset] = this.position.x; history.samples[offset + 1] = this.position.y; history.samples[offset + 2] = this.position.z; history.samples[offset + 3] = performance.now();
          history.next = (history.next + 1) % 5; history.count = Math.min(5, history.count + 1);
        }
      } else if (entity.getValue(PaperTask, 'state') === 'crumpled' && !entity.getValue(PaperTask, 'completed') && last) {
        const dx = this.position.x - last.x, dy = this.position.y - last.y, dz = this.position.z - last.z;
        const length2 = dx * dx + dy * dy + dz * dz;
        const t = Math.max(0, Math.min(1, length2 ? ((this.trash.x - last.x) * dx + (this.trash.y - last.y) * dy + (this.trash.z - last.z) * dz) / length2 : 0));
        const x = last.x + t * dx - this.trash.x, y = last.y + t * dy - this.trash.y, z = last.z + t * dz - this.trash.z;
        if (x * x + y * y + z * z < 0.032 && this.position.y < this.trash.y + 0.28 && this.position.y > this.trash.y - 0.22) void this.complete(entity);
      }
      last?.copy(this.position);
    }
  }
}
