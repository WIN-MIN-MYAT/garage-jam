import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.GARAGE_TEST_URL ?? 'https://localhost:8091';
const backend = process.env.GARAGE_BACKEND_ORIGIN ?? 'https://garage-jam.onrender.com';
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: [
    '--ignore-certificate-errors',
  ],
});
try {
  const errors = [];
  const viewer = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  viewer.on('pageerror', error => errors.push(`viewer ${error.message}`));
  await viewer.addInitScript(() => localStorage.setItem('garage-jam-preferences-v1', JSON.stringify({ mode: 'streaming' })));
  await viewer.goto(`${base}/?revealSpeed=3`, { waitUntil: 'domcontentloaded' });
  await viewer.waitForFunction(() => window.garageStreamDebug?.room, null, { timeout: 30000 });
  const room = await viewer.evaluate(() => window.garageStreamDebug.room);

  const sender = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  sender.on('pageerror', error => errors.push(`sender ${error.message}`));
  await sender.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 480;
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
  const channel = await sender.evaluate(() => document.querySelector('.channel').dataset.channel);
  assert.equal(channel, `${room}:monitor1`);
  await sender.locator('.channel').first().locator('.start').click();
  await sender.waitForFunction(() => document.querySelector('.channel .status')?.textContent === 'Live', null, { timeout: 20000 });
  await viewer.waitForFunction(() => window.garageStreamDebug.states[0]?.live === true, null, { timeout: 20000 });
  const state = await viewer.evaluate(() => window.garageStreamDebug.states[0]);
  assert.deepEqual(state, { name: `${room}:monitor1`, state: 'live', live: true });
  const setMode = mode => viewer.evaluate(async mode => {
    const { setWorkMode } = await import('/src/garage-state.ts');
    const { StreamSystem } = await import('/src/systems/stream-system.ts');
    setWorkMode(mode);
    const stream = window.garageEmulatorWorld.getSystem(StreamSystem).channels[0];
    return { signal: !!stream.signal, peer: !!stream.peer, video: !!stream.video.srcObject };
  }, mode);
  assert.deepEqual(await setMode('passthrough'), { signal: false, peer: false, video: false });
  await setMode('streaming');
  await viewer.waitForFunction(() => window.garageStreamDebug.states[0]?.live === true, null, { timeout: 20000 });
  assert.deepEqual(errors, []);
  console.log('Room-scoped WebRTC sender to viewer passed (direct UDP).');
} finally {
  await browser.close();
}
