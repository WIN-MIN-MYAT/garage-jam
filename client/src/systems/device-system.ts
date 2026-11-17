import {
  BoxGeometry, BufferGeometry, createSystem, DoubleSide, Group, Line, LineBasicMaterial, loadUIKitMLAsset,
  Mesh, MeshBasicMaterial, PlaneGeometry, PokeInteractable, Pressed, Quaternion, Ray, RayInteractable, RingGeometry, Vector3, VisibilityState,
  type Entity, type UIKitMLAsset,
} from '@iwsdk/core';
import { emit, garageEvents } from '../events.js';
import { createMonitorModel } from '../monitor-model.js';
import { garageState, setPreference } from '../garage-state.js';
import { garageRootsVisible } from '../garage-visibility.js';
import { outlineBounds, type Vec3 } from '../room-model.js';
import {
  clearDeviceCollection, deviceObstacles, extraVolume, keyboardVolume, loadDeviceCollection, makeExtra, makeLaptop, makeMonitor,
  minScreenDepth, minZoneHeight, saveDeviceCollection, screenDragCorners, screenVolume, type DeviceRecord, type DeviceTemplate, type DeviceVolume,
} from '../device-model.js';
import { revealAudio } from '../reveal/RevealAudio.js';
import { showComicWord } from '../comic-word.js';
import { bindPress, PanelInput, sendPanelToFront } from '../ui-press.js';
import { GarageBuildSystem } from './garage-build-system.js';

type Stage = 'screen' | 'deck' | 'keyboard' | 'extra';
type Diagonal = [Vec3, Vec3];
type Marking = {
  template: DeviceTemplate; stage: Stage; first?: Vec3; points?: Diagonal; screen?: Vec3[]; screenPoints?: Diagonal; screenYaw?: number; yaw: number; editId?: string;
  source?: XRInputSource; dragLast?: Vec3; dragMoved?: boolean;
};
type DeviceVisual = { device: DeviceRecord; occluder: Group; display: Group; outline: Group };
const templates: [string, DeviceTemplate][] = [
  ['laptop', 'laptop'], ['monitor', 'monitor'], ['desktop', 'monitor-keyboard'], ['extra', 'extra'],
];
const unitSquare = () => new BufferGeometry().setFromPoints([
  new Vector3(-0.5, -0.5, 0), new Vector3(0.5, -0.5, 0), new Vector3(0.5, 0.5, 0), new Vector3(-0.5, 0.5, 0), new Vector3(-0.5, -0.5, 0),
]);

export class DeviceSystem extends createSystem({}) {
  private builder?: GarageBuildSystem;
  private panel?: UIKitMLAsset;
  private panelEntity?: Entity;
  private panelInput?: PanelInput;
  private root = new Group();
  private preview = new Group();
  private cursor = new Mesh(new RingGeometry(0.009, 0.014, 24), new MeshBasicMaterial({ color: 0xe8ff70, depthTest: false, depthWrite: false, transparent: true, side: DoubleSide }));
  private firstMarker = new Mesh(new RingGeometry(0.006, 0.012, 24), this.cursor.material);
  private previewFill?: Mesh;
  private previewOutline?: Line;
  private previewScreen?: Line;
  private devices: DeviceRecord[] = [];
  private unverified = new Set<string>();
  private visuals: DeviceVisual[] = [];
  private marking?: Marking;
  private aimed = new WeakMap<XRInputSource, { point: Vec3; time: number }>();
  private hoverCorner?: Vec3;
  private down = new WeakMap<XRInputSource, boolean>();
  private loaded = false;
  private page = 0;
  private panelOpen = false;
  private issue = '';
  private acceptAfter = 0;
  private tableY?: number;
  private ray = new Ray();
  private rotation = new Quaternion();
  private tip = new Vector3();

  private occluder = new MeshBasicMaterial({ colorWrite: false, depthWrite: true, side: DoubleSide });
  private displayMat = new MeshBasicMaterial({ color: 0x111924, side: DoubleSide });
  private outlineMat = new LineBasicMaterial({ color: 0x8ef5ef, depthTest: false, depthWrite: false, transparent: true, opacity: 0.94 });
  private fill = new MeshBasicMaterial({ color: 0x8ef5ef, depthTest: false, depthWrite: false, transparent: true, opacity: 0.14, side: DoubleSide });

