import { Box3, BoxGeometry, CanvasTexture, createSystem, Grabbed, GrabSystem, Group, IcosahedronGeometry, InputComponent, Mesh, MeshBasicMaterial, OneHandGrabbable, PhysicsBody, PhysicsManipulation, PhysicsShape, PhysicsShapeType, PhysicsState, PhysicsSystem, Quaternion, RayInteractable, Sphere, SRGBColorSpace, VisibilityState, Vector3 } from '@iwsdk/core';
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
import { showComicWord } from '../comic-word.js';
import { outlineBounds, pointInPolygon } from '../room-model.js';
import { apiUrl } from '../backend.js';

type Task = { id: string; title: string; priority?: string | null; due?: string | null; source?: string; starter?: boolean };
type Hand = 'left' | 'right';
type HandPose = { point: Vector3; rotation: Quaternion; tracked: boolean };
type HandHold = { side: Hand; offset: Vector3; rotationOffset: Quaternion; position: Vector3; rotation: Quaternion };
const hands = ['left', 'right'] as const;
const newHandPose = (): HandPose => ({ point: new Vector3(), rotation: new Quaternion(), tracked: false });
const ink = '#161922';
const paperLimit = 25;
const paperWidth = 0.22;
const paperDepth = 0.28;
const crumpleReach = 0.08;
const crumpledRadius = 0.045;
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
  c.fillStyle = ink; c.font = 'bold 18px sans-serif';
  c.fillText('CRUMPLE: PINCH WITH FREE HAND OR PRESS TRIGGER', 42, 486, 426);
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
  private trashContacts = new Set<number>();
  private motion = new Map<number, { samples: Float32Array; next: number; count: number }>();
  private trash = new Vector3(roomConfig.trash[0], 0.55, roomConfig.trash[2]);
  private position = new Vector3();
  private crumpleTip = new Vector3();
  private paperRotation = new Quaternion();
  private up = new Vector3(0, 1, 0);
  private handPoses = { left: newHandPose(), right: newHandPose() };
  private handHolds = new Map<number, HandHold>();
  private handOriginRotation = new Quaternion();
  private grabGeometry = new BoxGeometry(paperWidth + 0.05, 0.09, paperDepth + 0.05);
  private grabMaterial = new MeshBasicMaterial({ visible: false });
  private loaded = false;
  private loading = false;
  private crumpledTemplate?: Group;
  private paperLoader = new GLTFLoader();
  private paperShell = new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
  private tasks = new Map<string, Task>();
  private taskLoadGeneration = 0;
  private roomHidden = false;
  private highlightingZone = false;

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
      this.started = false; this.loaded = false; this.loading = false;
      this.taskLoadGeneration++;
      for (const entity of this.queries.papers.entities) {
        this.disposePaper(entity);
      }
      this.previous.clear(); this.trashContacts.clear(); this.motion.clear(); this.handHolds.clear(); this.tasks.clear();
    };
    const onRoomHidden = () => { this.roomHidden = true; for (const entity of this.queries.papers.entities) entity.object3D?.visible && (entity.object3D.visible = false); };
    const onRoomShown = () => { this.roomHidden = false; for (const entity of this.queries.papers.entities) entity.object3D && (entity.object3D.visible = true); };
    const onBoardDone = (event: Event) => {
      const { id } = (event as CustomEvent<{ id: string }>).detail;
      if (this.roomHidden || !loadProgress().pinned.includes(id)) return;
      const paper = [...this.queries.papers.entities].find(entity =>
        entity.getValue(PaperTask, 'taskId') === id && entity.getValue(PaperTask, 'state') === 'pinned');
      if (paper) void this.complete(paper, true);
    };
    garageEvents.addEventListener('garage-revealed', onRevealed);
    garageEvents.addEventListener('garage-reset', onReset);
    garageEvents.addEventListener('task-created', onCreated);
    garageEvents.addEventListener('room-hidden', onRoomHidden);
    garageEvents.addEventListener('room-shown', onRoomShown);
    garageEvents.addEventListener('pinned-task-done', onBoardDone);
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
    this.cleanupFuncs.push(() => garageEvents.removeEventListener('pinned-task-done', onBoardDone));
    this.cleanupFuncs.push(this.world.onXRFrame(frame => {
      try { this.sampleHands(frame); } catch { /* hand tracking is optional */ }
    }));
    this.cleanupFuncs.push(() => { this.paperShell.dispose(); this.grabGeometry.dispose(); this.grabMaterial.dispose(); });
    this.cleanupFuncs.push(this.world.visibilityState.subscribe(state => {
      if (state === VisibilityState.Visible && this.demo && !this.started) onRevealed();
      if (state === VisibilityState.NonImmersive && this.started) onReset();
    }));
    const onRelease = (entity: Entity) => {
      const wasHandHeld = this.handHolds.delete(entity.index);
      if (!entity.hasComponent(PaperTask) || !entity.hasComponent(PhysicsBody)) return;
      if (entity.getValue(PaperTask, 'state') === 'flat') {
        const board = garageState.placements.find(placement => placement.slotId === 'corkboard');
        entity.object3D?.getWorldPosition(this.position);
        if (board && Math.hypot(this.position.x - board.position.x, this.position.y - board.position.y, this.position.z - board.position.z) < 0.65) {
          const id = String(entity.getValue(PaperTask, 'taskId'));
          const progress = loadProgress();
          const previousPins = [...progress.pinned];
          setPinned(progress, [id, ...progress.pinned.filter(item => item !== id)]);
          const evicted = previousPins.find(item => !progress.pinned.includes(item));
          if (evicted) {
            const oldest = [...this.queries.papers.entities].find(other =>
              other.getValue(PaperTask, 'taskId') === evicted && other.getValue(PaperTask, 'state') === 'pinned');
            if (oldest && !oldest.getValue(PaperTask, 'completed')) {
              oldest.setValue(PaperTask, 'state', 'flat');
              oldest.setValue(PhysicsBody, 'state', PhysicsState.Dynamic);
              this.recoverPaper(oldest, garageState.room?.floor.y ?? 0);
            }
          }
          const wall = garageState.room?.walls.find(item => item.id === board.wallId);
          const normal = wall?.normal ?? { x: 0, z: 1 };
          const position = { x: board.position.x + normal.x * 0.06, y: board.position.y, z: board.position.z + normal.z * 0.06 };
          const quaternion = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(normal.x, 0, normal.z));
          entity.setValue(PaperTask, 'state', 'pinned');
          entity.setValue(PhysicsBody, 'state', PhysicsState.Static);
          entity.object3D?.position.set(position.x, position.y, position.z);
          entity.object3D?.quaternion.copy(quaternion);
          this.world.getSystem(PhysicsSystem)?.setBodyTransform(entity, {
            position: [position.x, position.y, position.z],
            quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
          });
          emit('progress-updated', progress);
          emit('status', 'Pinned to Today / Top 3');
          revealAudio.playGameplay('paper_pin', position);
          showComicWord('TIK!', position);
          return;
        }
      }
      const current = entity.getVectorView(PhysicsBody, '_linearVelocity');
      let speed = Math.hypot(current[0], current[1], current[2]);
      const samples = this.motion.get(entity.index);
      if (samples && samples.count >= 2 && (wasHandHeld || speed < 0.5)) {
        const newest = ((samples.next + 4) % 5) * 4;
        const oldest = (samples.count === 5 ? samples.next : 0) * 4;
        const dt = (samples.samples[newest + 3] - samples.samples[oldest + 3]) / 1000;
        if (dt >= 0.01) {
          const axis = (offset: number) => Math.max(-8, Math.min(8, (samples.samples[newest + offset] - samples.samples[oldest + offset]) / dt));
          const velocity: [number, number, number] = [axis(0), axis(1), axis(2)];
          speed = Math.hypot(...velocity);
          if (wasHandHeld) {
            entity.addComponent(PhysicsManipulation, {
              linearVelocity: speed > 0.20 ? velocity : [0, 0, 0],
              angularVelocity: [0, 0, 0],
            });
          } else if (speed > 0.5) entity.addComponent(PhysicsManipulation, { linearVelocity: velocity });
        }
      }
      if (speed > 0.5 && entity.object3D) {
        const position = entity.object3D.getWorldPosition(this.position);
        revealAudio.playPaperThrow(position, speed);
        showComicWord('FWHIP!', position);
      }
      if (samples) samples.count = 0;
    };
    this.cleanupFuncs.push(this.queries.held.subscribe('disqualify', onRelease));
    this.cleanupFuncs.push(this.queries.held.subscribe('qualify', entity => {
      this.trashContacts.delete(entity.index);
      const samples = this.motion.get(entity.index);
      if (samples) samples.count = 0;
      const position = entity.object3D?.getWorldPosition(this.position);
      revealAudio.playPaperGrab(position);
      if (position) showComicWord('FWIP!', position);
    }));
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
    const generation = this.taskLoadGeneration;
    this.loading = true;
    try {
      const [response] = await Promise.all([
        fetch(apiUrl('/api/tasks')),
        document.fonts.load('bold 42px GarageDisplay'),
        document.fonts.load('bold 42px GarageCJK'),
      ]);
      if (!response.ok) throw new Error(`Tasks HTTP ${response.status}`);
      const result = await response.json() as { tasks: Task[]; offline: boolean; message?: string; notion?: { configured?: boolean } };
      if (generation !== this.taskLoadGeneration) return;
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
        if (generation === this.taskLoadGeneration && this.queries.papers.entities.size < paperLimit) this.spawn(task, index);
      }, index * 60));
      if (tasks.length > paperLimit) emit('status', `${paperLimit} papers, +${tasks.length - paperLimit} more`);
    } catch (error) {
      if (generation === this.taskLoadGeneration) emit('status', `Tasks unavailable: ${(error as Error).message}`);
    } finally {
      if (generation === this.taskLoadGeneration) this.loading = false;
    }
  }

  private spawn(task: Task, index: number) {
    const texture = paperTexture(task);
    const zone = this.paperZone();
    const room = garageState.room;
    const top = room?.table?.topY ?? 0.75;
    const yaw = room?.table ? outlineBounds(room.table.polygon).yaw : 0;
    const edge = new MeshBasicMaterial({ color: 0xf0dfbd });
    const face = new MeshBasicMaterial({ map: texture });
    const mesh = new Mesh(new BoxGeometry(paperWidth, 0.008, paperDepth), [edge, edge, face, edge, edge, edge]);
    mesh.name = `Paper ${task.title}`;
    mesh.position.set(
      zone.x + ((index % 5) - 2) * 0.018,
      top + 0.012 + index * 0.009,
      zone.z + ((index % 3) - 1) * 0.016,
    );
    mesh.rotation.y = yaw + (index % 7 - 3) * 0.045;
    mesh.userData.paperTexture = texture;
    mesh.userData.flatMaterial = mesh.material;
    mesh.userData.paperMaterials = [edge, face];
    const grabTarget = new Mesh(this.grabGeometry, this.grabMaterial);
    grabTarget.name = 'Paper grip target';
    mesh.userData.grabTarget = grabTarget;
    mesh.add(grabTarget);
    const entity = this.world.createTransformEntity(mesh);
    entity.addComponent(PaperTask, { taskId: task.id, state: 'flat', completed: false });
    entity.addComponent(RayInteractable, {});
    entity.addComponent(OneHandGrabbable, {});
    entity.addComponent(PhysicsShape, { shape: PhysicsShapeType.Box, dimensions: [paperWidth, 0.008, paperDepth], density: 0.25, friction: 0.8 });
    entity.addComponent(PhysicsBody, { state: PhysicsState.Dynamic, linearDamping: 0.12, angularDamping: 0.2 });
    this.previous.set(entity.index, mesh.position.clone());
    this.motion.set(entity.index, { samples: new Float32Array(20), next: 0, count: 0 });
    mesh.visible = !this.roomHidden;
    const pinned = loadProgress().pinned.includes(task.id);
    const board = pinned ? garageState.placements.find(placement => placement.slotId === 'corkboard') : null;
    if (board) {
      const wall = garageState.room?.walls.find(item => item.id === board.wallId);
      const normal = wall?.normal ?? { x: 0, z: 1 };
      const quaternion = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(normal.x, 0, normal.z));
      mesh.position.set(board.position.x + normal.x * 0.06, board.position.y, board.position.z + normal.z * 0.06);
      mesh.quaternion.copy(quaternion);
      entity.setValue(PaperTask, 'state', 'pinned');
      entity.setValue(PhysicsBody, 'state', PhysicsState.Static);
      this.world.getSystem(PhysicsSystem)?.setBodyTransform(entity, {
        position: [mesh.position.x, mesh.position.y, mesh.position.z],
        quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
      });
    }
  }

  private crumple(entity: Entity, handInput = true) {
    if (entity.getValue(PaperTask, 'state') !== 'flat' || entity.getValue(PaperTask, 'completed')) return;
    const mesh = entity.object3D as Mesh;
    try {
      // Keep the original paper geometry, texture and physics body alive.
      // Disposing or replacing a live mesh while it is grabbed can take down
      // Quest Browser; the crumpled model is added as a child instead.
      const visual = new Group();
      visual.name = 'Crumpled paper visual';
      if (this.crumpledTemplate) {
        try {
          const model = this.crumpledTemplate.clone(true);
          const bounds = new Box3().setFromObject(model).getBoundingSphere(new Sphere());
          if (bounds.radius > 0) {
            const scale = crumpledRadius / bounds.radius;
            model.scale.multiplyScalar(scale);
            model.position.sub(bounds.center).multiplyScalar(scale);
            visual.add(model);
          }
        } catch (error) {
          console.warn('Crumpled paper model clone failed, using procedural sphere', error);
        }
      }
      if (!visual.children.length) {
        const geometry = new IcosahedronGeometry(crumpledRadius, 1);
        const material = new MeshBasicMaterial({ color: 0xf4dfbb });
        const ball = new Mesh(geometry, material);
        ball.name = 'Crumpled paper fallback';
        visual.add(ball);
        mesh.userData.crumpledDisposables = [geometry, material];
      }
      mesh.material = this.paperShell;
      mesh.userData.grabTarget.scale.set(0.6, 1.3, 0.5);
      mesh.add(visual);
      mesh.userData.crumpledVisual = visual;
      entity.setValue(PaperTask, 'state', 'crumpled');
      emit('status', handInput ? 'CRUNCH! Toss it, or pinch again to unfold.' : 'CRUNCH! Toss it, or press the trigger again to unfold.');
      emit('paper-crumpled', { id: entity.getValue(PaperTask, 'taskId') });
      const position = mesh.getWorldPosition(this.position);
      revealAudio.playPaperCrumple(position);
      showComicWord('KRRUNCH!', position);
      this.pulse(0.32, 45);
    } catch (error) {
      console.warn('Paper crumple failed', error);
      emit('status', 'Paper crumple failed; try again');
    }
  }

  private togglePaper(entity: Entity, handInput: boolean) {
    const state = entity.getValue(PaperTask, 'state');
    if (state === 'flat') {
      this.crumple(entity, handInput);
    } else if (state === 'crumpled' && !entity.getValue(PaperTask, 'completed')) {
      const mesh = entity.object3D as Mesh;
      this.removeCrumpledVisual(mesh);
      mesh.material = mesh.userData.flatMaterial;
      mesh.userData.grabTarget.scale.setScalar(1);
      entity.setValue(PaperTask, 'state', 'flat');
      this.trashContacts.delete(entity.index);
      const position = mesh.getWorldPosition(this.position);
      this.previous.get(entity.index)?.copy(position);
      emit('status', 'Paper unfolded');
      revealAudio.playPaperGrab(position);
    }
  }

  private removeCrumpledVisual(mesh?: Mesh) {
    if (!mesh) return;
    mesh.userData.crumpledVisual?.removeFromParent();
    const disposables = mesh.userData.crumpledDisposables as Array<{ dispose: () => void }> | undefined;
    disposables?.forEach(disposable => disposable.dispose());
    delete mesh.userData.crumpledVisual;
    delete mesh.userData.crumpledDisposables;
  }

  private disposePaper(entity: Entity) {
    const mesh = entity.object3D as Mesh | undefined;
    mesh?.userData.paperTexture?.dispose?.();
    mesh?.geometry?.dispose?.();
    const materials = mesh?.userData.paperMaterials as Array<{ dispose?: () => void }> | undefined;
    materials?.forEach(material => material.dispose?.());
    this.removeCrumpledVisual(mesh);
    entity.dispose();
  }

  private pulse(duration = 0.32, ms = 45) {
    [this.input.xr.gamepads.left, this.input.xr.gamepads.right].forEach(pad => {
      const actuator = (pad as any)?.gamepad?.hapticActuators?.[0];
      try {
        const result = actuator?.pulse?.(duration, ms);
        result?.catch?.(() => { /* haptics are optional */ });
      } catch { /* haptics are optional */ }
    });
  }

  private async complete(entity: Entity, fromBoard = false) {
    if (entity.getValue(PaperTask, 'completed')) return;
    entity.setValue(PaperTask, 'completed', true);
    const id = String(entity.getValue(PaperTask, 'taskId'));
    const task = this.tasks.get(id);
    const generation = this.taskLoadGeneration;
    const location = fromBoard ? entity.object3D?.getWorldPosition(new Vector3()) : this.trash;
    if (fromBoard) emit('pinned-task-pending', { id, pending: true });
    try {
      if (task?.starter || String(id).startsWith('demo-') || String(id).startsWith('starter-')) {
        emit('status', 'DONE! Task finished');
        this.finishTask(entity, id, task, true, location);
        return;
      }
      const response = await fetch(apiUrl(`/api/tasks/${encodeURIComponent(String(id))}/done`), { method: 'POST' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json();
      if (generation !== this.taskLoadGeneration) return;
      emit('status', result.synced ? 'DONE! Saved to Notion' : 'DONE! Sync queued for retry');
      this.finishTask(entity, id, task, !!result.synced, location);
    } catch (error) {
      if (generation !== this.taskLoadGeneration) return;
      entity.setValue(PaperTask, 'completed', false);
      emit('status', `Write-back failed: ${(error as Error).message}`);
      if (!this.roomHidden && this.world.session) revealAudio.playGameplay('ui_action_blocked', location);
      showComicWord('TOK.');
    } finally {
      if (fromBoard) emit('pinned-task-pending', { id, pending: false });
    }
  }

  private finishTask(entity: Entity, id: string, task: Task | undefined, synced: boolean, location?: Vector3) {
    const progress = loadProgress();
    progress.pinned = progress.pinned.filter(item => item !== id);
    addCompletion(progress);
    emit('task-done', { id, title: task?.title ?? 'Task', source: task?.source, synced });
    this.tasks.delete(id);
    emit('tasks-updated', { tasks: [...this.tasks.values()], offline: false });
    emit('progress-updated', progress);
    this.previous.delete(entity.index);
    this.trashContacts.delete(entity.index);
    this.motion.delete(entity.index);
    this.handHolds.delete(entity.index);
    this.disposePaper(entity);
    if (!this.roomHidden && this.world.session) revealAudio.playTaskDone(location ?? this.trash);
    showComicWord('KA-CHAK!');
    this.pulse(0.45, 55);
  }

  private recoverPaper(entity: Entity, floorY: number) {
    const room = garageState.room;
    const zone = this.paperZone();
    const destination = room && !room.table && !pointInPolygon(zone, room.floor.polygon) ? room.seat : zone;
    this.position.set(destination.x, (room?.table?.topY ?? (this.demo ? 0.9 : floorY)) + 0.12, destination.z);
    this.paperRotation.setFromAxisAngle(this.up, room?.table ? outlineBounds(room.table.polygon).yaw : 0);
    const physics = this.world.getSystem(PhysicsSystem);
    physics?.setBodyTransform(entity, { position: this.position, quaternion: this.paperRotation });
    this.previous.get(entity.index)?.copy(this.position);
    this.trashContacts.delete(entity.index);
  }

  private keepCrumpledVisualAboveSurface(mesh: Mesh, held: boolean, floorY: number) {
    const visual = mesh.userData.crumpledVisual as Group | undefined;
    if (!visual) return;
    let surface = floorY;
    const table = garageState.room?.table;
    if (table && Math.abs(this.position.y - table.topY) < crumpledRadius && pointInPolygon(this.position, table.polygon)) {
      surface = table.topY;
    }
    const lift = held ? 0 : Math.max(0, surface + crumpledRadius + 0.003 - this.position.y);
    visual.position.set(0, lift, 0);
    if (lift) visual.position.applyQuaternion(mesh.getWorldQuaternion(this.paperRotation).invert());
  }

  private sampleHands(frame: XRFrame) {
    const xr = this.input.xr;
    const space = this.world.renderer.xr.getReferenceSpace();
    xr.xrOrigin.getWorldQuaternion(this.handOriginRotation);
    for (const side of hands) {
      const pose = this.handPoses[side];
      const hand = xr.getPrimaryInputSource(side)?.hand;
      const wrist = hand?.get('wrist');
      const index = hand?.get('index-finger-tip');
      const thumb = hand?.get('thumb-tip');
      const wristPose = wrist && space && frame.getJointPose?.(wrist, space);
      const indexPose = index && space && frame.getJointPose?.(index, space);
      const thumbPose = thumb && space && frame.getJointPose?.(thumb, space);
      pose.tracked = !!(wristPose && indexPose && thumbPose);
      if (!wristPose || !indexPose || !thumbPose) continue;
      const a = indexPose.transform.position, b = thumbPose.transform.position;
      const q = wristPose.transform.orientation;
      pose.point.set((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
      xr.xrOrigin.localToWorld(pose.point);
      pose.rotation.set(q.x, q.y, q.z, q.w).premultiply(this.handOriginRotation);
    }
  }

  private stabilizeHandHold(entity: Entity, mesh: Mesh, side: Hand, delta: number) {
    const pose = this.handPoses[side];
    let hold = this.handHolds.get(entity.index);
    if (!hold || hold.side !== side) {
      if (!pose.tracked) return;
      const inverse = pose.rotation.clone().invert();
      hold = {
        side, offset: mesh.position.clone().sub(pose.point).applyQuaternion(inverse),
        rotationOffset: inverse.multiply(mesh.quaternion),
        position: mesh.position.clone(), rotation: mesh.quaternion.clone(),
      };
      this.handHolds.set(entity.index, hold);
    }
    if (pose.tracked) {
      const alpha = 1 - Math.exp(-Math.min(delta, 0.05) * 27);
      hold.position.lerp(this.crumpleTip.copy(hold.offset).applyQuaternion(pose.rotation).add(pose.point), alpha);
      hold.rotation.slerp(this.paperRotation.copy(pose.rotation).multiply(hold.rotationOffset), alpha);
    }
    mesh.position.copy(hold.position);
    mesh.quaternion.copy(hold.rotation);
    mesh.updateMatrixWorld(true);
  }

  update(delta: number) {
    const held = this.queries.held.entities;
    const xr = this.input.xr;
    const grab = this.world.getSystem(GrabSystem);
    if (held.size && !xr.getSelectState('left').active && !xr.getSelectState('right').active) {
      // A two-hand edit can leave the original hand's grab captured after its
      // pinch ends. Return the paper to physics once both hands are open.
      for (const entity of [...held]) {
        const holder = grab?.getHolderHand(entity);
        if (holder && xr.isPrimary('hand', holder)) grab?.forceRelease(entity);
      }
    }
    if (!this.roomHidden && held.size) {
      const triggerSide = (['left', 'right'] as const).find(side =>
        xr.isPrimary('controller', side) && xr.gamepads[side]?.getButtonDown(InputComponent.Trigger));
      if (triggerSide) {
        const paper = [...held].find(entity => grab?.getHolderHand(entity) === triggerSide)
          ?? (held.size === 1 ? held.values().next().value : undefined);
        if (paper) this.togglePaper(paper, false);
      } else if (xr.isPrimary('hand', 'left') && xr.isPrimary('hand', 'right')) {
        for (const entity of held) {
          const state = entity.getValue(PaperTask, 'state');
          if (state === 'pinned' || !entity.object3D) continue;
          const holder = grab?.getHolderHand(entity);
          if (!holder || !xr.getSelectState(holder).active) continue;
          const freeHand = holder === 'left' ? 'right' : 'left';
          if (!xr.getSelectState(freeHand).start) continue;
          xr.xrOrigin.indexTipSpaces[freeHand].getWorldPosition(this.crumpleTip);
          const tip = entity.object3D.worldToLocal(this.crumpleTip);
          if (Math.abs(tip.x) <= paperWidth / 2 + crumpleReach
            && Math.abs(tip.y) <= crumpleReach
            && Math.abs(tip.z) <= paperDepth / 2 + crumpleReach) {
            this.togglePaper(entity, true);
          }
        }
      }
    }
    const zone = this.queries.held.entities.size && !this.roomHidden
      ? garageState.placements.find(item => item.slotId === 'paper-zone') : undefined;
    const tabletop = garageState.room?.table;
    const floorY = garageState.room?.floor.y ?? 0;
    let highlightZone = false;
    for (const entity of this.queries.papers.entities) {
      const mesh = entity.object3D as Mesh | undefined;
      if (!mesh) continue;
      const isHeld = held.has(entity);
      const holder = isHeld && grab?.getHolderHand(entity);
      if (holder && xr.isPrimary('hand', holder)) this.stabilizeHandHold(entity, mesh, holder, delta);
      mesh.getWorldPosition(this.position);
      const last = this.previous.get(entity.index);
      if (!isHeld && !entity.getValue(PaperTask, 'completed') && this.position.y < floorY - 0.25) {
        this.recoverPaper(entity, floorY);
        continue;
      }
      this.keepCrumpledVisualAboveSurface(mesh, isHeld, floorY);
      if (isHeld) {
        if (zone && tabletop && entity.getValue(PaperTask, 'state') === 'flat') {
          const dx = this.position.x - zone.position.x, dz = this.position.z - zone.position.z;
          const cos = Math.cos(zone.yaw), sin = Math.sin(zone.yaw);
          const aboveTable = this.position.y - tabletop.topY;
          highlightZone ||= aboveTable >= -0.025 && aboveTable < 0.33
            && Math.abs(dx * cos - dz * sin) < zone.footprint.width * zone.scale / 2 + 0.1
            && Math.abs(dx * sin + dz * cos) < zone.footprint.depth * zone.scale / 2 + 0.1;
        }
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
        const hit = x * x + y * y + z * z < 0.032 && this.position.y < this.trash.y + 0.28 && this.position.y > this.trash.y - 0.22;
        if (hit) {
          if (!this.trashContacts.has(entity.index)) {
            this.trashContacts.add(entity.index);
            revealAudio.playTrash(this.trash);
            showComicWord('P’LUNK!', { x: this.trash.x, y: this.trash.y + 0.36, z: this.trash.z });
            void this.complete(entity);
          }
        } else {
          this.trashContacts.delete(entity.index);
        }
      }
      last?.copy(this.position);
    }
    if (highlightZone !== this.highlightingZone) {
      this.highlightingZone = highlightZone;
      emit('paper-zone-highlight', highlightZone);
    }
  }
}
