import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.GARAGE_TEST_URL ?? 'https://localhost:8091';
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--ignore-certificate-errors'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  const playerActions = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/api/plugins/status', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      notion: { configured: false, connected: false },
      spotify: { configured: true, connected: true, account: 'Demo account' },
      calendar: { configured: false, connected: false },
      weather: { configured: false, connected: false },
    }),
  }));
  await page.route('**/api/plugins/spotify/headset-token', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ access: 'mock-token' }),
  }));
  await page.route('**/api/plugins/spotify/state', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      active: true, connected: true, playing: false, title: 'Mock Song', artists: 'Mock Artist',
      device: { id: 'external-mock', name: 'Other speaker', type: 'Computer', volume: 80 },
    }),
  }));
  await page.route('**/api/plugins/spotify/devices', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{ id: 'mock-device', name: 'Garage Jam Headset', type: 'Computer', active: true, volume: 80 }]),
  }));
  await page.route('**/api/plugins/spotify/playlists', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{ id: 'mock-playlist', name: 'Demo', uri: 'spotify:playlist:mock', tracks: 3 }]),
  }));
  await page.route('**/api/plugins/spotify/player', async route => {
    playerActions.push(JSON.parse(route.request().postData() ?? '{}'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('https://sdk.scdn.co/spotify-player.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `(() => {
      class Player {
        constructor(options) {
          this.options = options; this.listeners = {}; window.__garageMockPlayer = this;
          setTimeout(() => options.getOAuthToken(token => { window.__garageMockToken = token; this.listeners.ready?.({ device_id: 'mock-device' }); }), 30);
        }
        addListener(name, callback) { this.listeners[name] = callback; return true; }
        connect() { return Promise.resolve(true); }
        disconnect() { return Promise.resolve(); }
        activateElement() { return Promise.resolve(); }
        setVolume(value) { this.volume = value; return Promise.resolve(); }
      }
      window.Spotify = { Player };
      window.onSpotifyWebPlaybackSDKReady?.();
    })();`,
  }));

  await page.goto(`${base}/?revealSpeed=3`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.garagePluginDebug?.enableHeadset, null, { timeout: 30000 });
  await page.evaluate(() => window.garagePluginDebug.refresh());
  await page.evaluate(() => window.garagePluginDebug.enableHeadset());
  await page.waitForFunction(() => window.garagePluginDebug.headset.status === 'ready', null, { timeout: 10000 });
  const state = await page.evaluate(() => ({
    headset: window.garagePluginDebug.headset,
    token: window.__garageMockToken,
    device: window.__garageMockPlayer?.options?.name,
  }));
  assert.equal(state.headset.deviceId, 'mock-device');
  assert.equal(state.token, 'mock-token');
  assert.equal(state.device, 'Garage Jam Headset');
  assert.deepEqual(playerActions, [], 'Registering headset audio should leave existing playback alone');
  await page.evaluate(async () => {
    const { emit } = await import('/src/events.ts');
    emit('music-toggle');
  });
  await expectTransfer();
  assert.deepEqual(playerActions, [{ action: 'transfer', deviceId: 'mock-device', play: true }]);
  await page.locator('#gj-enter').click();
  await page.waitForFunction(() => window.__garageMockPlayer.volume > 0);
  const roomVolume = await page.evaluate(() => window.__garageMockPlayer.volume);
  await page.evaluate(async () => {
    const { emit } = await import('/src/events.ts');
    emit('room-hidden');
  });
  await page.waitForFunction(volume => window.__garageMockPlayer.volume < volume * 0.75, roomVolume);
  async function expectTransfer() {
    const limit = Date.now() + 3000;
    while (!playerActions.length && Date.now() < limit) await page.waitForTimeout(50);
  }
  assert.deepEqual(errors, []);
  console.log('Spotify headset setup, explicit transfer and room-aware volume passed.');
} finally {
  await browser.close();
}
