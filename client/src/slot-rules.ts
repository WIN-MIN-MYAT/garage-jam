import type { SlotRule } from './placement-solver.js';

/**
 * Slot catalogue from the Garage Jam placement brief.
 * P0 slots are required by the scene, P1 is the intended dressing, P2 is optional.
 * Keep this list data-only so the solver, validator and tests share one source of truth.
 */
export const slotRules: SlotRule[] = [
  { id: 'paper-zone', type: 'table', priority: 0, reach: 'interact', footprint: { width: 0.4, depth: 0.3 }, height: 0.02, minGap: 0.03 },
  { id: 'trash', type: 'floor', priority: 0, reach: 'interact', footprint: { width: 0.36, depth: 0.36 }, height: 0.6, minGap: 0.15 },
  { id: 'door', type: 'wall', priority: 0, reach: 'decor', footprint: { width: 2.0, depth: 0.12 }, height: 2.2, minGap: 0.1 },

  { id: 'neon', type: 'wall', priority: 1, reach: 'near', footprint: { width: 0.8, depth: 0.1 }, height: 0.3, preferredHeight: 1.8, minGap: 0.1 },
  { id: 'stats-board', type: 'wall', priority: 1, reach: 'near', footprint: { width: 0.9, depth: 0.1 }, height: 0.6, preferredHeight: 1.6, minGap: 0.1 },
  { id: 'calendar-board', type: 'wall', priority: 1, reach: 'near', footprint: { width: 0.9, depth: 0.1 }, height: 0.6, preferredHeight: 1.6, minGap: 0.1 },
  { id: 'corkboard', type: 'wall', priority: 1, reach: 'near', footprint: { width: 0.8, depth: 0.1 }, height: 0.6, preferredHeight: 1.5, minGap: 0.1 },
  { id: 'whiteboard', type: 'wall', priority: 1, reach: 'near', footprint: { width: 1.2, depth: 0.1 }, height: 0.8, preferredHeight: 1.5, minGap: 0.1 },
  { id: 'patch-bay', type: 'wall', priority: 1, reach: 'near', footprint: { width: 0.7, depth: 0.1 }, height: 0.6, preferredHeight: 1.5, minGap: 0.1 },

  { id: 'pegboard', type: 'wall', priority: 1, reach: 'near', footprint: { width: 0.8, depth: 0.18 }, height: 0.55, preferredHeight: 1.45, minGap: 0.1 },
  { id: 'shelf', type: 'floor', priority: 1, reach: 'decor', footprint: { width: 0.95, depth: 0.4 }, height: 1.6, canScale: true, minGap: 0.12 },
  { id: 'crates', type: 'floor', priority: 2, reach: 'decor', footprint: { width: 0.5, depth: 0.5 }, height: 0.4, minGap: 0.15 },
  { id: 'tires', type: 'floor', priority: 2, reach: 'decor', footprint: { width: 0.65, depth: 0.65 }, height: 0.5, minGap: 0.15 },
  { id: 'mini-fridge', type: 'floor', priority: 2, reach: 'decor', footprint: { width: 0.5, depth: 0.5 }, height: 0.85, minGap: 0.15 },
  { id: 'paint-cans', type: 'table', priority: 1, reach: 'near', footprint: { width: 0.32, depth: 0.26 }, height: 0.26, minGap: 0.03 },
  { id: 'toolbox', type: 'floor', priority: 2, reach: 'decor', footprint: { width: 0.4, depth: 0.25 }, height: 0.35, minGap: 0.15 },
  { id: 'lamp', type: 'ceiling', priority: 2, reach: 'decor', footprint: { width: 1.0, depth: 0.1 }, height: 0.12, minGap: 0 },
  { id: 'shutter', type: 'wall', priority: 2, reach: 'decor', footprint: { width: 1.6, depth: 0.4 }, height: 1.5, preferredHeight: 0.75, minGap: 0.1 },
  { id: 'graffiti', type: 'wall', priority: 2, reach: 'decor', footprint: { width: 1.8, depth: 0.02 }, height: 1.2, canScale: true, minGap: 0.1 },
];
