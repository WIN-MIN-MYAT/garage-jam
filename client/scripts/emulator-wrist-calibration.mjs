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
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(`${process.env.GARAGE_TEST_URL ?? 'https://localhost:8091'}/?revealSpeed=3`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.garageWristDebug && window.garageManualDebug?.panel && window.IWER_DEVICE);
  const click = (owner, id) => page.evaluate(({ owner, id }) => {
    window[owner].panel.requireElementById(id).dispatchEvent({ type: 'click' });
  }, { owner, id });
  const menu = id => click('garageWristDebug', id);
  const calibration = id => click('garageManualDebug', id);
  const flow = id => click('garageFlowDebug', id);
  const table = id => click('garageTableDebug', id);
  const waitStage = async stage => {
    try {
      await page.waitForFunction(stage => window.garageFlowDebug.stage === stage, stage, { timeout: 25000 });
    } catch (error) {
      const state = await page.evaluate(() => ({
        stage: window.garageFlowDebug?.stage,
        calibration: window.garageManualDebug?.phase,
        status: window.garageEmulatorWorld?.getSceneObject('garage-hud')?.getElementById('status')?.properties.value.text,
        roomBuilt: !!window.garageBuildDebug,
        reveal: window.garageRevealDebug?.state(),
      }));
      throw new Error(`Expected ${stage}, got ${JSON.stringify(state)}. Browser errors: ${errors.join(', ')}`, { cause: error });
    }
  };
  const preferences = () => page.evaluate(() => JSON.parse(localStorage.getItem('garage-jam-preferences-v1')));
  const savedRoom = () => page.evaluate(() => JSON.parse(localStorage.getItem('garage-jam-last-room-v1')));
  const points = corners => page.evaluate(corners => corners.forEach(point => window.garageManualDebug.addPoint(...point)), corners);
  const lookAt = target => page.evaluate(target => window.IWER_DEVICE.remote.dispatch('look_at', { device: 'headset', target }), target);
  const lookForward = { x: 0, y: 1.6, z: -2 };
  const leftWrist = { x: -0.34, y: 1.10, z: -0.43 };

  await page.locator('#gj-enter').click();
  await waitStage('S2');
  await flow('flow-manual');
  await waitStage('S3');
  await page.waitForFunction(() => window.garageManualDebug.panel.visible);
  await points([[-2, 0, -3], [2, 0, -3], [-2, 0, 1], [2, 0, 1]]);
  await calibration('cal-use');
  assert.equal(await page.evaluate(() => window.garageManualDebug.phase), 'floor');
  assert.match(await page.evaluate(() => window.garageManualDebug.panel.requireElementById('cal-error').properties.value.text), /perimeter/);
  await calibration('cal-undo');
  await calibration('cal-undo');
  await points([[2, 0, 1], [-2, 0, 1]]);
  await calibration('cal-use');
  assert.equal(await page.evaluate(() => window.garageManualDebug.phase), 'table');
  await points([[-0.65, 0.75, -1.25], [0.65, 0.75, -1.25], [0.65, 0.75, -0.55], [-0.65, 0.75, -0.55]]);
  await calibration('cal-use');

  await waitStage('S7');
  await table('yep-button');
  await waitStage('S8');
  await flow('flow-mode-passthrough');
  await flow('flow-mark-devices');
  await page.waitForFunction(() => window.garageDeviceDebug?.state.visible === true);
  await page.evaluate(() => {
    window.garageDeviceDebug.start('laptop');
    window.garageDeviceDebug.mark({ x: -0.30, y: 1.25, z: -1.22 });
    window.garageDeviceDebug.mark({ x: 0.30, y: 0.82, z: -1.15 });
    window.garageDeviceDebug.commit();
    window.garageDeviceDebug.skipKeyboard();
  });
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => window.garageDeviceDebug.devices.length), 1);
  assert.equal(await page.evaluate(() => window.garageBuildDebug.root.visible), false, 'marking opens passthrough');
  assert.ok(await page.evaluate(() => window.garageDeviceDebug.volumeCount) > 0);
  const visibleAfterDevices = await page.evaluate(() => {
    let count = 0;
    window.garageBuildDebug.root.traverse(object => {
      if (object.name?.startsWith('PLACED_') && object.visible) count++;
    });
    return count;
  });
  assert.ok(visibleAfterDevices > 0, 'props stay visible after the device re-solve');
  const depthBefore = await page.evaluate(() => window.garageDeviceDebug.devices[0].parts[0].size.z);
  await page.evaluate(() => window.garageDeviceDebug.panel.requireElementById('dev-depth-up').dispatchEvent({ type: 'click' }));
  const depthAfter = await page.evaluate(() => window.garageDeviceDebug.devices[0].parts[0].size.z);
  assert.ok(depthAfter > depthBefore, `depth ${depthBefore} -> ${depthAfter}`);
  await page.evaluate(() => window.garageDeviceDebug.done());
  await waitStage('S10');
  await flow('flow-start');
  const before = await savedRoom();
  assert.equal(before.floor.polygon.length, 4);
  assert.ok(Number.isFinite(before.seat.x) && Number.isFinite(before.seat.z));
  await page.evaluate(position => window.IWER_DEVICE.remote.dispatch('set_transform', {
    device: 'controller-left', position, orientation: { x: 0, y: 0, z: 0, w: 1 },
  }), leftWrist);
  await lookAt(lookForward);
  await page.waitForTimeout(420);
  assert.equal(await page.evaluate(() => window.garageWristDebug.panel.visible), false);
  await lookAt(leftWrist);
  await page.waitForFunction(() => window.garageWristDebug.autoVisible);
  const position = await page.evaluate(() => {
    const debug = window.garageWristDebug;
    const { x, y, z } = debug.panel.position;
    return { x, y, z };
  });
  await lookAt(position);
  await page.waitForTimeout(420);
  assert.equal(await page.evaluate(() => window.garageWristDebug.autoVisible), true);
  await menu('wm-pin');
  await lookAt(lookForward);
  await page.waitForTimeout(420);
  assert.equal(await page.evaluate(() => window.garageWristDebug.panel.visible), true);
  await menu('wm-pin');
  await lookAt({ x: 2, y: 1.6, z: 0 });
  await page.waitForFunction(() => !window.garageWristDebug.panel.visible);

  const reopen = async () => {
    await lookAt(lookForward);
    await page.waitForFunction(() => !window.garageWristDebug.gesture.lookingAtWrist);
    await lookAt(leftWrist);
    await page.waitForFunction(() => window.garageWristDebug.panel.visible);
  };
  await reopen();
  await menu('wm-close');
  await page.waitForTimeout(420);
  assert.equal(await page.evaluate(() => window.garageWristDebug.panel.visible), false);
  await lookAt(lookForward);
  await page.evaluate(async position => {
    const remote = window.IWER_DEVICE.remote;
    await remote.dispatch('set_input_mode', { mode: 'hand' });
    await remote.dispatch('set_transform', { device: 'hand-left', position, anchor: 'wrist', orientation: 'auto' });
  }, leftWrist);
  await page.waitForFunction(() => [...window.garageEmulatorWorld.session.inputSources].some(source => source.handedness === 'left' && source.hand));
  assert.equal(await page.evaluate(() => window.garageWristDebug.panel.visible), false);
  await lookAt(leftWrist);
  await page.waitForFunction(() => window.garageWristDebug.autoVisible);
  await menu('wm-close');
  await page.evaluate(() => window.IWER_DEVICE.remote.dispatch('set_input_mode', { mode: 'controller' }));
  await reopen();
  await menu('wm-tab-home');
  await menu('wm-passthrough');
  assert.equal(await page.evaluate(() => window.garageBuildDebug.root.visible), false);
  await menu('wm-passthrough');
  assert.equal(await page.evaluate(() => window.garageBuildDebug.root.visible), true);
  await menu('wm-tab-settings');
  await menu('wm-settings-room');
  await menu('wm-table-view');
  assert.equal((await preferences()).tableView, 'real');
  await menu('wm-settings-preferences');
  for (const id of ['wm-units', 'wm-hand', 'wm-motion', 'wm-reveal', 'wm-sound', 'wm-outlines', 'wm-sky', 'wm-focus-length', 'wm-standup']) await menu(id);
  const prefs = await preferences();
  assert.deepEqual([prefs.units, prefs.dominantHand, prefs.reducedMotion, prefs.revealOff, prefs.revealSound, prefs.outlines, prefs.skyMode, prefs.focusMinutes, prefs.standUpFade],
    ['in', 'left', true, true, false, false, 'night', 45, true]);
  await menu('wm-tab-music');
  assert.equal(await page.evaluate(() => window.garageWristDebug.panel.requireElementById('page-music').properties.value.display), 'flex');
  await menu('wm-tab-settings');
  await menu('wm-settings-room');
  await menu('wm-debug');
  assert.equal(await page.evaluate(() => window.garageEmulatorWorld.getSceneObject('garage-hud').visible), true);
  await menu('wm-tab-settings');
  await menu('wm-reset');
  const reset = await preferences();
  assert.deepEqual([reset.units, reset.tableView, reset.revealSound, reset.outlines, reset.debugOverlay, reset.skyMode, reset.focusMinutes, reset.standUpFade], ['cm', 'workbench', true, true, false, 'golden', 25, false]);
  assert.equal(await page.evaluate(() => window.garageEmulatorWorld.getSceneObject('garage-hud').visible), false);

  await menu('wm-tab-room');
  await menu('wm-cutouts');
  assert.equal((await preferences()).cutouts, false);
  assert.equal(await page.evaluate(() => window.garageDeviceDebug.state.cutouts), false);
  await menu('wm-cutouts');
  assert.equal((await preferences()).cutouts, true);
  await menu('wm-mark-devices');
  await page.waitForFunction(() => window.garageDeviceDebug.state.visible === true);
  assert.equal(await page.evaluate(() => window.garageWristDebug.panel.visible), false);
  await page.evaluate(() => window.garageDeviceDebug.done());
  await page.waitForFunction(() => window.garageDeviceDebug.state.visible === false);
  await reopen();

  await menu('wm-tab-settings');
  await menu('wm-settings-room');
  await menu('wm-edit-table');
  await page.waitForFunction(() => window.garageTableDebug.panel.visible);
  await table('height-plus');
  await table('yep-button');
  assert.ok(Math.abs((await savedRoom()).table.topY - 0.755) < 0.001);
  const deviceAfterTable = await page.evaluate(() => window.garageDeviceDebug.devices);
  const laptopBase = deviceAfterTable[0].parts.find(part => part.part === 'base');
  assert.ok(Math.abs(laptopBase.center.y - 0.765) < 0.004, `device rebased to ${laptopBase.center.y}`);
  await reopen();
  await menu('wm-mark-table');
  await page.waitForFunction(() => window.garageManualDebug.panel.visible);
  assert.equal(await page.evaluate(() => window.garageBuildDebug.root.visible), false);
  await calibration('cal-cancel');
  assert.equal(await page.evaluate(() => window.garageBuildDebug.root.visible), true);
  await reopen();
  await menu('wm-mark-table');
  await points([[-0.8, 0.8, -1.35], [0.7, 0.8, -1.35], [0.7, 0.8, -0.65], [-0.8, 0.8, -0.65]]);
  await calibration('cal-use');
  const after = await savedRoom();
  assert.deepEqual(after.floor, before.floor);
  assert.deepEqual(after.walls, before.walls);
  assert.equal(after.table.topY, 0.8);
  assert.equal(after.table.polygon[0].x, -0.8);
  assert.equal(await page.evaluate(() => window.garageBuildDebug.root.visible), true);

  await reopen();
  await menu('wm-rearrange');
  await page.waitForTimeout(1700);
  assert.equal(await page.evaluate(() => window.garageFlowDebug.stage), 'S10');
  const visibleAfterRearrange = await page.evaluate(() => {
    let count = 0;
    window.garageBuildDebug.root.traverse(object => {
      if (object.name?.startsWith('PLACED_') && object.visible) count++;
    });
    return count;
  });
  assert.ok(visibleAfterRearrange > 0, 'props stay visible after rearrange');
  await reopen();
  await menu('wm-rescan');
  await waitStage('S2');
  await flow('flow-manual');
  await waitStage('S3');
  await points([[-2, 0, -3], [2, 0, -3], [2, 0, 1], [-2, 0, 1]]);
  await calibration('cal-use');
  await calibration('cal-skip');
  await waitStage('S10');
  assert.equal((await savedRoom()).table, null);

  await reopen();
  await menu('wm-tab-settings');
  await Promise.all([page.waitForEvent('load'), menu('wm-forget')]);
  await page.waitForFunction(() => document.querySelector('#gj-enter')?.textContent?.trim() === 'ENTER THE GARAGE');
  assert.equal(await savedRoom(), null);
  assert.equal(await page.evaluate(() => localStorage.getItem('garage-jam-devices-v1')), null);
  assert.deepEqual(errors, []);
  console.log('Wrist glance, panel retention, menu controls, room calibration, table-only edit, rescan, and forget passed.');
} finally {
  await browser.close();
}
