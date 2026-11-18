import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.GARAGE_TEST_URL ?? 'https://localhost:8091';
const backend = process.env.GARAGE_BACKEND_ORIGIN ?? 'https://garage-jam.onrender.com';
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--ignore-certificate-errors'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/?revealSpeed=3`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.garageWristDebug && window.garageManualDebug?.panel && window.IWER_DEVICE && window.garageFlowDebug);
  const click = (owner, id) => page.evaluate(({ owner, id }) =>
    window[owner].panel.requireElementById(id).dispatchEvent({ type: 'click' }), { owner, id });
  const stage = async expected => {
    await page.waitForFunction(expected => window.garageFlowDebug.stage === expected, expected, { timeout: 30000 });
  };
  const points = corners => page.evaluate(corners => corners.forEach(point => window.garageManualDebug.addPoint(...point)), corners);
  await page.locator('#gj-enter').click();
  await stage('S2');
  await click('garageFlowDebug', 'flow-manual');
  await stage('S3');
  await page.waitForFunction(() => window.garageManualDebug.panel.visible);
  await points([[-2, 0, -3], [2, 0, -3], [-2, 0, 1], [2, 0, 1]]);
  await click('garageManualDebug', 'cal-use');
  await click('garageManualDebug', 'cal-undo');
  await click('garageManualDebug', 'cal-undo');
  await points([[2, 0, 1], [-2, 0, 1]]);
  await click('garageManualDebug', 'cal-use');
  await points([[-0.65, 0.75, -1.25], [0.65, 0.75, -1.25], [0.65, 0.75, -0.55], [-0.65, 0.75, -0.55]]);
  await click('garageManualDebug', 'cal-use');
  await stage('S7');
  await click('garageTableDebug', 'yep-button');
  await stage('S8');
  await click('garageFlowDebug', 'flow-mode-streaming');
  await stage('S9b');
  const pairing = await page.evaluate(() => ({
    url: window.garageFlowDebug.panel.requireElementById('flow-pair-url').properties.value.text,
    code: window.garageFlowDebug.panel.requireElementById('flow-pair-code').properties.value.text,
  }));
  assert.match(pairing.url, /\/s\/[A-Za-z0-9_-]{4,32}$/);
  assert.ok(pairing.url.endsWith(pairing.code), JSON.stringify(pairing));
  await page.screenshot({ path: 'screenshots/qa/56-pairing-room-link.png' });
  await click('garageFlowDebug', 'flow-continue-2');
  await stage('S10');
  await click('garageFlowDebug', 'flow-start');
  await page.waitForFunction(() => window.garageStreamDebug?.room, null, { timeout: 30000 });
  const room = await page.evaluate(() => window.garageStreamDebug.room);
  await page.waitForFunction(() => window.garageStreamDebug.layout[0]?.visible === true, null, { timeout: 30000 });

  const sender = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  await sender.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640; canvas.height = 480;
      const drawing = canvas.getContext('2d');
      let frame = 0;
      setInterval(() => {
        drawing.fillStyle = frame++ % 2 ? '#755978' : '#ab826e';
        drawing.fillRect(0, 0, canvas.width, canvas.height);
      }, 50);
      return canvas.captureStream(20);
    };
  });
  await sender.goto(`${backend}/sender?room=${room}&allowScreen=1`, { waitUntil: 'domcontentloaded' });
  await sender.waitForFunction(() => document.querySelectorAll('.channel').length === 2);
  await sender.locator('.channel').first().locator('.start').click();
  await sender.waitForFunction(() => document.querySelector('.channel .status')?.textContent === 'Live', null, { timeout: 20000 });
  await page.waitForFunction(() => window.garageStreamDebug.states[0]?.live === true, null, { timeout: 20000 });
  const before = await page.evaluate(() => ({ states: window.garageStreamDebug.states, layout: window.garageStreamDebug.layout }));
  assert.equal(before.layout[0].visible, true, 'streamed monitor should be visible after the full product flow');

  await page.evaluate(() => window.garageMonitorDebug.show());
  await page.waitForFunction(() => window.garageEmulatorWorld.scene.getObjectByName('Monitor manager panel')?.visible);
  await page.waitForTimeout(300);
  await page.evaluate(() => window.garageEmulatorWorld.scene.getObjectByName('Monitor manager panel')
    .requireElementById('mm-turn-left-1').dispatchEvent({ type: 'click' }));
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ states: window.garageStreamDebug.states, layout: window.garageStreamDebug.layout }));
  assert.equal(after.states[0].live, true, 'stream should remain live after turning the monitor');
  assert.ok(Math.abs(after.layout[0].yaw - before.layout[0].yaw) > 0.2, 'monitor did not turn');
  await page.screenshot({ path: 'screenshots/qa/55-stream-full-flow.png' });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ room, before, after, errors }, null, 2));
} finally {
  await browser.close();
}
