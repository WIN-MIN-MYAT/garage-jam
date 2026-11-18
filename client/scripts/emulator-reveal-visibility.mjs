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
  await press('garageFlowDebug', 'flow-manual');
  await stage('S3');
  await mark([[-2, 0, -3], [2, 0, -3], [2, 0, 1], [-2, 0, 1]]);
  await press('garageManualDebug', 'cal-use');
  await mark([[-0.65, 0.75, -1.25], [0.65, 0.75, -1.25], [0.65, 0.75, -0.55], [-0.65, 0.75, -0.55]]);

  await page.evaluate(() => {
    // Ensure that several frames render while the build is still preparing.
    const renderer = window.garageEmulatorWorld.renderer;
    const compile = renderer.compileAsync.bind(renderer);
    renderer.compileAsync = async (scene, ...args) => {
      if (scene.name === 'Room-driven garage') {
        renderer.compileAsync = compile;
        await new Promise(resolve => { window.releaseGarageCompile = resolve; });
      }
      return compile(scene, ...args);
    };
  });
  await press('garageManualDebug', 'cal-use');
  await stage('S5');
  await page.waitForFunction(() => window.releaseGarageCompile);
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
    };
  });
  await page.waitForTimeout(300);
  await capture('01-room-saved');
  assert.deepEqual(await visibility(), { ceiling: false, props: false, floor: false });

  await page.evaluate(() => window.releaseGarageCompile());
  await stage('S6');
  await page.waitForFunction(() => window.garageRevealDebug.elapsed >= 0.4);
  const progress = await page.evaluate(() => window.garageRevealDebug.state().surfaces.find(surface => surface.id === 'ceiling').progress);
  assert.equal(progress, 0, 'the ceiling beat must start after the first reveal frames');
  await capture('02-first-reveal');

  await stage('S7');
  await page.waitForFunction(() => window.garageTableDebug?.panel.visible);
  assert.deepEqual(await visibility(), { ceiling: true, props: true, floor: true });
  await capture('03-reveal-complete');
  assert.deepEqual(errors, []);
  console.log('Garage geometry stayed hidden during preparation and the full reveal reached table confirmation.');
} finally {
  await browser.close();
}
