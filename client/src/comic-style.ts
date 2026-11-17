import { BackSide, Color, DataTexture, Mesh, MeshBasicMaterial, MeshToonMaterial, NearestFilter, RGBAFormat, UnsignedByteType } from '@iwsdk/core';
import type { BufferGeometry, Material, Texture } from '@iwsdk/core';

export const styleMode: 'comic' | 'plain' = new URLSearchParams(location.search).get('style') === 'plain' ? 'plain' : 'comic';
const ramp = new DataTexture(new Uint8Array([110, 110, 110, 255, 185, 185, 185, 255, 255, 255, 255, 255]), 3, 1, RGBAFormat, UnsignedByteType);
ramp.minFilter = NearestFilter; ramp.magFilter = NearestFilter; ramp.needsUpdate = true;
const hero = new Set(['SLOT_TrashCan', 'SLOT_Boombox', 'SLOT_DoorHandle', 'SLOT_Marker']);
export function comicMaterial(color: number | Color, map?: Texture | null): Material {
  if (styleMode === 'plain') return new MeshBasicMaterial({ color, map: map ?? null });
  return new MeshToonMaterial({ color, map: map ?? null, gradientMap: ramp, transparent: false });
}
export function addOutline(mesh: Mesh<BufferGeometry>, slotId: string): number {
  if (styleMode === 'plain' || !hero.has(slotId)) return 0;
  const outline = new Mesh(mesh.geometry, new MeshBasicMaterial({ color: 0x101318, side: BackSide }));
  outline.name = `${slotId} ink outline`;
  outline.position.copy(mesh.position);
  outline.rotation.copy(mesh.rotation);
  outline.scale.copy(mesh.scale).multiplyScalar(1.015);
  mesh.parent?.add(outline);
  const index = mesh.geometry.index;
  return index ? index.count / 3 : (mesh.geometry.attributes.position?.count || 0) / 3;
}
