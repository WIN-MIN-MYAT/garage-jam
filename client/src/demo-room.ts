import { wallsFromFloor, type RoomModel } from './room-model.js';

/** Desktop/emulator room used by the `?roomBuild=1` scene until the manual room is saved. */
export function makeDemoRoom(): RoomModel {
  const floorY = 0;
  const ceilingY = 2.7;
  const polygon = [{ x: -2, z: -2 }, { x: 2, z: -2 }, { x: 2, z: 1.5 }, { x: -2, z: 1.5 }];
  return {
    floor: { y: floorY, polygon },
    ceilingY,
    walls: wallsFromFloor(polygon, floorY, ceilingY),
    openings: [
      { type: 'window', wallId: 'wall-0', sillY: 0.8, topY: 2.1, center: 2.0, width: 1.4 },
      { type: 'door', wallId: 'wall-2', sillY: 0, topY: 2.1, center: 2.0, width: 0.9 },
    ],
    furniture: [{ center: { x: -1.55, y: 0.45, z: 0.9 }, size: { x: 0.8, y: 0.9, z: 0.8 }, yaw: 0, label: 'cabinet', confidence: 0.8 }],
    table: { topY: 0.75, polygon: [{ x: -0.6, z: -1.8 }, { x: 0.6, z: -1.8 }, { x: 0.6, z: -1.0 }, { x: -0.6, z: -1.0 }], label: 'demo table near window', confidence: 0.9 },
    seat: { x: 0, y: floorY, z: 0 },
    forward: { x: 0, z: -1 },
    confidence: 0.9,
    source: 'mock',
  };
}
