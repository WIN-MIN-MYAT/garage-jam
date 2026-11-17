import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, 'fixtures');
const snapshotDir = join(here, 'snapshots');
const bundle = await build({ entryPoints: [join(here, 'placement-entry.ts')], bundle: true, platform: 'node', format: 'esm', write: false });
const { solve, validatePlacements, slotRules, createDefaultRoom, outlineBounds, roomFromSnapshots, wallsFromFloor } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

function makeRoom(definition) {
  const seat = definition.seat;
  const forward = definition.forward;
  if (!definition.floorPolygon) return createDefaultRoom(seat, forward, null);
  const floorY = definition.seat.y ?? 0;
  const ceilingY = definition.ceilingY ?? floorY + 2.6;
  return {
    floor: { y: floorY, polygon: definition.floorPolygon },
    ceilingY,
    walls: wallsFromFloor(definition.floorPolygon, floorY, ceilingY),
    openings: definition.openings ?? [],
    furniture: definition.furniture ?? [],
    table: definition.table ? { topY: definition.table.topY, polygon: definition.table.polygon, label: 'fixture table', confidence: 0.9 } : null,
    seat,
    forward,
    confidence: definition.confidence ?? 0.9,
    source: definition.source ?? 'mock',
  };
}

const fixtures = readdirSync(fixtureDir)
  .filter(file => file.endsWith('.json'))
  .sort()
  .map(file => {
    const definition = JSON.parse(readFileSync(join(fixtureDir, file), 'utf8'));
    return { file, definition, room: makeRoom(definition) };
  });
const byId = new Map(fixtures.map(fixture => [fixture.definition.id, fixture]));

function snapshotOf(result) {
  return {
    zone: result.report.zone,
    cautious: result.report.cautious,
    placements: [...result.placements]
      .sort((a, b) => a.slotId.localeCompare(b.slotId))
      .map(placement => ({
        slotId: placement.slotId,
        position: [Number(placement.position.x.toFixed(3)), Number(placement.position.y.toFixed(3)), Number(placement.position.z.toFixed(3))],
        yaw: Number(placement.yaw.toFixed(3)),
        scale: Number(placement.scale.toFixed(3)),
        wallId: placement.wallId ?? null,
      })),
    unplaced: [...result.report.unplaced].sort((a, b) => a.slotId.localeCompare(b.slotId)),
    p0Unplaced: [...result.report.p0Unplaced].sort(),
  };
}

function writeOrCompareSnapshot(id, snapshot) {
  mkdirSync(snapshotDir, { recursive: true });
  const path = join(snapshotDir, `${id}.json`);
  const serialized = `${JSON.stringify(snapshot, null, 2)}\n`;
  if (!existsSync(path) || process.env.UPDATE_SNAPSHOTS === '1') {
    writeFileSync(path, serialized);
    return;
  }
  assert.equal(readFileSync(path, 'utf8'), serialized, `snapshot changed for ${id}; rerun with UPDATE_SNAPSHOTS=1 after reviewing the diff`);
}

test('every fixture is deterministic, valid, and under the solver budget', () => {
  assert.equal(fixtures.length >= 10, true, 'expected the section 19 fixture set');
  for (const { definition, room } of fixtures) {
    solve(room, slotRules, [], [], { dominantSide: 'right' }, 413); // warm the candidate/overlap paths
    const first = solve(room, slotRules, [], [], { dominantSide: 'right' }, 413);
    const second = solve(room, slotRules, [], [], { dominantSide: 'right' }, 413);
    assert.deepEqual(second.placements, first.placements, `${definition.id}: repeated solve must be deterministic`);
    assert.deepEqual(second.report.unplaced, first.report.unplaced, `${definition.id}: repeated unplaced list must be deterministic`);
    assert.equal(first.report.valid, true, `${definition.id}: ${first.report.violations.join(', ')}`);
    assert.deepEqual(validatePlacements(room, slotRules, first.placements), [], `${definition.id}: independent validation`);
    const activeRules = first.report.cautious ? slotRules.filter(rule => rule.priority < 2) : slotRules;
    assert.equal(first.placements.length + first.report.unplaced.length, activeRules.length, `${definition.id}: every active slot is placed or logged`);
    const bestDuration = Math.min(first.report.durationMs, second.report.durationMs);
    assert.ok(bestDuration < 50, `${definition.id}: solver took ${bestDuration.toFixed(1)} ms (${JSON.stringify(first.report.timings)})`);
    for (const slotId of first.report.p0Unplaced) {
      assert.ok(first.report.unplaced.some(item => item.slotId === slotId), `${definition.id}: P0 ${slotId} must have an unplaced reason`);
    }
    writeOrCompareSnapshot(definition.id, snapshotOf(first));
  }
});