  init() {
    this.builder = this.world.getSystem(GarageBuildSystem) ?? undefined;
    this.root.name = 'Device cutout volumes';
    this.previewFill = new Mesh(new PlaneGeometry(1, 1), this.fill);
    this.previewFill.name = 'Device preview fill';
    this.previewFill.renderOrder = 219;
    this.previewFill.visible = false;
    this.previewOutline = new Line(unitSquare(), this.outlineMat);
    this.previewOutline.name = 'Device preview outline';
    this.previewOutline.renderOrder = 220;
    this.previewOutline.visible = false;
    this.previewScreen = new Line(unitSquare(), this.outlineMat);
    this.previewScreen.name = 'Device preview screen';
    this.previewScreen.renderOrder = 220;
    this.previewScreen.visible = false;
    this.preview.add(this.previewFill, this.previewOutline, this.previewScreen);
    this.root.add(this.preview, this.cursor, this.firstMarker);
    this.cursor.visible = false;
    this.cursor.renderOrder = 1600;
    this.firstMarker.visible = false;
    this.firstMarker.renderOrder = 1600;
    const entity = this.world.createTransformEntity(this.root, { persistent: true });
    const listeners: Record<string, (event: Event) => void> = {
      'device-marking-open': () => this.openPanel(),
      'device-marking-start': event => this.start((event as CustomEvent<{ template?: DeviceTemplate }>).detail?.template ?? 'laptop'),
      'device-marking-cancel': () => this.cancel(),
      'device-marking-done': () => this.done(),
      'garage-cutouts-changed': () => { this.applyVisibility(); this.refresh(); },
      'mode-changed': () => this.applyVisibility(),
      'room-manual-active': event => { if ((event as CustomEvent<boolean>).detail) this.closePanel(); },
      'table-confirm-visibility': event => { if ((event as CustomEvent<boolean>).detail) this.closePanel(); },
      'garage-reset': () => this.resetRoom(),
      'table-confirmed': () => this.rebaseHeight(),
      'garage-revealed': () => { if (this.activeObstacles().length) this.builder?.forceDeviceResolve(); },
    };
    for (const [name, listener] of Object.entries(listeners)) garageEvents.addEventListener(name, listener);
    const stop = this.world.onXRFrame(frame => this.onFrame(frame));
    const stopVisibility = this.world.visibilityState.subscribe(state => {
      if (state === VisibilityState.NonImmersive) this.closePanel();
    });
    this.cleanupFuncs.push(() => {
      for (const [name, listener] of Object.entries(listeners)) garageEvents.removeEventListener(name, listener);
      stop(); stopVisibility();
      for (const group of this.visuals.flatMap(v => [v.occluder, v.display, v.outline])) this.clearGroup(group);
      this.previewFill?.geometry.dispose();
      this.previewOutline?.geometry.dispose();
      this.previewScreen?.geometry.dispose();
      this.cursor.geometry.dispose();
      this.firstMarker.geometry.dispose();
      for (const mat of [this.cursor.material, this.occluder, this.displayMat, this.outlineMat, this.fill]) mat.dispose();
      this.panel?.dispose();
      entity.destroy();
    });
    void this.createPanel().catch(error => emit('status', `Device panel failed: ${String(error)}`));
    if (location.hostname === 'localhost') {
      const system = this;
      (window as any).garageDeviceDebug = {
        open: () => this.openPanel(),
        start: (template: DeviceTemplate = 'laptop') => this.start(template),
        mark: (point: Vec3) => this.markCorner(point),
        commit: () => this.commit(),
        skipKeyboard: () => this.skipSurface(),
        undo: () => this.undo(), cancel: () => this.cancel(), done: () => this.done(), clear: () => this.clearAll(),
        toggleDevice: (index: number) => this.toggleDevice(index),
        setCutouts: (value: boolean) => this.setCutouts(value),
        get obstacles() { return system.activeObstacles(); },
        get devices() { return system.devices; },
        get marking() { return system.marking ?? null; },
        get panel() { return system.panel; },
        get volumeCount() { return system.visuals.length; },
        get state() {
          return { loaded: system.loaded, fingerprintMatch: !system.unverified.size, cutouts: garageState.preferences.cutouts,
            visible: system.panelOpen, previewing: !!system.hoverCorner, issue: system.issue };
        },
      };
    }
  }

