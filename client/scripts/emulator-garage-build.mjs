import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--ignore-certificate-errors'],
});
const manualYaw = Math.PI / 5;
const rotate = ({ x, z, ...rest }) => ({
  ...rest, x: x * Math.cos(manualYaw) + z * Math.sin(manualYaw), z: -x * Math.sin(manualYaw) + z * Math.cos(manualYaw),
});

function manualRoomFromFixture() {
  const fixture = JSON.parse(readFileSync(new URL('../test/fixtures/4x3-table.json', import.meta.url), 'utf8'));
  const floorY = fixture.seat.y ?? 0;
  const floorPolygon = fixture.floorPolygon.map(rotate);
  const walls = floorPolygon.map((p0, index, points) => {
    const p1 = points[(index + 1) % points.length];
    const dx = p1.x - p0.x, dz = p1.z - p0.z;
    const length = Math.hypot(dx, dz) || 1;
    return { id: `wall-${index}`, p0, p1, normal: { x: -dz / length, z: dx / length }, minY: floorY, maxY: fixture.ceilingY, openings: [], isVirtual: false };
  });
  return {
    floor: { y: floorY, polygon: floorPolygon },
    ceilingY: fixture.ceilingY,
    walls,
    openings: fixture.openings,
    furniture: fixture.furniture.map(item => ({ ...item, center: rotate(item.center), yaw: item.yaw + manualYaw })),
    table: { topY: fixture.table.topY, polygon: fixture.table.polygon.map(rotate), label: 'emulator table', confidence: 0.9 },
    seat: rotate(fixture.seat),
    forward: rotate(fixture.forward),
    confidence: fixture.confidence,
    source: 'manual',
  };
}

