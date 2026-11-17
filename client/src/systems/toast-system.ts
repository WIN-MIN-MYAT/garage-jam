import {
  CanvasTexture,
  createSystem,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import { garageEvents } from '../events.js';

type Severity = 'info' | 'success' | 'error';

const palette: Record<Severity, { accent: string; border: string; icon: string }> = {
  info: { accent: '#e8ff2a', border: '#4b4a36', icon: 'i' },
  success: { accent: '#8ef5a9', border: '#35513f', icon: '\u2713' },
  error: { accent: '#ff5c9e', border: '#5a2a3d', icon: '!' },
};

const technicalNoise = /^(ROOM BUILT|ROOM SCAN|GARAGE LOCKED|Room:|Reveal quality|Props rearranged|Props adjusted|Slot |Table height|Table view:)/;
const taskNoise = /(papers, \+\d+ more|local tasks ready|tasks from Notion|cached tasks)/i;
const errorPattern = /(fail|error|unavailable|denied|could not|cannot|can't|no room scan|not supported|offline|blocked|lost|try again|permission|did not|no playlists|no spotify)/i;
const successPattern = /(done|saved|confirmed|added|pinned|cleared|complete|finished|started|connected|live|reset|ready)/i;

function classify(text: string): Severity {
  if (errorPattern.test(text)) return 'error';
  if (successPattern.test(text)) return 'success';
  return 'info';
}

function currentLineWidth(ctx: CanvasRenderingContext2D, text: string) {
  return ctx.measureText(text).width;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (currentLineWidth(ctx, candidate) > maxWidth && line) {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    } else {
      line = candidate;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines && words.length) {
    const used = lines.join(' ').split(/\s+/).length;
    if (used < words.length) {
      let last = lines[lines.length - 1];
      while (last.length > 1 && currentLineWidth(ctx, `${last}\u2026`) > maxWidth) last = last.slice(0, -1);
      lines[lines.length - 1] = `${last}\u2026`;
    }
  }
  return lines;
}

/**
 * World-space feedback surface for the product flow.
 *
 * The debug HUD is hidden in the product entry, so status and error messages
 * need their own small, readable surface. The toast is intentionally not a
 * garage root: it stays visible in passthrough and above panels.
 */
export class ToastSystem extends createSystem({}) {
  private canvas?: HTMLCanvasElement;
  private texture?: CanvasTexture;
  private sprite?: Sprite;
  private material?: SpriteMaterial;
  private shownAt = 0;
  private visibleUntil = 0;
  private opacity = 0;
  private lastText = '';
  private lastAt = 0;
  private head = new Vector3();
  private forward = new Vector3();
  private lastForward = new Vector3(0, 0, -1);

  init() {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 180;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const material = new SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
    const sprite = new Sprite(material);
    sprite.name = 'Status toast';
    sprite.scale.set(0.64, 0.18, 1);
    sprite.renderOrder = 1500;
    sprite.visible = false;
    this.world.scene.add(sprite);
    this.canvas = canvas;
    this.texture = texture;
    this.material = material;
    this.sprite = sprite;

    const onStatus = (event: Event) => {
      const text = String((event as CustomEvent).detail ?? '').replace(/\s+/g, ' ').trim();
      if (!text || !this.world.session) return;
      const severity = classify(text);
      if (severity !== 'error' && (technicalNoise.test(text) || taskNoise.test(text))) return;
      const now = performance.now();
      if (text === this.lastText && now - this.lastAt < 1500) return;
      this.lastText = text;
      this.lastAt = now;
      this.show(text, severity);
    };
    const stopVisibility = this.world.visibilityState.subscribe(state => {
      if (state === VisibilityState.NonImmersive) this.hideNow();
    });
    garageEvents.addEventListener('status', onStatus);
    this.cleanupFuncs.push(() => {
      garageEvents.removeEventListener('status', onStatus);
      stopVisibility();
      this.sprite?.removeFromParent();
      this.material?.dispose();
      this.texture?.dispose();
      this.canvas = undefined;
      this.texture = undefined;
      this.material = undefined;
      this.sprite = undefined;
    });

    if (location.hostname === 'localhost') {
      (window as any).garageToastDebug = {
        show: (text: string) => this.show(String(text), classify(String(text))),
        hide: () => this.hideNow(),
        get text() { return system.lastText; },
      };
      const system = this;
    }
  }

  private show(text: string, severity: Severity) {
    const sprite = this.sprite;
    const camera = this.world.camera;
    if (!sprite || !camera) return;
    this.draw(text, severity);
    camera.getWorldPosition(this.head);
    camera.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-4) this.forward.copy(this.lastForward);
    else this.lastForward.copy(this.forward);
    this.forward.normalize();
    sprite.position.copy(this.head).addScaledVector(this.forward, 1.05);
    sprite.position.y = this.head.y - 0.14;
    sprite.visible = true;
    this.shownAt = performance.now();
    this.visibleUntil = this.shownAt + 4600;
    this.opacity = Math.max(this.opacity, 0.25);
  }

  private draw(text: string, severity: Severity) {
    const canvas = this.canvas;
    const texture = this.texture;
    if (!canvas || !texture) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const colors = palette[severity];
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    ctx.beginPath();
    ctx.roundRect(3, 3, width - 6, height - 6, 18);
    ctx.fillStyle = 'rgba(13,13,16,0.94)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = colors.border;
    ctx.stroke();
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.roundRect(3, 3, 12, height - 6, [18, 0, 0, 18]);
    ctx.fill();

    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.arc(46, height / 2, 19, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#101116';
    ctx.font = 'bold 24px "GarageDisplay", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(colors.icon, 46, height / 2 + 1);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#f3ecd9';
    ctx.font = 'bold 25px "GarageDisplay", "Segoe UI", sans-serif';
    const lines = wrap(ctx, text, width - 104, 3);
    const lineHeight = 31;
    const startY = height / 2 - (lines.length * lineHeight) / 2 - 1;
    lines.forEach((line, index) => ctx.fillText(line, 84, startY + index * lineHeight));
    texture.needsUpdate = true;
  }

  update(delta: number) {
    const sprite = this.sprite;
    const material = this.material;
    if (!sprite || !material || !sprite.visible) return;
    const now = performance.now();
    const fadeIn = Math.min(1, Math.max(0, (now - this.shownAt) / 160));
    const fadeOut = Math.min(1, Math.max(0, (this.visibleUntil - now) / 280));
    const target = Math.min(fadeIn, fadeOut);
    this.opacity += (target - this.opacity) * Math.min(1, delta * 14);
    material.opacity = Math.max(0, Math.min(1, this.opacity));
    if (now >= this.visibleUntil && this.opacity < 0.02) this.hideNow();
  }

  private hideNow() {
    if (this.sprite) this.sprite.visible = false;
    this.opacity = 0;
    if (this.material) this.material.opacity = 0;
  }
}
