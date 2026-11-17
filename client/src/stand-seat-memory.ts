import type { RoomPointMemory } from './device-model.js';

const seatStorageKey = 'garage-jam-seated-pose-v2';
const legacySeatStorageKey = 'garage-jam-seated-pose-v1';

export function loadStandSeat(): RoomPointMemory | null {
  try {
    const memory = JSON.parse(localStorage.getItem(seatStorageKey) || 'null') as RoomPointMemory | null;
    const point = memory?.point;
    const reference = memory?.reference;
    if (!point || ![point.x, point.y, point.z].every(Number.isFinite)) return null;
    if (!reference || !['table', 'floor'].includes(reference.surface)) return null;
    if (![reference.width, reference.depth].every(Number.isFinite)) return null;
    if (!Array.isArray(reference.roomEdges) || reference.roomEdges.length !== 5 || !reference.roomEdges.every(Number.isFinite)) return null;
    if (!Array.isArray(reference.openings) || !reference.openings.every(item => item && typeof item.type === 'string' && Number.isFinite(item.x) && Number.isFinite(item.z))) return null;
    if (reference.floorOutline !== undefined && (!Array.isArray(reference.floorOutline) || reference.floorOutline.length < 3
      || !reference.floorOutline.every(item => item && Number.isFinite(item.x) && Number.isFinite(item.z)))) return null;
    return memory;
  } catch {
    return null;
  }
}

export function saveStandSeat(memory: RoomPointMemory) {
  try {
    localStorage.setItem(seatStorageKey, JSON.stringify(memory));
    localStorage.removeItem(legacySeatStorageKey);
    return true;
  } catch {
    return false;
  }
}

export function clearStandSeat() {
  try {
    localStorage.removeItem(seatStorageKey);
    localStorage.removeItem(legacySeatStorageKey);
  } catch { /* storage can be disabled */ }
}
