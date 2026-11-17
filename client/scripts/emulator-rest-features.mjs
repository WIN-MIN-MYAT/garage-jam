import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--ignore-certificate-errors'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(`${process.env.GARAGE_TEST_URL ?? 'https://localhost:8091'}/?revealSpeed=3`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.garageWristDebug && window.garageManualDebug?.panel && window.IWER_DEVICE);
  const click = (owner, id) => page.evaluate(({ owner, id }) => window[owner].panel.requireElementById(id).dispatchEvent({ type: 'click' }), { owner, id });
  const waitStage = stage => page.waitForFunction(stage => window.garageFlowDebug.stage === stage, stage, { timeout: 25000 });
  const points = corners => page.evaluate(corners => corners.forEach(point => window.garageManualDebug.addPoint(...point)), corners);
  const lookAt = target => page.evaluate(target => window.IWER_DEVICE.remote.dispatch('look_at', { device: 'headset', target }), target);
  const remote = (method, params) => page.evaluate(({ method, params }) => window.IWER_DEVICE.remote.dispatch(method, params), { method, params });
  const controllerButtons = buttons => remote('set_gamepad_state', { device: 'controller-right', buttons });

  await page.locator('#gj-enter').click();
  await waitStage('S2');
  const revealUi = await page.evaluate(() => ({
    page: !!window.garageFlowDebug.panel?.getElementById('page-reveal'),
    skip: !!window.garageFlowDebug.panel?.getElementById('flow-skip'),
  }));
  assert.deepEqual(revealUi, { page: false, skip: false }, 'reveal must not expose a skip panel or button');
  await click('garageFlowDebug', 'flow-manual');
  await waitStage('S3');
  await page.waitForFunction(() => window.garageManualDebug.panel.visible);
  await points([[-2, 0, -3], [2, 0, -3], [-2, 0, 1], [2, 0, 1]]);
  await click('garageManualDebug', 'cal-use');
  await click('garageManualDebug', 'cal-undo');
  await click('garageManualDebug', 'cal-undo');
  await points([[2, 0, 1], [-2, 0, 1]]);
  await click('garageManualDebug', 'cal-use');
  await points([[-0.65, 0.75, -1.25], [0.65, 0.75, -1.25], [0.65, 0.75, -0.55], [-0.65, 0.75, -0.55]]);
  await click('garageManualDebug', 'cal-use');
  await waitStage('S7');
  await click('garageTableDebug', 'yep-button');
  await waitStage('S8');
  await click('garageFlowDebug', 'flow-mode-streaming');
  await waitStage('S9b');
  await page.waitForTimeout(600);
  const pairing = await page.evaluate(() => ({
    stage: window.garageFlowDebug.stage,
    status: window.garageFlowDebug.panel?.requireElementById('flow-monitor-status')?.properties.value.text,
    url: window.garageFlowDebug.panel?.requireElementById('flow-pair-url')?.properties.value.text,
    states: window.garageStreamDebug?.states,
  }));
  assert.equal(pairing.stage, 'S9b');
  assert.ok(pairing.url && pairing.url.includes('/sender'), JSON.stringify(pairing));
  assert.match(pairing.url, /\/sender\?room=[A-Za-z0-9_-]{4,32}$/, 'S9b must show the room-scoped sender link');
  const streamRoom = await page.evaluate(() => window.garageStreamDebug?.room);
  assert.ok(streamRoom && pairing.url.includes(`room=${streamRoom}`), JSON.stringify({ pairing, streamRoom }));
  assert.equal(pairing.states.length, 3);
  await click('garageFlowDebug', 'flow-continue-2');
  await waitStage('S10');
  await click('garageFlowDebug', 'flow-start');
  await page.waitForFunction(() => window.garageDebug?.papers?.().length >= 2, null, { timeout: 15000 });
  await lookAt({ x: 0, y: 0.8, z: -0.9 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'scripts/rest-papers.png' });
  const before = await page.evaluate(() => ({
    papers: window.garageDebug.papers(),
    boards: { tasks: window.garageBoardDebug?.tasks ?? 0, splats: window.garageBoardDebug?.splats ?? 0 },
    monitors: [1, 2, 3].map(index => window.garageEmulatorWorld.scene.getObjectByName(`Monitor ${index}`)?.visible ?? null),
    streams: window.garageStreamDebug?.states,
    plugins: window.garagePluginDebug?.statuses,
    placements: window.garageBuildDebug.placements.map(item => item.slotId),
  }));
  assert.equal(before.papers.length, 2);
  assert.equal(before.boards.tasks, 2);
  assert.deepEqual(before.monitors, [false, true, false], JSON.stringify(before));
  assert.equal(before.streams.length, 3);
  assert.ok(!before.placements.includes('paint-cans'), 'spray cans are removed from the room');
  const boombox = await page.evaluate(() => window.garageBuildDebug.placements.find(item => item.slotId === 'boombox') ?? null);
  assert.ok(boombox, 'boombox should be placed in a corner');
  await lookAt({ x: boombox.position.x, y: boombox.position.y + 0.2, z: boombox.position.z });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'scripts/boombox-corner.png' });
  await lookAt({ x: 0, y: 0.8, z: -0.9 });

  await page.evaluate(() => window.garageWristDebug.show('plugins'));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.garageWristDebug.panel.requireElementById('wm-connect-weather').dispatchEvent({ type: 'click' }));
  await page.waitForFunction(() => window.garageWristDebug.panel.requireElementById('wm-plugin-note').properties.value.text.includes('CODE'), null, { timeout: 8000 });
  const pairingNote = await page.evaluate(() => ({ note: window.garageWristDebug.panel.requireElementById('wm-plugin-note').properties.value.text, url: location.href }));
  assert.match(pairingNote.note, /CODE [0-9A-F]{6}/);
  assert.ok(pairingNote.url.includes('/?'), 'plugin pairing must not navigate away from XR');
  await page.evaluate(() => window.garageWristDebug.hide());

  await page.evaluate(() => window.garageMonitorDebug?.show());
  await page.waitForTimeout(400);
  const panel = await page.evaluate(() => {
    const manager = window.garageEmulatorWorld.scene.getObjectByName('Monitor manager panel');
    const scene = window.garageEmulatorWorld.scene;
    return {
      visible: manager?.visible ?? false, hasPreset: !!manager?.requireElementById?.('mm-preset'),
      monitors: [1, 2, 3].map(index => scene.getObjectByName(`Monitor ${index}`)?.visible),
      connectionCard: scene.getObjectByName('Stream connection card')?.visible,
    };
  });
  assert.equal(panel.visible, true);
  assert.equal(panel.hasPreset, true);
  assert.deepEqual(panel.monitors, [true, true, true]);
  assert.equal(panel.connectionCard, false);
  await page.screenshot({ path: 'scripts/monitor-manager.png' });
  const monitor = async id => page.evaluate(id => window.garageEmulatorWorld.scene.getObjectByName('Monitor manager panel').requireElementById(id).dispatchEvent({ type: 'click' }), id);
  await monitor('mm-monitor-2');
  await monitor('mm-preset');
  await monitor('mm-width-up');
  await monitor('mm-lock');
  const monitorState = await page.evaluate(() => window.garageMonitorDebug.state());
  assert.equal(monitorState.selected, 1);
  assert.equal(monitorState.preset, 'table');
  assert.ok(monitorState.width > 1);
  assert.equal(monitorState.locked, true);
  assert.deepEqual(await page.evaluate(() => [1, 2, 3].map(index =>
    window.garageEmulatorWorld.scene.getObjectByName(`Monitor ${index} frame`).material.color.getHex())),
  [0x302d35, 0xd575a5, 0x302d35]);
  await monitor('mm-recenter');
  assert.equal(await page.evaluate(() => window.garageMonitorDebug.state().preset), 'arc');
  await page.evaluate(() => window.garageMonitorDebug.hide());
  await page.evaluate(() => window.garagePresenceDebug?.hide());
  await page.waitForTimeout(1400);
  const hidden = await page.evaluate(() => ({ root: window.garageBuildDebug.root.visible, debug: window.garagePresenceDebug?.hidden }));
  assert.equal(hidden.root, false);
  assert.equal(hidden.debug, true);
  await page.evaluate(() => window.garagePresenceDebug?.show());
  await page.waitForTimeout(1400);
  assert.equal(await page.evaluate(() => window.garageBuildDebug.root.visible), true);

  await page.evaluate(() => window.garageFocusDebug.start(1));
  await page.waitForFunction(() => window.garageFocusDebug.state.running, null, { timeout: 5000 });
  await page.waitForTimeout(1600);
  const focus = await page.evaluate(() => ({
    state: window.garageFocusDebug.state,
    door: window.garageEmulatorWorld.scene.getObjectByName('Roll-down focus door')?.position.y ?? null,
  }));
  assert.equal(focus.state.phase, 'focus');
  assert.ok(focus.state.remaining > 0 && focus.state.remaining < 60);
  assert.ok(focus.door !== null);
  await lookAt({ x: 0, y: 0.9, z: -1.3 });
  await page.screenshot({ path: 'scripts/rest-focus.png' });
  await page.evaluate(() => window.garageFocusDebug.cancel());

  const paper = await page.evaluate(() => {
    let found = null;
    window.garageEmulatorWorld.scene.traverse(object => {
      if (found || !object.isMesh || !object.name?.startsWith('Paper ')) return;
      const point = object.getWorldPosition(object.position.clone());
      found = { x: point.x, y: point.y, z: point.z };
    });
    return found;
  });
  assert.ok(paper, 'expected a paper to grab');
  await lookAt({ x: paper.x, y: paper.y, z: paper.z });
  await remote('set_transform', {
    device: 'controller-right',
    position: { x: paper.x, y: paper.y + 0.03, z: paper.z + 0.03 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  });
  await page.waitForTimeout(350);
  await controllerButtons([{ index: 1, value: 1, touched: true }]);
  await page.waitForTimeout(250);
  await controllerButtons([{ index: 0, value: 1, touched: true }]);
  await page.waitForTimeout(500);
  await controllerButtons([{ index: 0, value: 0, touched: false }, { index: 1, value: 0, touched: false }]);
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => window.garageDebug.papers().some(item => item.state === 'crumpled')), 'controller grab + trigger must crumple a paper');
  assert.equal(await page.evaluate(() => window.garageEmulatorWorld.renderer.xr.isPresenting), true, 'XR must stay up after crumpling');
  await page.screenshot({ path: 'scripts/rest-crumple.png' });
  await page.evaluate(() => window.garageDebug.dropFirstInTrash());
  await page.waitForFunction(() => window.garageDebug.papers().length === 1, null, { timeout: 10000 });
  const after = await page.evaluate(() => ({
    papers: window.garageDebug.papers(),
    splats: window.garageBoardDebug?.splats ?? 0,
    completed: JSON.parse(localStorage.getItem('garage-jam-progress-v1') || '{}').completedByDay ?? {},
  }));
  assert.equal(after.papers.length, 1);
  assert.ok(after.splats > before.boards.splats, JSON.stringify({ before: before.boards, after }));
  assert.ok(Object.values(after.completed).some(value => value > 0), JSON.stringify(after));
  await lookAt({ x: -2.2, y: 1.3, z: 0 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'scripts/rest-boards.png' });
  assert.deepEqual(errors, []);
  console.log('Papers, native task completion, mural, focus door, boards, streaming sender and plugin status passed.');
} finally {
  await browser.close();
}
