import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const captures = process.env.GARAGE_PAPER_CAPTURE;
if (captures) await mkdir(captures, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--ignore-certificate-errors'],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  let completedRequests = 0, releaseCompletion;
  const completionResponse = new Promise(resolve => { releaseCompletion = resolve; });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/state', route => route.fulfill({ json: {} }));
  await page.route('**/api/tasks', route => route.fulfill({
    json: { tasks: [{ id: 'starter-paper-test', title: 'Check the paper', priority: 'High', starter: true }] },
  }));
  await page.route('**/api/tasks/pinned-fixture/done', async route => {
    completedRequests++;
    await completionResponse;
    await route.fulfill({ json: { synced: true } });
  });
  const base = process.env.GARAGE_TEST_URL ?? 'https://localhost:8091';
  await page.goto(base + '/?roomBuild=1&roomSource=demo&revealOff=1');
  await page.waitForFunction(() => window.garageTableDebug?.panel && window.IWER_DEVICE);
  await page.locator('#garage-test-badge').click();
  await page.waitForFunction(() => window.garageTableDebug.panel.visible && window.garageDebug.papers().length === 1);
  await page.evaluate(async () => {
    const { PaperSystem } = await import('/src/systems/paper-system.ts');
    const world = window.garageEmulatorWorld;
    const system = world.getSystem(PaperSystem);
    window.paperFixture = { system, paper: [...system.queries.papers.entities][0] };
    window.garageTableDebug.panel.requireElementById('yep-button').dispatchEvent({ type: 'click' });
    document.getElementById('garage-test-badge').style.display = 'none';
    const hud = world.getSceneObject('garage-hud');
    if (hud) hud.visible = false;
  });
  const send = (method, params) => page.evaluate(({ method, params }) =>
    window.IWER_DEVICE.remote.dispatch(method, params), { method, params });
  const device = 'controller-right';
  const move = position => send('set_transform', { device, position, orientation: { x: 0, y: 0, z: 0, w: 1 } });
  const buttons = (grip, trigger = 0) => send('set_gamepad_state', {
    device,
    buttons: [{ index: 1, value: grip, touched: !!grip }, { index: 0, value: trigger, touched: !!trigger }],
  });
  const position = () => page.evaluate(() => {
    const { x, y, z } = window.paperFixture.paper.object3D.position;
    return { x, y, z };
  });
  const awaitState = expected => page.waitForFunction(expected => window.garageDebug.papers()[0]?.state === expected, expected);
  const screenshot = async name => { if (captures) await page.screenshot({ path: join(captures, name + '.png') }); };
  const grab = async () => {
    const { x, y, z } = await position();
    await move({ x, y: y + 0.03, z: z + 0.03 });
    await page.waitForTimeout(250);
    await buttons(1);
    await page.waitForFunction(() => window.paperFixture.system.queries.held.entities.has(window.paperFixture.paper));
  };
  const aim = target => send('look_at', { device: 'headset', target });
  const onFloor = () => page.waitForFunction(() => {
    const { paper, system } = window.paperFixture;
    const { x, y, z } = paper.object3D.position;
    return !system.queries.held.entities.has(paper) && Math.abs(x + 0.5) < 0.45
      && Math.abs(z - 0.2) < 0.45 && y >= -0.015 && y < 0.035;
  });
  const drop = async () => {
    await move({ x: -0.5, y: 0.55, z: 0.2 });
    await page.waitForTimeout(250);
    await buttons(0);
    await onFloor();
    await page.waitForTimeout(400);
  };

  await grab();
  await drop();
  await awaitState('flat');
  await aim(await position());
  await screenshot('01-flat-paper-on-floor');
  await grab();
  await move({ x: -0.4, y: 0.95, z: -0.65 });
  await page.waitForTimeout(200);
  await buttons(1, 1);
  await awaitState('crumpled');
  await buttons(1);
  await page.waitForTimeout(150);
  await buttons(1, 1);
  await awaitState('flat');
  assert.equal(await page.evaluate(() => {
    const { paper, system } = window.paperFixture;
    const { material, userData } = paper.object3D;
    return material === userData.flatMaterial && !userData.crumpledVisual && system.queries.held.entities.has(paper);
  }), true);
  await aim(await position());
  await screenshot('02-paper-unfolded');

  await buttons(1);
  await page.waitForTimeout(150);
  await buttons(1, 1);
  await awaitState('crumpled');
  await drop();
  await aim(await position());
  assert.ok(await page.evaluate(() => {
    const visual = window.paperFixture.paper.object3D.userData.crumpledVisual;
    return visual.getWorldPosition(visual.position.clone()).y > 0.035;
  }), 'the ball must remain above the floor skin');
  await screenshot('03-crumpled-paper-on-floor');

  await grab();
  await move({ x: 3, y: 0.55, z: 0 });
  await page.waitForTimeout(250);
  await buttons(0);
  await page.waitForFunction(() => {
    const { x, y } = window.paperFixture.paper.object3D.position;
    return Math.abs(x) < 1 && y > 0.74;
  });
  await awaitState('crumpled');
  assert.equal(await page.evaluate(() => window.garageDebug.papers().length), 1, 'a miss keeps the same pending paper');

  await send('set_input_mode', { mode: 'hand' });
  for (const device of ['hand-right', 'hand-left']) await send('set_connected', { device, connected: true });
  await page.waitForFunction(() => [...window.garageEmulatorWorld.session.inputSources].filter(source => source.hand).length === 2);
  await page.waitForFunction(() => {
    const poses = window.paperFixture.system.handPoses;
    return poses.right.tracked && poses.left.tracked;
  }, null, { timeout: 10000 });
  await page.waitForFunction(() => window.paperFixture.paper.object3D.position.y < 0.77);
  const handMove = (device, position, anchor = 'index-tip') => send('set_transform', {
    device, position, anchor, orientation: { fingers: 'forward', palm: 'down' },
  });
  const pinch = (device, value) => send('set_select_value', { device, value });
  const right = 'hand-right', left = 'hand-left';
  const recovered = await position();
  await handMove(right, { ...recovered, y: recovered.y + 0.01 }, 'grasp');
  await page.waitForTimeout(350);
  await pinch(right, 1);
  await page.waitForFunction(() => window.paperFixture.system.queries.held.entities.has(window.paperFixture.paper), null, { timeout: 8000 });
  const heldAt = await position();
  await handMove(right, { ...recovered, x: recovered.x + 0.16, y: recovered.y + 0.16 });
  await page.waitForTimeout(500);
  await page.waitForFunction(({ x, y }) => {
    const now = window.paperFixture.paper.object3D.position;
    return now.x - x > 0.10 && now.y - y > 0.10;
  }, heldAt);
  const nearPaper = await position();
  await handMove(left, { ...nearPaper, x: nearPaper.x - 0.04 });
  await page.waitForTimeout(200);
  await pinch(left, 1);
  await awaitState('flat');
  await aim(await position());
  await screenshot('04-unfolded-with-hand-tracking');
  await pinch(left, 0);
  await page.waitForTimeout(200);
  await pinch(left, 1);
  await awaitState('crumpled');
  await pinch(left, 0);
  await handMove(left, { x: -0.65, y: 1.25, z: -0.5 });
  await page.waitForTimeout(200);
  await pinch(right, 0);
  await page.waitForFunction(() => !window.paperFixture.system.queries.held.entities.has(window.paperFixture.paper));
  await page.evaluate(() => window.garageDebug.dropFirstInTrash());
  await page.waitForFunction(() => window.garageDebug.papers().length === 0);

  await send('set_input_mode', { mode: 'controller' });
  await page.evaluate(async () => {
    const { emit } = await import('/src/events.ts');
    emit('task-created', { id: 'pinned-fixture', title: 'Finish from the board', source: 'local' });
    const { system } = window.paperFixture;
    window.paperFixture.paper = [...system.queries.papers.entities][0];
  });
  await page.waitForTimeout(400);
  await grab();
  const corkboard = await page.evaluate(() => {
    const board = window.garageBuildDebug.placements.find(item => item.slotId === 'corkboard');
    return board.position;
  });
  await move({ ...corkboard, y: corkboard.y + 0.18 });
  await page.waitForTimeout(250);
  await buttons(0);
  await awaitState('pinned');
  await page.waitForFunction(() => window.garageBoardDebug.pinnedActions?.visible);
  await aim({ ...corkboard, y: corkboard.y + 0.3 });
  await screenshot('05-pinned-task-done');
  await page.evaluate(() => {
    const button = window.garageBoardDebug.pinnedActions.requireElementById('pinned-done-0');
    button.dispatchEvent({ type: 'click' });
    button.dispatchEvent({ type: 'click' });
  });
  await page.waitForFunction(() => window.garageBoardDebug.pinnedActions
    .requireElementById('pinned-done-0').properties.value.disabled);
  releaseCompletion();
  await page.waitForFunction(() => window.garageDebug.papers().length === 0 && !window.garageBoardDebug.pinnedActions.visible);
  assert.equal(completedRequests, 1);
  const progress = await page.evaluate(() => JSON.parse(localStorage.getItem('garage-jam-progress-v1')));
  assert.deepEqual(progress.pinned, []);
  assert.equal(Object.values(progress.completedByDay).reduce((sum, count) => sum + count, 0), 2);

  await page.evaluate(async () => {
    const { setWorkMode } = await import('/src/garage-state.ts');
    setWorkMode('streaming');
  });
  await page.waitForFunction(() => window.garageEmulatorWorld.scene.getObjectByName('Monitor 1')?.visible);
  await send('set_input_mode', { mode: 'hand' });
  await send('set_connected', { device: right, connected: true });
  const monitor = await page.evaluate(() => {
    const root = window.garageEmulatorWorld.scene.getObjectByName('Monitor 1');
    const target = root.localToWorld(root.position.clone().set(0, 0, 0.05));
    return { yaw: root.rotation.y, target: { x: target.x, y: target.y, z: target.z } };
  });
  await handMove(right, monitor.target);
  await aim(monitor.target);
  await page.waitForTimeout(350);
  await pinch(right, 1);
  await page.waitForTimeout(160);
  await handMove(right, { ...monitor.target, x: monitor.target.x + 0.18 });
  await page.waitForFunction(yaw => Math.abs(window.garageEmulatorWorld.scene.getObjectByName('Monitor 1').rotation.y - yaw) > 0.4, monitor.yaw);
  await screenshot('06-monitor-hand-turn');
  await pinch(right, 0);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('garage-jam-monitor-layout-v2') ?? '{}').preset === 'custom');
  assert.deepEqual(errors, []);
  console.log('Paper grip, floor recovery, controller and hand unfolding, bin completion, pinned Done, and saved hand monitor turn passed.');
} finally {
  await browser.close();
}
