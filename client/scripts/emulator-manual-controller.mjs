import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
await page.goto('https://localhost:8091/?roomSpike=1&v=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.garageEmulatorWorld && !!window.garageManualDebug && !!window.IWER_DEVICE);
await page.locator('#garage-test-badge').click();
await page.waitForFunction(() => window.garageEmulatorWorld.renderer.xr.isPresenting);
await page.evaluate(() => window.garageManualDebug.start());
await page.waitForTimeout(800);

const points = [
  [-2, 0, -2], [2, 0, -2], [2, 0, 1], [-2, 0, 1],
  [-0.6, 0.75, -1.2], [0.6, 0.75, -1.2], [0.6, 0.75, -0.6], [-0.6, 0.75, -0.6],
];
let firstPose;
for (const [index, [x, y, z]] of points.entries()) {
  await page.evaluate(async ({ x, y, z }) => {
    const remote = window.IWER_DEVICE.remote;
    await remote.dispatch('set_transform', { device: 'controller-right', position: { x, y, z }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  }, { x, y, z });
  if (index === 0) firstPose = await page.evaluate(() => new Promise(resolve => {
    const world = window.garageEmulatorWorld;
    const stop = world.onXRFrame(frame => {
      const source = [...world.session.inputSources].find(input => input.handedness === 'right');
      const reference = world.renderer.xr.getReferenceSpace();
      const grip = source?.gripSpace && frame.getPose(source.gripSpace, reference);
      const ray = source?.targetRaySpace && frame.getPose(source.targetRaySpace, reference);
      stop(); resolve({ grip: grip?.transform.position, ray: ray?.transform.position });
    });
  }));
  await page.evaluate(() => window.IWER_DEVICE.remote.dispatch('set_select_value', { device: 'controller-right', value: 1 }));
  await page.waitForFunction(count => window.garageManualDebug.pointCount === count, index % 4 + 1);
  await page.evaluate(() => window.IWER_DEVICE.remote.dispatch('set_select_value', { device: 'controller-right', value: 0 }));
  await page.waitForTimeout(450);
  if (index === 3 || index === 7) {
    await page.evaluate(() => window.garageManualDebug.use());
    await page.waitForTimeout(300);
  }
}
const result = await page.evaluate(() => ({ phase: window.garageManualDebug.phase, room: window.garageManualRoom }));
assert.equal(result.phase, 'done');
assert.equal(result.room.source, 'manual');
assert.equal(result.room.floor.polygon.length, 4);
assert.equal(result.room.table.polygon.length, 4);
assert.ok(Math.abs(result.room.floor.y) < 0.02);
assert.ok(Math.abs(result.room.floor.polygon[0].x + 2) < 0.02);
assert.ok(Math.abs(result.room.floor.polygon[0].z + 2) < 0.02);
assert.ok(Math.abs(result.room.table.topY - 0.75) < 0.02);
console.log(JSON.stringify({ firstPose, phase: result.phase, floor: result.room.floor, table: result.room.table }, null, 2));
await browser.close();
