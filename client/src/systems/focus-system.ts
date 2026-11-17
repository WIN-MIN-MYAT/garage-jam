import { AdditiveBlending, BoxGeometry, CanvasTexture, createSystem, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from '@iwsdk/core';
import { emit, garageEvents } from '../events.js';
import { garageState } from '../garage-state.js';
import { garageRootsVisible, registerGarageRoot, unregisterGarageRoot } from '../garage-visibility.js';
import { addFocusMinutes, loadProgress } from '../progress-store.js';
import { revealAudio } from '../reveal/RevealAudio.js';
import { slotRules } from '../slot-rules.js';
import { showComicWord } from '../comic-word.js';

type Phase = 'focus' | 'break';
const demo = new URLSearchParams(location.search).get('focusDemo') === '1';
const breakClosure = 0.34;

export class FocusSystem extends createSystem({}) {
  private root = new Group();
  private focusContent = new Group();
  private shutter?: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private rail?: Mesh<BoxGeometry, MeshBasicMaterial>;
  private shutterHeight = 0;
  private sign?: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private signTexture?: CanvasTexture;
  private workLight?: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private soundPosition = new Vector3();
  private running = false;
  private paused = false;
  private phase: Phase = 'focus';
  private remaining = 0;
  private duration = 0;
  private scheduledFocusMinutes = 0;
  private closed = 0;
  private transition?: { from: number; to: number; elapsed: number; duration: number };
  private lastSeconds = -1;

  init() {
    this.root.name = 'Focus door';
    this.focusContent.name = 'Focus scene';
    this.focusContent.visible = false;
    this.root.add(this.focusContent);
    this.root.visible = garageRootsVisible();
    this.world.scene.add(this.root);
    registerGarageRoot(this.root);
    const listeners: Record<string, EventListener> = {
      'garage-revealed': () => this.build(),
      'garage-reset': () => this.reset(),
      'focus-start': event => this.start((event as CustomEvent<{ minutes?: number }>).detail?.minutes),
      'focus-pause': () => this.pause(),
      'focus-cancel': () => this.end('Focus ended'),
    };
    for (const [event, listener] of Object.entries(listeners)) garageEvents.addEventListener(event, listener);
    if (location.hostname === 'localhost') {
      const system = this;
      (window as any).garageFocusDebug = {
        start: (minutes?: number) => this.start(minutes),
        pause: () => this.pause(),
        cancel: () => this.end('Focus ended'),
        get state() { return { ...system.state(), closed: system.closed }; },
      };
    }
    this.cleanupFuncs.push(() => {
      for (const [event, listener] of Object.entries(listeners)) garageEvents.removeEventListener(event, listener);
      unregisterGarageRoot(this.root);
      this.reset();
      this.root.removeFromParent();
    });
  }

  private build() {
    this.clear();
    const room = garageState.room;
    if (!room) return;
    const door = garageState.placements.find(placement => placement.slotId === 'door');
    const wall = room.walls.find(item => item.id === door?.wallId);
    const signMount = new Group();
    this.focusContent.add(signMount);
    if (door && wall) {
      const rule = slotRules.find(item => item.id === 'door');
      const width = door.footprint.width * door.scale + 0.14;
      const height = Math.min((rule?.height ?? 2.2) * door.scale, room.ceilingY - room.floor.y);
      const doorway = new Group();
      doorway.position.set(door.position.x, room.floor.y + height, door.position.z);
      doorway.rotation.y = Math.atan2(wall.normal.x, wall.normal.z);
      this.focusContent.add(doorway);
      this.shutterHeight = height;
      this.buildShutter(doorway, width, height);
      signMount.position.set(0, -Math.min(0.42, height * 0.22), 0.14);
      doorway.add(signMount);
    } else {
      signMount.position.set(room.seat.x + room.forward.x * 1.45, room.floor.y + 1.32, room.seat.z + room.forward.z * 1.45);
      signMount.rotation.y = Math.atan2(-room.forward.x, -room.forward.z);
    }

    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 256;
    this.signTexture = new CanvasTexture(canvas);
    this.signTexture.colorSpace = SRGBColorSpace;
    this.sign = new Mesh(new PlaneGeometry(0.86, 0.344), new MeshBasicMaterial({
      map: this.signTexture, transparent: true, depthWrite: false,
    }));
    this.sign.name = 'Focus countdown';
    signMount.add(this.sign);

    const lightCanvas = document.createElement('canvas');
    lightCanvas.width = lightCanvas.height = 128;
    const ctx = lightCanvas.getContext('2d')!;
    const glow = ctx.createRadialGradient(64, 64, 0, 64, 64, 63);
    glow.addColorStop(0, 'rgba(239, 147, 68, 0.45)');
    glow.addColorStop(0.48, 'rgba(222, 118, 48, 0.21)');
    glow.addColorStop(1, 'rgba(195, 84, 38, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, 128, 128);
    const lightTexture = new CanvasTexture(lightCanvas);
    lightTexture.colorSpace = SRGBColorSpace;
    this.workLight = new Mesh(new PlaneGeometry(1.85, 1.45), new MeshBasicMaterial({
      map: lightTexture, blending: AdditiveBlending, transparent: true, opacity: 0, depthWrite: false,
    }));
    this.workLight.name = 'Focus workbench light';
    this.workLight.rotation.set(-Math.PI / 2, 0, Math.atan2(room.forward.x, -room.forward.z));
    this.workLight.position.set(room.seat.x + room.forward.x * 0.5, room.floor.y + 0.012, room.seat.z + room.forward.z * 0.5);
    this.focusContent.add(this.workLight);
  }

  private buildShutter(doorway: Group, width: number, height: number) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    for (let y = 0; y < 512; y += 24) {
      const slat = ctx.createLinearGradient(0, y, 0, y + 24);
      slat.addColorStop(0, '#151822');
      slat.addColorStop(0.15, '#68717e');
      slat.addColorStop(0.34, '#424957');
      slat.addColorStop(0.8, '#303644');
      slat.addColorStop(1, '#171923');
      ctx.fillStyle = slat;
      ctx.fillRect(0, y, 512, 24);
    }
    const edgeShade = ctx.createLinearGradient(0, 0, 512, 0);
    edgeShade.addColorStop(0, 'rgba(17, 12, 27, .76)');
    edgeShade.addColorStop(0.4, 'rgba(17, 12, 27, 0)');
    edgeShade.addColorStop(0.68, 'rgba(128, 78, 45, .14)');
    edgeShade.addColorStop(1, 'rgba(17, 12, 27, .65)');
    ctx.fillStyle = edgeShade;
    ctx.fillRect(0, 0, 512, 512);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    this.shutter = new Mesh(new PlaneGeometry(width, height), new MeshBasicMaterial({ map: texture }));
    this.shutter.name = 'Roll-down focus door';
    this.shutter.position.z = 0.018;
    doorway.add(this.shutter);

    this.rail = new Mesh(new BoxGeometry(width, 0.042, 0.038), new MeshBasicMaterial({ color: 0x60534b }));
    this.rail.name = 'Focus shutter bottom rail';
    this.rail.position.z = 0.029;
    doorway.add(this.rail);
  }

  private start(minutes?: number) {
    if (this.running) return;
    if (!this.sign) this.build();
    if (!this.sign) return;
    this.running = true;
    this.paused = false;
    this.phase = 'focus';
    this.scheduledFocusMinutes = demo ? 1 : Math.max(1, Math.round(minutes ?? garageState.preferences.focusMinutes));
    this.remaining = this.duration = this.scheduledFocusMinutes * 60;
    this.focusContent.visible = true;
    this.moveShutter(1);
    this.publish();
    emit('status', 'Focus started');
  }

  private pause() {
    if (!this.running) return;
    this.paused = !this.paused;
    this.publish();
    emit('status', this.paused ? 'Focus paused' : 'Focus resumed');
  }

  private end(status: string) {
    if (!this.running) return;
    this.running = false;
    this.paused = false;
    this.remaining = 0;
    this.moveShutter(0);
    this.publish();
    emit('status', status);
  }

  private complete() {
    const minutes = Math.max(1, Math.round(this.duration / 60));
    if (this.phase === 'focus') addFocusMinutes(loadProgress(), this.scheduledFocusMinutes);
    emit('focus-complete', { phase: this.phase, minutes });
    if (this.phase === 'break') {
      this.end('Break complete');
      return;
    }
    this.phase = 'break';
    this.remaining = this.duration = demo ? 20 : 5 * 60;
    this.moveShutter(breakClosure);
    if (this.root.visible && this.sign) {
      const position = this.sign.getWorldPosition(this.soundPosition);
      if (!revealAudio.playGameplay('focus_break_start', position)) revealAudio.playChime(position);
    }
    this.publish();
    emit('status', 'Focus complete. Take a break.');
  }

  private moveShutter(to: number) {
    const distance = Math.abs(to - this.closed);
    const duration = garageState.preferences.reducedMotion ? 0 : Math.max(0.24, distance * (to > this.closed ? 2.35 : 1.65));
    this.transition = { from: this.closed, to, elapsed: 0, duration };
    this.applyShutter(this.closed);
  }

  private applyShutter(amount: number) {
    this.closed = amount;
    if (this.shutter && this.rail) {
      this.shutter.visible = this.rail.visible = amount > 0.002;
      this.shutter.scale.y = Math.max(0.001, amount);
      this.shutter.position.y = -this.shutterHeight * amount * 0.5;
      this.rail.position.y = -this.shutterHeight * amount;
      const texture = this.shutter.material.map!;
      texture.repeat.y = amount;
      texture.offset.y = 1 - amount;
      emit('focus-shutter', amount);
      revealAudio.setShutterAmount(amount);
    }
    if (this.sign) this.sign.material.opacity = Math.min(1, amount * 5);
    if (this.workLight) this.workLight.material.opacity = amount * 0.8;
  }

  private publish() {
    this.lastSeconds = Math.ceil(this.remaining);
    this.drawSign();
    emit('focus-state', this.state());
  }

  private drawSign() {
    if (!this.signTexture) return;
    const canvas = this.signTexture.image as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const accent = this.paused ? '#ffd8a3' : this.phase === 'break' || !this.running ? '#a9dbd3' : '#ffc783';
    ctx.clearRect(0, 0, 640, 256);
    ctx.beginPath();
    ctx.roundRect(4, 4, 632, 248, 22);
    ctx.fillStyle = '#11121a';
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = '#534448';
    ctx.stroke();

    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(65, 52, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = '600 28px "GarageDisplay", sans-serif';
    const label = !this.running ? 'SESSION ENDED' : this.paused ? 'PAUSED' : this.phase === 'break' ? 'BREAK TIME' : 'FOCUS SESSION';
    ctx.fillText(label, 88, 63);

    const seconds = this.lastSeconds;
    const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    ctx.fillStyle = '#fff0d9';
    ctx.font = '700 108px "GarageDisplay", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(clock, 320, 180);
    ctx.textAlign = 'left';

    const progress = this.duration > 0 ? this.remaining / this.duration : 0;
    ctx.fillStyle = '#33313b';
    ctx.fillRect(61, 214, 518, 8);
    ctx.fillStyle = accent;
    ctx.fillRect(61, 214, 518 * progress, 8);
    this.signTexture.needsUpdate = true;
  }

  private state() {
    return { running: this.running, paused: this.paused, remaining: this.remaining, duration: this.duration, phase: this.phase };
  }

  private reset() {
    const wasRunning = this.running;
    this.running = this.paused = false;
    this.remaining = this.duration = 0;
    this.transition = undefined;
    this.applyShutter(0);
    this.clear();
    if (wasRunning) emit('focus-state', this.state());
  }

  private clear() {
    this.focusContent.traverse(object => {
      if (!(object instanceof Mesh)) return;
      object.geometry.dispose();
      const material = object.material as MeshBasicMaterial;
      material.map?.dispose();
      material.dispose();
    });
    this.focusContent.clear();
    this.focusContent.visible = false;
    this.shutter = undefined;
    this.rail = undefined;
    this.sign = undefined;
    this.signTexture = undefined;
    this.workLight = undefined;
  }

  update(delta: number) {
    const motion = this.transition;
    if (motion) {
      motion.elapsed += delta;
      const t = motion.duration ? Math.min(1, motion.elapsed / motion.duration) : 1;
      const eased = t * t * (3 - 2 * t);
      const previous = this.closed;
      this.applyShutter(motion.from + (motion.to - motion.from) * eased);
      if (motion.to === 1 && previous < 0.82 && this.closed >= 0.82 && this.shutter && this.root.visible) {
        const position = this.shutter.getWorldPosition(this.soundPosition);
        revealAudio.playFocusClose(position);
        showComicWord('R-R-R-CHUNK.', position);
      }
      if (t === 1) {
        this.transition = undefined;
        this.focusContent.visible = this.running;
      }
    }
    if (!this.running || this.paused) return;
    this.remaining = Math.max(0, this.remaining - delta);
    if (this.remaining === 0) this.complete();
    else if (Math.ceil(this.remaining) !== this.lastSeconds) this.publish();
  }
}
