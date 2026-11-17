import type { RoomModel } from './room-model.js';
import type { SlotPlacement } from './placement-solver.js';

export type TableView = 'workbench' | 'real';
export type Units = 'cm' | 'in';
export type WorkMode = 'passthrough' | 'streaming';
export type SkyMode = 'golden' | 'time' | 'weather';

export type GaragePreferences = {
  units: Units;
  dominantHand: 'left' | 'right';
  tableView: TableView;
  standUpFade: boolean;
  cutouts: boolean;
  mode: WorkMode;
  skyMode: SkyMode;
  outlines: boolean;
  musicVolume: number;
  sfxVolume: number;
  focusMinutes: number;
  debugOverlay: boolean;
  reducedMotion: boolean;
  revealOff: boolean;
  revealSound: boolean;
  tableHeight: number | null;
  tableConfirmed: boolean;
  clearTableTipShown: boolean;
};

const key = 'garage-jam-preferences-v1';
const defaults: GaragePreferences = {
  units: 'cm',
  dominantHand: 'right',
  tableView: 'workbench',
  standUpFade: false,
  cutouts: true,
  mode: 'passthrough',
  skyMode: 'golden',
  outlines: true,
  musicVolume: 40,
  sfxVolume: 65,
  focusMinutes: 25,
  debugOverlay: false,
  reducedMotion: false,
  revealOff: false,
  revealSound: true,
  tableHeight: null,
  tableConfirmed: false,
  clearTableTipShown: false,
};

export function loadPreferences(): GaragePreferences {
  try {
    const stored = localStorage.getItem(key);
    return stored ? { ...defaults, ...JSON.parse(stored) } : { ...defaults };
  } catch {
    return { ...defaults };
  }
}

export function resetPreferences() {
  garageState.preferences = { ...defaults };
  savePreferences();
}

export const lastRoomStorageKey = 'garage-jam-last-room-v1';

export const garageState = {
  room: null as RoomModel | null,
  placements: [] as SlotPlacement[],
  preferences: loadPreferences(),
};

export function saveLastRoom(room: RoomModel) {
  try { localStorage.setItem(lastRoomStorageKey, JSON.stringify(room)); } catch { /* private mode */ }
}

export function loadLastRoom(): RoomModel | null {
  try {
    const stored = localStorage.getItem(lastRoomStorageKey);
    if (!stored) return null;
    const room = JSON.parse(stored) as RoomModel;
    if (room?.floor?.polygon?.length >= 3 && room.walls?.length) return room;
  } catch { /* no saved room */ }
  return null;
}

export function savePreferences() {
  try { localStorage.setItem(key, JSON.stringify(garageState.preferences)); } catch { /* private mode */ }
}

export function setPreference<K extends keyof GaragePreferences>(name: K, value: GaragePreferences[K]) {
  garageState.preferences = { ...garageState.preferences, [name]: value };
  savePreferences();
}

export function formatLength(meters: number, units: Units) {
  return units === 'in' ? `${(meters / 0.0254).toFixed(1)} in` : `${(meters * 100).toFixed(1)} cm`;
}

export function formatSize(width: number, depth: number, units: Units) {
  return units === 'in'
    ? `${(width / 0.0254).toFixed(1)} x ${(depth / 0.0254).toFixed(1)} in`
    : `${width.toFixed(2)} x ${depth.toFixed(2)} m`;
}