  private async createPanel() {
    const panel = await loadUIKitMLAsset('/ui/device-marking.uikitml', { kit: 'horizon', preferredColorScheme: 'dark' });
    panel.name = 'Device drawing panel';
    panel.scale.setScalar(0.10);
    panel.visible = false;
    sendPanelToFront(panel);
    this.panel = panel;
    this.panelInput = new PanelInput(panel, () => { this.acceptAfter = performance.now() + 180; });
    const entity = this.world.createTransformEntity(panel, { persistent: true });
    entity.addComponent(RayInteractable, {});
    entity.addComponent(PokeInteractable, {});
    this.panelEntity = entity;
    const on = (id: string, action: () => void) => bindPress(panel, id, () => { revealAudio.playPress(panel); action(); });
    for (const [name, template] of templates) on(`dev-template-${name}`, () => this.start(template));
    on('dev-use', () => this.commit());
    on('dev-skip-keyboard', () => this.skipSurface());
    on('dev-undo', () => this.undo());
    on('dev-cancel', () => this.cancel());
    on('dev-done', () => this.done());
    on('dev-angle-left', () => this.rotate(-1));
    on('dev-angle-right', () => this.rotate(1));
    on('dev-depth-down', () => this.adjustDepth(-0.005));
    on('dev-depth-up', () => this.adjustDepth(0.005));
    on('dev-remark', () => {
      const target = this.devices.find(device => this.unverified.has(device.id)) ?? this.devices[this.devices.length - 1];
      if (target) this.start(target.template, target.id);
    });
    on('dev-cutouts', () => this.setCutouts(!garageState.preferences.cutouts));
    on('dev-prev', () => { this.page--; this.refresh(); });
    on('dev-next', () => { this.page++; this.refresh(); });
    for (let i = 0; i < 4; i++) {
      on(`dev-toggle-${i + 1}`, () => this.toggleDevice(this.page * 4 + i));
      on(`dev-delete-${i + 1}`, () => this.deleteDevice(this.page * 4 + i));
    }
    this.refresh();
  }

  private openPanel() {
    if (!this.panel || this.panelOpen) return;
    this.panelOpen = true;
    this.panel.visible = true;
    const head = this.world.camera.getWorldPosition(new Vector3());
    const forward = this.world.camera.getWorldDirection(new Vector3());
    forward.y = 0;
    if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
    forward.normalize();
    const side = garageState.preferences.dominantHand === 'left' ? 1 : -1;
    this.panel.position.copy(head).addScaledVector(forward, 0.99).addScaledVector(new Vector3(-forward.z, 0, forward.x), side * 0.38);
    this.panel.position.y += 0.05;
    this.panel.lookAt(head);
    emit('device-marking-active', true);
    this.refresh();
  }

  private closePanel() {
    if (!this.panelOpen) return;
    this.panelOpen = false;
    this.marking = undefined;
    this.hoverCorner = undefined;
    if (this.panel) this.panel.visible = false;
    this.cursor.visible = false;
    this.firstMarker.visible = false;
    this.resetPreview();
    emit('device-marking-active', false);
  }

  private start(template: DeviceTemplate, editId?: string) {
    const room = garageState.room;
    if (!room) return;
    this.openPanel();
    if (template === 'extra' && !editId && this.devices.filter(device => device.template === 'extra').length >= 4) {
      this.issue = 'Remove an extra zone to draw another.';
      this.refresh();
      return;
    }
    const yaw = room.table ? outlineBounds(room.table.polygon).yaw : Math.atan2(-room.forward.x, -room.forward.z);
    this.hoverCorner = undefined;
    this.marking = { template, stage: template === 'extra' ? 'extra' : 'screen', yaw, editId };
    this.issue = '';
    this.acceptAfter = performance.now() + 300;
    this.rebuildPreview();
    this.refresh();
  }

  private cancel() {
    if (this.marking && this.panelOpen) {
      this.marking = undefined;
      this.hoverCorner = undefined;
      this.issue = '';
      this.resetPreview();
      this.firstMarker.visible = false;
      if (this.panel) this.panel.visible = true;
      this.refresh();
      return;
    }
    if (!this.panelOpen) return;
    this.closePanel();
    emit('device-marking-cancelled');
  }

  private done() {
    if (!this.panelOpen) return;
    this.closePanel();
    emit('device-marking-done', { count: this.devices.length });
  }

  private outline(points?: Diagonal) {
    const room = garageState.room;
    const marking = this.marking;
    if (!room || !marking || !points) return null;
    const y = room.table?.topY ?? room.floor.y;
    if (marking.stage === 'screen') {
      if (Math.abs(points[0].y - points[1].y) < 0.05) return null;
      return screenVolume(screenDragCorners(...points, marking.yaw), room.seat);
    }
    if (marking.stage === 'extra') return extraVolume(points, y, marking.yaw);
    return keyboardVolume(points, y, marking.yaw);
  }

