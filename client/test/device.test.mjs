import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const bundle = await build({ entryPoints: [join(here, 'device-entry.ts')], bundle: true, platform: 'node', format: 'esm', write: false });
const {
  deviceInsideTyping, deviceObstacles, devicesFromSeat, devicesToSeat, keyboardVolume,
  makeExtra, makeLaptop, makeMonitor, matchesSavedWorkspace, nextDeviceState, screenVolume, seatFrameYaw, seatToWorld,
  rememberDevice, restoreDevice, rememberRoomPoint, restoreRoomPoint, screenDragCorners, minScreenDepth, minZoneHeight,
  worldToSeat, solve, slotRules, validatePlacements,
} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function room(overrides = {}) {
  const floorY = 0;
  const tableY = 0.75;
  const floorPolygon = [
    { x: -2, z: -2 }, { x: 2, z: -2 }, { x: 2, z: 1 }, { x: -2, z: 1 },
  ];
  const tablePolygon = [
    { x: -0.6, z: -1.8 }, { x: 0.6, z: -1.8 }, { x: 0.6, z: -1.0 }, { x: -0.6, z: -1.0 },
  ];
  return {
    floor: { y: floorY, polygon: floorPolygon },
    ceilingY: 2.7,
    walls: [],
    openings: [],
    furniture: [],
    table: { topY: tableY, polygon: tablePolygon, label: 'table', confidence: 0.9 },
    seat: { x: 0, y: floorY, z: 0 },
    forward: { x: 0, z: -1 },
    confidence: 0.9,
    source: 'manual',
    ...overrides,
  };
}

test('fast resume verifies the same room and table across a changed tracking origin', () => {
  const saved = room();
  const transform = point => ({ x: 4 - point.z, z: point.x + 2 });
  const scanned = room({
    source: 'webxr',
    floor: { y: 0.3, polygon: saved.floor.polygon.map(transform) },
    table: { ...saved.table, topY: 1.05, polygon: saved.table.polygon.map(transform) },
  });
  assert.equal(matchesSavedWorkspace(saved, scanned), true);
  assert.equal(matchesSavedWorkspace(saved, { ...scanned, table: null }), false);
  assert.equal(matchesSavedWorkspace(saved, { ...scanned, table: { ...scanned.table, topY: 1.15 } }), false);
  assert.equal(matchesSavedWorkspace(saved, { ...scanned, table: {
    ...scanned.table, polygon: scanned.table.polygon.map(point => ({ ...point, x: point.x + 0.3 })),
  } }), false);
  assert.equal(matchesSavedWorkspace(saved, { ...scanned, floor: {
    ...scanned.floor, polygon: scanned.floor.polygon.map(point => ({ ...point, z: point.z * 1.25 })),
  } }), false);
});

const laptopCorners = [
  { x: -0.30, y: 1.20, z: -1.65 },
  { x: 0.30, y: 1.20, z: -1.65 },
  { x: 0.30, y: 0.80, z: -1.58 },
  { x: -0.30, y: 0.80, z: -1.58 },
];

const monitorCorners = [
  { x: -0.30, y: 1.32, z: -1.78 },
  { x: 0.30, y: 1.32, z: -1.78 },
  { x: 0.30, y: 0.97, z: -1.78 },
  { x: -0.30, y: 0.97, z: -1.78 },
];

test('screen volume fits a leaning laptop screen', () => {
  const volume = screenVolume(laptopCorners, { x: 0, y: 0, z: 0 }, 0.012);
  assert.ok(volume);
  assert.equal(volume.part, 'screen');
  assert.ok(Math.abs(volume.size.x - 0.6) < 0.002, `width ${volume.size.x}`);
  assert.ok(Math.abs(volume.size.y - 0.4061) < 0.003, `height ${volume.size.y}`);
  assert.ok(Math.abs(volume.yaw) < 0.02, `yaw ${volume.yaw}`);
  assert.ok(volume.tilt < -0.1 && volume.tilt > -0.3, `tilt ${volume.tilt}`);
  assert.ok(volume.center.z > -1.65 && volume.center.z < -1.58);
});

test('laptop volume adds a base on the table and a typing margin', () => {
  const record = makeLaptop(laptopCorners, room());
  assert.ok(record);
  assert.equal(record.parts.length, 3);
  const [screen, base, typing] = record.parts;
  assert.equal(base.part, 'base');
  assert.equal(typing.part, 'typing');
  assert.ok(Math.abs(base.center.y - 0.76) < 0.001, `base y ${base.center.y}`);
  assert.ok(base.center.z > screen.center.z, 'base projects toward the seat');
  assert.ok(base.size.x > 0.5 && base.size.x < 0.62);
  assert.ok(typing.size.x > base.size.x, 'typing margin widens the keyboard zone');
  assert.ok(Math.abs(typing.size.y - 0.12) < 0.001);
});

