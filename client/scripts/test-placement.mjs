import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ entryPoints: ['src/placement-solver.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { solve, validatePlacements } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const polygon = [{ x: -3, z: -3 }, { x: 3, z: -3 }, { x: 3, z: 3 }, { x: -3, z: 3 }];
const walls = polygon.map((p0, i) => {
  const p1 = polygon[(i + 1) % polygon.length];
  const dx = p1.x - p0.x, dz = p1.z - p0.z, length = Math.hypot(dx, dz);
  return { id: `wall-${i}`, p0, p1, normal: { x: -dz / length, z: dx / length }, minY: 0, maxY: 2.6, openings: [], isVirtual: false };
});
const room = {
  floor: { y: 0, polygon }, ceilingY: 2.6, walls,
  openings: [{ type: 'door', wallId: 'wall-3', sillY: 0, topY: 2.2 }, { type: 'window', wallId: 'wall-0', sillY: 0.8, topY: 2.1 }],
  furniture: [{ center: { x: -2, y: 0.5, z: 1.5 }, size: { x: 0.8, y: 1, z: 0.8 }, yaw: 0, label: 'cabinet', confidence: 0.9 }],
  table: { topY: 0.75, polygon: [{ x: -0.7, z: -1.7 }, { x: 0.7, z: -1.7 }, { x: 0.7, z: -0.9 }, { x: -0.7, z: -0.9 }], label: 'table', confidence: 0.9 },
  seat: { x: 0, y: 0, z: 0 }, forward: { x: 0, z: -1 }, confidence: 0.9, source: 'mock',
};
const rules = [
  { id: 'trash', type: 'floor', priority: 0, reach: 'interact', footprint: { width: 0.32, depth: 0.32 }, height: 0.55 },
  { id: 'paper-zone', type: 'table', priority: 0, reach: 'interact', footprint: { width: 0.4, depth: 0.3 }, height: 0.02 },
  { id: 'door', type: 'wall', priority: 0, reach: 'decor', footprint: { width: 1.5, depth: 0.1 }, height: 2.2 },
  { id: 'neon', type: 'wall', priority: 1, reach: 'decor', footprint: { width: 0.8, depth: 0.1 }, height: 0.3, preferredHeight: 1.8 },
  { id: 'board', type: 'wall', priority: 1, reach: 'near', footprint: { width: 0.8, depth: 0.1 }, height: 0.6 },
  { id: 'crate', type: 'floor', priority: 2, reach: 'decor', footprint: { width: 0.55, depth: 0.55 }, height: 0.45, canScale: true },
  { id: 'shelf', type: 'floor', priority: 2, reach: 'decor', footprint: { width: 0.8, depth: 0.3 }, height: 1.4, canScale: true },
  { id: 'tires', type: 'floor', priority: 2, reach: 'decor', footprint: { width: 0.5, depth: 0.5 }, height: 0.9 },
  { id: 'toolbox', type: 'floor', priority: 2, reach: 'decor', footprint: { width: 0.4, depth: 0.25 }, height: 0.35 },
  { id: 'minifridge', type: 'floor', priority: 2, reach: 'decor', footprint: { width: 0.5, depth: 0.5 }, height: 0.9 },
  { id: 'paintcans', type: 'floor', priority: 2, reach: 'decor', footprint: { width: 0.35, depth: 0.35 }, height: 0.6 },
  { id: 'mural', type: 'wall', priority: 2, reach: 'decor', footprint: { width: 1.3, depth: 0.1 }, height: 1.1 },
  { id: 'calendar', type: 'wall', priority: 1, reach: 'decor', footprint: { width: 0.5, depth: 0.1 }, height: 0.6 },
  { id: 'corkboard', type: 'wall', priority: 1, reach: 'decor', footprint: { width: 0.7, depth: 0.1 }, height: 0.6 },
  { id: 'patchbay', type: 'wall', priority: 1, reach: 'decor', footprint: { width: 0.7, depth: 0.1 }, height: 0.6 },
  { id: 'boombox', type: 'table', priority: 1, reach: 'interact', footprint: { width: 0.35, depth: 0.2 }, height: 0.25 },
];
solve(room, rules, [], [], { dominantSide: 'right' }, 413); // warm JIT before the 50 ms steady-state gate
const first = solve(room, rules, [], [], { dominantSide: 'right' }, 413);
const second = solve(room, rules, [], [], { dominantSide: 'right' }, 413);
assert.deepEqual(first.placements, second.placements);
assert.equal(first.report.valid, true, first.report.violations.join(', '));
assert.deepEqual(validatePlacements(room, rules, first.placements), []);
assert.ok(first.report.durationMs < 50, `solver took ${first.report.durationMs.toFixed(1)} ms: ${JSON.stringify(first.report.timings)}`);
assert.ok(first.placements.some(p => p.slotId === 'trash'));
assert.ok(first.placements.some(p => p.slotId === 'paper-zone'));
assert.ok(first.placements.some(p => p.slotId === 'door'));
const compact = structuredClone(room);
compact.floor.polygon = [{ x: -1.3, z: -1.3 }, { x: 1.3, z: -1.3 }, { x: 1.3, z: 1.3 }, { x: -1.3, z: 1.3 }];
compact.table.polygon = [{ x: -0.6, z: -1.2 }, { x: 0.6, z: -1.2 }, { x: 0.6, z: -0.4 }, { x: -0.6, z: -0.4 }];
compact.walls = walls.map((wall, i) => ({ ...wall, p0: compact.floor.polygon[i], p1: compact.floor.polygon[(i + 1) % 4] }));
const small = solve(compact, rules, [], [], {}, 413);
assert.equal(small.report.zone, 'normal');
assert.equal(small.report.valid, true, small.report.violations.join(', '));
assert.equal(small.placements.length + small.report.unplaced.length, rules.length);
const noTable = structuredClone(room); noTable.table = null;
const lShape = structuredClone(room);
lShape.floor.polygon = [{ x: -3, z: -3 }, { x: 3, z: -3 }, { x: 3, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 3 }, { x: -3, z: 3 }];
lShape.walls = lShape.floor.polygon.map((p0, i, points) => {
  const p1 = points[(i + 1) % points.length]; const dx = p1.x - p0.x, dz = p1.z - p0.z, length = Math.hypot(dx, dz);
  return { id: `l-wall-${i}`, p0, p1, normal: { x: -dz / length, z: dx / length }, minY: 0, maxY: 2.6, openings: [], isVirtual: false };
});
const large = structuredClone(room);
large.floor.polygon = [{ x: -4, z: -4 }, { x: 4, z: -4 }, { x: 4, z: 4 }, { x: -4, z: 4 }];
const lowCeiling = structuredClone(room); lowCeiling.ceilingY = 2.1;
const tableAtWall = structuredClone(room);
tableAtWall.table.polygon = [{ x: -0.7, z: -2.9 }, { x: 0.7, z: -2.9 }, { x: 0.7, z: -2.1 }, { x: -0.7, z: -2.1 }];
tableAtWall.seat.z = -1.6;
const fixtures = { noTable, lShape, large, lowCeiling, tableAtWall };
const fixtureReports = {};
for (const [name, fixture] of Object.entries(fixtures)) {
  solve(fixture, rules, [], [], {}, 413);
  const result = solve(fixture, rules, [], [], {}, 413);
  assert.equal(result.report.valid, true, `${name}: ${result.report.violations.join(', ')}`);
  assert.equal(result.placements.length + result.report.unplaced.length, rules.length, `${name}: every slot must be placed or logged`);
  if (name !== 'large') assert.ok(result.report.durationMs < 50, `${name}: ${result.report.durationMs.toFixed(1)} ms`);
  fixtureReports[name] = { ms: result.report.durationMs, placed: result.placements.length, unplaced: result.report.unplaced.map(item => item.slotId) };
}
assert.equal(solve(noTable, rules).report.unplaced.some(item => item.slotId === 'paper-zone'), true);
console.log(JSON.stringify({ normal: { ms: first.report.durationMs, placements: first.placements.map(p => p.slotId), unplaced: first.report.unplaced }, compact: { ms: small.report.durationMs, placements: small.placements.map(p => p.slotId), unplaced: small.report.unplaced }, fixtures: fixtureReports }, null, 2));
