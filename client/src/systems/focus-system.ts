import { BoxGeometry, CanvasTexture, Color, createSystem, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Sprite, SpriteMaterial } from '@iwsdk/core';
import { emit, garageEvents } from '../events.js';
import { garageState } from '../garage-state.js';
import { registerGarageRoot, unregisterGarageRoot } from '../garage-visibility.js';
import { addFocusMinutes, loadProgress } from '../progress-store.js';
import { revealAudio } from '../reveal/RevealAudio.js';
import { slotRules } from '../slot-rules.js';

type Phase = 'focus' | 'break';
const demo = new URLSearchParams(location.search).get('focusDemo') === '1';

export class FocusSystem extends createSystem({}) {
  private root = new Group();
  private shutter?: Group;
  private sign?: Sprite;
  private signTexture?: CanvasTexture;
  private sky?: Mesh;
  private beam?: Mesh;
  private dust?: Mesh;
  private baseSkyColor = new Color(0xffffff);
  private baseBeamOpacity = 0.4;
  private baseDustOpacity = 0.55;
  private running = false;
  private paused = false;
  private phase: Phase = 'focus';
  private remaining = 0;
  private duration = 0;
  private focusSeconds = demo ? 60 : 25 * 60;
  private breakSeconds = demo ? 20 : 5 * 60;
  private closed = 0;
  private lastSeconds = -1;
  private built = false;

  init() {
    this.root.name = 'Focus door';
    this.root.visible = false;
    this.world.scene.add(this.root);
    registerGarageRoot(this.root);
    const onRevealed = () => this.build();
    const onReset = () => this.reset();
    const start = (event: Event) => this.start((event as CustomEvent<{ minutes?: number }>).detail?.minutes);
    const pause = () => this.pause();
    const cancel = () => this.cancel();
    garageEvents.addEventListener('garage-revealed', onRevealed);
    garageEvents.addEventListener('garage-reset', onReset);
    garageEvents.addEventListener('focus-start', start);
    garageEvents.addEventListener('focus-pause', pause);
    garageEvents.addEventListener('focus-cancel', cancel);
    if (location.hostname === 'localhost') {
      (window as any).garageFocusDebug = {
        start: (minutes?: number) => this.start(minutes),
        pause: () => this.pause(),
        cancel: () => this.cancel(),
        get state() { return { running: system.running, paused: system.paused, remaining: system.remaining, phase: system.phase, closed: system.closed }; },
      };
      const system = this;
    }
    this.cleanupFuncs.push(() => {
      garageEvents.removeEventListener('garage-revealed', onRevealed);
      garageEvents.removeEventListener('garage-reset', onReset);
      garageEvents.removeEventListener('focus-start', start);
      garageEvents.removeEventListener('focus-pause', pause);
      garageEvents.removeEventListener('focus-cancel', cancel);
      unregisterGarageRoot(this.root);
      this.clear();
      this.root.removeFromParent();
    });
  }

