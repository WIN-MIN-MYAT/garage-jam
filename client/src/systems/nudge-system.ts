import { CanvasTexture, createSystem, Group, SRGBColorSpace, Sprite, SpriteMaterial } from '@iwsdk/core';
import { emit, garageEvents } from '../events.js';
import { garageState } from '../garage-state.js';
import { registerGarageRoot, unregisterGarageRoot } from '../garage-visibility.js';
import { revealAudio } from '../reveal/RevealAudio.js';

const messages = [
  'STRETCH YOUR SHOULDERS',
  'DRINK SOME WATER',
  'LOOK AT THE SUNSET FOR 20 SECONDS',
  '20-20-20: LOOK 20 FT AWAY',
];
const demo = new URLSearchParams(location.search).get('nudgeDemo') === '1';

export class NudgeSystem extends createSystem({}) {
  private sprite?: Sprite;
  private texture?: CanvasTexture;
  private root = new Group();
  private timer = 0;
  private visibleUntil = 0;
  private next = 0;

  init() {
    this.root.name = 'Break nudge root';
    this.world.scene.add(this.root);
    registerGarageRoot(this.root);
    const onRevealed = () => this.build();
    const onDismiss = () => this.hide();
    garageEvents.addEventListener('garage-revealed', onRevealed);
    garageEvents.addEventListener('nudge-dismiss', onDismiss);
    this.cleanupFuncs.push(() => {
      garageEvents.removeEventListener('garage-revealed', onRevealed);
      garageEvents.removeEventListener('nudge-dismiss', onDismiss);
      window.clearInterval(this.timer);
      this.hide();
      this.sprite?.removeFromParent();
      this.texture?.dispose();
      unregisterGarageRoot(this.root);
      this.root.removeFromParent();
    });
    if (location.hostname === 'localhost') (window as any).garageNudgeDebug = { show: () => this.show(), dismiss: () => this.hide() };
  }

  private build() {
    if (!garageState.room || this.sprite) return;
    const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 192;
    this.texture = new CanvasTexture(canvas); this.texture.colorSpace = SRGBColorSpace;
    this.sprite = new Sprite(new SpriteMaterial({ map: this.texture, depthTest: false, depthWrite: false, transparent: true }));
    this.sprite.name = 'Break nudge';
    this.sprite.scale.set(1.6, 0.4, 1);
    this.sprite.renderOrder = 950;
    this.sprite.visible = false;
    const room = garageState.room;
    const neon = garageState.placements.find(placement => placement.slotId === 'neon');
    const point = neon?.position ?? { x: room.seat.x, y: room.floor.y + 2.0, z: room.seat.z - 1.8 };
    this.sprite.position.set(point.x, point.y - 0.35, point.z);
    this.sprite.lookAt(room.seat.x, point.y - 0.35, room.seat.z);
    this.root.add(this.sprite);
    this.timer = window.setInterval(() => this.tick(), 1000);
    this.next = Date.now() + (demo ? 45 : 50 * 60) * 1000;
  }

  private tick() {
    const now = Date.now();
    if (this.sprite?.visible && now > this.visibleUntil) this.hide();
    const interval = demo ? 45 : 50 * 60;
    if (now >= this.next) {
      this.next = now + interval * 1000;
      this.show();
    }
  }

  private show() {
    if (!this.sprite || !this.texture) return;
    const canvas = this.texture.image as HTMLCanvasElement;
    const ctx = canvas.getContext('2d')!;
    const message = messages[this.next % messages.length];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(13,13,16,0.94)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#e8ff2a'; ctx.lineWidth = 10; ctx.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
    ctx.fillStyle = '#ff2d95'; ctx.font = 'bold 20px "GarageDisplay", sans-serif'; ctx.textAlign = 'left'; ctx.fillText('GARAGE JAM / BREAK NUDGE', 28, 38);
    ctx.fillStyle = '#f5ecd7'; ctx.font = 'bold 38px "GarageDisplay", sans-serif'; ctx.fillText(message, 28, 118);
    this.texture.needsUpdate = true;
    this.sprite.visible = true;
    this.visibleUntil = Date.now() + 12000;
    emit('status', message);
    emit('nudge', { message });
    revealAudio.playNudge();
  }

  private hide() {
    if (this.sprite) this.sprite.visible = false;
  }
}
