import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.GARAGE_TEST_URL ?? 'https://localhost:8091';
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'],
});

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  const errors = [];
  const searchRequests = [];
  const playerActions = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (message.text().includes('No supported keysystem was found')) return;
    if (message.text().includes('SSL certificate error')) return;
    errors.push(message.text());
  });

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
      active: true, connected: true, playing: true, title: 'Garage Anthem', artists: 'Mock Artist',
      device: { id: 'mock-device', name: 'Garage Jam Headset', type: 'Computer', volume: 80 },
    }),
  }));
  await page.route('**/api/plugins/spotify/devices', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify([{ id: 'mock-device', name: 'Garage Jam Headset', type: 'Computer', active: true, volume: 80 }]),
  }));
  await page.route(/\/api\/plugins\/spotify\/search/, async route => {
    const url = new URL(route.request().url());
    searchRequests.push(url.searchParams.get('q'));
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([
        { id: 'garage-1', uri: 'spotify:track:garage-1', name: 'Garage Anthem', artists: 'Mock Artist', album: 'Concrete', durationMs: 180000 },
        { id: 'garage-2', uri: 'spotify:track:garage-2', name: 'Garage Sunset', artists: 'Mock Artist', album: 'Golden Hour', durationMs: 200000 },
      ]),
    });
  });
  await page.route('**/api/plugins/spotify/player', async route => {
    const action = JSON.parse(route.request().postData() ?? '{}');
    playerActions.push(action);
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route('https://sdk.scdn.co/spotify-player.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `(() => {
      class Player {
        constructor(options) { this.options = options; this.listeners = {}; window.__garageMockPlayer = this;
          setTimeout(() => options.getOAuthToken(() => this.listeners.ready?.({ device_id: 'mock-device' })), 30); }
        addListener(name, callback) { this.listeners[name] = callback; return true; }
        connect() { return Promise.resolve(true); }
        disconnect() { return Promise.resolve(); }
        activateElement() { return Promise.resolve(); }
        setVolume() { return Promise.resolve(); }
      }
      window.Spotify = { Player };
      window.onSpotifyWebPlaybackSDKReady?.();
    })();`,
  }));

  await page.goto(`${base}/?roomBuild=1&roomSource=demo&revealOff=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.IWER_DEVICE && window.garagePluginDebug && window.garageWristDebug && window.garageSpotifySearchDebug?.panel, null, { timeout: 30000 });
  const badge = page.locator('#garage-test-badge');
  if (await badge.count()) await badge.click();
  await page.waitForFunction(() => window.garageBuildDebug?.ready, null, { timeout: 30000 });
  await page.evaluate(() => window.garagePluginDebug.refresh());
  await page.evaluate(() => window.garagePluginDebug.enableHeadset());
  await page.waitForFunction(() => window.garagePluginDebug.headset.status === 'ready', null, { timeout: 15000 });
  await page.waitForFunction(() => window.garageSpotifySearchDebug.state.spotifyConnected === true, null, { timeout: 15000 });

  await page.evaluate(() => window.garageWristDebug.show('music'));
  await page.waitForTimeout(400);
  await page.evaluate(() => window.garageWristDebug.panel.requireElementById('wm-music-search').dispatchEvent({ type: 'click' }));
  await page.waitForFunction(() => window.garageSpotifySearchDebug.state.open === true, null, { timeout: 10000 });

  for (const letter of 'garage') {
    await page.evaluate(letter => window.garageSpotifySearchDebug.panel.requireElementById(`ss-key-${letter}`).dispatchEvent({ type: 'click' }), letter);
  }
  await page.evaluate(() => window.garageSpotifySearchDebug.panel.requireElementById('ss-search').dispatchEvent({ type: 'click' }));
  await page.waitForFunction(() => window.garageSpotifySearchDebug.state.results.length === 2, null, { timeout: 10000 });
  const searched = await page.evaluate(() => window.garageSpotifySearchDebug.state);
  assert.equal(searched.query, 'garage');
  assert.equal(searched.results[0].uri, 'spotify:track:garage-1');
  assert.match(searched.status, /2 tracks/);
  await page.evaluate(() => {
    const hud = window.garageEmulatorWorld.scene.getObjectByName('garage-hud');
    const table = window.garageEmulatorWorld.scene.getObjectByName('Table confirm panel');
    if (hud) hud.visible = false;
    if (table) table.visible = false;
    document.getElementById('garage-test-badge')?.style.setProperty('display', 'none');
  });
  await page.screenshot({ path: 'screenshots/qa/53-spotify-search.png' });

  await page.evaluate(() => window.garageSpotifySearchDebug.panel.requireElementById('ss-result-0').dispatchEvent({ type: 'click' }));
  await page.waitForFunction(() => window.garageSpotifySearchDebug.state.status.startsWith('Playing'), null, { timeout: 10000 });
  await page.waitForFunction(() => window.__garageMockPlayer, null, { timeout: 5000 });
  assert.deepEqual(searchRequests, ['garage']);
  assert.ok(playerActions.some(action => action.action === 'play' && action.uris?.[0] === 'spotify:track:garage-1'), JSON.stringify(playerActions));

  await page.evaluate(() => window.garageSpotifySearchDebug.close());
  assert.equal(await page.evaluate(() => window.garageSpotifySearchDebug.state.open), false);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ searched, searchRequests, playerActions, errors }, null, 2));
} finally {
  await browser.close();
}
