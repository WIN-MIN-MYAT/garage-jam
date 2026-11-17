import { createSystem } from '@iwsdk/core';
import { emit, garageEvents } from '../events.js';
import { garageState } from '../garage-state.js';
import { setGarageRootsVisible } from '../garage-visibility.js';
import { rememberRoomPoint, restoreRoomPoint } from '../device-model.js';
import type { RoomModel, Vec3 } from '../room-model.js';
import { loadStandSeat, saveStandSeat } from '../stand-seat-memory.js';

type Transition = { away: boolean; since: number };
const triggerDwellMs = 260;

export class PresenceSystem extends createSystem({}) {
  private memory = loadStandSeat();
  private pose: Vec3 | null = null;
  private checkedRoom: RoomModel | null = null;
  private enabled = garageState.preferences.standUpFade;
  private hidden = false;
  private manualPassthrough = false;
  private stage = 'S0';
  private hideTimer = 0;
  private transition?: Transition;
  private autoCandidate?: { point: Vec3; since: number };
  private captureRequested = false;

  init() {
    const onStage = (event: Event) => {
      this.stage = (event as CustomEvent<{ stage: string }>).detail?.stage ?? this.stage;
      this.transition = undefined;
      this.autoCandidate = undefined;
      if (this.stage !== 'S10') this.captureRequested = false;
    };
    const onPassthrough = (event: Event) => {
      this.manualPassthrough = !!(event as CustomEvent<boolean>).detail;
      this.transition = undefined;
      if (this.manualPassthrough) this.cancelHide();
      else if (this.hidden && !this.enabled) this.show();
      else if (this.hidden) setGarageRootsVisible(false);
    };
    const onFade = () => {
      this.enabled = garageState.preferences.standUpFade;
      this.transition = undefined;
      this.autoCandidate = undefined;
      if (!this.enabled && !this.manualPassthrough) this.show();
      if (this.enabled && !this.pose) emit('status', 'Sit at your work spot and use Save seat in Settings.');
    };
    const onStore = () => {
      if (this.stage === 'S10' && this.world.session) this.captureRequested = true;
    };
    const onReset = () => {
      this.hidden = false;
      this.pose = null;
      this.checkedRoom = null;
      this.transition = undefined;
      this.autoCandidate = undefined;
      this.captureRequested = false;
      this.cancelHide();
      setGarageRootsVisible(!this.manualPassthrough);
      emit('stand-seat-state', 'SET');
    };
    const stopFrame = this.world.onXRFrame(frame => this.track(frame));
    garageEvents.addEventListener('app-flow-stage', onStage);
    garageEvents.addEventListener('garage-passthrough-changed', onPassthrough);
    garageEvents.addEventListener('stand-up-fade-changed', onFade);
    garageEvents.addEventListener('standup-seat-store', onStore);
    garageEvents.addEventListener('garage-reset', onReset);
    garageEvents.addEventListener('garage-space-reset', onReset);
    this.cleanupFuncs.push(() => {
      garageEvents.removeEventListener('app-flow-stage', onStage);
      garageEvents.removeEventListener('garage-passthrough-changed', onPassthrough);
      garageEvents.removeEventListener('stand-up-fade-changed', onFade);
      garageEvents.removeEventListener('standup-seat-store', onStore);
      garageEvents.removeEventListener('garage-reset', onReset);
      garageEvents.removeEventListener('garage-space-reset', onReset);
      stopFrame();
      this.cancelHide();
    });
    if (location.hostname === 'localhost') {
      const system = this;
      (window as any).garagePresenceDebug = {
        get pose() { return system.pose; },
        get enabled() { return system.enabled; },
        get hidden() { return system.hidden; },
        store: onStore,
        show: () => system.show(),
        hide: () => system.hide(),
      };
    }
  }

  private storePose(room: RoomModel, head: Vec3) {
    this.pose = { x: head.x, y: head.y, z: head.z };
    this.memory = rememberRoomPoint(room, this.pose);
    this.transition = undefined;
    this.autoCandidate = undefined;
    const saved = saveStandSeat(this.memory);
    emit('stand-seat-state', saved ? 'SAVED' : 'SESSION');
    emit('status', saved ? 'Seated position saved for stand-up fade.' : 'Seated position set for this session.');
    if (!this.manualPassthrough) this.show();
  }

  private track(frame: XRFrame) {
    const room = garageState.room;
    if (!room || this.stage !== 'S10') return;
    const space = this.world.renderer.xr.getReferenceSpace();
    const tracking = space && frame.session.visibilityState === 'visible' && frame.getViewerPose(space);
    if (!tracking || tracking.emulatedPosition) {
      this.transition = undefined;
      this.autoCandidate = undefined;
      return;
    }
    const head = tracking.transform.position;
    const height = head.y - room.floor.y;
    if (this.captureRequested) {
      this.captureRequested = false;
      if (height >= 0.6 && height <= 1.55) this.storePose(room, head);
      else emit('status', 'Sit at your work spot before saving your seat.');
      return;
    }
    if (!this.pose && this.checkedRoom !== room) {
      this.checkedRoom = room;
      this.pose = this.memory && restoreRoomPoint(room, this.memory);
      emit('stand-seat-state', this.pose ? 'SAVED' : this.memory ? 'SET AGAIN' : 'SET');
    }
    if (!this.enabled || this.manualPassthrough) return;
    const now = performance.now();
    if (!this.pose) {
      if (!this.memory) this.maybeStorePose(room, head, height, now);
      return;
    }
    const horizontal = Math.hypot(head.x - this.pose.x, head.z - this.pose.z);
    const vertical = head.y - this.pose.y;
    const near = horizontal < 0.55 && Math.abs(vertical) <= 0.20;
    const away = horizontal > 0.95 || vertical >= 0.32 || vertical < -0.60;
    if (!(this.hidden ? near : away)) {
      this.transition = undefined;
      return;
    }
    if (!this.transition) this.transition = { away: !this.hidden, since: now };
    if (now - this.transition.since < triggerDwellMs) return;
    const transition = this.transition;
    this.transition = undefined;
    if (transition.away) this.hide();
    else this.show();
  }

  private maybeStorePose(room: RoomModel, head: Vec3, height: number, now: number) {
    if (height < 0.8 || height > 1.45 || Math.hypot(head.x - room.seat.x, head.z - room.seat.z) > 0.60) {
      this.autoCandidate = undefined;
      return;
    }
    const candidate = this.autoCandidate;
    if (!candidate || Math.hypot(head.x - candidate.point.x, head.y - candidate.point.y, head.z - candidate.point.z) > 0.06) {
      this.autoCandidate = { point: { x: head.x, y: head.y, z: head.z }, since: now };
    } else if (now - candidate.since >= 500) {
      this.storePose(room, head);
    }
  }

  private show() {
    this.cancelHide();
    if (!this.hidden) return;
    this.hidden = false;
    setGarageRootsVisible(true);
    emit('room-shown');
    emit('room-enter');
    emit('status', 'Welcome back - garage revealed');
  }

  private hide() {
    if (this.hidden) return;
    this.hidden = true;
    emit('room-hidden');
    emit('room-leave');
    emit('status', 'Garage fading to passthrough - stand-up fade');
    this.cancelHide();
    this.hideTimer = window.setTimeout(() => {
      this.hideTimer = 0;
      if (this.hidden) setGarageRootsVisible(false);
    }, 900) as unknown as number;
  }

  private cancelHide() {
    if (this.hideTimer) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = 0;
    }
  }
}