  private build() {
    this.clear();
    const room = garageState.room;
    const door = garageState.placements.find(placement => placement.slotId === 'door');
    if (!room || !door) return;
    const wall = room.walls.find(item => item.id === door.wallId);
    if (!wall) return;
    const rule = slotRules.find(item => item.id === 'door');
    const width = (rule?.footprint.width ?? 2) * (door.scale ?? 1);
    const height = Math.min((rule?.height ?? 2.2) * (door.scale ?? 1), room.ceilingY - room.floor.y - 0.1);
    const floorY = room.floor.y;
    const shutter = new Group();
    shutter.name = 'Roll-down focus door';
    shutter.position.set(door.position.x, floorY + height * 2, door.position.z);
    shutter.rotation.y = Math.atan2(wall.normal.x, wall.normal.z);
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#2b3039'; ctx.fillRect(0, 0, 512, 512);
    for (let y = 0; y < 512; y += 40) {
      ctx.fillStyle = y % 80 ? '#343a45' : '#232830';
      ctx.fillRect(0, y, 512, 20);
      ctx.strokeStyle = '#0d0d10'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
    }
    ctx.strokeStyle = '#ff2d95'; ctx.lineWidth = 8; ctx.strokeRect(8, 8, 496, 496);
    ctx.fillStyle = '#e8ff2a'; ctx.font = 'bold 34px "GarageDisplay", sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('FOCUS DOOR', 256, 276);
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
    const panel = new Mesh(new PlaneGeometry(width, height), new MeshBasicMaterial({ map: texture, side: 2 }));
    panel.name = 'Focus door panel';
    panel.position.set(0, -height / 2, 0.03);
    shutter.add(panel);
    this.root.add(shutter);
    this.shutter = shutter;
    shutter.visible = false;

    const signCanvas = document.createElement('canvas'); signCanvas.width = 320; signCanvas.height = 128;
    const signTexture = new CanvasTexture(signCanvas); signTexture.colorSpace = SRGBColorSpace;
    const sign = new Sprite(new SpriteMaterial({ map: signTexture, depthTest: false, depthWrite: false }));
    sign.name = 'Focus countdown';
    sign.scale.set(0.72, 0.28, 1);
    sign.renderOrder = 900;
    sign.position.set(0, -height, 0.2);
    shutter.add(sign);
    this.sign = sign;
    this.signTexture = signTexture;
    this.signTexture.userData = { canvas: signCanvas };
    this.sky = this.world.scene.getObjectByName('Golden hour sky') as Mesh | undefined;
    this.beam = this.world.scene.getObjectByName('Sun beam') as Mesh | undefined;
    this.dust = this.world.scene.getObjectByName('Dust motes in the sun beam') as Mesh | undefined;
    if (this.sky) this.baseSkyColor.copy((this.sky.material as MeshBasicMaterial).color);
    this.baseBeamOpacity = (this.beam?.material as MeshBasicMaterial | undefined)?.opacity ?? 0.4;
    this.baseDustOpacity = (this.dust?.material as MeshBasicMaterial | undefined)?.opacity ?? 0.55;
    this.built = true;
    this.drawSign();
  }

  private start(minutes?: number) {
    if (!this.built) this.build();
    if (!this.built || this.shutter) {
      if (!this.shutter) return;
    }
    this.running = true;
    this.paused = false;
    this.phase = 'focus';
    this.focusSeconds = Math.max(1, Math.round((demo ? 1 : (minutes ?? 25)) * 60));
    this.remaining = this.focusSeconds;
    this.duration = this.focusSeconds;
    this.closed = 0;
    this.lastSeconds = -1;
    this.root.visible = true;
    if (this.shutter) this.shutter.visible = true;
    revealAudio.playFocus(true);
    emit('focus-state', this.state());
    emit('music-play');
    emit('status', `Focus started: ${Math.round(this.focusSeconds / 60)} minutes`);
    this.applyDim(0);
    this.drawSign();
  }

  private pause() {
    if (!this.running) return;
    this.paused = !this.paused;
    emit('focus-state', this.state());
    emit('status', this.paused ? 'Focus paused' : 'Focus resumed');
  }

  private cancel() {
    if (!this.running) return;
    this.running = false;
    this.paused = false;
    this.remaining = 0;
    this.closed = 0;
    this.applyDim(0);
    if (this.shutter) { this.shutter.position.y = this.doorTopOpen(); this.shutter.visible = false; }
    this.root.visible = false;
    emit('focus-cancel');
    emit('focus-state', this.state());
    emit('status', 'Focus cancelled');
    revealAudio.playFocus(false);
    emit('music-stop');
  }

  private complete() {
    const minutes = Math.max(1, Math.round((this.phase === 'focus' ? this.focusSeconds : this.breakSeconds) / 60));
    if (this.phase === 'focus') addFocusMinutes(loadProgress(), minutes);
    emit('focus-complete', { phase: this.phase, minutes });
    if (this.phase === 'focus') {
      this.phase = 'break';
      this.remaining = this.breakSeconds;
      this.duration = this.breakSeconds;
      this.applyDim(0.55);
      emit('status', `Focus complete. Take a ${Math.max(1, Math.round(this.breakSeconds / 60))}-minute break.`);
      revealAudio.playChime();
      this.drawSign();
      emit('focus-state', this.state());
    } else {
      this.cancel();
    }
  }

