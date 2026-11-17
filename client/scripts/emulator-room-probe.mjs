import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
await page.goto('https://localhost:8091/?roomSpike=1&v=1', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
const before = await page.evaluate(async () => ({
  xr: !!navigator.xr,
  arSupported: await navigator.xr?.isSessionSupported('immersive-ar'),
  badge: document.getElementById('garage-test-badge')?.textContent,
}));
await page.locator('#garage-test-badge').click();
await page.waitForTimeout(4000);
const after = await page.evaluate(() => {
  const world = window.garageEmulatorWorld;
  const panel = world?.getSceneObject('garage-hud');
  const text = id => panel?.getElementById(id)?.properties?.value?.text;
  return {
    xrPresenting: world?.renderer.xr.isPresenting,
    snapshot: window.garageRoomSnapshot,
    status: text('status'),
    measurements: text('room-measurements'),
    labels: text('stream-diagnostics'),
  };
});
await page.screenshot({ path: 'scripts/room-emulator.png' });
assert.equal(before.arSupported, true);
assert.equal(after.xrPresenting, true);
assert.ok(after.snapshot.floors > 0);
assert.ok(after.snapshot.tables > 0);
assert.ok(after.measurements.includes(after.snapshot.floorSize));
assert.ok(after.measurements.includes(after.snapshot.tableHeight));
console.log(JSON.stringify({ before, after, errors }, null, 2));
await browser.close();