test('desktop and monitor fit the screen without a stand', () => {
  const record = makeMonitor(
    monitorCorners,
    room(),
    [{ x: -0.25, y: 0.75, z: -1.22 }, { x: 0.25, y: 0.75, z: -1.36 }],
  );
  assert.ok(record);
  const parts = Object.fromEntries(record.parts.map(part => [part.part, part]));
  assert.deepEqual(Object.keys(parts), ['screen', 'keyboard', 'typing']);
  assert.equal(parts.screen.size.z, minScreenDepth);
  assert.ok(Math.abs(parts.keyboard.size.x - 0.5) < 0.002);
  assert.ok(Math.abs(parts.keyboard.size.z - 0.14) < 0.002);
  assert.ok(Math.abs(parts.keyboard.center.y - 0.765) < 0.002);
  assert.deepEqual(makeMonitor(monitorCorners, room(), [], true).parts.map(part => part.part), ['screen']);
});

test('keyboard and extra zones align to the table yaw', () => {
  const key = keyboardVolume([{ x: 0.1, y: 0.75, z: -1.2 }, { x: 0.4, y: 0.75, z: -1.4 }], 0.75, Math.PI / 2);
  assert.ok(key);
  assert.ok(Math.abs(key.size.x - 0.2) < 0.002, `rotated width ${key.size.x}`);
  assert.ok(Math.abs(key.size.z - 0.3) < 0.002, `rotated depth ${key.size.z}`);
  const extra = makeExtra([{ x: -0.1, y: 0.75, z: -1.1 }, { x: 0.1, y: 0.75, z: -1.3 }], room());
  assert.ok(extra);
  assert.equal(extra.parts[0].part, 'extra');
  assert.equal(extra.parts[0].size.y, minZoneHeight);
});

test('either drag direction reconstructs a tilted laptop and preserves the measured deck', () => {
  for (const [a, b] of [[laptopCorners[0], laptopCorners[2]], [laptopCorners[2], laptopCorners[0]]]) {
    const record = makeLaptop(screenDragCorners(a, b, 0), room(), [
      { x: -0.20, y: 0.75, z: -1.56 }, { x: 0.20, y: 0.75, z: -1.27 },
    ]);
    assert.equal(record.parts[0].size.z, minScreenDepth);
    assert.ok(Math.abs(record.parts[0].tilt + Math.atan2(0.07, 0.40)) < 1e-7);
    assert.ok(Math.abs(record.parts[1].size.x - 0.40) < 1e-7);
    assert.ok(Math.abs(record.parts[1].center.z + 1.415) < 1e-7);
  }
});

test('device memories follow the same table across shifted and rotated tracking origins', () => {
  const before = room();
  const record = makeLaptop(laptopCorners, before);
  const memory = rememberDevice(before, record);
  const angle = 2.05;
  const transform = p => ({ x: 3 + p.x * Math.cos(angle) + p.z * Math.sin(angle), z: -4 - p.x * Math.sin(angle) + p.z * Math.cos(angle) });
  const after = room({
    floor: { y: 0.12, polygon: before.floor.polygon.map(transform) },
    table: { ...before.table, topY: 0.87, polygon: before.table.polygon.map(transform) },
    seat: { x: 1, y: 0.12, z: -1 },
    forward: { x: 0.5, z: 0.86 },
  });
  const restored = restoreDevice(after, memory);
  assert.ok(restored);
  for (const [i, part] of restored.parts.entries()) {
    const old = record.parts[i].center, expected = transform(old);
    assert.ok(Math.hypot(part.center.x - expected.x, part.center.z - expected.z) < 1e-6);
    assert.ok(Math.abs(part.center.y - old.y - 0.12) < 1e-6);
  }
  assert.equal(restoreDevice(room({ table: { ...before.table, polygon: before.table.polygon.map(p => ({ ...p, x: p.x + 0.8 })) } }), memory), null);
});

test('an ambiguous symmetric room keeps the device unplaced', () => {
  const original = room();
  const symmetric = room({ table: { ...original.table, polygon: original.table.polygon.map(p => ({ ...p, z: p.z + 0.9 })) } });
  assert.equal(restoreDevice(symmetric, rememberDevice(symmetric, makeLaptop(laptopCorners, symmetric))), null);
});

test('the saved stand-fade seat follows a realigned room and keeps its floor-relative height', () => {
  const before = room();
  const seat = { x: 0.24, y: 1.17, z: -0.27 };
  const memory = rememberRoomPoint(before, seat);
  const transform = p => ({ x: 4 + p.z, z: 2 - p.x });
  const after = room({
    floor: { y: 0.18, polygon: before.floor.polygon.map(transform) },
    table: { ...before.table, topY: 0.98, polygon: before.table.polygon.map(transform) },
    seat: { x: -9, y: 0.18, z: 7 },
    forward: { x: 0, z: 1 },
  });
  const restored = restoreRoomPoint(after, JSON.parse(JSON.stringify(memory)));
  const expected = transform(seat);
  assert.ok(restored);
  assert.ok(Math.hypot(restored.x - expected.x, restored.z - expected.z) < 1e-6);
  assert.ok(Math.abs(restored.y - 1.35) < 1e-6);
  assert.equal(restoreRoomPoint(room({ table: null }), memory), null);
  const symmetric = room({ table: { ...before.table, polygon: before.table.polygon.map(p => ({ ...p, z: p.z + 0.9 })) } });
  assert.equal(restoreRoomPoint(symmetric, rememberRoomPoint(symmetric, seat)), null);
});

