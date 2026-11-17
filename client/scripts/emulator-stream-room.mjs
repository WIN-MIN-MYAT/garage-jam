import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.GARAGE_TEST_URL ?? 'https://localhost:8091';
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: [
    '--ignore-certificate-errors',
    '--use-fake-ui-for-media-stream',
    '--auto-select-desktop-capture-source=Entire screen',
    '--auto-select-tab-capture-source-by-title=Entire screen',
  ],
});
try {
  const errors = [];
  const viewer = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  viewer.on('pageerror', error => errors.push(`viewer ${error.message}`));
  await viewer.goto(`${base}/?revealSpeed=3`, { waitUntil: 'domcontentloaded' });
  await viewer.waitForFunction(() => window.garageStreamDebug?.room, null, { timeout: 30000 });
  const room = await viewer.evaluate(() => window.garageStreamDebug.room);

  const sender = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  sender.on('pageerror', error => errors.push(`sender ${error.message}`));
  await sender.goto(`${base}/sender?room=${room}&allowScreen=1`, { waitUntil: 'domcontentloaded' });
  await sender.waitForFunction(() => document.querySelectorAll('.channel').length === 3);
  const channel = await sender.evaluate(() => document.querySelector('.channel').dataset.channel);
  assert.equal(channel, `${room}:monitor1`);
  await sender.locator('.channel').first().locator('.start').click();
  await sender.waitForFunction(() => document.querySelector('.channel .status')?.textContent === 'Live', null, { timeout: 20000 });
  await viewer.waitForFunction(() => window.garageStreamDebug.states[0]?.live === true, null, { timeout: 20000 });
  const state = await viewer.evaluate(() => window.garageStreamDebug.states[0]);
  assert.deepEqual(state, { name: `${room}:monitor1`, state: 'live', live: true });
  assert.deepEqual(errors, []);
  console.log('Room-scoped WebRTC sender to viewer passed (direct UDP).');
} finally {
  await browser.close();
}
