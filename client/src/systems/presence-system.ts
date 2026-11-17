import { createSystem } from '@iwsdk/core';
import { emit, garageEvents } from '../events.js';
import { garageState } from '../garage-state.js';
import { setGarageRootsVisible } from '../garage-visibility.js';

type SeatedPose = { x: number; y: number; z: number; forwardX: number; forwardZ: number };
const storageKey = 'garage-jam-seated-pose-v1';

function loadPose(): SeatedPose | null {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) || 'null');
    return value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z) ? value : null;
  } catch { return null; }
}

export class PresenceSystem extends createSystem({}) {
  private pose: SeatedPose | null = loadPose();
  private enabled = garageState.preferences.standUpFade;
  private hidden = false;
  private manualPassthrough = false;
  private stage = 'S0';
  private hideTimer = 0;
  private lastZone = 'unknown';

  init() {
    const onStage = (event: Event) => {
      this.stage = (event as CustomEvent<{ stage: string }>).detail?.stage ?? this.stage;
      if (this.stage === 'S10') this.evaluate(true);
      else if (this.hidden && this.stage !== 'S10') this.show();
    };
    const onPassthrough = (event: Event) => {
      this.manualPassthrough = !!(event as CustomEvent<boolean>).detail;
      if (this.manualPassthrough) this.cancelHide();
      else this.evaluate(true);
    };
    const onFade = () => {
      this.enabled = garageState.preferences.standUpFade;
      if (this.enabled && !this.pose) this.maybeStorePose();
      if (!this.enabled) this.show();
      else this.evaluate(true);
    };
    const onStore = () => this.storePose();
    const onRevealed = () => { if (!this.pose) this.maybeStorePose(); this.evaluate(true); };
    const onReset = () => { this.hidden = false; this.cancelHide(); setGarageRootsVisible(true); };
    garageEvents.addEventListener('app-flow-stage', onStage);
    garageEvents.addEventListener('garage-passthrough-changed', onPassthrough);
    garageEvents.addEventListener('stand-up-fade-changed', onFade);
    garageEvents.addEventListener('standup-seat-store', onStore);
    garageEvents.addEventListener('garage-revealed', onRevealed);
    garageEvents.addEventListener('garage-reset', onReset);
    this.cleanupFuncs.push(() => {
      garageEvents.removeEventListener('app-flow-stage', onStage);
      garageEvents.removeEventListener('garage-passthrough-changed', onPassthrough);
      garageEvents.removeEventListener('stand-up-fade-changed', onFade);
      garageEvents.removeEventListener('standup-seat-store', onStore);
      garageEvents.removeEventListener('garage-revealed', onRevealed);
      garageEvents.removeEventListener('garage-reset', onReset);
      this.cancelHide();
    });
    if (location.hostname === 'localhost') {
      const system = this;
      (window as any).garagePresenceDebug = {
        get pose() { return system.pose; },
        get enabled() { return system.enabled; },
        get hidden() { return system.hidden; },
        store: () => system.storePose(),
        show: () => system.show(),
        hide: () => system.hide(),
      };
    }
  }

  private storePose() {
    if (!this.world.session) return;
    const head = this.world.camera.getWorldPosition(this.world.camera.position.clone());
    const forward = this.world.camera.getWorldDirection(this.world.camera.position.clone());
    this.pose = { x: head.x, y: head.y, z: head.z, forwardX: forward.x, forwardZ: forward.z };
    try { localStorage.setItem(storageKey, JSON.stringify(this.pose)); } catch { /* private mode */ }
    emit('status', 'Seated position saved for stand-up fade');
  }

  private maybeStorePose() {
    if (this.pose || !this.world.session) return;
    const head = this.world.camera.getWorldPosition(this.world.camera.position.clone());
    const floor = garageState.room?.floor.y ?? 0;
    if (head.y - floor > 0.8 && head.y - floor < 1.55) this.storePose();
  }

  update() {
    if (!this.enabled || !this.world.session) return;
    if (!this.pose) { this.maybeStorePose(); return; }
    this.evaluate(false);
  }

  private evaluate(immediate: boolean) {
    if (!this.enabled || this.manualPassthrough || this.stage !== 'S10' || !this.pose) return;
    if (!this.world.session) return;
    const head = this.world.camera.getWorldPosition(this.world.camera.position.clone());
    const horizontal = Math.hypot(head.x - this.pose.x, head.z - this.pose.z);
    const vertical = head.y - this.pose.y;
    const near = horizontal < 0.55 && Math.abs(vertical) < 0.42;
    const away = horizontal > 0.95 || vertical > 0.5 || vertical < -0.6;
    const zone = near ? 'seated' : away ? 'away' : this.lastZone;
    if (zone === this.lastZone && !immediate) return;
    this.lastZone = zone;
    if (zone === 'seated' && this.hidden) this.show();
    else if (zone === 'away' && !this.hidden) this.hide();
  }

  private show() {
    this.cancelHide();
    if (!this.hidden) {
      this.lastZone = 'seated';
      return;
    }
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