test('compact and cautious modes are selected from room data', () => {
  const tiny = byId.get('tiny-2x4');
  assert.ok(tiny, 'tiny fixture is present');
  const tinyResult = solve(tiny.room, slotRules, [], [], {}, 413);
  assert.equal(tinyResult.report.zone, 'compact');

  const cautious = byId.get('low-confidence');
  assert.ok(cautious, 'low-confidence fixture is present');
  const cautiousResult = solve(cautious.room, slotRules, [], [], {}, 413);
  assert.equal(cautiousResult.report.cautious, true);
  const p2 = new Set(slotRules.filter(rule => rule.priority === 2).map(rule => rule.id));
  assert.deepEqual(cautiousResult.placements.filter(placement => p2.has(placement.slotId)), [], 'cautious mode skips P2 props');
});

test('no-table and no-scan fallbacks are explicit', () => {
  const noTable = byId.get('no-table');
  assert.ok(noTable, 'no-table fixture is present');
  const noTableResult = solve(noTable.room, slotRules, [], [], {}, 413);
  assert.ok(noTableResult.report.p0Unplaced.includes('paper-zone'), 'paper zone is logged when there is no table');
  assert.ok(noTableResult.report.unplaced.find(item => item.slotId === 'paper-zone')?.reason.includes('side-tray'));

  const noScan = byId.get('no-scan');
  assert.ok(noScan, 'no-scan fixture is present');
  const noScanResult = solve(noScan.room, slotRules, [], [], {}, 413);
  assert.equal(noScanResult.report.cautious, true);
  assert.equal(noScanResult.report.valid, true);
  assert.deepEqual(noScanResult.report.violations, []);
});

test('wall props avoid doors and windows', () => {
  const fixture = byId.get('windows-and-doors');
  assert.ok(fixture, 'window/door fixture is present');
  const result = solve(fixture.room, slotRules, [], [], {}, 413);
  const walls = new Map(fixture.room.walls.map(wall => [wall.id, wall]));
  for (const placement of result.placements.filter(item => item.type === 'wall' && item.slotId !== 'door')) {
    const wall = walls.get(placement.wallId);
    if (!wall) continue;
    const length = Math.hypot(wall.p1.x - wall.p0.x, wall.p1.z - wall.p0.z);
    const t = ((placement.position.x - wall.p0.x) * (wall.p1.x - wall.p0.x) + (placement.position.z - wall.p0.z) * (wall.p1.z - wall.p0.z)) / length;
    const half = placement.footprint.width * placement.scale / 2;
    for (const opening of fixture.room.openings.filter(item => item.wallId === wall.id)) {
      const start = opening.center - opening.width / 2;
      const end = opening.center + opening.width / 2;
      assert.equal(t + half > start - 0.1 && t - half < end + 0.1, false, `${placement.slotId} overlaps ${opening.type} on ${wall.id}`);
    }
  }
});

test('locked placements survive a re-solve', () => {
  const fixture = byId.get('4x3-table');
  assert.ok(fixture, 'standard fixture is present');
  const first = solve(fixture.room, slotRules, [], [], {}, 413);
  const locked = first.placements.find(item => item.slotId === 'trash');
  assert.ok(locked, 'trash is placed');
  const result = solve(fixture.room, slotRules, [], [locked], {}, 413);
  const same = result.placements.find(item => item.slotId === 'trash');
  assert.deepEqual(same, locked);
  assert.equal(result.report.valid, true, result.report.violations.join(', '));
});