  private markCorner(point: Vec3, source?: XRInputSource) {
    const marking = this.marking;
    if (!marking || marking.points || !garageState.room) return;
    const { x, y, z } = point;
    const corner = { x, y: marking.stage === 'screen' ? y : garageState.room.table?.topY ?? garageState.room.floor.y, z };
    this.hoverCorner = undefined;
    this.acceptAfter = performance.now() + 180;
    if (!marking.first) {
      marking.first = corner;
      // Keep every later corner on the hand/controller that started the mark.
      if (source) marking.source = source;
      marking.dragLast = corner;
      marking.dragMoved = false;
    } else if (this.outline([marking.first, corner])) {
      marking.points = [marking.first, corner];
      marking.dragLast = undefined;
      marking.dragMoved = false;
    } else {
      this.issue = 'Mark a diagonally opposite corner farther from the first.';
      this.rebuildPreview();
      this.refresh();
      return;
    }
    this.issue = '';
    revealAudio.playTick(corner);
    showComicWord('TUP.', corner);
    this.rebuildPreview();
    this.refresh();
  }

  private rotate(direction: number) {
    if (!this.marking) return;
    this.marking.yaw += direction * Math.PI / 36;
    this.rebuildPreview();
    this.refresh();
  }

  private undo() {
    const marking = this.marking;
    if (!marking) return;
    if (marking.points) marking.points = undefined;
    else if (marking.first) {
      marking.first = undefined;
      marking.source = undefined;
    } else if (marking.screenPoints) {
      marking.stage = 'screen';
      marking.points = marking.screenPoints;
      marking.first = marking.points[0];
      marking.yaw = marking.screenYaw ?? marking.yaw;
      marking.screen = undefined;
      marking.screenPoints = undefined;
    }
    marking.dragLast = undefined;
    marking.dragMoved = false;
    this.hoverCorner = undefined;
    this.acceptAfter = performance.now() + 250;
    this.issue = '';
    this.rebuildPreview();
    this.refresh();
  }

  private commit() {
    const marking = this.marking;
    const room = garageState.room;
    if (!room || !marking?.points || !this.outline(marking.points)) return;
    if (marking.stage === 'screen') {
      const screen = screenDragCorners(...marking.points, marking.yaw);
      if (marking.template === 'monitor') {
        const record = makeMonitor(screen, room, [], true);
        if (record) this.finishDevice(record);
      } else {
        marking.screen = screen;
        marking.screenPoints = marking.points;
        marking.screenYaw = marking.yaw;
        marking.stage = marking.template === 'laptop' ? 'deck' : 'keyboard';
        if (marking.stage === 'deck') marking.yaw = screenVolume(screen, room.seat)?.yaw ?? marking.yaw;
        if (marking.stage === 'keyboard' && room.table) marking.yaw = outlineBounds(room.table.polygon).yaw;
        marking.points = undefined;
        marking.first = undefined;
        this.hoverCorner = undefined;
        this.acceptAfter = performance.now() + 300;
        this.rebuildPreview();
        this.refresh();
      }
      return;
    }
    const record = marking.stage === 'extra' ? makeExtra(marking.points, room, marking.yaw)
      : marking.stage === 'deck' ? makeLaptop(marking.screen!, room, marking.points)
      : makeMonitor(marking.screen!, room, marking.points, false, marking.yaw);
    if (record) this.finishDevice(record);
  }

  private skipSurface() {
    const marking = this.marking;
    const room = garageState.room;
    if (!room || !marking?.screen) return;
    const record = marking.stage === 'deck' ? makeLaptop(marking.screen, room) : makeMonitor(marking.screen, room);
    if (record) this.finishDevice(record);
  }

  private finishDevice(device: DeviceRecord) {
    const edit = this.devices.findIndex(item => item.id === this.marking?.editId);
    if (edit >= 0) {
      device.id = this.devices[edit].id;
      device.enabled = this.devices[edit].enabled;
      this.devices[edit] = device;
    } else this.devices.push(device);
    this.unverified.delete(device.id);
    this.marking = undefined;
    this.firstMarker.visible = false;
    this.issue = '';
    this.resetPreview();
    this.saveDevices();
    this.rebuildVisuals();
    emit('device-marked', { device, count: this.devices.length });
    revealAudio.playGameplay('setup_lock', device.parts[0]?.center);
    showComicWord('KLIK.', device.parts[0]?.center);
    this.refresh();
  }

