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
  let activeDevice = 'external-mock';
  let playing = false;
  let title = 'Mock Song';
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
      active: true, connected: true, playing, title, artists: 'Mock Artist',
      device: { id: activeDevice, name: 'Other speaker', type: 'Computer', volume: 80 },
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
    const action = JSON.parse(route.request().postData() ?? '{}');
    playerActions.push(action);
    if (action.action === 'transfer') {
      activeDevice = action.deviceId;
      playing = action.play;
    }
    if (action.action === 'next') title = 'Next mock song';
    if (action.action === 'previous') title = 'Mock Song';
    if (action.action === 'pause') playing = false;
    if (action.action === 'play') playing = true;
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
  await page.waitForFunction(() => window.garageWristDebug?.panel);
  await page.evaluate(() => window.garageWristDebug.show('music'));
  const press = id => page.evaluate(id => window.garageWristDebug.panel.requireElementById(id).dispatchEvent({ type: 'click' }), id);
  const text = (id, text) => page.waitForFunction(({ id, text }) =>
    window.garageWristDebug.panel.requireElementById(id).properties.value.text === text, { id, text });
  await press('wm-music-next');
  assert.deepEqual(playerActions, [], 'Next must leave playback on the other device alone');
  await press('wm-music-play');
  await expectTransfer();
  assert.deepEqual(playerActions, [{ action: 'transfer', deviceId: 'mock-device', play: true }]);
  await text('wm-music-play', 'PAUSE');
  await press('wm-music-next');
  await text('wm-music-title', 'Next mock song');
  await press('wm-music-prev');
  await text('wm-music-title', 'Mock Song');
  await press('wm-music-play');
  await text('wm-music-play', 'PLAY');
  await press('wm-music-playlist');
  await text('wm-music-play', 'PAUSE');
  assert.deepEqual(playerActions.slice(1), [
    { action: 'next', deviceId: 'mock-device' },
    { action: 'previous', deviceId: 'mock-device' },
    { action: 'pause', deviceId: 'mock-device' },
    { action: 'play', contextUri: 'spotify:playlist:mock', deviceId: 'mock-device' },
  ]);
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