async function openBuild(query, manualRoom = null) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
  if (manualRoom) await context.addInitScript(({ room }) => localStorage.setItem('garage-jam-manual-room-v1', JSON.stringify(room)), { room: manualRoom });
  if (!query) await context.addInitScript(() => localStorage.setItem('garage-jam-preferences-v1', JSON.stringify({ tableConfirmed: true, tableHeight: 1.35 })));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(`https://localhost:8091/?roomBuild=1&v=1${query}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.garageEmulatorWorld, { timeout: 30000 });
  await page.locator('#garage-test-badge').click();
  await page.waitForFunction(() => window.garageEmulatorWorld.renderer.xr.isPresenting, { timeout: 15000 });
  await page.waitForFunction(() => window.garageBuildDebug?.ready === true, { timeout: 30000 });
  await page.waitForTimeout(2800);
  return { context, page, errors };
}

async function read(page) {
  return page.evaluate(() => {
    const world = window.garageEmulatorWorld;
    const debug = window.garageBuildDebug;
    const panel = world?.getSceneObject('garage-hud');
    const text = id => panel?.getElementById(id)?.properties?.value?.text;
    const box = debug.room.floor.polygon.reduce((bounds, point) => ({
      minX: Math.min(bounds.minX, point.x), maxX: Math.max(bounds.maxX, point.x),
      minZ: Math.min(bounds.minZ, point.z), maxZ: Math.max(bounds.maxZ, point.z),
    }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
    const table = debug.room.table ? debug.room.table.polygon.reduce((bounds, point) => ({
      minX: Math.min(bounds.minX, point.x), maxX: Math.max(bounds.maxX, point.x),
      minZ: Math.min(bounds.minZ, point.z), maxZ: Math.max(bounds.maxZ, point.z),
    }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }) : null;
    const tableCenterPoint = debug.room.table ? debug.room.table.polygon.reduce((sum, point) => ({ x: sum.x + point.x / debug.room.table.polygon.length, z: sum.z + point.z / debug.room.table.polygon.length }), { x: 0, z: 0 }) : null;
    const door = debug.placements.find(placement => placement.slotId === 'door');
    const doorWall = door ? debug.room.walls.find(wall => wall.id === door.wallId) : null;
    let doorDistance = null;
    if (doorWall && tableCenterPoint) {
      const dx = doorWall.p1.x - doorWall.p0.x, dz = doorWall.p1.z - doorWall.p0.z;
      const length2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((tableCenterPoint.x - doorWall.p0.x) * dx + (tableCenterPoint.z - doorWall.p0.z) * dz) / length2));
      doorDistance = Math.hypot(tableCenterPoint.x - (doorWall.p0.x + dx * t), tableCenterPoint.z - (doorWall.p0.z + dz * t));
    }
    const tableForward = tableCenterPoint ? (tableCenterPoint.x - debug.room.seat.x) * debug.room.forward.x + (tableCenterPoint.z - debug.room.seat.z) * debug.room.forward.z : null;
    const modelNodes = [];
    debug.root.traverse(object => {
      if (object.name?.endsWith(' model')) modelNodes.push({ name: object.name, parent: object.parent?.name ?? null });
    });
    const facing = [];
    const worktop = debug.root.getObjectByName('Workbench top') ?? debug.root.getObjectByName('Workbench model root');
    const worktopVertices = [];
    if (worktop) {
      worktop.updateMatrixWorld(true);
      worktop.traverse((mesh) => {
        if (!mesh.isMesh || mesh.name?.endsWith('ink outline')) return;
        const position = mesh.geometry?.attributes?.position;
        if (!position) return;
        const vertex = worktop.position.clone();
        for (let i = 0; i < position.count; i++) {
          mesh.localToWorld(vertex.fromBufferAttribute(position, i));
          if (Math.abs(vertex.y - debug.room.table.topY) < 0.02) worktopVertices.push({ x: vertex.x, z: vertex.z });
        }
      });
    }
    const propOverflows = [];
    const wallOffsets = [];
    debug.root.updateMatrixWorld(true);
    for (const wall of debug.room.walls) {
      const meshes = debug.root.getObjectByName('Garage walls').children.filter(mesh => mesh.name.startsWith(`Wall ${wall.id} `));
      for (const mesh of meshes) {
        const offset = (mesh.position.x - wall.p0.x) * wall.normal.x + (mesh.position.z - wall.p0.z) * wall.normal.z;
        wallOffsets.push(offset + mesh.geometry.parameters.depth / 2);
      }
    }
    for (const placement of debug.placements) {
      const prop = debug.root.getObjectByName(`PLACED_${placement.slotId}`);
      if (!prop) continue;
      const point = prop.position.clone();
      prop.traverse(mesh => {
        const vertices = mesh.geometry?.attributes.position;
        if (!vertices) return;
        for (let i = 0; i < vertices.count; i++) {
          point.fromBufferAttribute(vertices, i);
          prop.worldToLocal(mesh.localToWorld(point));
          if (Math.abs(point.x) > placement.footprint.width / 2 + 0.001 || Math.abs(point.z) > placement.footprint.depth / 2 + 0.001) {
            propOverflows.push(placement.slotId);
            break;
          }
        }
      });
      if (!prop.children.some(child => child.name.endsWith(' model frame'))) continue;
      let expected;
      if (placement.type === 'wall') {
        const wall = debug.room.walls.find(item => item.id === placement.wallId);
        if (!wall) continue;
        expected = { x: wall.normal.x, z: wall.normal.z };
      } else {
        const dx = debug.room.seat.x - placement.position.x, dz = debug.room.seat.z - placement.position.z;
        const length = Math.hypot(dx, dz) || 1;
        expected = { x: dx / length, z: dz / length };
      }
      facing.push({ slot: placement.slotId, dot: Number((Math.sin(prop.rotation.y) * expected.x + Math.cos(prop.rotation.y) * expected.z).toFixed(3)) });
    }
    let toon = 0, modelMeshes = 0;
    for (const node of modelNodes) {
      const object = debug.root.getObjectByName(node.name);
      object?.traverse(mesh => {
        if (!mesh.isMesh || mesh.name?.endsWith('ink outline')) return;
        modelMeshes++;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        toon += materials.filter(material => material?.type === 'MeshToonMaterial').length;
      });
    }
    return {
      presenting: world.renderer.xr.isPresenting,
      status: text('status'),
      metrics: text('metrics'),
      source: debug.source,
      roomSource: debug.room.source,
      tableMode: debug.tableMode,
      scan: debug.scan,
      floorSize: debug.getTableInfo() ? [debug.getTableInfo().roomWidth, debug.getTableInfo().roomDepth] : null,
      floorCenter: [Number(((box.minX + box.maxX) / 2).toFixed(3)), Number(((box.minZ + box.maxZ) / 2).toFixed(3))],
      tableTopY: debug.room.table?.topY ?? null,
      workbenchSurface: debug.getWorkbenchSurface?.() ?? null,
      tableCenter: tableCenterPoint ? [Number(tableCenterPoint.x.toFixed(3)), Number(tableCenterPoint.z.toFixed(3))] : null,
      tableSize: table ? [Number((table.maxX - table.minX).toFixed(3)), Number((table.maxZ - table.minZ).toFixed(3))] : null,
      tableFrame: debug.tableFrame?.() ?? null,
      doorWall: door?.wallId ?? null,
      doorDistance: doorDistance == null ? null : Number(doorDistance.toFixed(3)),
      tableForward: tableForward == null ? null : Number(tableForward.toFixed(3)),
      modelNodes,
      facing,
      worktopVertices,
      propOverflows,
      wallOffsets,
      toon,
      modelMeshes,
      tablePolygon: debug.room.table?.polygon ?? null,
      floorPolygon: debug.room.floor.polygon,
      walls: debug.room.walls.map(wall => ({ id: wall.id, p0: wall.p0, p1: wall.p1, normal: wall.normal, minY: wall.minY, maxY: wall.maxY })),
      openings: debug.room.openings,
      seat: debug.room.seat,
      forward: debug.room.forward,
      placements: debug.placements.length,
      placementList: debug.placements.map(item => item.slotId),
      solverMs: Number(debug.report.durationMs.toFixed(1)),
      timings: debug.report.timings,
      solverValid: debug.report.valid,
      p0Unplaced: debug.report.p0Unplaced,
      violations: debug.report.violations,
      unplaced: debug.report.unplaced.map(item => item.slotId),
    };
  });
}

const scan = await openBuild('');
const scanResult = await read(scan.page);
await scan.page.screenshot({ path: 'scripts/garage-build-emulator.png' });
const doorWall = scanResult.walls.find(wall => wall.id === scanResult.doorWall);
if (doorWall) {
  await scan.page.evaluate(({ x, z }) => {
    if (window.IWER_DEVICE) window.IWER_DEVICE.remote.dispatch('look_at', { device: 'headset', target: { x, y: 1.2, z } });
  }, { x: (doorWall.p0.x + doorWall.p1.x) / 2, z: (doorWall.p0.z + doorWall.p1.z) / 2 });
  await scan.page.waitForTimeout(900);
  await scan.page.screenshot({ path: 'scripts/garage-build-sunset.png' });
}
const close = (a, b, tolerance = 0.01) => Math.abs(a - b) <= tolerance;
function assertWorktopMatches(result) {
  assert.ok(result.worktopVertices.length > 0, 'expected visible worktop vertices at the measured height');
  const bounds = result.tablePolygon.reduce((box, point) => ({
    minX: Math.min(box.minX, point.x), maxX: Math.max(box.maxX, point.x),
    minZ: Math.min(box.minZ, point.z), maxZ: Math.max(box.maxZ, point.z),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
  const actual = result.worktopVertices.reduce((box, point) => ({
    minX: Math.min(box.minX, point.x), maxX: Math.max(box.maxX, point.x),
    minZ: Math.min(box.minZ, point.z), maxZ: Math.max(box.maxZ, point.z),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
  assert.ok(
    actual.minX <= bounds.minX + 0.05 && actual.maxX >= bounds.maxX - 0.05 &&
    actual.minZ <= bounds.minZ + 0.05 && actual.maxZ >= bounds.maxZ - 0.05,
    `worktop must cover the measured tabletop; attached hardware may overhang: ${JSON.stringify({ actual, bounds })}`,
  );
  const surface = result.workbenchSurface;
  assert.ok(surface, 'expected the measured wooden worktop');
  const frame = result.tableFrame;
  assert.ok(frame, 'expected the measured table frame');
  assert.ok(close(surface.width, frame.width, 0.02), `wooden top width ${surface.width} must match measured ${frame.width}`);
  assert.ok(close(surface.depth, frame.depth, 0.02), `wooden top depth ${surface.depth} must match measured ${frame.depth}`);
  assert.ok(close(surface.topY, result.tableTopY, 0.01), 'wooden top must sit at the measured table height');
}
assert.equal(scanResult.presenting, true);
assert.equal(scanResult.source, 'SCAN');
assert.equal(scanResult.roomSource, 'webxr');
assert.ok(scanResult.scan, 'expected live plane scan metadata');
assert.ok(close(scanResult.floorSize[0], scanResult.scan.floorSize[0]), 'floor width must match the scan');
assert.ok(close(scanResult.floorSize[1], scanResult.scan.floorSize[1]), 'floor depth must match the scan');
assert.ok(scanResult.tableTopY != null, 'expected a scanned table');
assert.ok(close(scanResult.tableTopY, scanResult.scan.tableTopY), 'table height must match the scan');
assert.ok(close(scanResult.tableTopY, 0.74), 'the saved height must not override the scanned desk-height table');
assertWorktopMatches(scanResult);
assert.equal(scanResult.tableMode, 'SCAN');
assert.ok(scanResult.tableCenter, 'expected a table polygon');
assert.ok(Math.hypot(scanResult.tableCenter[0] - scanResult.scan.tableCenter.x, scanResult.tableCenter[1] - scanResult.scan.tableCenter.z) < 0.2, 'table centre must match the scanned plane');
assert.equal(scanResult.solverValid, true);
assert.ok(scanResult.placements >= 8, 'expected placed props');
assert.ok(scanResult.facing.length >= 4, 'expected placed models to check');
assert.ok(scanResult.facing.every(item => item.slot === 'shelf' ? true : item.dot > 0.95), `model facing: ${JSON.stringify(scanResult.facing)}`);
assert.deepEqual(scanResult.propOverflows, []);
assert.ok(scanResult.modelMeshes > 0 && scanResult.toon === scanResult.modelMeshes, `toon materials ${scanResult.toon}/${scanResult.modelMeshes}`);
await scan.context.close();

const demo = await openBuild('&roomSource=demo');
const demoResult = await read(demo.page);
assert.equal(demoResult.source, 'DEMO');
assert.equal(demoResult.roomSource, 'mock');
assert.equal(demoResult.tableMode, 'SCAN');
assert.ok(demoResult.tableCenter, 'demo table must exist');
assert.ok(demoResult.tableCenter[1] < demoResult.floorCenter[1] - 0.5, 'demo table must remain forward toward the window');
assert.ok(demoResult.tableTopY > 0.7 && demoResult.tableTopY < 0.8, 'demo table top height');
assert.ok(demoResult.facing.length >= 4 && demoResult.facing.every(item => item.slot === 'shelf' ? true : item.dot > 0.95), `demo model facing: ${JSON.stringify(demoResult.facing)}`);
assert.deepEqual(demoResult.propOverflows, []);
assert.ok(demoResult.modelMeshes > 0 && demoResult.toon === demoResult.modelMeshes, `demo toon materials ${demoResult.toon}/${demoResult.modelMeshes}`);
await demo.context.close();

const manual = await openBuild('&roomSource=manual', manualRoomFromFixture());
const manualResult = await read(manual.page);
assert.equal(manualResult.source, 'MANUAL');
assert.equal(manualResult.roomSource, 'manual');
assert.equal(manualResult.tableMode, 'SCAN');
assert.ok(close(manualResult.floorSize[0], 4) && close(manualResult.floorSize[1], 3), 'manual room footprint');
const manualCenter = rotate({ x: 0, z: -1.4 });
assert.ok(manualResult.tableCenter && close(manualResult.tableCenter[0], manualCenter.x) && close(manualResult.tableCenter[1], manualCenter.z), 'manual table must remain next to the window');
assertWorktopMatches(manualResult);
assert.ok(manualResult.tableTopY && close(manualResult.tableTopY, 0.75), 'manual table height');
assert.ok(manualResult.facing.length >= 3 && manualResult.facing.every(item => item.slot === 'shelf' ? true : item.dot > 0.95), `manual model facing: ${JSON.stringify(manualResult.facing)}`);
assert.deepEqual(manualResult.propOverflows, []);
assert.ok(manualResult.modelMeshes > 0 && manualResult.toon === manualResult.modelMeshes, `manual toon materials ${manualResult.toon}/${manualResult.modelMeshes}`);

const errors = [...scan.errors, ...demo.errors, ...manual.errors];
assert.deepEqual(errors, []);
for (const result of [scanResult, demoResult, manualResult]) {
  assert.ok(result.solverValid, JSON.stringify(result.violations));
  assert.ok(result.wallOffsets.length >= result.walls.length && result.wallOffsets.every(offset => Math.abs(offset) < 0.001));
}
console.log(JSON.stringify({ scan: scanResult, demo: demoResult, manual: manualResult, errors }, null, 2));
await manual.context.close();
await browser.close();