  private setCutouts(value: boolean) {
    setPreference('cutouts', value);
    emit('garage-cutouts-changed', value);
  }

  private toggleDevice(index: number) {
    const device = this.devices[index];
    if (!device) return;
    device.enabled = !device.enabled;
    this.saveDevices();
    this.applyVisibility();
    this.refresh();
  }

  private deleteDevice(index: number) {
    const [device] = this.devices.splice(index, 1);
    if (!device) return;
    this.unverified.delete(device.id);
    this.saveDevices();
    this.rebuildVisuals();
    this.refresh();
  }

  private clearAll() {
    this.devices = [];
    this.unverified.clear();
    clearDeviceCollection();
    this.builder?.setDeviceObstacles([]);
    this.rebuildVisuals();
    this.refresh();
  }

  private depthPart() {
    const device = this.devices[this.devices.length - 1];
    return device && !this.unverified.has(device.id) ? device.parts.find(part => part.part === 'screen' || part.part === 'extra') : undefined;
  }

  private adjustDepth(delta: number) {
    const part = this.depthPart();
    if (!part) return;
    if (part.part === 'screen') part.size.z = Math.max(minScreenDepth, Math.min(0.08, part.size.z + delta));
    else {
      const bottom = part.center.y - part.size.y / 2;
      part.size.y = Math.max(minZoneHeight, Math.min(0.4, part.size.y + delta));
      part.center.y = bottom + part.size.y / 2;
    }
    this.saveDevices();
    this.rebuildVisuals();
    this.refresh();
  }

  private activeObstacles() {
    return deviceObstacles(this.devices.filter(device => !this.unverified.has(device.id)));
  }

  private saveDevices() {
    if (garageState.room) saveDeviceCollection(garageState.room, this.devices, this.unverified);
    this.builder?.setDeviceObstacles(this.activeObstacles());
  }

  private resetRoom() {
    this.loaded = false;
    this.root.visible = false;
    this.closePanel();
  }

  private syncRoom() {
    const room = garageState.room;
    if (!room) return;
    const loaded = loadDeviceCollection(room);
    this.devices = loaded.devices;
    this.unverified = loaded.unverified;
    this.devices.forEach(device => { device.parts = device.parts.filter(part => part.part !== 'stand-neck' && part.part !== 'stand-base'); });
    this.tableY = room.table?.topY;
    this.loaded = true;
    this.builder?.setDeviceObstacles(this.activeObstacles());
    this.rebuildVisuals();
    this.refresh();
  }

  private rebaseHeight() {
    const previous = this.tableY;
    this.tableY = garageState.room?.table?.topY;
    if (previous == null || this.tableY == null || Math.abs(this.tableY - previous) < 0.002) return;
    for (const device of this.devices) {
      if (this.unverified.has(device.id)) continue;
      for (const part of device.parts) part.center.y += this.tableY - previous;
    }
    this.saveDevices();
    this.rebuildVisuals();
  }

  private onFrame(frame: XRFrame) {
    if (!this.loaded) this.syncRoom();
    if (!this.loaded) return;
    this.sampleInput(frame);
    this.applyVisibility();
  }

