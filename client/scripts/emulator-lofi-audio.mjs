import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.GARAGE_TEST_URL ?? 'https://localhost:8091';
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'],
});

const status = {
  notion: { configured: false, connected: false, taskBoard: { configured: true, source: 'server' } },
  spotify: { configured: true, connected: false },
  calendar: { configured: false, connected: false },
  weather: { configured: false, connected: false },
};

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (message.text().includes('No supported keysystem was found')) return;
    if (message.text().includes('SSL certificate error')) return;
    errors.push(message.text());
  });
  await page.route('**/api/plugins/status', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(status),
  }));

  const click = (owner, id) => page.evaluate(({ owner, id }) =>
    window[owner].panel.requireElementById(id).dispatchEvent({ type: 'click' }), { owner, id });
  const waitStage = async (...stages) => {
    for (let index = 0; index < 160; index++) {
      const current = await page.evaluate(() => window.garageFlowDebug?.stage);
      if (stages.includes(current)) return current;
      await page.waitForTimeout(250);
    }
    throw new Error(`Timed out waiting for ${stages.join('/')}`);
  };
  const points = corners => page.evaluate(corners => corners.forEach(point => window.garageManualDebug.addPoint(...point)), corners);

  await page.goto(`${base}/?revealSpeed=3`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.garageWristDebug && window.garageManualDebug?.panel && window.IWER_DEVICE && window.garagePluginDebug);
  await page.waitForFunction(() => {
    const button = document.querySelector('#gj-enter');
    return button && !button.disabled;
  }, null, { timeout: 20000 });
  await page.waitForTimeout(400);
  await page.locator('#gj-enter').click();
  await waitStage('S2');
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
  await click('garageFlowDebug', 'flow-continue-2');
  await waitStage('S10');
  await click('garageFlowDebug', 'flow-start');
  await page.waitForFunction(() => window.garageDebug?.papers?.().length >= 1, null, { timeout: 20000 });
  await page.waitForFunction(() => window.garagePluginDebug.statuses.spotify?.connected === false, null, { timeout: 15000 });
  await page.waitForTimeout(500);

  await page.evaluate(() => window.garageWristDebug.show('music'));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.garageWristDebug.panel.requireElementById('wm-music-play').dispatchEvent({ type: 'click' }));
  await page.waitForFunction(() => window.garagePluginDebug.audio.localMusic === true, null, { timeout: 15000 });
  await page.waitForTimeout(1600);

  const samples = [];
  for (let index = 0; index < 6; index++) {
    samples.push(await page.evaluate(() => window.garagePluginDebug.musicSignal));
    await page.waitForTimeout(200);
  }
  const pose = await page.evaluate(() => window.garagePluginDebug.speakerPose());
  const peak = Math.max(...samples.map(sample => sample?.peak ?? 0));
  const rms = Math.max(...samples.map(sample => sample?.rms ?? 0));
  assert.ok(samples.every(sample => sample?.state === 'running'), 'audio context is not running');
  assert.ok(samples.every(sample => sample.gain > 0.1), 'music gain is too low');
  assert.ok(peak > 0.04, `local lo-fi peak too low: ${peak}`);
  assert.ok(rms > 0.012, `local lo-fi RMS too low: ${rms}`);
  assert.equal(pose.localMusic, true);
  assert.equal(pose.attached, true);

  // Volume control in the visible wrist panel.
  const volumeBefore = await page.evaluate(() => window.garageWristDebug.panel.requireElementById('wm-music-volume').properties.value.text);
  for (let index = 0; index < 3; index++) {
    await page.evaluate(() => window.garageWristDebug.panel.requireElementById('wm-music-vol-up').dispatchEvent({ type: 'click' }));
    await page.waitForTimeout(160);
  }
  await page.waitForTimeout(800);
  const volumeAfter = await page.evaluate(() => window.garageWristDebug.panel.requireElementById('wm-music-volume').properties.value.text);
  const louder = await page.evaluate(() => window.garagePluginDebug.musicSignal);
  assert.notEqual(volumeAfter, volumeBefore, `wrist volume label did not update: ${volumeBefore}`);
  assert.ok(louder.gain > samples[1].gain * 1.05, `gain did not increase: ${samples[1].gain} -> ${louder.gain}`);
  await page.screenshot({ path: 'screenshots/qa/49-local-lofi-product.png' });

  // Rearranging the room must keep the bed playing and move it with the boombox.
  const beforeUuid = pose.speakerUuid;
  await page.evaluate(() => window.garageBuildDebug.rearrange());
  await page.waitForFunction(previous => window.garagePluginDebug.audio.speakerUuid !== previous, beforeUuid, { timeout: 30000 });
  await page.waitForTimeout(900);
  const movedPose = await page.evaluate(() => window.garagePluginDebug.speakerPose());
  const moved = await page.evaluate(() => window.garagePluginDebug.musicSignal);
  const movedWanted = {
    x: movedPose.placement.x + Math.sin(movedPose.placement.yaw ?? 0) * 0.12,
    y: movedPose.placement.y + 0.15,
    z: movedPose.placement.z + Math.cos(movedPose.placement.yaw ?? 0) * 0.12,
  };
  assert.equal(movedPose.localMusic, true, 'local music stopped during rearrange');
  assert.ok(Math.abs(movedPose.musicPosition[0] - movedWanted.x) < 0.02, 'audio X did not follow the boombox');
  assert.ok(Math.abs(movedPose.musicPosition[1] - movedWanted.y) < 0.02, 'audio Y did not follow the boombox');
  assert.ok(Math.abs(movedPose.musicPosition[2] - movedWanted.z) < 0.02, 'audio Z did not follow the boombox');
  assert.ok(moved?.rms > 0.012, `local lo-fi went silent after rearrange: ${moved?.rms}`);

  // Pause tears the local graph down.
  await page.evaluate(() => window.garageWristDebug.panel.requireElementById('wm-music-play').dispatchEvent({ type: 'click' }));
  await page.waitForFunction(() => window.garagePluginDebug.audio.localMusic === false, null, { timeout: 10000 });
  const stopped = await page.evaluate(() => window.garagePluginDebug.musicSignal);
  assert.equal(stopped, null, 'audio graph still exists after pause');

  console.log(JSON.stringify({ samples, pose, peak, rms, volumeBefore, volumeAfter, louderGain: louder.gain, moved, movedPose, stopped, errors }, null, 2));
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
