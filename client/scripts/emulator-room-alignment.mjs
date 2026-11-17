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
      table: { label: 'old table', topY: 0.42, polygon: floor.map(p => ({ x: p.x + 50, z: p.z })) },
    }));
    localStorage.setItem('garage-jam-flow-v1', JSON.stringify({ stage: 'S11', completed: ['S10'] }));
    localStorage.setItem('garage-jam-preferences-v1', JSON.stringify({ tableConfirmed: true, tableHeight: 0.42 }));
  });
  await page.goto('https://localhost:8091/?revealOff=1');
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
    return { scan: debug.scan, y: debug.root.getObjectByName('Workbench top').position.y };
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
  await page.waitForFunction(() =>
    window.garageFlowDebug.panel.getElementById('scan-detail').properties.value.text.includes('74 cm'));
  await button('flow-use-table');
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
  console.log('Resume uses live room coordinates, aimed tabletop selection works, and tracking-space reset realigns the tabletop.');
} finally {
  await browser.close();
}
