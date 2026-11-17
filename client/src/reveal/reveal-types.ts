import type { Group, Mesh, Quaternion, Vector2, Vector3 } from '@iwsdk/core';

export type RevealSurfaceMode = 'radial' | 'vertical' | 'directional';
export type RevealBeatId = 'blueprint' | 'floor' | 'walls' | 'stickers' | 'ceiling' | 'door' | 'table' | 'props' | 'finish';

export type RevealUniform<T> = { value: T };
export type RevealUniforms = {
  uRevealOrigin: RevealUniform<Vector3>;
  uRevealProgress: RevealUniform<number>;
  uRevealDir: RevealUniform<Vector3>;
  uRevealRange: RevealUniform<Vector2>;
  uRevealMode: RevealUniform<number>;
  uRevealEdgeWidth: RevealUniform<number>;
  uRevealEdgeColor: RevealUniform<{ r: number; g: number; b: number }>;
  uRevealNoise: RevealUniform<unknown>;
  uRevealDrip: RevealUniform<unknown>;
  uRevealTime: RevealUniform<number>;
  uRevealNoiseAmount: RevealUniform<number>;
  uRevealDripAmount: RevealUniform<number>;
  uRevealUseNoise: RevealUniform<number>;
  uRevealUseDrips: RevealUniform<number>;
};

export type RevealSurface = {
  id: string;
  beat: RevealBeatId;
  mode: RevealSurfaceMode;
  materials: unknown[];
  uniforms: RevealUniforms;
  start: number;
  duration: number;
  /** Sort key used for wall ordering and prop staggering. */
  order: number;
};

export type RevealProp = {
  id: string;
  object: Group;
  basePosition: Vector3;
  baseScale: Vector3;
  finalVisible: boolean;
  start: number;
  dropDuration: number;
  landed: boolean;
  priority: number;
};

export type RevealSticker = {
  id: string;
  object: Group;
  basePosition: Vector3;
  baseQuaternion: Quaternion;
  baseScale: Vector3;
  normal: Vector3;
  roll: number;
  start: number;
  duration: number;
  landed: boolean;
};

export type RevealDoor = {
  group: Group;
  materials: unknown[];
  beams: Mesh[];
  dust?: unknown;
  opacity: number;
};

export type RevealBlueprint = {
  group: Group;
  lineMaterial: unknown;
  ring: Mesh;
  ringMaterial: unknown;
};

export type RevealRuntime = {
  seat: Vector3;
  floorY: number;
  ceilingY: number;
  radius: number;
  surfaces: RevealSurface[];
  props: RevealProp[];
  stickers: RevealSticker[];
  blueprint: RevealBlueprint | null;
  door: RevealDoor | null;
  hiddenAtBuild: boolean;
};
