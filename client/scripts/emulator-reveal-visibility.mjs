import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const captureDir = process.env.GARAGE_REVEAL_CAPTURE;
const base = process.env.GARAGE_TEST_URL ?? 'https://localhost:8091';
if (captureDir) await mkdir(captureDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--ignore-certificate-errors'],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let releaseLamp;
  const lampLoad = new Promise(resolve => { releaseLamp = resolve; });
  await page.route('**/assets/models/optimized/industrial-light.glb', async route => {
    await lampLoad;
    await route.continue();
  });
  let releaseProgress;
  const progressLoad = new Promise(resolve => { releaseProgress = resolve; });
  await page.route('**/api/state', async route => {
    if (route.request().method() !== 'GET') return route.fulfill({ json: {} });
    await progressLoad;
    await route.fulfill({ json: {
      completedByDay: {}, focusMinutesByDay: {}, pinned: [],
      mural: [{
        id: 'reveal-fixture', color: '#ff2d95', size: 0.36, rotation: 0,
        x: -0.65, y: 1.55, z: -2.89, normalX: 0, normalZ: 1, wallId: 'wall-0',
      }],
    } });
  });
  await page.route('**/api/tasks', route => route.fulfill({ json: { tasks: [] } }));
  const capture = async name => {
    if (captureDir) await page.screenshot({ path: join(captureDir, name + '.png') });
  };
  const stage = value => page.waitForFunction(value => window.garageFlowDebug?.stage === value, value);
  const press = (owner, id) => page.evaluate(({ owner, id }) => {
    window[owner].panel.requireElementById(id).dispatchEvent({ type: 'click' });
  }, { owner, id });
  const mark = points => page.evaluate(points => {
    points.forEach(point => window.garageManualDebug.addPoint(...point));
  }, points);

  await page.goto(base + '/?revealSpeed=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.garageFlowDebug?.panel && window.garageManualDebug?.panel && window.IWER_DEVICE);
  await page.locator('#gj-enter').click();
  await stage('S2');
  const markRoom = async () => {
    await press('garageFlowDebug', 'flow-manual');
    await stage('S3');
    await mark([[-2, 0, -3], [2, 0, -3], [2, 0, 1], [-2, 0, 1]]);
    await press('garageManualDebug', 'cal-use');
    await mark([[-0.65, 0.75, -1.25], [0.65, 0.75, -1.25], [0.65, 0.75, -0.55], [-0.65, 0.75, -0.55]]);
  };
  await markRoom();

  const holdCompile = () => page.evaluate(() => {
    // Ensure that several frames render while the build is still preparing.
    const renderer = window.garageEmulatorWorld.renderer;
    const compile = renderer.compileAsync.bind(renderer);
    window.releaseGarageCompile = undefined;
    renderer.compileAsync = async (scene, ...args) => {
      if (scene.name === 'Room-driven garage') {
        renderer.compileAsync = compile;
        await new Promise(resolve => { window.releaseGarageCompile = resolve; });
      }
      return compile(scene, ...args);
    };
  });
  await holdCompile();
  await press('garageManualDebug', 'cal-use');
  await stage('S5');
  await page.waitForFunction(() => window.garageEmulatorWorld.scene.getObjectByName('PLACED_lamp'));
  const visibility = () => page.evaluate(() => {
    const scene = window.garageEmulatorWorld.scene;
    const visible = name => {
      let object = scene.getObjectByName(name);
      if (!object) throw new Error('Missing scene object: ' + name);
      while (object) {
        if (!object.visible) return false;
        object = object.parent;
      }
      return true;
    };
    return {
      ceiling: visible('Room ceiling skin'),
      props: visible('Garage props'),
      floor: visible('Room floor skin'),
      lamp: visible('PLACED_lamp'),
    };
  });
  await page.waitForTimeout(300);
  await capture('01-room-saved');
  const duringModelLoad = await visibility();
  releaseLamp();
  assert.deepEqual(duringModelLoad, { ceiling: false, props: false, floor: false, lamp: false });

  await page.waitForFunction(() => window.releaseGarageCompile);
  releaseProgress();
  await page.waitForFunction(() => window.garageBoardDebug.splats === 1);
  await page.evaluate(async () => {
    const { setWorkMode } = await import('/src/garage-state.ts');
    setWorkMode('streaming');
  });
  const extraVisibility = () => page.evaluate(() => {
    const visible = [];
    window.garageEmulatorWorld.scene.traverseVisible(object => {
      if (/^(Mural splat |Monitor \d+$|Paper |Device cutout volumes$|Break nudge$|Whiteboard marker layer$)/.test(object.name)) visible.push(object.name);
    });
    return visible;
  });
  assert.deepEqual(await extraVisibility(), []);
  await capture('02-preparing-reveal');
  assert.deepEqual(await visibility(), duringModelLoad);

  await page.evaluate(() => window.releaseGarageCompile());
  await stage('S6');
  await page.waitForFunction(() => window.garageRevealDebug.elapsed >= 0.4);
  const progress = await page.evaluate(() => window.garageRevealDebug.state().surfaces.find(surface => surface.id === 'ceiling').progress);
  assert.equal(progress, 0, 'the ceiling beat must start after the first reveal frames');
  assert.deepEqual(await extraVisibility(), []);
  await capture('03-first-reveal');

  await stage('S7');
  await page.waitForFunction(() => window.garageTableDebug?.panel.visible);
  assert.deepEqual(await visibility(), { ceiling: true, props: true, floor: true, lamp: true });
  await page.waitForFunction(() => window.garageDebug.papers().length > 0);
  const complete = await extraVisibility();
  assert.ok(complete.includes('Mural splat reveal-fixture'));
  assert.ok(complete.includes('Monitor 1'));
  assert.ok(complete.some(name => name.startsWith('Paper ')));
  await capture('04-reveal-complete');

  await page.evaluate(() => {
    window.garageNudgeDebug.show();
    window.garageFlowDebug.rescan();
  });
  await stage('S2');
  await markRoom();
  await holdCompile();
  await press('garageManualDebug', 'cal-use');
  await stage('S5');
  await page.waitForFunction(() => window.releaseGarageCompile);
  assert.deepEqual(await visibility(), duringModelLoad);
  assert.deepEqual(await extraVisibility(), []);
  await capture('05-rescan-preparing');
  await page.evaluate(() => window.releaseGarageCompile());
  await stage('S6');
  await page.waitForFunction(() => window.garageRevealDebug.elapsed >= 0.4);
  assert.deepEqual(await extraVisibility(), []);
  await capture('06-rescan-first-reveal');
  await stage('S7');
  await page.waitForFunction(() => window.garageDebug.papers().length > 0);
  assert.ok((await extraVisibility()).includes('Mural splat reveal-fixture'));
  assert.deepEqual(errors, []);
  console.log('Garage geometry stayed hidden during preparation. Saved splats, monitors and papers stayed hidden until both reveals finished.');
} finally {
  await browser.close();
}
