import {
  Color, DataTexture, LinearFilter, RepeatWrapping, RGBAFormat, UnsignedByteType, Vector2, Vector3,
} from '@iwsdk/core';
import revealChunk from './revealChunk.glsl?raw';
import config from './reveal.config.json';
import type { RevealBeatId, RevealSurface, RevealSurfaceMode, RevealUniforms } from './reveal-types.js';

let noiseTexture: DataTexture | null = null;
let dripTexture: DataTexture | null = null;

function makeNoiseTexture() {
  const size = 128;
  const grid = 16;
  const data = new Uint8Array(size * size * 4);
  let seed = 4711;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const lattice = Array.from({ length: (grid + 1) * (grid + 1) }, () => random());
  const sample = (x: number, y: number) => {
    const gx = x * grid, gy = y * grid;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (ix: number, iy: number) => lattice[Math.min(grid, Math.max(0, iy)) * (grid + 1) + Math.min(grid, Math.max(0, ix))];
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = Math.round((sample(x / size, y / size) * 0.72 + sample(x / size * 2.3, y / size * 2.3) * 0.28) * 255);
      const i = (y * size + x) * 4;
      data[i] = value; data[i + 1] = value; data[i + 2] = value; data[i + 3] = 255;
    }
  }
  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping; texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearFilter; texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function makeDripTexture() {
  const width = 256;
  const data = new Uint8Array(width * 4);
  let seed = 913;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const marks = new Float32Array(width);
  for (let i = 0; i < width; i++) {
    if (random() < 0.974) continue;
    const radius = 5 + Math.floor(random() * 6);
    const height = 0.16 + random() * 0.22;
    for (let offset = -radius; offset <= radius; offset++) {
      const falloff = 0.5 + 0.5 * Math.cos(Math.PI * offset / radius);
      const index = (i + offset + width) % width;
      marks[index] = Math.max(marks[index], height * falloff);
    }
  }
  for (let i = 0; i < width; i++) {
    const phase = i / width * Math.PI * 2;
    const edge = 0.32 + 0.12 * Math.sin(phase * 4) + 0.08 * Math.sin(phase * 2 + 1.7) + marks[i];
    const value = Math.round(edge * 255);
    data[i * 4] = value; data[i * 4 + 1] = value; data[i * 4 + 2] = value; data[i * 4 + 3] = 255;
  }
  const texture = new DataTexture(data, width, 1, RGBAFormat, UnsignedByteType);
  texture.wrapS = RepeatWrapping; texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearFilter; texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function revealTextures() {
  noiseTexture ??= makeNoiseTexture();
  dripTexture ??= makeDripTexture();
  return { noise: noiseTexture, drip: dripTexture };
}

export function disposeRevealTextures() {
  noiseTexture?.dispose(); dripTexture?.dispose();
  noiseTexture = null; dripTexture = null;
}

export function createRevealSurface(id: string, beat: RevealBeatId, mode: RevealSurfaceMode, order = 0): RevealSurface {
  const textures = revealTextures();
  const uniforms: RevealUniforms = {
    uRevealOrigin: { value: new Vector3() },
    uRevealProgress: { value: 0 },
    uRevealDir: { value: new Vector3(0, 0, 1) },
    uRevealRange: { value: new Vector2(0, 1) },
    uRevealMode: { value: mode === 'radial' ? 0 : mode === 'vertical' ? 1 : 2 },
    uRevealEdgeWidth: { value: config.edgeWidth },
    uRevealEdgeColor: { value: new Color(config.edgeColor[0], config.edgeColor[1], config.edgeColor[2]) },
    uRevealNoise: { value: textures.noise },
    uRevealDrip: { value: textures.drip },
    uRevealTime: { value: 0 },
    uRevealNoiseAmount: { value: mode === 'radial' ? 0.030 : mode === 'vertical' ? 0.034 : 0.024 },
    uRevealDripAmount: { value: mode === 'vertical' ? 0.075 : 0.015 },
    uRevealUseNoise: { value: 1 },
    uRevealUseDrips: { value: 1 },
  };
  return { id, beat, mode, materials: [], uniforms, start: 0, duration: 1, order };
}

export function applyRevealMaterial(material: any, surface: RevealSurface) {
  if (!material || material.userData?.gjRevealSurface === surface.id) return;
  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader: any, renderer: unknown) => {
    previousCompile?.call(material, shader, renderer);
    for (const [key, uniform] of Object.entries(surface.uniforms)) shader.uniforms[key] = uniform;
    shader.vertexShader = `varying vec3 vRevealWorld;\n${shader.vertexShader}`.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n  vRevealWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    );
    shader.fragmentShader = `${revealChunk}\n${shader.fragmentShader}`.replace(
      'void main() {',
      'void main() {\n  float gjReveal = gjRevealValue(vRevealWorld);\n  if (uRevealProgress <= 0.0 || gjReveal > uRevealProgress) discard;\n  float gjDistance = uRevealProgress - gjReveal;\n  float gjEdge = 1.0 - smoothstep(0.0, uRevealEdgeWidth, gjDistance);\n  if (uRevealMode > 0.5 && uRevealMode < 1.5) {\n    float lip = 1.0 - smoothstep(0.0, uRevealEdgeWidth * 0.42, gjDistance);\n    float paint = 1.0 - smoothstep(0.0, uRevealEdgeWidth * 1.7, gjDistance);\n    gjEdge = (lip * 0.56 + paint * 0.28) * (1.0 - smoothstep(0.95, 1.04, uRevealProgress));\n  }',
    ).replace(
      '#include <dithering_fragment>',
      'gl_FragColor.rgb = mix(gl_FragColor.rgb, uRevealEdgeColor, gjEdge * 0.82);\n#include <dithering_fragment>',
    );
    material.userData.__gjRevealInjected = shader.fragmentShader.includes('gjRevealValue') && shader.vertexShader.includes('vRevealWorld =');
  };
  material.customProgramCacheKey = () => `garage-reveal-${surface.id}-${material.uuid}`;
  material.userData.gjRevealSurface = surface.id;
  material.needsUpdate = true;
  if (!surface.materials.includes(material)) surface.materials.push(material);
  return material;
}

/** Project an outline onto a direction, returning the full sweep range. */
export function projectionRange(points: { x: number; z: number }[], dir: { x: number; z: number }) {
  const length = Math.hypot(dir.x, dir.z) || 1;
  const nx = dir.x / length, nz = dir.z / length;
  let min = Infinity, max = -Infinity;
  for (const point of points) {
    const value = point.x * nx + point.z * nz;
    min = Math.min(min, value); max = Math.max(max, value);
  }
  return { min, max, dir: new Vector3(nx, 0, nz) };
}
