import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const captures = process.env.GARAGE_WHITEBOARD_CAPTURE;
if (captures) await mkdir(captures, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--ignore-certificate-errors'],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/state', route => route.fulfill({ json: {} }));
  await page.route('**/api/tasks', route => route.fulfill({ json: { tasks: [] } }));
  await page.goto((process.env.GARAGE_TEST_URL ?? 'https://localhost:8091') + '/?roomBuild=1&roomSource=demo&revealOff=1');
  await page.waitForFunction(() => window.garageWhiteboardDebug && window.IWER_DEVICE);
  await page.locator('#garage-test-badge').click();
  await page.waitForFunction(() => window.garageTableDebug?.panel.visible);
  await page.evaluate(() => {
    window.garageTableDebug.panel.requireElementById('yep-button').dispatchEvent({ type: 'click' });
    document.getElementById('garage-test-badge').style.display = 'none';
    const hud = window.garageEmulatorWorld.getSceneObject('garage-hud');
    if (hud) hud.visible = false;
  });
  await page.waitForFunction(() => window.garageEmulatorWorld.scene.getObjectByName('Board content whiteboard'), null, { timeout: 5000 }).catch(async error => {
    const slots = await page.evaluate(() => window.garageBuildDebug?.placements.map(entry => entry.slotId));
    throw new Error('The whiteboard fixture is missing: ' + JSON.stringify(slots), { cause: error });
  });

  const remote = (method, params) => page.evaluate(({ method, params }) =>
    window.IWER_DEVICE.remote.dispatch(method, params), { method, params });
  const positionOnBoard = ([x, y, z]) => page.evaluate(([x, y, z]) => {
    const board = window.garageEmulatorWorld.scene.getObjectByName('Whiteboard marker layer');
    const point = board.localToWorld(board.position.clone().set(x, y, z));
    return { x: point.x, y: point.y, z: point.z };
  }, [x, y, z]);
  await remote('set_input_mode', { mode: 'hand' });
  await remote('set_transform', { device: 'headset', position: await positionOnBoard([0, 0.10, 1.28]) });
  await remote('look_at', { device: 'headset', target: await positionOnBoard([0, 0.03, 0]) });

  // Use the non-dominant hand with its fingertip near the board.
  const device = 'hand-left';
  await remote('set_connected', { device, connected: true });
  await page.waitForFunction(() => Array.from(window.garageEmulatorWorld.session.inputSources)
    .some(source => source.handedness === 'left' && source.hand));
  const move = async (x, y) => remote('set_transform', {
    device,
    position: await positionOnBoard([x, y, 0.045]),
    anchor: 'index-tip',
    orientation: { fingers: 'forward', palm: 'down' },
  });
  await move(-0.34, 0.08);
  await page.waitForTimeout(180);
  if (captures) await page.screenshot({ path: join(captures, '01-blank-whiteboard.png') });
  assert.equal(await page.evaluate(() => window.garageWhiteboardDebug.strokes), 0);
  await remote('set_select_value', { device, value: 1 });
  await page.waitForFunction(() => window.garageWhiteboardDebug.strokes === 1);
  for (const [x, y] of [[-0.26, -0.05], [-0.18, -0.17], [-0.06, -0.095], [0.08, 0.015], [0.24, 0.14], [0.34, 0.215]]) {
    await move(x, y);
    await page.waitForTimeout(100);
  }
  if (captures) await page.screenshot({ path: join(captures, '02-hand-drawing.png') });
  await remote('set_select_value', { device, value: 0 });
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('garage-jam-whiteboard-v1') ?? '[]')[0]?.points.length >= 5);
  const strokes = await page.evaluate(() => JSON.parse(localStorage.getItem('garage-jam-whiteboard-v1')));
  assert.equal(strokes.length, 1);
  assert.ok(strokes[0].points.at(-1).x - strokes[0].points[0].x > 0.40);
  await move(0.42, -0.16);
  await page.waitForTimeout(150);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('garage-jam-whiteboard-v1'))), strokes);
  if (captures) await page.screenshot({ path: join(captures, '03-saved-stroke.png') });
  assert.deepEqual(errors, []);
  console.log('Tracked left-hand pinch drew one continuous fingertip stroke. Release saved the stroke and stopped drawing.');
} finally {
  await browser.close();
}
