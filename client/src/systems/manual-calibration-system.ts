import {
  BufferGeometry, CanvasTexture, createSystem, Group, Line, LineBasicMaterial, loadUIKitMLAsset, Mesh,
  MeshBasicMaterial, PokeInteractable, Quaternion, Ray, RayInteractable, RingGeometry, Sprite, SpriteMaterial, SRGBColorSpace,
  Vector3, VisibilityState,
} from '@iwsdk/core';
import type { UIKitMLAsset } from '@iwsdk/core';
import { emit, garageEvents } from '../events.js';
import { garageState } from '../garage-state.js';
import { makeManualRoom, manualRoomStorageKey, polygonArea, validateCalibrationCorners, withMarkedTable, type Vec3 } from '../room-model.js';
import { revealAudio } from '../reveal/RevealAudio.js';
import { showComicWord } from '../comic-word.js';
import { GarageBuildSystem } from './garage-build-system.js';
import { bindPress, clearUiInput, PanelInput, sendPanelToFront } from '../ui-press.js';
import { pulseGamepads } from '../feedback.js';

type Phase = 'idle' | 'floor' | 'table' | 'done';
type Mode = 'room' | 'table';

export class ManualCalibrationSystem extends createSystem({}) {
  private phase: Phase = 'idle';
  private mode: Mode = 'room';
  private floorPoints: Vec3[] = [];
  private tablePoints: Vec3[] = [];
  private seat: Vec3 = { x: 0, y: 0, z: 0 };
  private latestHead: Vec3 = { x: 0, y: 1.2, z: 0 };
  private root = new Group();
  private markers = new Group();
  private panel?: UIKitMLAsset;
  private panelNeedsPlacement = false;
  private builder?: GarageBuildSystem;
  private lastPressed = new WeakMap<XRInputSource, boolean>();
  private acceptAfter = 0;
  private nextPointAt = 0;
  private issue = '';
  private cursor = new Mesh(new RingGeometry(0.009, 0.014, 24), new MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, transparent: true }));
  private lineMaterial = new LineBasicMaterial({ color: 0x8ef5ef, depthTest: false, depthWrite: false, transparent: true, opacity: 0.95 });
  private stamps: SpriteMaterial[] = [];
  private ray = new Ray();
  private panelInput?: PanelInput;
  private tip = new Vector3();
  private rayRotation = new Quaternion();

  init() {
    this.builder = this.world.getSystem(GarageBuildSystem) ?? undefined;
    this.root.name = 'Calibration corner markers';
    this.root.add(this.markers, this.cursor);
    this.cursor.rotation.x = -Math.PI / 2;
    this.cursor.renderOrder = 1600;
    this.root.visible = false;
    const entity = this.world.createTransformEntity(this.root, { persistent: true });
    this.stamps = [1, 2, 3, 4].map(number => this.createStamp(number));
    const start = (event: Event) => this.start((event as CustomEvent<{ mode?: Mode }>).detail?.mode ?? 'room');
    const undo = () => this.undo();
    const skip = () => this.skipTable();
    const cancel = () => this.end(false);
    garageEvents.addEventListener('room-manual-start', start);
    garageEvents.addEventListener('room-manual-undo', undo);
    garageEvents.addEventListener('room-manual-skip-table', skip);
    garageEvents.addEventListener('room-manual-cancel', cancel);
    const stopFrame = this.world.onXRFrame(frame => this.sampleController(frame));
    const stopVisibility = this.world.visibilityState.subscribe(state => {
      if (state === VisibilityState.NonImmersive && this.currentPoints()) this.end(false);
    });
    this.cleanupFuncs.push(() => {
      garageEvents.removeEventListener('room-manual-start', start);
      garageEvents.removeEventListener('room-manual-undo', undo);
      garageEvents.removeEventListener('room-manual-skip-table', skip);
      garageEvents.removeEventListener('room-manual-cancel', cancel);
      stopFrame();
      stopVisibility();
      this.clearMarkers();
      this.cursor.geometry.dispose();
      this.cursor.material.dispose();
      this.lineMaterial.dispose();
      this.stamps.forEach(stamp => { stamp.map?.dispose(); stamp.dispose(); });
      this.panel?.dispose();
      entity.destroy();
    });
    void this.createPanel().catch(error => emit('status', `Could not load corner marking: ${String(error)}`));
    if (location.hostname === 'localhost') {
      const system = this;
      (window as any).garageManualDebug = {
        start: (mode: Mode = 'room') => this.start(mode),
        addPoint: (x: number, y: number, z: number) => this.addPoint({ x, y, z }),
        use: () => this.useOutline(), undo, skipTable: skip, cancel: () => this.end(false),
        get phase() { return system.phase; },
        get panel() { return system.panel; },
        get pointCount() { return system.currentPoints()?.length ?? 0; },
      };
    }
  }

  private async createPanel() {
    const panel = await loadUIKitMLAsset('/ui/room-calibration.uikitml', { kit: 'horizon', preferredColorScheme: 'dark' });
    panel.name = 'Room calibration panel';
    panel.scale.setScalar(0.14);
    panel.visible = false;
    sendPanelToFront(panel);
    const entity = this.world.createTransformEntity(panel, { persistent: true });
    entity.addComponent(RayInteractable, {});
    entity.addComponent(PokeInteractable, {});
    this.panel = panel;
    this.panelInput = new PanelInput(panel, () => { this.acceptAfter = performance.now() + 180; });
    const on = (id: string, action: () => void) => bindPress(panel, id, () => {
      pulseGamepads(this.input.xr.gamepads, 0.3, 26);
      revealAudio.playPress(panel);
      action();
    });
    on('cal-use', () => this.useOutline());
    on('cal-undo', () => this.undo());
    on('cal-skip', () => this.skipTable());
    on('cal-cancel', () => this.end(false));
    this.refresh();
  }

  private start(mode: Mode) {
    if (mode === 'table' && (!garageState.room || !this.builder?.isRevealed())) return;
    this.mode = mode;
    this.phase = mode === 'table' ? 'table' : 'floor';
    this.floorPoints = [];
    this.tablePoints = [];
    this.issue = '';
    this.lastPressed = new WeakMap();
    this.acceptAfter = performance.now() + 400;
    this.nextPointAt = 0;
    this.panelNeedsPlacement = true;
    this.root.visible = true;
    this.cursor.visible = false;
    this.clearMarkers();
    void revealAudio.unlock().catch(() => { /* optional feedback */ });
    emit('room-manual-active', true);
    this.refresh();
  }

  private end(saved: boolean) {
    if (!this.currentPoints()) return;
    this.phase = saved ? 'done' : 'idle';
    this.clearMarkers();
    this.root.visible = false;
    if (this.panel) this.panel.visible = false;
    clearUiInput();
    emit('room-manual-active', false);
    emit('room-manual-ended', { mode: this.mode, saved });
  }

  private currentPoints() {
    if (this.phase === 'floor') return this.floorPoints;
    if (this.phase === 'table') return this.tablePoints;
    return null;
  }

  private sampleController(frame: XRFrame) {
    const space = this.world.renderer.xr.getReferenceSpace();
    if (!space || !this.world.session) return;
    const viewer = frame.getViewerPose(space);
    if (viewer) {
      const { x, y, z } = viewer.transform.position;
      this.latestHead = { x, y, z };
    }
    const points = this.currentPoints();
    this.cursor.visible = false;
    if (!points) return;
    if (this.panel && this.panelNeedsPlacement && viewer) {
      const { position, orientation } = viewer.transform;
      const forward = new Vector3(0, 0, -1).applyQuaternion(this.rayRotation.set(orientation.x, orientation.y, orientation.z, orientation.w));
      forward.y = 0;
      if (forward.lengthSq() < 0.01) forward.set(0, 0, -1);
      forward.normalize();
      const side = garageState.preferences.dominantHand === 'left' ? 1 : -1;
      this.panel.position.set(position.x, position.y - 0.05, position.z).addScaledVector(forward, 1.05)
        .addScaledVector(new Vector3(-forward.z, 0, forward.x), 0.34 * side);
      this.panel.lookAt(position.x, position.y, position.z);
      this.panel.updateMatrixWorld(true);
      this.panelNeedsPlacement = false;
      this.panel.visible = true;
    }
    if (points.length >= 4) return;
    const inputs = Array.from(this.world.session.inputSources).filter(source => source.targetRayMode === 'tracked-pointer');
    inputs.sort((a, b) => Number(b.handedness === garageState.preferences.dominantHand) - Number(a.handedness === garageState.preferences.dominantHand));
    for (const source of inputs) {
      const wasPressed = this.lastPressed.get(source);
      const side = source.handedness;
      const hand = source.hand && (side === 'left' || side === 'right') ? this.input.xr.visualAdapters.hand[side] : undefined;
      const select = (side === 'left' || side === 'right') && this.input.xr.getSelectState?.(side);
      const strength = Math.max(hand?.getPinchStrength?.() ?? 0, select && select.active ? 1 : 0);
      const pressed = source.hand ? strength > (wasPressed ? 0.45 : 0.78) : source.gamepad?.buttons[0]?.pressed ?? false;
      this.lastPressed.set(source, pressed);
      const rayPose = frame.getPose(source.targetRaySpace, space);
      const joint = source.hand?.get('index-finger-tip');
      const pose = source.hand ? joint && frame.getJointPose?.(joint, space) : rayPose;
      if (!pose || !rayPose) continue;
      const { x, y, z } = pose.transform.position;
      const { position, orientation } = rayPose.transform;
      this.tip.set(x, y, z);
      this.ray.origin.set(position.x, position.y, position.z);
      this.ray.direction.set(0, 0, -1).applyQuaternion(this.rayRotation.set(orientation.x, orientation.y, orientation.z, orientation.w));
      if (this.panelInput?.owns(this.ray, this.tip)) continue;
      if (!this.cursor.visible) {
        this.cursor.position.set(x, y + 0.004, z);
        this.cursor.visible = true;
      }
      if (!pressed || wasPressed !== false || performance.now() < this.acceptAfter || performance.now() < this.nextPointAt) continue;
      this.addPoint({ x, y, z }, true);
      break;
    }
  }

  private addPoint(point: Vec3, fromInput = false) {
    const points = this.currentPoints();
    if (!points || points.length >= 4) return;
    const now = performance.now();
    if (fromInput && now < this.nextPointAt) return;
    this.issue = '';
    points.push({ x: point.x, y: point.y, z: point.z });
    if (fromInput) this.nextPointAt = now + 420;
    if (fromInput) pulseGamepads(this.input.xr.gamepads, 0.3, 22);
    revealAudio.playTick(point);
    showComicWord('TUP.', point);
    this.rebuildMarkers();
    this.refresh();
  }

  private undo() {
    const points = this.currentPoints();
    if (!points?.length && this.phase === 'table' && this.mode === 'room') {
      this.phase = 'floor';
    } else points?.pop();
    this.issue = '';
    this.acceptAfter = performance.now() + 250;
    this.rebuildMarkers();
    this.refresh();
  }

  private useOutline() {
    const points = this.currentPoints();
    if (!points || points.length !== 4) return;
    try {
      if (this.phase === 'floor') {
        validateCalibrationCorners(points, 'floor');
        this.seat = { ...this.latestHead };
        this.phase = 'table';
        this.clearMarkers();
        this.acceptAfter = performance.now() + 250;
        this.issue = '';
        this.refresh();
        return;
      }
      if (this.mode === 'table' && garageState.room && this.builder?.isRevealed()) {
        const room = withMarkedTable(garageState.room, points);
        this.builder.setTableOutline(room.table!);
        if (room.source === 'manual') this.saveManualRoom(room);
        this.end(true);
      } else if (this.mode === 'room') {
        validateCalibrationCorners(points, 'table');
        this.saveFullRoom();
      }
    } catch (error) {
      this.issue = (error as Error).message;
      revealAudio.playGameplay('ui_action_blocked', this.panel?.getWorldPosition(new Vector3()));
      showComicWord('TOK.');
      this.refresh();
    }
  }

  private skipTable() {
    if (this.phase !== 'table' || this.mode !== 'room') return;
    this.tablePoints = [];
    this.saveFullRoom();
  }

  private saveFullRoom() {
    const room = makeManualRoom(this.floorPoints, this.tablePoints, this.seat);
    this.saveManualRoom(room);
    this.end(true);
    emit('room-measurements', `Floor area ${Math.round(polygonArea(room.floor.polygon) * 100) / 100} m²`);
    emit('room-manual-saved', room);
  }

  private saveManualRoom(room: ReturnType<typeof makeManualRoom>) {
    try { localStorage.setItem(manualRoomStorageKey, JSON.stringify(room)); } catch { /* private mode */ }
    if (location.hostname === 'localhost') (window as any).garageManualRoom = room;
  }

  private refresh() {
    const points = this.currentPoints();
    if (!this.panel || !points) return;
    const floor = this.phase === 'floor';
    const target = floor ? 'floor' : 'table';
    const count = points.length;
    const set = (id: string, props: object) => this.panel?.requireElementById(id).setProperties(props);
    set('cal-step', { text: this.mode === 'table' ? 'Table setup' : floor ? 'Step 1 of 2' : 'Step 2 of 2' });
    set('cal-count', { text: `${count} of 4 corners` });
    set('cal-title', { text: count === 4 ? `Check the ${target} outline` : `Mark the ${floor ? 'floor' : 'tabletop'}` });
    set('cal-instruction', { text: count === 4
      ? 'If the outline fits, continue. Undo the last corner to place it again.'
      : count === 0
        ? `Touch the first ${target} corner, then pull the trigger or pinch. Work around the edges in order.`
        : `Touch corner ${count + 1} along the next edge, then pull the trigger or pinch.` });
    set('cal-error', { display: this.issue ? 'flex' : 'none', text: this.issue });
    set('cal-use', { display: count === 4 ? 'flex' : 'none', text: floor ? 'Use floor outline' : 'Save table outline' });
    set('cal-undo', { display: count || (!floor && this.mode === 'room') ? 'flex' : 'none', text: count ? 'Undo last corner' : 'Back to floor' });
    set('cal-skip', { display: !floor && this.mode === 'room' ? 'flex' : 'none' });
    set('cal-cancel', { text: this.mode === 'room' ? 'Back to scan' : 'Cancel' });
    for (let i = 1; i <= 4; i++) set(`cal-progress-${i}`, { backgroundColor: i <= count ? '#b6e6d8' : '#524759' });
    emit('room-manual-progress', { phase: this.phase, floor: this.floorPoints.length, table: this.tablePoints.length });
    emit('room-measurements', `Floor ${this.floorPoints.length}/4  |  Table ${this.tablePoints.length}/4`);
  }

  private createStamp(number: number) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.beginPath();
    ctx.arc(64, 64, 50, 0, Math.PI * 2);
    ctx.fillStyle = '#25222d';
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#b6e6d8';
    ctx.stroke();
    ctx.font = '400 60px GarageComic, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff9ee';
    ctx.fillText(String(number), 64, 67);
    const map = new CanvasTexture(canvas);
    map.colorSpace = SRGBColorSpace;
    return new SpriteMaterial({ map, depthTest: false, depthWrite: false });
  }

  private clearMarkers() {
    for (const child of this.markers.children) if (child instanceof Line) child.geometry.dispose();
    this.markers.clear();
  }

  private rebuildMarkers() {
    this.clearMarkers();
    const points = this.currentPoints();
    if (!points) return;
    points.forEach((point, i) => {
      const stamp = new Sprite(this.stamps[i]);
      stamp.position.set(point.x, point.y + 0.035, point.z);
      stamp.scale.setScalar(0.075);
      stamp.renderOrder = 622;
      this.markers.add(stamp);
    });
    if (points.length < 2) return;
    const outline = points.length === 4 ? [...points, points[0]] : points;
    const geometry = new BufferGeometry().setFromPoints(outline.map(point => new Vector3(point.x, point.y + 0.012, point.z)));
    const line = new Line(geometry, this.lineMaterial);
    line.renderOrder = 620;
    this.markers.add(line);
  }
}