  private sampleInput(frame: XRFrame) {
    const space = this.world.renderer.xr.getReferenceSpace();
    this.cursor.visible = false;
    if (!space || !this.panel || !this.world.session || !this.panelOpen) return;
    const now = performance.now();
    this.firstMarker.quaternion.copy(this.world.camera.quaternion);
    const samples: Array<{
      source: XRInputSource; side: string; down: boolean; previous?: boolean; point: Vec3; aim?: { point: Vec3; time: number };
    }> = [];
    for (const source of this.world.session.inputSources) {
      if (source.targetRayMode !== 'tracked-pointer') continue;
      const previous = this.down.get(source);
      const side = source.handedness;
      const hand = source.hand && (side === 'left' || side === 'right') ? this.input.xr.visualAdapters.hand[side] : undefined;
      const select = (side === 'left' || side === 'right') && this.input.xr.getSelectState?.(side);
      const strength = Math.max(hand?.getPinchStrength?.() ?? 0, select && select.active ? 1 : 0);
      const down = source.hand ? strength > (previous ? 0.35 : 0.72) : source.gamepad?.buttons[0]?.pressed ?? false;
      this.down.set(source, down);
      const marking = this.marking;
      if (!marking || marking.points) {
        this.aimed.delete(source);
        continue;
      }
      // After the first corner, follow only the hand/controller that drew it.
      if (marking.source && marking.source !== source) {
        this.aimed.delete(source);
        continue;
      }
      const rayPose = frame.getPose(source.targetRaySpace, space);
      const joint = source.hand?.get('index-finger-tip');
      const pose = source.hand ? joint && frame.getJointPose?.(joint, space) : rayPose;
      if (!pose || !rayPose) {
        this.aimed.delete(source);
        continue;
      }
      const { x, y, z } = pose.transform.position;
      const point = { x, y, z };
      const { position, orientation } = rayPose.transform;
      this.tip.set(x, y, z);
      this.ray.origin.set(position.x, position.y, position.z);
      this.ray.direction.set(0, 0, -1).applyQuaternion(this.rotation.set(orientation.x, orientation.y, orientation.z, orientation.w));
      if (this.panelEntity?.hasComponent(Pressed) || this.panelInput?.owns(this.ray, this.tip)) {
        this.aimed.delete(source);
        continue;
      }
      if (!down) this.aimed.set(source, { point, time: now });
      samples.push({ source, side, down, previous, point, aim: this.aimed.get(source) });
    }

    const marking = this.marking;
    const room = garageState.room;
    let candidate: Vec3 | undefined;
    if (marking && !marking.points) {
      const locked = marking.source ? samples.find(sample => sample.source === marking.source) : undefined;
      if (marking.first && locked) {
        if (locked.down) {
          // Live drag: the outline follows the locked hand while it is pinched.
          marking.dragLast = locked.point;
          if (Math.hypot(locked.point.x - marking.first.x, locked.point.y - marking.first.y, locked.point.z - marking.first.z) > 0.06) {
            marking.dragMoved = true;
          }
          candidate = locked.point;
        } else if (locked.previous === true) {
          const last = marking.dragLast;
          const dragged = marking.dragMoved && last && Math.hypot(
            last.x - marking.first.x, last.y - marking.first.y, last.z - marking.first.z,
          ) > 0.06;
          if (dragged && last) this.markCorner(last, locked.source);
          marking.dragMoved = false;
          marking.dragLast = undefined;
        }
      }
      if (!marking.points) {
        const presses = samples.filter(sample => sample.down && sample.previous === false && now >= this.acceptAfter);
        presses.sort((a, b) => {
          const score = (sample: typeof a) => sample.source === marking.source ? 2 : sample.side === garageState.preferences.dominantHand ? 1 : 0;
          return score(b) - score(a);
        });
        const pressed = presses[0];
        if (pressed) {
          // A fresh pinch still works as a tap. Use the pre-pinch aim so the
          // curl of the index finger does not pull the corner away.
          const fresh = pressed.aim && now - pressed.aim.time <= 220;
          this.markCorner(fresh ? pressed.aim!.point : pressed.point, pressed.source);
          candidate = undefined;
        } else if (marking.source) {
          const follow = samples.find(sample => sample.source === marking.source);
          if (follow && !follow.down) candidate = follow.aim?.point ?? follow.point;
        } else {
          const aiming = samples.filter(sample => !sample.down);
          const pick = aiming.find(sample => sample.side === garageState.preferences.dominantHand) ?? aiming[0];
          candidate = pick ? pick.aim?.point ?? pick.point : undefined;
        }
      }
    }

    if (candidate && room && marking && !marking.points) {
      if (marking.stage !== 'screen') candidate = { ...candidate, y: room.table?.topY ?? room.floor.y };
      this.cursor.position.set(candidate.x, candidate.y, candidate.z);
      this.cursor.quaternion.copy(this.world.camera.quaternion);
      this.cursor.visible = true;
    } else candidate = undefined;
    if (!marking?.first) candidate = undefined;
    const before = this.hoverCorner;
    if ((!candidate && before) || (candidate && (!before ||
        Math.hypot(before.x - candidate.x, before.y - candidate.y, before.z - candidate.z) > 0.002))) {
      this.hoverCorner = candidate;
      this.rebuildPreview();
    }
  }

  private applyVisibility() {
    const garage = garageRootsVisible();
    const cutouts = garageState.preferences.cutouts;
    this.root.visible = this.loaded;
    for (const { device, occluder, display, outline } of this.visuals) {
      occluder.visible = device.enabled && garage && cutouts;
      const virtualBody = display.getObjectByName('Low-poly monitor');
      const face = display.getObjectByName('Virtual display');
      display.visible = device.enabled && garage && garageState.preferences.mode === 'passthrough' && (!!virtualBody || !cutouts);
      if (face) face.visible = !cutouts;
      outline.visible = device.enabled && !garage;
    }
  }

