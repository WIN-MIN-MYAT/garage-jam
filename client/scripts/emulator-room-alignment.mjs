import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--ignore-certificate-errors'],
});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const floor = [{ x: -2, z: -2 }, { x: 2, z: -2 }, { x: 2, z: 2 }, { x: -2, z: 2 }];
    localStorage.setItem('garage-jam-last-room-v1', JSON.stringify({
      source: 'webxr', floor: { y: 0, polygon: floor },
      walls: [{ id: 'stale wall' }],
      openings: [],
      table: { label: 'old table', topY: 0.42, polygon: floor.map(p => ({ x: p.x + 50, z: p.z })) },
    }));
    localStorage.setItem('garage-jam-flow-v1', JSON.stringify({ stage: 'S11', completed: ['S10'] }));
    localStorage.setItem('garage-jam-preferences-v1', JSON.stringify({ tableConfirmed: true, tableHeight: 0.42 }));
  });
  await page.goto(`${process.env.GARAGE_TEST_URL ?? 'https://localhost:8091'}/?revealSpeed=3`);
  await page.waitForFunction(() => window.garageFlowDebug?.panel && window.IWER_DEVICE);
  assert.match(await page.locator('#gj-enter').innerText(), /RESUME/);
  await page.locator('#gj-enter').click();
  const stage = expected => page.waitForFunction(expected => window.garageFlowDebug?.stage === expected, expected);
  const choices = () => page.waitForFunction(() =>
    window.garageFlowDebug?.panel.getElementById('flow-table-choices').properties.value.display === 'flex');
  const aim = target => page.evaluate(target =>
    window.IWER_DEVICE.remote.dispatch('look_at', { device: 'headset', target }), target);
  const button = id => page.evaluate(id => window.garageFlowDebug.panel.requireElementById(id).dispatchEvent({ type: 'click' }), id);
  const readyToChoose = () => page.waitForFunction(() =>
    window.garageFlowDebug.panel.getElementById('flow-use-table').properties.value.display === 'flex');
  const measuredTable = () => page.evaluate(() => {
    const debug = window.garageBuildDebug;
    return { scan: debug.scan, y: debug.getTableInfo().topY };
  });

  await stage('S2');
  await choices();
  assert.equal(await page.evaluate(() => !!window.garageBuildDebug), false, 'saved coordinates must not build a room');
  await aim({ x: 0, y: 0.42, z: -1.95 });
  await readyToChoose();
  await button('flow-use-table');
  await stage('S7');
  const first = await measuredTable();
  assert.ok(Math.abs(first.y - 0.42) < 0.01);
  assert.ok(Math.abs(first.scan.tableCenter.x) < 0.01);
  assert.ok(Math.abs(first.scan.tableCenter.z + 1.95) < 0.01);

  await page.waitForFunction(() => window.garageTableDebug?.panel.visible);
  await page.evaluate(() => window.garageTableDebug.panel.requireElementById('yep-button').dispatchEvent({ type: 'click' }));
  await stage('S10');
  await button('flow-start');
  await page.evaluate(async () => {
    const { garageEvents } = await import('/src/events.ts');
    window.resumeStages = [];
    window.resumeReveals = [];
    window.resumeSetupFrames = 0;
    garageEvents.addEventListener('app-flow-stage', event => window.resumeStages.push(event.detail.stage));
    garageEvents.addEventListener('reveal-started', event => window.resumeReveals.push(event.detail.mode));
    await window.garageEmulatorWorld.renderer.xr.getSession().end();
  });
  await stage('S11');
  await page.evaluate(() => {
    window.stopResumeObserver = window.garageEmulatorWorld.onXRFrame(() => {
      if (window.garageFlowDebug.panel.visible || window.garageTableDebug.panel.visible ||
          window.garageEmulatorWorld.scene.getObjectByName('Room scan overlay').visible) window.resumeSetupFrames++;
    });
  });
  await page.locator('#gj-enter').click();
  await stage('S10');
  await page.evaluate(() => window.stopResumeObserver());
  const matched = await measuredTable();
  assert.ok(Math.abs(matched.y - first.y) < 0.01);
  assert.deepEqual(matched.scan.tableCenter, first.scan.tableCenter);
  const visible = await page.evaluate(() => ({
    flow: window.garageFlowDebug.panel.visible,
    table: window.garageTableDebug.panel.visible,
    stages: window.resumeStages,
    reveals: window.resumeReveals,
    setupFrames: window.resumeSetupFrames,
  }));
  assert.equal(visible.flow, false);
  assert.equal(visible.table, false);
  assert.equal(visible.setupFrames, 0, 'no room scan, setup, or confirmation should be visible on matching resume');
  assert.ok(visible.stages.includes('S2'));
  assert.ok(visible.stages.includes('S6'));
  assert.ok(!visible.stages.includes('S7'));
  assert.deepEqual(visible.reveals, ['quick']);

  const desk = await page.evaluate(() => new Promise(resolve => {
    const world = window.garageEmulatorWorld;
    const stop = world.onXRFrame(frame => {
      const space = world.renderer.xr.getReferenceSpace();
      for (const plane of frame.detectedPlanes) {
        if (plane.semanticLabel !== 'table') continue;
        const position = frame.getPose(plane.planeSpace, space)?.transform.position;
        if (position && Math.abs(position.y - 0.74) < 0.01) {
          stop();
          resolve({ x: position.x, y: position.y, z: position.z });
          break;
        }
      }
    });
  }));
  await page.evaluate(() => {
    window.garageEmulatorWorld.renderer.xr.getReferenceSpace().dispatchEvent(new Event('reset'));
  });
  await stage('S2');
  assert.equal(await page.evaluate(() => !!window.garageBuildDebug), false, 'the old build must be removed on reset');
  await choices();
  await aim(desk);
  await page.evaluate(async () => {
    const { GarageBuildSystem } = await import('/src/systems/garage-build-system.ts');
    window.alignmentBuilder = window.garageEmulatorWorld.getSystem(GarageBuildSystem);
  });
  await page.waitForFunction(desk => {
    const builder = window.alignmentBuilder;
    const center = builder.scanCandidate?.info.tableCenter;
    if (!center || Math.hypot(center.x - desk.x, center.z - desk.z) >= 0.01 ||
        performance.now() - builder.candidateAt > 750) return false;
    window.garageFlowDebug.panel.requireElementById('flow-use-table').dispatchEvent({ type: 'click' });
    return builder.building;
  }, desk);
  await stage('S7');
  const reset = await measuredTable();
  assert.ok(Math.abs(reset.scan.tableCenter.x - desk.x) < 0.01);
  assert.ok(Math.abs(reset.scan.tableCenter.z - desk.z) < 0.01);
  assert.ok(Math.abs(reset.y - reset.scan.floorY - 0.74) < 0.01);

  await page.evaluate(() => window.garageEmulatorWorld.renderer.xr.getReferenceSpace().dispatchEvent(new Event('reset')));
  await stage('S2');
  await choices();
  await button('flow-mark-table');
  await stage('S7');
  await page.waitForFunction(() => window.garageManualDebug?.panel.visible);
  await page.evaluate(() => {
    const manual = window.garageManualDebug;
    for (const p of [[-0.65, 0.76, -1.3], [0.65, 0.76, -1.3], [0.65, 0.76, -0.6], [-0.65, 0.76, -0.6]]) manual.addPoint(...p);
    manual.use();
  });
  await stage('S10');
  const marked = await measuredTable();
  assert.ok(Math.abs(marked.y - 0.76) < 0.01);
  assert.deepEqual(marked.scan.floorSize, first.scan.floorSize);
  assert.deepEqual(errors, []);
  console.log('Matching rooms resume without confirmation, stale saved geometry falls back, and tracking-space reset realigns the tabletop.');
} finally {
  await browser.close();
}
