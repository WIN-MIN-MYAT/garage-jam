import {
  AdditiveBlending, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, Group, Mesh, Points, ShaderMaterial,
} from '@iwsdk/core';
import { pointInPolygon, type RoomModel, type Vec2 } from '../room-model.js';

export const shutterVents = [
  { x: 0.34, y: 0.57, width: 0.29, height: 0.012 },
  { x: 0.66, y: 0.43, width: 0.30, height: 0.012 },
];

export function createDoorwayAtmosphere(room: RoomModel, door: Vec2, normal: Vec2, width: number, height: number) {
  const root = new Group();
  root.name = 'Evening doorway atmosphere';
  root.position.set(door.x, room.floor.y, door.z);
  root.rotation.y = Math.atan2(normal.x, normal.z);

  let reach = 0.22;
  for (let distance = 0.3; distance <= 2.65; distance += 0.1) {
    if (!pointInPolygon({ x: door.x + normal.x * distance, z: door.z + normal.z * distance }, room.floor.polygon)) break;
    reach = distance;
  }

  const uniforms = {
    uPresence: { value: 0 },
    uClosure: { value: 0 },
    uTime: { value: 0 },
    uMotion: { value: 1 },
    uLightColor: { value: new Color().setRGB(1, 0.76, 0.43) },
    uLightStrength: { value: 1 },
  };
  const visibility = /* glsl */`
    float doorwayLight(float vent) {
      float opening = pow(1.0 - uClosure, 1.45);
      return mix(opening, smoothstep(0.57, 0.94, uClosure), vent);
    }
  `;
  const positions: number[] = [];
  const uvs: number[] = [];
  const styles: number[] = [];
  type Point = [number, number, number];
  const ribbon = (start: Point, end: Point, sourceEdge: Point, endEdge: Point, vent: number, intensity: number) => {
    const ends = [start, end];
    const edges = [sourceEdge, endEdge];
    for (const [side, along] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) {
      const point = ends[along];
      const edge = edges[along];
      positions.push(point[0] + edge[0] * (side * 2 - 1), point[1] + edge[1] * (side * 2 - 1), point[2] + edge[2] * (side * 2 - 1));
      uvs.push(side, along);
      styles.push(vent, intensity);
    }
  };

  // A broad fan and its floor reflection share the same horizontal sun angle.
  const openStart: Point = [width * 0.14, height * 0.72, 0.05];
  const openEnd: Point = [-width * 0.23, 0.09, reach];
  ribbon(openStart, openEnd, [width * .36, 0, 0], [width * .51, 0, 0], 0, .18);
  ribbon(openStart, openEnd, [0, height * .2, 0], [0, .075, 0], 0, .105);
  ribbon([width * .09, .016, .12], [openEnd[0], .016, reach], [width * .25, 0, 0], [width * .53, 0, 0], 0, .17);

  // Each narrow shaft starts at a cutout in the shutter and widens in the room.
  for (const [index, vent] of shutterVents.entries()) {
    const x = (vent.x - .5) * width;
    const z = reach * (index === 0 ? .92 : .68);
    const start: Point = [x, vent.y * height, .052];
    const end: Point = [x - z * .30, .065, z];
    ribbon(start, end, [vent.width * width * .5, 0, 0], [vent.width * width * .64, 0, 0], 1, .22);
    ribbon(start, end, [0, vent.height * height * .65, 0], [0, .04, 0], 1, .23);
    ribbon([end[0] + .18, .019, z * .62], [end[0] - .08, .019, Math.min(reach, z * 1.23)],
      [vent.width * width * .3, 0, 0], [vent.width * width * .72, 0, 0], 1, .22);
  }
  const rayGeometry = new BufferGeometry();
  rayGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  rayGeometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  rayGeometry.setAttribute('aStyle', new Float32BufferAttribute(styles, 2));
  const rays = new Mesh(rayGeometry, new ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, side: DoubleSide, blending: AdditiveBlending,
    vertexShader: /* glsl */`
      uniform float uClosure;
      attribute vec2 aStyle;
      varying vec2 vUv;
      varying vec2 vStyle;
      void main() {
        vUv = uv;
        vStyle = aStyle;
        vec3 point = position;
        point.y = .016 + (point.y - .016) * mix(1.0 - uClosure, 1.0, aStyle.x);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(point, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uPresence;
      uniform float uClosure;
      uniform vec3 uLightColor;
      uniform float uLightStrength;
      varying vec2 vUv;
      varying vec2 vStyle;
      ${visibility}
      void main() {
        float edge = 1.0 - abs(vUv.x * 2.0 - 1.0);
        float softness = mix(1.75, .82, vStyle.x);
        float core = pow(edge, softness);
        float lengthFade = smoothstep(0.0, .10, vUv.y) * (1.0 - smoothstep(.45, 1.0, vUv.y));
        vec3 color = mix(uLightColor * vec3(1., .72, .65), uLightColor, vStyle.x);
        gl_FragColor = vec4(color, core * lengthFade * vStyle.y * uPresence * uLightStrength * doorwayLight(vStyle.x));
      }
    `,
  }));
  rays.name = 'Evening sun shafts';
  rays.renderOrder = 2;
  root.add(rays);

  const dustPositions: number[] = [];
  const dustStyles: number[] = [];
  let seed = 307;
  const random = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const addDust = (count: number, x: number, y: number, z: number, spread: number, vent: number) => {
    for (let i = 0; i < count; i++) {
      const along = .12 + random() * .75;
      dustPositions.push(x - along * z * .30 + (random() - .5) * spread,
        y * (1 - along) + (random() - .5) * (vent ? .10 : .42), along * z);
      dustStyles.push(random(), vent);
    }
  };
  addDust(38, openStart[0], openStart[1], reach, width * .72, 0);
  for (const [index, vent] of shutterVents.entries()) {
    addDust(11, (vent.x - .5) * width, vent.y * height, reach * (index ? .68 : .92), vent.width * width, 1);
  }
  const dustGeometry = new BufferGeometry();
  dustGeometry.setAttribute('position', new Float32BufferAttribute(dustPositions, 3));
  dustGeometry.setAttribute('aStyle', new Float32BufferAttribute(dustStyles, 2));
  const dust = new Points(dustGeometry, new ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: AdditiveBlending,
    vertexShader: /* glsl */`
      uniform float uTime;
      uniform float uMotion;
      uniform float uClosure;
      attribute vec2 aStyle;
      varying vec2 vStyle;
      void main() {
        vStyle = aStyle;
        float phase = uTime * .38 + aStyle.x * 14.0;
        vec3 drift = vec3(sin(phase), cos(phase * .73), sin(phase * .58)) * .035 * uMotion;
        vec3 motes = position + drift;
        motes.y *= mix(1.0 - uClosure, 1.0, aStyle.y);
        vec4 point = modelViewMatrix * vec4(motes, 1.0);
        gl_Position = projectionMatrix * point;
        gl_PointSize = clamp((3.1 + aStyle.x * 3.7) / max(.6, -point.z), 1.25, 7.0);
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uPresence;
      uniform float uClosure;
      uniform vec3 uLightColor;
      uniform float uLightStrength;
      varying vec2 vStyle;
      ${visibility}
      void main() {
        float falloff = 1.0 - smoothstep(.08, .5, length(gl_PointCoord - .5));
        gl_FragColor = vec4(uLightColor, falloff * (.26 + vStyle.x * .28) * uPresence * uLightStrength * doorwayLight(vStyle.y));
      }
    `,
  }));
  dust.name = 'Dust motes in the sun beam';
  dust.renderOrder = 3;
  root.add(dust);
  return { root, uniforms };
}
