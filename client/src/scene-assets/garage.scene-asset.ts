import { BoxGeometry, BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, PlaneGeometry, Points, PointsMaterial, ShaderMaterial } from '@iwsdk/core';
import { roomConfig as room } from '../room-config.js';
const concrete = new MeshStandardMaterial({ color: 0x777579, roughness: 1 });
const brick = new MeshStandardMaterial({ color: 0x79655e, roughness: 1, side: DoubleSide });
const steel = new MeshStandardMaterial({ color: 0x59616b, roughness: 0.85 });
function box(group: Group, name: string, w: number, h: number, d: number, x: number, y: number, z: number, material = brick) {
  const mesh = new Mesh(new BoxGeometry(w, h, d), material);
  mesh.name = name;
  mesh.position.set(x, y, z);
  group.add(mesh);
}
export function createGarageShell(): Group {
  const group = new Group(); group.name = 'Garage Shell';
  box(group, 'Concrete floor', room.width, 0.12, room.depth, 0, -0.06, (room.frontZ + room.backZ) / 2, concrete);
  box(group, 'Ceiling', room.width, 0.12, room.depth, 0, room.height + 0.06, (room.frontZ + room.backZ) / 2, steel);
  box(group, 'Front brick wall', room.width, room.height, 0.12, 0, room.height / 2, room.frontZ);
  box(group, 'Rear brick wall', room.width, room.height, 0.12, 0, room.height / 2, room.backZ);
  box(group, 'Right brick wall', 0.12, room.height, room.depth, room.width / 2, room.height / 2, (room.frontZ + room.backZ) / 2);
  const sideSegment = (room.depth - room.doorWidth) / 2;
  const centerZ = (room.frontZ + room.backZ) / 2;
  box(group, 'Left wall front', 0.12, room.height, sideSegment, -room.width / 2, room.height / 2, room.frontZ + sideSegment / 2);
  box(group, 'Left wall rear', 0.12, room.height, sideSegment, -room.width / 2, room.height / 2, room.backZ - sideSegment / 2);
  box(group, 'Left wall lintel', 0.12, room.height - room.doorHeight, room.doorWidth, -room.width / 2, (room.doorHeight + room.height) / 2, centerZ);
  const sky = new Mesh(new PlaneGeometry(8, 6), new ShaderMaterial({
    side: DoubleSide,
    uniforms: { topColor: { value: [0.27, 0.16, 0.4] }, bottomColor: { value: [1, 0.45, 0.19] } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'varying vec2 vUv; uniform vec3 topColor; uniform vec3 bottomColor; void main(){ gl_FragColor=vec4(mix(bottomColor,topColor,smoothstep(0.,1.,vUv.y)),1.); }',
  }));
  sky.name = 'Sunset sky mesh'; sky.position.set(-4.8, 1.7, centerZ); sky.rotation.y = Math.PI / 2; group.add(sky);
  const sun = new Mesh(new PlaneGeometry(0.9, 0.9), new MeshStandardMaterial({ color: 0xffbc64, emissive: 0xffa94f, emissiveIntensity: 2, side: DoubleSide }));
  sun.name = 'Setting sun'; sun.position.set(-4.75, 1.25, centerZ - 0.3); sun.rotation.y = Math.PI / 2; group.add(sun);
  const dustPositions = new Float32Array(90 * 3);
  let seed = 413;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 90; i++) { dustPositions[i * 3] = -2.2 + random() * 3.5; dustPositions[i * 3 + 1] = 0.4 + random() * 2; dustPositions[i * 3 + 2] = -2 + random() * 3; }
  const dustGeometry = new BufferGeometry(); dustGeometry.setAttribute('position', new Float32BufferAttribute(dustPositions, 3));
  const dust = new Points(dustGeometry, new PointsMaterial({ color: 0xffe5a4, size: 0.012, transparent: true, opacity: 0.55, depthWrite: false }));
  dust.name = 'Dust in sunbeam'; group.add(dust);
  return group;
}
