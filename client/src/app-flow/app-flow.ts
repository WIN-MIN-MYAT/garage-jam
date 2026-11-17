import type { RoomModel } from '../room-model.js';
import { garageState, loadLastRoom, type GaragePreferences } from '../garage-state.js';

export type AppStage = 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'S8' | 'S9a' | 'S9b' | 'S10' | 'S11';
export type RevealMode = 'full' | 'quick' | 'dissolve' | 'off' | 'props';

const query = new URLSearchParams(location.search);
/** The product entry is `/`; query modes remain developer probes only. */
export const isProductEntry = !query.has('roomBuild') && !query.has('roomSpike') && !query.has('cutoutSpike') && !query.has('demo') && query.get('test') !== '1';
export const flowDebug = query.get('flowDebug') === '1' || query.get('flow') === 'debug';

const flowStorageKey = 'garage-jam-flow-v1';

export type FlowSave = {
  stage: AppStage;
  completed: AppStage[];
  lastEnteredAt: number;
  lastExitAt: number | null;
};

const stages: AppStage[] = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9a', 'S9b', 'S10', 'S11'];

export function loadFlow(): FlowSave {
  try {
    const stored = localStorage.getItem(flowStorageKey);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<FlowSave>;
      const stage = stages.includes(parsed.stage as AppStage) ? parsed.stage as AppStage : 'S0';
      return {
        stage,
        completed: Array.isArray(parsed.completed) ? parsed.completed.filter((item): item is AppStage => stages.includes(item as AppStage)) : [],
        lastEnteredAt: parsed.lastEnteredAt ?? 0,
        lastExitAt: parsed.lastExitAt ?? null,
      };
    }
  } catch { /* private mode */ }
  return { stage: 'S0', completed: [], lastEnteredAt: 0, lastExitAt: null };
}

export function saveFlow(save: FlowSave) {
  try { localStorage.setItem(flowStorageKey, JSON.stringify(save)); } catch { /* private mode */ }
}

export function resetFlow() {
  try { localStorage.removeItem(flowStorageKey); } catch { /* private mode */ }
}

export function resumeAvailable(): boolean {
  const flow = loadFlow();
  const room = loadLastRoom();
  const stage = String(flow.stage);
  return !!room && (flow.completed.includes('S10') || stage === 'S6' || stage === 'S7' || stage === 'S8' || stage === 'S9a' || stage === 'S9b' || stage === 'S11');
}

export function describeLastRoom(room: RoomModel | null): string {
  if (!room) return '';
  const bounds = room.floor.polygon.reduce((box, point) => ({
    minX: Math.min(box.minX, point.x), maxX: Math.max(box.maxX, point.x),
    minZ: Math.min(box.minZ, point.z), maxZ: Math.max(box.maxZ, point.z),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
  const width = (bounds.maxX - bounds.minX).toFixed(1);
  const depth = (bounds.maxZ - bounds.minZ).toFixed(1);
  const table = room.table ? ` · TABLE ${((room.table.topY - room.floor.y) * 100).toFixed(0)} CM` : '';
  return `${width} × ${depth} M${table}`;
}

export function revealModeFor(preferences: GaragePreferences = garageState.preferences): RevealMode {
  const forced = query.get('revealMode');
  if (forced === 'full' || forced === 'quick' || forced === 'dissolve' || forced === 'off' || forced === 'props') return forced;
  if (query.get('revealOff') === '1' || preferences.revealOff) return 'off';
  if (query.get('revealQuick') === '1') return 'quick';
  if (query.get('reducedMotion') === '1' || preferences.reducedMotion) return 'dissolve';
  return 'full';
}

export function revealSpeed(): number {
  const value = Number(query.get('revealSpeed') ?? '1');
  return Number.isFinite(value) ? Math.max(0.5, Math.min(3, value)) : 1;
}

export function needsTableConfirm(room: RoomModel | null, preferences: GaragePreferences = garageState.preferences): boolean {
  if (!room?.table) return false;
  if (!preferences.tableConfirmed || preferences.tableHeight == null) return true;
  return Math.abs((room.table.topY - room.floor.y) - preferences.tableHeight) > 0.03;
}