  private place(object: Mesh | Line | Group, part: DeviceVolume) {
    object.position.set(part.center.x, part.center.y, part.center.z);
    object.rotation.set(part.tilt, part.yaw, 0, 'YXZ');
  }

  private rectangle(part: DeviceVolume) {
    const flat = part.part !== 'screen';
    const w = part.size.x / 2, h = (flat ? part.size.z : part.size.y) / 2;
    const points = [[-w, -h], [w, -h], [w, h], [-w, h], [-w, -h]]
      .map(([x, y]) => flat ? new Vector3(x, 0.008, y) : new Vector3(x, y, 0.003));
    const line = new Line(new BufferGeometry().setFromPoints(points), this.outlineMat);
    this.place(line, part);
    line.renderOrder = 220;
    return line;
  }

  private rebuildPreview() {
    const marking = this.marking;
    const room = garageState.room;
    const first = marking?.first;
    this.firstMarker.visible = !!first;
    if (first) this.firstMarker.position.set(first.x, first.y, first.z);
    const screen = marking?.screen && room ? screenVolume(marking.screen, room.seat) : null;
    if (this.previewScreen) {
      this.previewScreen.visible = !!screen;
      if (screen) this.updatePreviewPart(this.previewScreen, screen, false, 0.003);
    }
    if (!marking || !room) {
      if (this.previewFill) this.previewFill.visible = false;
      if (this.previewOutline) this.previewOutline.visible = false;
      return;
    }
    const part = this.outline(marking.points ?? (first && this.hoverCorner ? [first, this.hoverCorner] : undefined));
    const show = !!part;
    if (this.previewFill) this.previewFill.visible = show;
    if (this.previewOutline) this.previewOutline.visible = show;
    if (!part) return;
    if (part.part !== 'screen' && first) part.center.y = first.y;
    const flat = part.part !== 'screen';
    if (this.previewFill) this.updatePreviewPart(this.previewFill, part, flat, flat ? 0.004 : 0);
    if (this.previewOutline) this.updatePreviewPart(this.previewOutline, part, flat, flat ? 0.008 : 0.003);
  }

  private updatePreviewPart(object: Mesh | Line, part: DeviceVolume, flat: boolean, lift: number) {
    object.position.set(part.center.x, part.center.y, part.center.z);
    object.rotation.set(part.tilt, part.yaw, 0, 'YXZ');
    object.scale.set(part.size.x, flat ? part.size.z : part.size.y, 1);
    if (flat) {
      object.rotateX(-Math.PI / 2);
      object.position.y += lift;
    } else if (lift) object.translateZ(lift);
  }

  private resetPreview() {
    if (this.previewFill) this.previewFill.visible = false;
    if (this.previewOutline) this.previewOutline.visible = false;
    if (this.previewScreen) this.previewScreen.visible = false;
  }

  private rebuildVisuals() {
    for (const entry of this.visuals) {
      for (const group of [entry.occluder, entry.display, entry.outline]) {
        this.clearGroup(group);
        group.removeFromParent();
      }
    }
    this.visuals = [];
    for (const device of this.devices) {
      if (this.unverified.has(device.id)) continue;
      const occluder = new Group(), display = new Group(), outline = new Group();
      occluder.name = `Device occluders ${device.label}`;
      display.name = `Device display ${device.label}`;
      outline.name = `Device passthrough outline ${device.label}`;
      for (const part of device.parts) {
        const box = new Mesh(new BoxGeometry(part.size.x, part.size.y, part.size.z), this.occluder);
        this.place(box, part);
        if (part.part === 'screen') box.translateZ(-part.size.z / 2);
        box.renderOrder = -1000;
        occluder.add(box);
        if (part.part !== 'typing') outline.add(this.rectangle(part));
        if (part.part !== 'screen') continue;
        const w = part.size.x, h = part.size.y;
        const face = new Mesh(new PlaneGeometry(w, h), this.displayMat);
        face.name = 'Virtual display';
        this.place(face, part);
        display.add(face);
        void createMonitorModel(w + 0.006, h + 0.006, { hideStand: device.template === 'laptop' })
          .then(({ mount, display: glass }) => {
            if (display.parent !== this.root) return;
            this.place(mount, part);
            glass.name = 'Virtual display';
            face.removeFromParent();
            face.geometry.dispose();
            display.add(mount);
            this.applyVisibility();
          }).catch(error => console.warn('[device] Monitor model could not load', error));
      }
      this.root.add(occluder, display, outline);
      this.visuals.push({ device, occluder, display, outline });
    }
    this.applyVisibility();
  }