test('rotated scans preserve room dimensions and choose the labelled table', () => {
  const angle = Math.PI / 5;
  const point = (x, y, z) => ({ x: 2 + x * Math.cos(angle) + z * Math.sin(angle), y, z: -3 - x * Math.sin(angle) + z * Math.cos(angle) });
  const plane = (label, width, depth, y, x = 0, z = 0) => ({
    label, orientation: 'horizontal', y, minY: y, maxY: y, area: width * depth, center: point(x, y, z),
    polygon: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => point(x + u * width / 2, y, z + v * depth / 2)),
  });
  const floor = plane('floor', 3, 4, 0.1);
  const table = plane('table', 0.65, 1.4, 0.72, -0.65, -1);
  const { room, info } = roomFromSnapshots([
    floor, plane('floor', 8, 5, 0.1, 8), plane('ceiling', 3, 4, 3.35), table,
    plane('shelf', 0.8, 0.9, 0.85, 0, -0.8),
  ], { position: point(0, 1.6, 0), forward: { x: -Math.sin(angle), z: -Math.cos(angle) } });
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.0001, `${actual} must equal ${expected}`);
  close(info.floorSize[0], 4);
  close(info.floorSize[1], 3);
  close(room.ceilingY, 3.35);
  close(room.table.topY, 0.72);
  assert.deepEqual(room.table.polygon, table.polygon.map(({ x, z }) => ({ x, z })));
  const tableBounds = outlineBounds(room.table.polygon);
  close(tableBounds.center.x, table.center.x);
  close(tableBounds.center.z, table.center.z);
  close(tableBounds.width, 1.4);
  close(tableBounds.depth, 0.65);
});

test('an aimed tabletop beats a taller desk and remains selected while looking at the controls', () => {
  const plane = (label, x, z, y, width = 1, depth = 0.8) => ({
    label, orientation: 'horizontal', y, minY: y, maxY: y, area: width * depth, center: { x, y, z },
    polygon: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => ({ x: x + u * width / 2, y, z: z + v * depth / 2 })),
  });
  const scenes = [plane('floor', 0, 0, -0.05, 6, 6), plane('table', 0, -1, 0.43), plane('desk', 1.6, -0.8, 0.77)];
  const viewer = { position: { x: 0, y: 1.43, z: 0 }, forward: { x: 0, z: -0.7 }, lookY: -0.7 };
  const selected = roomFromSnapshots(scenes, viewer);
  assert.equal(selected.info.tableCount, 2);
  assert.equal(selected.room.table.topY, 0.43);
  const away = { ...viewer, forward: { x: 0, z: -1 }, lookY: 0 };
  assert.equal(roomFromSnapshots(scenes, away).room.table, null);
  assert.equal(roomFromSnapshots(scenes, away, selected.info.tableCenter).room.table.topY, 0.43);
  assert.equal(roomFromSnapshots(scenes.slice(0, 1), away, selected.info.tableCenter).room.table, null);
});

test('a closed set of scanned walls preserves an alcove in an enclosing floor plane', () => {
  const corners = [[0, 0], [5, 0], [5, 4], [0, 4], [0, 2.5], [2, 2.5], [2, 1.5], [0, 1.5]];
  const position = (x, z, y = 0) => ({ x, y, z });
  const walls = corners.map(([x, z], i) => {
    const [nextX, nextZ] = corners[(i + 1) % corners.length];
    return { label: 'wall_face', orientation: 'vertical', minY: 0, maxY: 2.3, polygon: [
      position(x, z), position(nextX, nextZ), position(nextX, nextZ, 2.3), position(x, z, 2.3),
    ] };
  });
  const floor = { label: 'floor', orientation: 'horizontal', area: 20, y: 0,
    polygon: [[0, 0], [5, 0], [5, 4], [0, 4]].map(([x, z]) => position(x, z)) };
  const viewer = { position: position(3, 2, 1.5), forward: { x: -1, z: 0 } };
  const { room } = roomFromSnapshots([floor, ...walls], viewer);
  assert.equal(room.walls.length, 8);
  assert.equal(room.ceilingY, 2.3);
  assert.deepEqual(room.floor.polygon, corners.slice(1).concat([corners[0]]).map(([x, z]) => ({ x, z })));
  assert.equal(roomFromSnapshots([floor, ...walls.slice(1)], viewer).room.walls.length, 4);

  const wideProp = { id: 'wide', type: 'floor', priority: 2, reach: 'decor', footprint: { width: 0.5, depth: 1.8 }, height: 0.5 };
  const crossing = { slotId: wideProp.id, position: { x: 1.4, y: 0, z: 2 }, scale: 1, yaw: 0 };
  assert.ok(validatePlacements(room, [wideProp], [crossing]).includes('wide: crosses room boundary'));
});
