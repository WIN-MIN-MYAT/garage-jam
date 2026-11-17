import {
  BufferAttribute, CanvasTexture, Color, DoubleSide, DynamicDrawUsage, Group,
  InstancedBufferAttribute, InstancedBufferGeometry, Mesh, NormalBlending, ShaderMaterial, SRGBColorSpace, Vector2,
} from '@iwsdk/core';

type SpawnOptions = {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  life?: number;
  startScale?: number;
  endScale?: number;
  rotation?: number;
  spin?: number;
  color?: Color;
  uvOffset?: number;
};

const vertexShader = `
attribute vec3 aCenter;
attribute float aScale;
attribute float aRotation;
attribute vec3 aColor;
attribute float aAlpha;
attribute vec2 aUvOffset;
uniform vec2 uUvScale;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
void main() {
  float c = cos(aRotation);
  float s = sin(aRotation);
  vec2 corner = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
  vec4 center = viewMatrix * vec4(aCenter, 1.0);
  center.xy += corner * aScale;
  gl_Position = projectionMatrix * center;
  vUv = uv * uUvScale + aUvOffset;
  vColor = aColor;
  vAlpha = aAlpha;
}`;

const fragmentShader = `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 tex = texture2D(uMap, vUv);
  if (tex.a < 0.01 || vAlpha < 0.01) discard;
  gl_FragColor = vec4(vColor * tex.rgb, tex.a * vAlpha);
}`;

class BillboardPool {
  readonly mesh: Mesh;
  private readonly max: number;
  private readonly geometry: InstancedBufferGeometry;
  private readonly centers: Float32Array;
  private readonly scales: Float32Array;
  private readonly rotations: Float32Array;
  private readonly colors: Float32Array;
  private readonly alphas: Float32Array;
  private readonly uvOffsets: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly startScale: Float32Array;
  private readonly endScale: Float32Array;
  private readonly spin: Float32Array;
  private cursor = 0;
  private budget: number;

  constructor(parent: Group, texture: CanvasTexture, max: number, uvScale: number) {
    this.max = max;
    this.budget = max;
    this.centers = new Float32Array(max * 3);
    this.scales = new Float32Array(max);
    this.rotations = new Float32Array(max);
    this.colors = new Float32Array(max * 3);
    this.alphas = new Float32Array(max);
    this.uvOffsets = new Float32Array(max * 2);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.vx = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.vz = new Float32Array(max);
    this.startScale = new Float32Array(max);
    this.endScale = new Float32Array(max);
    this.spin = new Float32Array(max);

    const geometry = new InstancedBufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array([
      -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ]), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), 2));
    geometry.setIndex([0, 1, 2, 0, 2, 3]);
    geometry.setAttribute('aCenter', new InstancedBufferAttribute(this.centers, 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute('aScale', new InstancedBufferAttribute(this.scales, 1).setUsage(DynamicDrawUsage));
    geometry.setAttribute('aRotation', new InstancedBufferAttribute(this.rotations, 1).setUsage(DynamicDrawUsage));
    geometry.setAttribute('aColor', new InstancedBufferAttribute(this.colors, 3).setUsage(DynamicDrawUsage));
    geometry.setAttribute('aAlpha', new InstancedBufferAttribute(this.alphas, 1).setUsage(DynamicDrawUsage));
    geometry.setAttribute('aUvOffset', new InstancedBufferAttribute(this.uvOffsets, 2).setUsage(DynamicDrawUsage));
    geometry.instanceCount = max;
    this.geometry = geometry;

    const material = new ShaderMaterial({
      uniforms: { uMap: { value: texture }, uUvScale: { value: new Vector2(uvScale, 1) } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: DoubleSide,
      blending: NormalBlending,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 900;
    this.mesh.name = 'Reveal particles';
    parent.add(this.mesh);
  }

  setBudget(value: number) {
    this.budget = Math.max(0, Math.min(this.max, Math.floor(value)));
    this.geometry.instanceCount = Math.max(1, this.budget);
    for (let i = this.budget; i < this.max; i++) this.alphas[i] = 0;
  }

  spawn(options: SpawnOptions) {
    if (this.budget <= 0) return;
    const index = this.cursor % this.budget;
    this.cursor = (this.cursor + 1) % Math.max(1, this.budget);
    const i3 = index * 3, i2 = index * 2;
    this.centers[i3] = options.x; this.centers[i3 + 1] = options.y; this.centers[i3 + 2] = options.z;
    this.vx[index] = options.vx ?? 0; this.vy[index] = options.vy ?? 0; this.vz[index] = options.vz ?? 0;
    this.life[index] = this.maxLife[index] = Math.max(0.05, options.life ?? 0.8);
    this.startScale[index] = options.startScale ?? 0.08;
    this.endScale[index] = options.endScale ?? 0.18;
    this.scales[index] = this.startScale[index];
    this.rotations[index] = options.rotation ?? Math.random() * Math.PI * 2;
    this.spin[index] = options.spin ?? 0;
    const color = options.color ?? new Color(1, 1, 1);
    this.colors[i3] = color.r; this.colors[i3 + 1] = color.g; this.colors[i3 + 2] = color.b;
    this.alphas[index] = 1;
    this.uvOffsets[i2] = options.uvOffset ?? 0;
    this.uvOffsets[i2 + 1] = 0;
    this.touch();
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alphas[i] = 0; continue; }
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.alphas[i] = 0; continue; }
      const t = 1 - this.life[i] / this.maxLife[i];
      this.centers[i * 3] += this.vx[i] * dt;
      this.centers[i * 3 + 1] += this.vy[i] * dt;
      this.centers[i * 3 + 2] += this.vz[i] * dt;
      this.vy[i] -= 0.15 * dt;
      this.rotations[i] += this.spin[i] * dt;
      this.scales[i] = this.startScale[i] + (this.endScale[i] - this.startScale[i]) * t;
      this.alphas[i] = Math.sin(Math.min(1, t) * Math.PI) * (1 - t * 0.25);
    }
    this.touch();
  }

  private touch() {
    (this.geometry.getAttribute('aCenter') as InstancedBufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aScale') as InstancedBufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aRotation') as InstancedBufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aColor') as InstancedBufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aAlpha') as InstancedBufferAttribute).needsUpdate = true;
    (this.geometry.getAttribute('aUvOffset') as InstancedBufferAttribute).needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.alphas.fill(0);
    this.touch();
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}

function makeParticleTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 58);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.95)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.beginPath(); ctx.arc(64, 64, 56, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  for (let i = 0; i < 8; i++) {
    const angle = i / 8 * Math.PI * 2;
    const inner = 18, outer = 54;
    ctx.beginPath();
    ctx.moveTo(64 + Math.cos(angle - 0.10) * inner, 64 + Math.sin(angle - 0.10) * inner);
    ctx.lineTo(64 + Math.cos(angle) * outer, 64 + Math.sin(angle) * outer);
    ctx.lineTo(64 + Math.cos(angle + 0.10) * inner, 64 + Math.sin(angle + 0.10) * inner);
    ctx.closePath(); ctx.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export const popWords = ['THUD!', 'READY!', 'WELCOME BACK', 'POP!', 'LEFT WRIST'] as const;
export type PopWord = typeof popWords[number];
const sprayColors = [new Color(0xff2d95), new Color(0x19e3ff), new Color(0xe8ff2a)];
const dustColor = new Color(0xffe5b0);
const whiteColor = new Color(0xffffff);

function makePopAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, 1280, 256);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 16;
  ctx.strokeStyle = '#0b0b0e';
  popWords.forEach((word, index) => {
    const size = word.length > 8 ? 60 : 82;
    ctx.font = `900 ${size}px Anton, Impact, sans-serif`;
    const x = 128 + index * 256;
    ctx.strokeText(word, x, 132, 224);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(word, x, 132, 224);
  });
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export class RevealParticles {
  private readonly parent: Group;
  private readonly dust: BillboardPool;
  private readonly pops: BillboardPool;
  private budget = 200;
  private popBudget = 8;
  private popCursor = 0;

  constructor(parent: Group) {
    this.parent = parent;
    const particleTexture = makeParticleTexture();
    const popTexture = makePopAtlas();
    this.dust = new BillboardPool(parent, particleTexture, 200, 1);
    this.pops = new BillboardPool(parent, popTexture, 8, 0.2);
    this.dust.mesh.name = 'Reveal dust pool';
    this.pops.mesh.name = 'Reveal pop pool';
    this.setBudget(200);
  }

  setBudget(value: number) {
    this.budget = Math.max(0, Math.min(200, Math.floor(value)));
    this.dust.setBudget(this.budget);
    this.pops.setBudget(Math.min(this.popBudget, Math.max(0, Math.floor(this.budget / 25))));
  }

  setPopBudget(value: number) {
    this.popBudget = Math.max(0, Math.min(8, Math.floor(value)));
    this.pops.setBudget(this.popBudget);
  }

  spawnSpray(x: number, y: number, z: number, count = 3) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.25 + Math.random() * 0.55;
      this.dust.spawn({
        x, y: y + 0.04 + Math.random() * 0.18, z,
        vx: Math.cos(angle) * speed, vy: 0.25 + Math.random() * 0.35, vz: Math.sin(angle) * speed,
        life: 0.35 + Math.random() * 0.30, startScale: 0.035, endScale: 0.055,
        color: sprayColors[i % sprayColors.length], spin: (Math.random() - 0.5) * 8,
      });
    }
  }

  spawnDust(x: number, y: number, z: number, count = 6) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.10 + Math.random() * 0.28;
      this.dust.spawn({
        x, y: y + 0.03, z,
        vx: Math.cos(angle) * speed, vy: 0.08 + Math.random() * 0.18, vz: Math.sin(angle) * speed,
        life: 0.5 + Math.random() * 0.35, startScale: 0.06, endScale: 0.16,
        color: dustColor, spin: (Math.random() - 0.5) * 3,
      });
    }
  }

  spawnPoof(x: number, y: number, z: number, color = dustColor, count = 8) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.25 + Math.random() * 0.5;
      this.dust.spawn({
        x, y: y + 0.04, z,
        vx: Math.cos(angle) * speed, vy: 0.10 + Math.random() * 0.25, vz: Math.sin(angle) * speed,
        life: 0.5 + Math.random() * 0.3, startScale: 0.07, endScale: 0.20,
        color, spin: (Math.random() - 0.5) * 5,
      });
    }
  }

  spawnPop(word: PopWord, x: number, y: number, z: number, scale = 0.34, color = whiteColor) {
    const index = popWords.indexOf(word);
    if (index < 0) return;
    // The atlas is one row; each word gets a 0.25 slice.
    this.pops.spawn({
      x, y, z, vx: 0, vy: 0.12, vz: 0,
      life: 0.86, startScale: scale * 0.55, endScale: scale,
      rotation: (Math.random() - 0.5) * 0.10, spin: (Math.random() - 0.5) * 0.22,
      color, uvOffset: index * 0.2,
    });
    this.popCursor = (this.popCursor + 1) % popWords.length;
  }

  update(dt: number) {
    this.dust.update(dt);
    this.pops.update(dt);
  }

  clear() {
    this.dust.clear();
    this.pops.clear();
  }

  dispose() {
    this.dust.dispose();
    this.pops.dispose();
    this.parent.removeFromParent();
  }
}
