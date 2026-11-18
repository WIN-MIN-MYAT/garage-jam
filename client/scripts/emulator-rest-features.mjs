import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--ignore-certificate-errors'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`); });
  await page.route('**/api/tasks', route => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      json: {
        tasks: [
          { id: 'qa-task-1', title: 'QA task one', priority: 'High', due: null, source: 'local', starter: true },
          { id: 'qa-task-2', title: 'QA task two', priority: 'Medium', due: null, source: 'local', starter: true },
        ],
        offline: false,
        notion: { configured: false },
      },
    });
  });
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
    code: window.garageFlowDebug.panel?.requireElementById('flow-pair-code')?.properties.value.text,
    states: window.garageStreamDebug?.states,
  }));
  assert.equal(pairing.stage, 'S9b');
  assert.ok(pairing.url && pairing.url.includes('/sender'), JSON.stringify(pairing));
  assert.equal(new URL(pairing.url).search, '');
  assert.equal(pairing.code, await page.evaluate(() => window.garageStreamDebug.room));
  assert.match(pairing.code, /^[A-Za-z0-9_-]{4,32}$/);
  assert.equal(pairing.states.length, 2);
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
    monitors: [1, 2].map(index => window.garageEmulatorWorld.scene.getObjectByName(`Monitor ${index}`)?.visible ?? null),
    streams: window.garageStreamDebug?.states,
    plugins: window.garagePluginDebug?.statuses,
    placements: window.garageBuildDebug.placements.map(item => item.slotId),
  }));
  assert.equal(before.papers.length, 2);
  assert.equal(before.boards.tasks, 2);
  assert.deepEqual(before.monitors, [true, false], JSON.stringify(before));
  assert.equal(before.streams.length, 2);
  assert.ok(!before.placements.includes('paint-cans'), 'spray cans are removed from the room');
  const boombox = await page.evaluate(() => window.garageBuildDebug.placements.find(item => item.slotId === 'boombox') ?? null);
  assert.ok(boombox, 'boombox should be placed in a corner');
  const trash = await page.evaluate(() => {
    const placement = window.garageBuildDebug.placements.find(item => item.slotId === 'trash') ?? null;
    const frame = window.garageBuildDebug.tableFrame();
    const room = window.garageBuildDebug.room;
    return { placement, frame, seat: room?.seat, forward: room?.forward };
  });
  assert.ok(trash.placement, 'trash should be placed');
  if (trash.frame && trash.seat) {
    const dx = trash.placement.position.x - trash.frame.center.x;
    const dz = trash.placement.position.z - trash.frame.center.z;
    const cos = Math.cos(trash.frame.yaw), sin = Math.sin(trash.frame.yaw);
    const localX = dx * cos - dz * sin;
    const localZ = dx * sin + dz * cos;
    const seatDistance = Math.hypot(trash.placement.position.x - trash.seat.x, trash.placement.position.z - trash.seat.z);
    const ahead = (trash.placement.position.x - trash.seat.x) * trash.forward.x
      + (trash.placement.position.z - trash.seat.z) * trash.forward.z;
    assert.ok(Math.abs(localX) > trash.frame.width / 2 - 0.02, JSON.stringify({ reason: 'trash should sit outside the table edge', trash, localX, localZ }));
    assert.ok(Math.abs(localZ) < trash.frame.depth / 2 + 0.3, JSON.stringify({ reason: 'trash should stay alongside the table', trash, localX, localZ }));
    assert.ok(seatDistance > 0.5, JSON.stringify({ reason: 'trash should not sit under the seat', trash, seatDistance }));
    assert.ok(ahead > -0.35, JSON.stringify({ reason: 'trash should not spawn behind the player', trash, ahead }));
  }
  await lookAt({ x: boombox.position.x, y: boombox.position.y + 0.2, z: boombox.position.z });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'scripts/boombox-corner.png' });
  await lookAt({ x: 0, y: 0.8, z: -0.9 });

  await page.evaluate(() => window.garageWristDebug.show('plugins'));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.garageWristDebug.panel.requireElementById('wm-connect-weather').dispatchEvent({ type: 'click' }));
  await page.waitForFunction(() => window.garageSpotifySearchDebug?.state.open === true, null, { timeout: 8000 });
  const weatherPanel = await page.evaluate(() => ({
    title: window.garageSpotifySearchDebug.panel.requireElementById('ss-title').properties.value.text,
    open: window.garageSpotifySearchDebug.state.open,
    url: location.href,
  }));
  assert.equal(weatherPanel.title, 'Weather location');
  assert.equal(weatherPanel.open, true);
  assert.ok(weatherPanel.url.includes('/?'), 'weather search must not navigate away from XR');
  await page.evaluate(() => window.garageSpotifySearchDebug.close());

  await page.evaluate(() => window.garageMonitorDebug?.show());
  await page.waitForTimeout(400);
  const panel = await page.evaluate(() => {
    const manager = window.garageEmulatorWorld.scene.getObjectByName('Monitor manager panel');
    const scene = window.garageEmulatorWorld.scene;
    return {
      visible: manager?.visible ?? false, hasPreset: !!manager?.requireElementById?.('mm-layout-desk'),
      monitors: [1, 2].map(index => scene.getObjectByName(`Monitor ${index}`)?.visible),
      model: !!scene.getObjectByName('Monitor 1')?.getObjectByName('Low-poly monitor'),
      texture: window.garageBuildDebug.root.getObjectByName('Garage walls').children
        .find(child => child.name.startsWith('Wall '))?.material.map?.image?.width,
    };
  });
  assert.equal(panel.visible, true);
  assert.equal(panel.hasPreset, true);
  assert.deepEqual(panel.monitors, [true, false]);
  assert.equal(panel.model, true);
  assert.equal(panel.texture, 2048);
  await page.screenshot({ path: 'scripts/monitor-manager.png' });
  const monitor = async id => page.evaluate(id => window.garageEmulatorWorld.scene.getObjectByName('Monitor manager panel').requireElementById(id).dispatchEvent({ type: 'click' }), id);
  await monitor('mm-monitor-2');
  const two = await page.evaluate(() => window.garageStreamDebug.layout);
  const twoEnabled = two.filter(monitor => monitor.enabled);
  assert.equal(twoEnabled.length, 2);
  const left = twoEnabled.find(monitor => monitor.x < 0);
  const right = twoEnabled.find(monitor => monitor.x > 0);
  assert.ok(left && right, JSON.stringify(two));
  assert.ok(Math.abs(left.x + right.x) < 0.02, 'two monitors stay symmetrical');
  assert.ok(Math.abs(left.x - right.x) > 0.6, 'two monitors are spread apart');
  assert.ok(Math.abs(left.z - right.z) < 0.02, 'two monitors share one arc depth');
  assert.ok(left.yaw > 0.1 && left.yaw < Math.PI / 2, 'left monitor tilts inward');
  assert.ok(right.yaw < -0.1 && right.yaw > -Math.PI / 2, 'right monitor tilts inward');
  await monitor('mm-monitor-1');
  await monitor('mm-layout-desk');
  const monitorState = await page.evaluate(() => window.garageMonitorDebug.state());
  assert.equal(monitorState.preset, 'desk');
  assert.deepEqual(monitorState.monitors.map(item => item.enabled), [false, true]);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('garage-jam-monitor-layout-v2')).monitors.map(item => item.enabled)), [false, true]);
  const one = await page.evaluate(() => window.garageStreamDebug.layout.find(monitor => monitor.enabled));
  assert.ok(one && Math.abs(one.x) < 0.02, JSON.stringify(one));
  assert.ok(Math.abs(one.yaw) < 0.05, 'single monitor faces the viewer square-on');
  await monitor('mm-layout-arc');
  assert.equal(await page.evaluate(() => window.garageMonitorDebug.state().preset), 'arc');
  await page.evaluate(() => window.garageMonitorDebug.hide());
  const turnable = await page.evaluate(() => window.garageStreamDebug.layout.find(monitor => monitor.enabled));
  assert.equal(turnable.grabbable, true);
  assert.equal(turnable.grabTranslate, false);
  await page.evaluate(() => window.garageWristDebug.show('plugins'));
  await click('garageWristDebug', 'wm-connect-screen');
  const guide = await page.evaluate(() => {
    const manager = window.garageEmulatorWorld.scene.getObjectByName('Monitor manager panel');
    return { visible: manager.visible, code: manager.requireElementById('mm-code').properties.value.text,
      address: manager.requireElementById('mm-address').properties.value.text };
  });
  assert.deepEqual(guide, { visible: true, code: pairing.code, address: pairing.url });
  await page.evaluate(() => window.garageMonitorDebug.hide());
  const moveHead = position => remote('set_transform', { device: 'headset', position });
  const seatedPosition = await page.evaluate(() => {
    const room = window.garageBuildDebug.room;
    return { x: room.seat.x, y: room.floor.y + 1.2, z: room.seat.z };
  });
  await moveHead(seatedPosition);
  await page.evaluate(() => window.garageWristDebug.show('settings'));
  await click('garageWristDebug', 'wm-settings-preferences');
  await click('garageWristDebug', 'wm-standup');
  await click('garageWristDebug', 'wm-save-seat');
  await page.waitForTimeout(1000);
  await page.waitForFunction(() => window.garagePresenceDebug?.pose);
  const seat = await page.evaluate(() => window.garagePresenceDebug.pose);
  await moveHead({ ...seat, y: seat.y + 0.48 });
  await page.waitForFunction(() => window.garagePresenceDebug.hidden && !window.garageBuildDebug.root.visible);
  assert.equal(await page.evaluate(() => window.garageWristDebug.panel.visible), true);
  await moveHead(seat);
  await page.waitForFunction(() => !window.garagePresenceDebug.hidden
    && window.garageBuildDebug.root.visible && window.garageWristDebug.panel.visible);
  assert.equal(await page.evaluate(() => window.garageFlowDebug.stage), 'S10');
  assert.equal(await page.evaluate(() => window.garageWristDebug.info.pinned), true);
  assert.deepEqual(await page.evaluate(() => [1, 2].map(index =>
    window.garageEmulatorWorld.scene.getObjectByName(`Monitor ${index}`).visible)), [false, true]);
  await page.evaluate(() => window.garageWristDebug.hide());

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