test('device obstacles respect padding and enabled state', () => {
  const record = makeLaptop(laptopCorners, room());
  const obstacles = deviceObstacles([record]);
  assert.equal(obstacles.length, record.parts.length);
  const keyboard = record.parts[1];
  const obstacle = obstacles[1];
  assert.ok(Math.abs(obstacle.size.x - (keyboard.size.x + 0.024)) < 1e-6);
  assert.ok(Math.abs(obstacle.size.y - (keyboard.size.y + 0.024)) < 1e-6);
  assert.ok(Math.abs(obstacle.size.z - (keyboard.size.z + 0.024)) < 1e-6);
  record.enabled = false;
  assert.equal(deviceObstacles([record]).length, 0);
});

test('typing check sees a hand only inside the keyboard margin', () => {
  const record = makeLaptop(laptopCorners, room());
  const keyboard = record.parts[1];
  assert.equal(deviceInsideTyping(record, { x: keyboard.center.x, y: 0.80, z: keyboard.center.z }), true);
  assert.equal(deviceInsideTyping(record, { x: keyboard.center.x + 0.6, y: 0.80, z: keyboard.center.z }), false);
  assert.equal(deviceInsideTyping(record, { x: keyboard.center.x, y: 1.2, z: keyboard.center.z }), false);
});

test('seat-frame conversion round-trips position and yaw', () => {
  const base = room();
  const record = makeLaptop(laptopCorners, base);
  for (const rotated of [base, room({ forward: { x: 0.5, z: -0.8660254 } })]) {
    const local = devicesToSeat(rotated, [record]);
    const back = devicesFromSeat(rotated, local);
    for (let index = 0; index < record.parts.length; index++) {
      const a = record.parts[index], b = back[0].parts[index];
      assert.ok(Math.abs(a.center.x - b.center.x) < 1e-9, `x ${a.center.x} ${b.center.x}`);
      assert.ok(Math.abs(a.center.y - b.center.y) < 1e-9, `y ${a.center.y} ${b.center.y}`);
      assert.ok(Math.abs(a.center.z - b.center.z) < 1e-9, `z ${a.center.z} ${b.center.z}`);
      assert.ok(Math.abs(a.yaw - b.yaw) < 1e-9, `yaw ${a.yaw} ${b.yaw}`);
    }
  }
  const angle = seatFrameYaw(base);
  assert.ok(Math.abs(angle) < 1e-9);
});

test('device state machine follows anchors, tracking and stand-up fade', () => {
  assert.equal(nextDeviceState({ anchorTracked: false, standUpFade: false }), 'lost');
  assert.equal(nextDeviceState({ anchorTracked: true, trackingLimited: true, standUpFade: false }), 'uncertain');
  assert.equal(nextDeviceState({ anchorTracked: true, standUpFade: false, headBelowSeat: true }), 'tracked');
  assert.equal(nextDeviceState({ anchorTracked: true, standUpFade: true, headBelowSeat: true }), 'away');
  assert.equal(nextDeviceState({ anchorTracked: true, standUpFade: true, distanceFromSeat: 1.4 }), 'away');
  assert.equal(nextDeviceState({ anchorTracked: true, standUpFade: true, distanceFromSeat: 0.2 }), 'tracked');
});

test('solver keeps devices as fixed obstacles', () => {
  const base = room();
  const record = makeLaptop(laptopCorners, base);
  const devices = deviceObstacles([record]);
  const plain = solve(base, slotRules, [], [], {}, 413);
  const withDevices = solve(base, slotRules, devices, [], {}, 413);
  assert.ok(plain.report.valid, plain.report.violations.join(', '));
  assert.ok(withDevices.report.valid, withDevices.report.violations.join(', '));
  assert.equal(validatePlacements(base, slotRules, withDevices.placements, devices).length, 0);
  const floorBlocker = [{ center: { x: 1.2, y: 0.5, z: 0 }, size: { x: 0.6, y: 1, z: 0.6 }, yaw: 0 }];
  const blocked = solve(base, slotRules, floorBlocker, [], {}, 413);
  assert.ok(blocked.report.blockedCells > plain.report.blockedCells, 'floor device blocks grid cells');
  assert.ok(withDevices.report.durationMs < 50, `solver ${withDevices.report.durationMs} ms`);
});
