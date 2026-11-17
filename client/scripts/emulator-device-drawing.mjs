import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--ignore-certificate-errors'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${process.env.GARAGE_TEST_URL ?? 'https://localhost:8091'}/?roomBuild=1&roomSource=demo&revealOff=1`);
  await page.waitForFunction(() => window.garageDeviceDebug?.panel && window.IWER_DEVICE);
  await page.locator('#garage-test-badge').click();
  await page.waitForFunction(() => window.garageBuildDebug?.ready && window.garageTableDebug?.panel.visible);
  await page.waitForTimeout(1200);
  const cursorOverlay = await page.evaluate(() => {
    let found = 0, overlaid = 0;
    window.garageEmulatorWorld.scene.traverse(object => {
      if (object.isMesh && object.renderOrder === Infinity && object.userData?.attached === true) {
        found++;
        if (object.material?.depthTest === false && object.material?.depthWrite === false) overlaid++;
      }
    });
    return { found, overlaid };
  });
  assert.ok(cursorOverlay.found > 0 && cursorOverlay.overlaid === cursorOverlay.found, `pointer cursor must draw above props and panels: ${JSON.stringify(cursorOverlay)}`);
  await page.evaluate(() => window.garageTableDebug.panel.requireElementById('yep-button').dispatchEvent({ type: 'click' }));
  const deviceClick = id => page.evaluate(id => window.garageDeviceDebug.panel.requireElementById(id).dispatchEvent({ type: 'click' }), id);
  const send = (method, params) => page.evaluate(({ method, params }) => window.IWER_DEVICE.remote.dispatch(method, params), { method, params });
  const controller = 'controller-right', hand = 'hand-right';
  const move = (device, position, extra = {}) => send('set_transform', { device, position, ...extra });
  const press = (device, value) => send('set_select_value', { device, value });
  const read = () => page.evaluate(() => {
    const debug = window.garageDeviceDebug;
    return {
      first: debug.marking?.first,
      points: debug.marking?.points,
      issue: debug.state.issue,
      dragMoved: !!debug.marking?.dragMoved,
      locked: !!debug.marking?.source,
    };
  });
  const uiCenter = () => page.evaluate(() => {
    const p = window.garageDeviceDebug.panel.position;
    return { x: p.x, y: p.y, z: p.z };
  });
  await page.evaluate(() => window.garageDeviceDebug.open());
  assert.equal(await page.evaluate(() => window.garageBuildDebug.root.visible), false);
  await deviceClick('dev-template-monitor');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'scripts/device-panel-open.png' });

  const panelCenter = await uiCenter();
  const orientation = { x: 0, y: 0, z: 0, w: 1 };
  await move(controller, { ...panelCenter, z: panelCenter.z + 0.25 }, { orientation });
  await press(controller, 1);
  await page.waitForTimeout(120);
  assert.equal((await read()).first, undefined, 'a trigger aimed at the card must stay with the UI');
  await press(controller, 0);

  const a = { x: -0.18, y: 1.2, z: -1.31 }, b = { x: 0.42, y: 0.85, z: -1.30 };
  await move(controller, a, { orientation });
  await page.waitForTimeout(210);
  await press(controller, 1);
  await page.waitForFunction(() => window.garageDeviceDebug.marking?.first);
  const first = (await read()).first;
  const previewState = () => page.evaluate(() => {
    const object = window.garageEmulatorWorld.scene.getObjectByName('Device preview outline');
    return object ? { uuid: object.geometry.uuid, visible: object.visible, scale: object.scale.toArray() } : null;
  });
  const previewBefore = await previewState();
  await move(controller, b, { orientation });
  await page.waitForTimeout(320);
  const dragging = await read();
  const previewAfter = await previewState();
  assert.deepEqual(dragging.first, first, 'dragging cannot shift the first corner');
  assert.equal(dragging.points, undefined, 'the second corner waits for release');
  assert.equal(dragging.dragMoved, true, 'a held drag updates the live outline');
  assert.equal(previewBefore?.uuid, previewAfter?.uuid, 'the live outline reuses one geometry while dragging');
  assert.equal(previewAfter?.visible, true);
  await page.screenshot({ path: 'scripts/device-drag-preview.png' });
  assert.equal(await page.evaluate(() => window.garageDeviceDebug.panel.visible), true);
  await press(controller, 0);
  await page.waitForFunction(() => window.garageDeviceDebug.marking?.points?.length === 2);
  const assertNear = (actual, expected) => assert.ok(Math.hypot(
    actual.x - expected.x, actual.y - expected.y, actual.z - expected.z,
  ) < 0.02, JSON.stringify({ actual, expected }));
  assertNear(first, a);
  assertNear((await read()).points[1], b);
  assert.equal((await read()).locked, true, 'the drawing hand stays locked');

  await deviceClick('dev-undo');
  assert.equal((await read()).points, undefined);
  assert.deepEqual((await read()).first, first, 'Undo removes the second corner only');
  await send('set_input_mode', { mode: 'hand' });
  await move(hand, panelCenter, { anchor: 'index-tip', orientation: 'auto' });
  await page.waitForTimeout(380);
  await press(hand, 1);
  await page.waitForTimeout(120);
  assert.equal((await read()).points, undefined, 'a pinch over the card must stay with the UI');
  await press(hand, 0);
  await page.waitForTimeout(200);
  assert.deepEqual((await read()).first, first);
  await deviceClick('dev-undo');
  assert.equal((await read()).first, undefined);
  assert.equal((await read()).locked, false, 'undoing the first corner releases the hand');

  const handPose = { anchor: 'index-tip', orientation: { fingers: 'forward', palm: 'down' } };
  await move(hand, a, handPose);
  await page.waitForTimeout(360);
  await press(hand, 1);
  await page.waitForFunction(() => window.garageDeviceDebug.marking?.first);
  assertNear((await read()).first, a);
  await move(hand, b, handPose);
  await page.waitForTimeout(320);
  await press(hand, 0);
  await page.waitForFunction(() => window.garageDeviceDebug.marking?.points?.length === 2);
  assertNear((await read()).points[1], b);
  await deviceClick('dev-undo');
  await deviceClick('dev-undo');
  assert.equal((await read()).first, undefined);

  await send('set_connected', { device: 'hand-left', connected: true });
  await send('set_connected', { device: 'hand-right', connected: true });
  await move(hand, a, handPose);
  await page.waitForTimeout(360);
  await press(hand, 1);
  await page.waitForFunction(() => window.garageDeviceDebug.marking?.first);
  await press(hand, 0);
  await page.waitForTimeout(200);
  await move('hand-left', b, handPose);
  await page.waitForTimeout(300);
  await press('hand-left', 1);
  await page.waitForTimeout(200);
  assert.equal((await read()).points, undefined, 'the other hand cannot finish the locked outline');
  await press('hand-left', 0);
  await move(hand, b, handPose);
  await page.waitForTimeout(300);
  await press(hand, 1);
  await page.waitForFunction(() => window.garageDeviceDebug.marking?.points?.length === 2);
  assertNear((await read()).points[1], b);
  await press(hand, 0);
  await deviceClick('dev-use');
  const setup = await page.evaluate(() => {
    const scene = window.garageEmulatorWorld.scene;
    const root = scene.getObjectByName('Device cutout volumes');
    const device = window.garageDeviceDebug.devices[0];
    return { partNames: device.parts.map(part => part.part), thickness: device.parts[0].size.z,
      passthroughOutline: root.getObjectByName('Device passthrough outline Monitor').visible, center: device.parts[0].center };
  });
  assert.deepEqual(setup.partNames, ['screen']);
  assert.equal(setup.thickness, 0.005);
  assert.equal(setup.passthroughOutline, true);
  await deviceClick('dev-done');
  await page.waitForFunction(() => window.garageBuildDebug.root.visible);
  assert.equal(await page.evaluate(() => {
    const scene = window.garageEmulatorWorld.scene;
    const display = scene.getObjectByName('Device display Monitor');
    return !display.visible && !display.getObjectByName('Monitor bezel') && scene.getObjectByName('Device occluders Monitor').visible;
  }), true);
  await page.evaluate(() => window.garageEmulatorWorld.getSceneObject('garage-hud')
    .requireElementById('passthrough-button').dispatchEvent({ type: 'click' }));
  await page.waitForFunction(() => window.garageEmulatorWorld.scene.getObjectByName('Device passthrough outline Monitor')?.visible);

  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('garage-jam-devices-v1')).entries.length), 1);
  await page.evaluate(() => window.garageEmulatorWorld.session.end());
  await page.waitForFunction(() => !window.garageEmulatorWorld.renderer.xr.isPresenting);
  await page.reload();
  await page.waitForFunction(() => window.garageDeviceDebug?.panel && window.IWER_DEVICE);
  await page.locator('#garage-test-badge').click();
  try {
    await page.waitForFunction(() => window.garageDeviceDebug?.volumeCount === 1, null, { timeout: 15000 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      presenting: window.garageEmulatorWorld?.renderer.xr.isPresenting,
      roomBuilt: !!window.garageBuildDebug?.ready,
      deviceState: window.garageDeviceDebug?.state,
      deviceCount: window.garageDeviceDebug?.devices.length,
      saved: JSON.parse(localStorage.getItem('garage-jam-devices-v1') || 'null')?.entries.length,
    }));
    throw new Error(`Saved monitor did not restore: ${JSON.stringify(state)} / ${errors.join(', ')}`, { cause: error });
  }
  const restored = await page.evaluate(() => window.garageDeviceDebug.devices[0].parts[0].center);
  assert.ok(Math.hypot(restored.x - setup.center.x, restored.y - setup.center.y, restored.z - setup.center.z) < 0.001);
  await page.evaluate(() => window.garageTableDebug.panel.requireElementById('yep-button').dispatchEvent({ type: 'click' }));
  await page.evaluate(() => window.garageDeviceDebug.start('extra'));
  const flat = await page.evaluate(() => {
    const debug = window.garageDeviceDebug;
    debug.mark({ x: -0.1, y: 0.92, z: -1.3 });
    debug.mark({ x: 0.35, y: 1.1, z: -1.0 });
    const [a, b] = debug.marking.points;
    debug.commit();
    const zone = debug.devices.find(device => device.template === 'extra').parts[0];
    return { a, b, zoneY: zone.center.y - zone.size.y / 2 };
  });
  assert.ok(Math.abs(flat.a.y - flat.b.y) < 0.001 && Math.abs(flat.a.y - flat.zoneY) < 0.001, 'desk marks and the saved zone use one surface');
  assert.deepEqual(errors, []);
  console.log('Independent controller and hand marks, corner undo, UI ownership, desk alignment, passthrough outlines, bezel-free cutout and reload persistence passed.');
} finally {
  await browser.close();
}
