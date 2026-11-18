import { CanvasTexture, RepeatWrapping, Vector2, Vector3, type Material } from '@iwsdk/core';
import { styleMode } from './comic-style.js';
import type { Vec2 } from './room-model.js';

type Surface = 'wall' | 'floor' | 'wood';
export type PrintTextures = Partial<Record<Surface, CanvasTexture>>;

export function applySurfacePrint(
  material: Material,
  textures: PrintTextures,
  surface: Surface,
  origin: Vec2 & { y?: number },
  yaw = 0,
  worktop?: { y: number; width: number; depth: number },
) {
  if (styleMode === 'plain') return;
  const texture = textures[surface] ??= makePrintTexture(surface);
  const wall = surface === 'wall';
  const axis = new Vector2(Math.cos(yaw), -Math.sin(yaw));
  const scale = new Vector2(worktop?.width ?? (wall ? 3.6 : 3.1), worktop?.depth ?? (wall ? 2.7 : 3.1));
  const previousCompile = material.onBeforeCompile;
  material.onBeforeCompile = function (shader, renderer) {
    previousCompile.call(this, shader, renderer);
    shader.uniforms.gjPrintMap = { value: texture };
    shader.uniforms.gjPrintAxis = { value: axis };
    shader.uniforms.gjPrintScale = { value: scale };
    shader.uniforms.gjPrintOrigin = { value: new Vector3(origin.x, worktop?.y ?? origin.y ?? 0, origin.z) };
    shader.vertexShader = /* glsl */`
      uniform vec2 gjPrintAxis;
      uniform vec2 gjPrintScale;
      uniform vec3 gjPrintOrigin;
      varying vec2 gjPrintUv;
      varying float gjPrintHeight;
    ` + shader.vertexShader.replace('#include <begin_vertex>', /* glsl */`
      #include <begin_vertex>
      vec3 gjPrintPoint = (modelMatrix * vec4(transformed, 1.0)).xyz - gjPrintOrigin;
      gjPrintHeight = gjPrintPoint.y;
      gjPrintUv = vec2(dot(gjPrintPoint.xz, gjPrintAxis),
        ${wall ? 'gjPrintPoint.y' : 'dot(gjPrintPoint.xz, vec2(-gjPrintAxis.y, gjPrintAxis.x))'}) / gjPrintScale${worktop ? ' + 0.5' : ''};
    `);
    shader.fragmentShader = /* glsl */`
      uniform sampler2D gjPrintMap;
      varying vec2 gjPrintUv;
      varying float gjPrintHeight;
    ` + shader.fragmentShader.replace('#include <map_fragment>', /* glsl */`
      #include <map_fragment>
      vec2 gjPrint = texture2D(gjPrintMap, gjPrintUv).rg;
      ${worktop ? 'gjPrint *= 1.0 - smoothstep(0.008, 0.034, abs(gjPrintHeight));' : ''}
      diffuseColor.rgb *= 1.0 - gjPrint.r * ${wall ? '0.18' : '0.15'};
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.63, 0.41, 0.30), gjPrint.g * ${wall ? '0.09' : '0.10'});
    `);
  };
  material.customProgramCacheKey = () => `garage-print-${surface}`;
  material.needsUpdate = true;
}

function makePrintTexture(surface: Surface) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 512, 512);
  let seed = surface === 'wall' ? 134 : surface === 'floor' ? 719 : 381;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const stroke = (points: [number, number][], width: number, alpha: number, highlight = false) => {
    ctx.beginPath();
    ctx.moveTo(...points[0]);
    for (const point of points.slice(1)) ctx.lineTo(...point);
    ctx.strokeStyle = highlight ? `rgba(0,255,0,${alpha})` : `rgba(255,0,0,${alpha})`;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };
  const hatch = (x: number, y: number, count: number, length: number, spacing: number) => {
    for (let i = 0; i < count; i++) {
      const n = length * (0.7 + random() * 0.55);
      const start = x + i * spacing;
      const top = y + i + random() * 4;
      stroke([[start, top], [start + n * 0.36, top - n * 0.4], [start + n * 0.75, top - n]],
        0.8 + random() * 1.15, 0.34 + random() * 0.28);
    }
  };
  const dots = (x: number, y: number, w: number, h: number, step: number, strength: number) => {
    for (let row = 0; row * step < h * 2; row++) {
      for (let col = 0; col * step < w * 2; col++) {
        const dx = col * step + (row % 2) * step * 0.5 - w;
        const dy = row * step - h;
        const weight = Math.max(0, 1 - Math.hypot(dx / w, dy / h));
        if (weight < 0.1) continue;
        ctx.fillStyle = `rgba(255,0,0,${weight * strength})`;
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, 0.75 + weight * 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };

  if (surface === 'wall') {
    dots(106, 321, 82, 125, 9, 0.9);
    dots(391, 133, 92, 54, 8, 0.82);
    hatch(56, 175, 5, 15, 4);
    hatch(363, 388, 5, 12, 4);
    stroke([[265, 305], [276, 309], [287, 307], [300, 313]], 1.6, 0.5);
    stroke([[271, 312], [281, 314], [293, 313]], 1.1, 0.44, true);
  } else if (surface === 'floor') {
    dots(155, 324, 102, 64, 7, 0.72);
    dots(405, 141, 73, 53, 8, 0.72);
    for (const [x, y] of [[308, 301], [63, 131], [390, 457]]) {
      for (let i = 0; i < 4; i++) {
        const offset = i * 3;
        const length = 29 + random() * 42;
        stroke([[x + offset, y + offset], [x + length * 0.62 + offset, y - length * 0.17 + offset],
          [x + length + offset, y - length * 0.27 + offset]], 1.2 + random(), 0.25 + random() * 0.36, i === 1);
      }
    }
    hatch(181, 92, 6, 10, 4);
  } else {
    for (let i = 0; i < 30; i++) {
      const x = 16 + random() * 385, y = 18 + random() * 475;
      const length = 25 + random() * 76;
      stroke([[x, y], [x + length * 0.38, y + random() * 2 - 1], [x + length, y + random() * 5 - 2.5]],
        1 + random() * 2.4, 0.3 + random() * 0.36, i % 5 === 0);
    }
    hatch(103, 432, 4, 16, 5);
    hatch(414, 115, 5, 12, 4);
    stroke([[391, 364], [411, 361], [405, 374], [425, 372]], 2.2, 0.63);
  }

  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.name = `Garage ${surface} ink texture`;
  return texture;
}