  private doorTopOpen() {
    const room = garageState.room;
    const door = garageState.placements.find(placement => placement.slotId === 'door');
    const rule = slotRules.find(item => item.id === 'door');
    const height = Math.min((rule?.height ?? 2.2) * (door?.scale ?? 1), (room?.ceilingY ?? 2.7) - (room?.floor.y ?? 0) - 0.1);
    return (room?.floor.y ?? 0) + height * 2;
  }

  private doorTopClosed() {
    const room = garageState.room;
    const door = garageState.placements.find(placement => placement.slotId === 'door');
    const rule = slotRules.find(item => item.id === 'door');
    const height = Math.min((rule?.height ?? 2.2) * (door?.scale ?? 1), (room?.ceilingY ?? 2.7) - (room?.floor.y ?? 0) - 0.1);
    return (room?.floor.y ?? 0) + height;
  }

  private applyDim(t: number) {
    if (this.sky) {
      const material = this.sky.material as MeshBasicMaterial;
      material.color.copy(this.baseSkyColor).lerp(new Color(0x313041), t);
    }
    if (this.beam) (this.beam.material as MeshBasicMaterial).opacity = this.baseBeamOpacity * (1 - t * 0.75);
    if (this.dust) (this.dust.material as any).opacity = this.baseDustOpacity * (1 - t * 0.5);
  }

  private drawSign() {
    if (!this.signTexture) return;
    const canvas = (this.signTexture.userData as { canvas?: HTMLCanvasElement }).canvas;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(13,13,16,0.92)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = this.running ? '#e8ff2a' : '#3a4656'; ctx.lineWidth = 8; ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
    ctx.fillStyle = '#f5ecd7'; ctx.textAlign = 'center';
    ctx.font = 'bold 22px "GarageDisplay", sans-serif';
    ctx.fillText(this.running ? (this.paused ? 'PAUSED' : this.phase === 'focus' ? 'FOCUS' : 'BREAK') : 'READY', 160, 42);
    ctx.fillStyle = this.phase === 'focus' ? '#e8ff2a' : '#19e3ff';
    ctx.font = 'bold 54px "GarageDisplay", sans-serif';
    const clock = `${Math.floor(Math.max(0, this.remaining) / 60)}:${String(Math.max(0, Math.floor(this.remaining)) % 60).padStart(2, '0')}`;
    ctx.fillText(this.running ? clock : '25:00', 160, 100);
    this.signTexture.needsUpdate = true;
  }

  private state() {
    return { running: this.running, paused: this.paused, remaining: this.remaining, duration: this.duration, phase: this.phase };
  }

  private reset() {
    this.cancel();
    this.clear();
  }

  private clear() {
    for (const child of this.root.children) {
      child.traverse((object: any) => {
        object.geometry?.dispose?.();
        const material = object.material;
        if (Array.isArray(material)) material.forEach(item => { item.map?.dispose?.(); item.dispose?.(); });
        else { material?.map?.dispose?.(); material?.dispose?.(); }
      });
    }
    this.root.clear();
    this.shutter = undefined;
    this.sign = undefined;
    this.signTexture = undefined;
    this.built = false;
  }

  update(delta: number) {
    if (!this.running || this.paused || !this.shutter) return;
    if (!this.paused) {
      this.remaining = Math.max(0, this.remaining - delta);
      const targetClosed = this.phase === 'focus' ? 1 : 0.42;
      this.closed = Math.min(targetClosed, this.closed + delta * 0.35);
      const open = this.doorTopOpen(), closed = this.doorTopClosed();
      this.shutter.position.y = open + (closed - open) * Math.min(1, this.closed / targetClosed);
      this.applyDim(Math.min(1, this.closed / Math.max(0.01, targetClosed)) * (this.phase === 'focus' ? 0.95 : 0.55));
      if (Math.floor(this.remaining) !== this.lastSeconds) {
        this.lastSeconds = Math.floor(this.remaining);
        this.drawSign();
        emit('focus-state', this.state());
      }
      if (this.remaining <= 0) this.complete();
    }
  }
}