  private clearGroup(group: Group) {
    group.getObjectByName('Low-poly monitor')?.removeFromParent();
    group.traverse(child => { if (child instanceof Mesh || child instanceof Line) child.geometry.dispose(); });
    group.clear();
  }

  private refresh() {
    const set = (id: string, props: object) => this.panel?.getElementById(id)?.setProperties(props);
    const marking = this.marking;
    const stage = marking?.stage;
    const partPreview = this.outline(marking?.points);
    const ready = !!partPreview;
    set('dev-count', { text: `${this.devices.length} SAVED` });
    set('dev-templates', { display: marking ? 'none' : 'flex' });
    set('dev-saved-controls', { display: marking ? 'none' : 'flex' });
    set('dev-title', { text: stage === 'screen' ? 'Mark the display' : stage === 'deck' ? 'Mark the laptop base' : stage === 'keyboard' ? 'Mark the keyboard' : stage === 'extra' ? 'Mark a zone' : 'Mark your setup' });
    set('dev-step', { text: ready ? 'REVIEW' : marking?.first ? 'DRAG OR PINCH' : stage ? 'FIRST CORNER' : 'PASSTHROUGH' });
    set('dev-instruction', { text: ready ? 'Check the outline against the real object.'
      : marking?.first ? 'Keep pinching and drag to the opposite corner, then release. Or pinch again there.'
      : stage ? 'Point at one corner with your fingertip or controller, then pinch or press.' : 'Choose an object to outline in your real room.' });
    set('dev-dimensions', { display: partPreview ? 'flex' : 'none', text: partPreview
      ? `${Math.round(partPreview.size.x * 100)} x ${Math.round((stage === 'screen' ? partPreview.size.y : partPreview.size.z) * 100)} cm` : '' });
    const tip = this.issue || (this.unverified.size ? 'Re-mark saved devices that need alignment.' : '');
    set('dev-tip', { text: tip, display: tip ? 'flex' : 'none' });
    set('dev-use', { display: ready ? 'flex' : 'none', text: stage === 'screen' && marking?.template !== 'monitor' ? 'Continue' : 'Save' });
    set('dev-skip-keyboard', { display: stage === 'keyboard' || stage === 'deck' ? 'flex' : 'none', text: stage === 'deck' ? 'Use fitted base' : 'Skip keyboard' });
    set('dev-undo', { display: marking?.first || marking?.screen ? 'flex' : 'none',
      text: marking?.points ? 'Undo second corner' : marking?.first ? 'Undo first corner' : 'Back to display' });
    set('dev-angle', { display: ready && stage !== 'deck' ? 'flex' : 'none' });
    set('dev-done', { display: marking ? 'none' : 'flex' });
    set('dev-cutouts', { text: garageState.preferences.cutouts ? 'Cutouts on' : 'Cutouts off' });
    const part = this.depthPart();
    set('dev-depth-row', { display: part ? 'flex' : 'none' });
    set('dev-depth', { text: part ? `Depth ${((part.part === 'screen' ? part.size.z : part.size.y) * 100).toFixed(1)} cm` : '' });
    set('dev-remark', { display: this.devices.length ? 'flex' : 'none' });
    const lastPage = Math.max(0, Math.ceil(this.devices.length / 4) - 1);
    this.page = Math.max(0, Math.min(this.page, lastPage));
    set('dev-prev', { display: this.page > 0 ? 'flex' : 'none' });
    set('dev-next', { display: this.page < lastPage ? 'flex' : 'none' });
    for (let i = 0; i < 4; i++) {
      const device = this.devices[this.page * 4 + i];
      set(`dev-row-${i + 1}`, { display: device ? 'flex' : 'none' });
      if (!device) continue;
      const main = device.parts[0];
      const size = main ? `${Math.round(main.size.x * 100)} x ${Math.round((main.part === 'screen' ? main.size.y : main.size.z) * 100)} cm` : '';
      set(`dev-name-${i + 1}`, { text: this.unverified.has(device.id) ? `${device.label} / re-mark` : `${device.label} / ${size}` });
      set(`dev-toggle-${i + 1}`, { text: device.enabled ? 'On' : 'Off' });
    }
  }
}
