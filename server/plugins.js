import express from 'express';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createProviders, PluginError } from './plugin-providers.js';
import { dataDir } from './store.js';

const path = '/api/plugins';
const manager = `${path}/manage`;
const days = 90;
const stateDuration = 10 * 60 * 1000;
const pairDuration = 10 * 60 * 1000;
const profilePattern = /^[A-Za-z0-9_-]{20,80}$/;
const random = () => randomBytes(32).toString('base64url');
const code = () => randomBytes(5).toString('hex').slice(0, 6).toUpperCase();
const hash = (purpose, session) => createHash('sha256').update(`${purpose}:${session}`).digest();

export function createPluginRouter({ env = process.env, fetcher = fetch, directory = join(dataDir, 'plugins') } = {}) {
  const providers = createProviders(env, fetcher);
  const router = express.Router();
  const sharedProfile = typeof env.PLUGIN_SHARED_PROFILE === 'string' && profilePattern.test(env.PLUGIN_SHARED_PROFILE)
    ? env.PLUGIN_SHARED_PROFILE : '';
  const demoLocked = env.PLUGIN_DEMO_LOCK === '1';
  const pending = new Map();
  const pendingByState = new Map();
  const pairingCodes = new Map();
  const mutations = new Map();
  let weatherCache = new Map();
  let calendarCache = new Map();
  const storagePath = (session, id) => join(directory, `${hash('plugin-file', session).toString('hex')}-${id}.bin`);

  async function read(session, id) {
    const box = await readFile(storagePath(session, id)).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (!box) return null;
    const decrypt = createDecipheriv('aes-256-gcm', hash('plugin-key', session), box.subarray(0, 12));
    decrypt.setAuthTag(box.subarray(12, 28));
    decrypt.setAAD(Buffer.from(id));
    return JSON.parse(Buffer.concat([decrypt.update(box.subarray(28)), decrypt.final()]).toString('utf8'));
  }

  async function save(session, id, connection) {
    const file = storagePath(session, id);
    const temp = `${file}.${random()}.tmp`;
    const iv = randomBytes(12);
    const encrypt = createCipheriv('aes-256-gcm', hash('plugin-key', session), iv);
    encrypt.setAAD(Buffer.from(id));
    const contents = Buffer.concat([encrypt.update(JSON.stringify(connection), 'utf8'), encrypt.final()]);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(temp, Buffer.concat([iv, encrypt.getAuthTag(), contents]), { mode: 0o600, flag: 'wx' });
      await rename(temp, file);
    } finally {
      await rm(temp, { force: true });
    }
  }

  function mutate(session, id, operation) {
    const key = `${session}:${id}`;
    const previous = mutations.get(key);
    const result = (previous ?? Promise.resolve()).then(operation, operation);
    mutations.set(key, result);
    return result.finally(() => {
      if (mutations.get(key) === result) mutations.delete(key);
    });
  }

  function publicStatus(provider, connection) {
    return { configured: provider.configured, origin: provider.configured ? provider.origin : undefined,
      connected: !!connection, account: connection?.account, verifiedAt: connection?.verifiedAt, sample: connection?.sample };
  }

  function assertConnectionsOpen() {
    if (demoLocked) throw new PluginError(403, 'This demo uses a shared host connection; provider changes are locked.');
  }

  const assets = join(import.meta.dirname, 'plugin-manager');
  const run = handler => (req, res, next) => Promise.resolve().then(() => handler(req, res)).catch(next);
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" });
    const proto = req.secure || req.get('x-forwarded-proto')?.split(',')[0].trim() === 'https' ? 'https' : 'http';
    const origin = `${proto}://${req.get('host')}`;
    req.pluginOrigin = URL.canParse(origin) ? new URL(origin).origin : undefined;
    if (['POST', 'DELETE'].includes(req.method) && (!req.pluginOrigin || req.get('origin') !== req.pluginOrigin)) {
      return res.status(403).json({ error: 'Open Plugins from the Garage Jam browser page.' });
    }
    next();
  });
  router.get('/manage', (_req, res) => res.sendFile(join(assets, 'index.html')));
  router.get('/connect', (_req, res) => res.sendFile(join(assets, 'connect.html')));
  router.use('/assets', express.static(assets, { index: false }));
  router.post('/pair/claim', run(async (req, res) => {
    const supplied = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    for (const [key, value] of pairingCodes) if (value.expires <= Date.now()) pairingCodes.delete(key);
    const pairing = pairingCodes.get(supplied);
    if (!pairing) throw new PluginError(404, 'That pairing code is missing or expired.');
    pairingCodes.delete(supplied);
    res.json({ url: `${manager}?provider=${pairing.id}&profile=${encodeURIComponent(pairing.profile)}` });
  }));

  router.use((req, res, next) => {
    const secure = req.pluginOrigin?.startsWith('https://') ?? false;
    const name = secure ? '__Host-garage-plugins' : 'garage-plugins-local';
    const cookie = req.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${name}=([A-Za-z0-9_-]{43})(?:;|$)`))?.[1];
    const supplied = req.get('x-garage-profile') || (typeof req.query.profile === 'string' ? req.query.profile : undefined);
    req.pluginSession = sharedProfile || (supplied && profilePattern.test(supplied) ? supplied : cookie);
    if (!req.pluginSession && req.path === '/status' && req.method === 'GET') {
      req.pluginSession = random();
    }
    if (!req.pluginSession) return res.status(400).json({ error: 'Open Plugins in your browser to start a connection.' });
    if (req.path === '/status' && req.method === 'GET' && !supplied) {
      res.cookie(name, req.pluginSession, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: days * 86400000 });
    }
    next();
  });
  router.param('id', (req, res, next, id) => {
    if (!Object.hasOwn(providers, id)) return res.status(404).json({ error: 'Unknown plugin.' });
    req.plugin = providers[id];
    next();
  });
  router.get('/status', run(async (req, res) => {
    const statuses = await Promise.all(Object.entries(providers).map(async ([id, provider]) => [
      id, publicStatus(provider, await read(req.pluginSession, id)),
    ]));
    res.json(Object.fromEntries(statuses));
  }));

  router.post('/:id/pair', run(async (req, res) => {
    assertConnectionsOpen();
    const provider = req.plugin;
    if (!provider.configured) throw new PluginError(503, `${provider.label} setup is incomplete on the server.`);
    for (const [key, value] of pairingCodes) if (value.expires <= Date.now()) pairingCodes.delete(key);
    let supplied = code();
    while (pairingCodes.has(supplied)) supplied = code();
    pairingCodes.set(supplied, { profile: req.pluginSession, id: req.params.id, expires: Date.now() + pairDuration });
    res.json({ code: supplied, url: `${req.pluginOrigin}${path}/connect?code=${supplied}`, expiresIn: pairDuration });
  }));

  async function withConnection(session, id, operation) {
    const provider = providers[id];
    let connection = await read(session, id);
    if (!connection) throw new PluginError(409, `Connect ${provider.label} first.`);
    try {
      return await operation(connection);
    } catch (error) {
      if (error?.status !== 401 || !connection.refresh) throw error;
      const tokens = await provider.token({ grant_type: 'refresh_token', refresh_token: connection.refresh });
      connection = { ...connection, access: tokens.access, refresh: tokens.refresh ?? connection.refresh };
      await save(session, id, connection);
      return await operation(connection);
    }
  }

  router.get('/spotify/state', run(async (req, res) => {
    const state = await withConnection(req.pluginSession, 'spotify', connection => providers.spotify.api(connection, '/me/player'));
    if (!state) return res.json({ active: false, connected: true });
    const item = state.item ?? {};
    res.json({
      active: true, connected: true,
      playing: !!state.is_playing,
      progressMs: state.progress_ms ?? 0,
      durationMs: item.duration_ms ?? 0,
      title: item.name ?? '',
      artists: (item.artists ?? []).map(artist => artist.name).filter(Boolean).join(', '),
      album: item.album?.name ?? '',
      art: item.album?.images?.[0]?.url ?? null,
      device: state.device ? { id: state.device.id, name: state.device.name, type: state.device.type, volume: state.device.volume_percent } : null,
      shuffle: !!state.shuffle_state,
      repeat: state.repeat_state ?? 'off',
    });
  }));

  router.post('/spotify/player', run(async (req, res) => {
    const { action, value, deviceId, contextUri, uris } = req.body ?? {};
    await withConnection(req.pluginSession, 'spotify', async connection => {
      const query = deviceId ? `?device_id=${encodeURIComponent(deviceId)}` : '';
      const json = body => ({ method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      switch (action) {
        case 'play': return providers.spotify.api(connection, `/me/player/play${query}`, json({ ...(contextUri ? { context_uri: contextUri } : {}), ...(Array.isArray(uris) ? { uris } : {}) }));
        case 'pause': return providers.spotify.api(connection, `/me/player/pause${query}`, { method: 'PUT' });
        case 'next': return providers.spotify.api(connection, '/me/player/next', { method: 'POST' });
        case 'previous': return providers.spotify.api(connection, '/me/player/previous', { method: 'POST' });
        case 'seek': return providers.spotify.api(connection, `/me/player/seek?position_ms=${Math.max(0, Math.round(Number(value) || 0))}`, { method: 'PUT' });
        case 'volume': return providers.spotify.api(connection, `/me/player/volume?volume_percent=${Math.max(0, Math.min(100, Math.round(Number(value) || 0)))}${deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : ''}`, { method: 'PUT' });
        case 'shuffle': return providers.spotify.api(connection, `/me/player/shuffle?state=${value ? 'true' : 'false'}${deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : ''}`, { method: 'PUT' });
        case 'repeat': {
          const state = ['track', 'context', 'off'].includes(value) ? value : 'off';
          return providers.spotify.api(connection, `/me/player/repeat?state=${state}${deviceId ? `&device_id=${encodeURIComponent(deviceId)}` : ''}`, { method: 'PUT' });
        }
        case 'transfer': {
          if (!deviceId) throw new PluginError(400, 'Choose a playback device first.');
          return providers.spotify.api(connection, '/me/player', json({ device_ids: [deviceId], play: true }));
        }
        default: throw new PluginError(400, 'Unknown player action.');
      }
    });
    res.json({ ok: true });
  }));

  router.get('/spotify/devices', run(async (req, res) => {
    const data = await withConnection(req.pluginSession, 'spotify', connection => providers.spotify.api(connection, '/me/player/devices'));
    res.json((data?.devices ?? []).map(device => ({ id: device.id, name: device.name, type: device.type, active: !!device.is_active, volume: device.volume_percent })));
  }));

  router.get('/spotify/playlists', run(async (req, res) => {
    const data = await withConnection(req.pluginSession, 'spotify', connection => providers.spotify.api(connection, '/me/playlists?limit=12'));
    res.json((data?.items ?? []).filter(Boolean).map(playlist => ({
      id: playlist.id, name: playlist.name, uri: playlist.uri, tracks: playlist.tracks?.total ?? 0,
      art: playlist.images?.[0]?.url ?? null,
    })));
  }));

  router.get('/spotify/image', run(async (req, res) => {
    await withConnection(req.pluginSession, 'spotify', async () => null);
    const target = typeof req.query.url === 'string' ? req.query.url : '';
    let parsed;
    try { parsed = new URL(target); } catch { throw new PluginError(400, 'Invalid image URL.'); }
    if (!['https://i.scdn.co', 'https://mosaic.scdn.co', 'https://image-cdn-ak.spotifycdn.com', 'https://image-cdn-fa.spotifycdn.com'].includes(parsed.origin)) {
      throw new PluginError(400, 'Image host is not allowed.');
    }
    const image = await fetch(parsed, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!image.ok || !image.headers.get('content-type')?.startsWith('image/')) throw new PluginError(502, 'Album art is unavailable.');
    res.set({ 'Cache-Control': 'private, max-age=3600', 'Content-Type': image.headers.get('content-type') });
    res.send(Buffer.from(await image.arrayBuffer()));
  }));

  router.get('/calendar/today', run(async (req, res) => {
    const cached = calendarCache.get(req.pluginSession);
    if (cached && Date.now() - cached.at < 300000) return res.json(cached.value);
    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    const query = new URLSearchParams({
      timeMin: start.toISOString(), timeMax: end.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '20', timeZone: req.query.timeZone || 'UTC',
    });
    const data = await withConnection(req.pluginSession, 'calendar', connection => providers.calendar.api(connection, `/calendars/primary/events?${query}`));
    const value = (data?.items ?? []).map(event => ({
      id: event.id,
      title: event.summary || '(busy)',
      start: event.start?.dateTime || event.start?.date || null,
      end: event.end?.dateTime || event.end?.date || null,
      allDay: !!event.start?.date,
      location: event.location || null,
      link: event.htmlLink || null,
    }));
    calendarCache.set(req.pluginSession, { at: Date.now(), value });
    res.json(value);
  }));

  router.get('/weather/current', run(async (req, res) => {
    let connection = await read(req.pluginSession, 'weather');
    if (!connection && Number.isFinite(Number(process.env.WEATHER_LATITUDE)) && Number.isFinite(Number(process.env.WEATHER_LONGITUDE))) {
      connection = { account: process.env.WEATHER_LOCATION || 'Default location', latitude: Number(process.env.WEATHER_LATITUDE), longitude: Number(process.env.WEATHER_LONGITUDE) };
    }
    if (!connection) throw new PluginError(409, 'Connect a weather location first.');
    const key = `${req.pluginSession}:${connection.latitude},${connection.longitude}`;
    const cached = weatherCache.get(key);
    if (cached && Date.now() - cached.at < 600000) return res.json(cached.value);
    const value = await providers.weather.current(connection);
    weatherCache.set(key, { at: Date.now(), value });
    res.json(value);
  }));

  router.post('/:id/authorize', run(async (req, res) => {
    assertConnectionsOpen();
    const provider = req.plugin;
    if (!provider.authorize || !provider.configured) throw new PluginError(503, `${provider.label} setup is incomplete on the server.`);
    if (provider.origin !== req.pluginOrigin) throw new PluginError(409, `Open Plugins at ${provider.origin} to connect ${provider.label}.`);
    for (const [key, flow] of pending) if (flow.expires <= Date.now()) pending.delete(key);
    const key = `${req.pluginSession}:${req.params.id}`;
    if (pending.size >= 1000 && !pending.has(key)) throw new PluginError(503, 'Sign-in is busy. Try again shortly.');
    const state = random();
    const verifier = random();
    pending.set(key, { state, verifier, profile: req.pluginSession, id: req.params.id, expires: Date.now() + stateDuration });
    pendingByState.set(state, key);
    res.json({ url: provider.authorize(state, verifier) });
  }));

  router.get('/:id/callback', run(async (req, res) => {
    const { id } = req.params;
    const provider = req.plugin;
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const key = pendingByState.get(state);
    const flow = key ? pending.get(key) : undefined;
    const session = flow?.profile;
    const result = (value) => res.redirect(303, `${manager}?provider=${id}${session ? `&profile=${encodeURIComponent(session)}` : ''}&result=${value}`);
    if (!provider.configured || provider.origin !== req.pluginOrigin || !flow || flow.id !== id ||
        flow.expires <= Date.now() || flow.state !== state) return result('expired');
    if (req.pluginSession && req.pluginSession !== flow.profile) return result('expired');
    pending.delete(key);
    pendingByState.delete(state);
    if (req.query.error) return result('denied');
    if (typeof req.query.code !== 'string' || !req.query.code) return result('expired');
    try {
      await mutate(session, id, async () => {
        const fields = { grant_type: 'authorization_code', code: req.query.code };
        if (id === 'spotify') fields.code_verifier = flow.verifier;
        const connection = await provider.token(fields);
        const account = await provider.verify(connection);
        if (!account) throw new PluginError(502, 'The provider rejected the new access token.');
        await save(session, id, { ...connection, account, verifiedAt: new Date().toISOString() });
      });
      return result('connected');
    } catch (error) {
      return result(error instanceof PluginError ? `provider-${error.message.match(/HTTP (\d{3})/)?.[1] ?? 'rejected'}` : 'unavailable');
    }
  }));

  router.get('/weather/locations', run(async (req, res) => {
    const name = typeof req.query.name === 'string' ? req.query.name.trim() : '';
    if (name.length < 2 || name.length > 120) throw new PluginError(400, 'Enter a city name between 2 and 120 characters.');
    res.json(await providers.weather.search(name));
  }));
  router.post('/weather/connect', run(async (req, res) => {
    assertConnectionsOpen();
    const { name, latitude, longitude } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim() || name.length > 240 ||
        !Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) {
      throw new PluginError(400, 'Choose a location from the search results.');
    }
    const provider = providers.weather;
    const connection = await mutate(req.pluginSession, 'weather', async () => {
      const sample = await provider.verify({ latitude, longitude });
      const connection = { account: name, latitude, longitude, sample, verifiedAt: new Date().toISOString() };
      await save(req.pluginSession, 'weather', connection);
      return connection;
    });
    res.json(publicStatus(provider, connection));
  }));
  router.post('/:id/verify', run(async (req, res) => {
    const { id } = req.params;
    const session = req.pluginSession;
    const provider = req.plugin;
    if (!provider.configured) throw new PluginError(503, `${provider.label} setup is incomplete on the server.`);
    const updated = await mutate(session, id, async () => {
      const stored = await read(session, id);
      if (!stored) throw new PluginError(409, 'Connect this plugin first.');
      let connection = stored;
      if (id === 'weather') {
        connection = { ...connection, sample: await provider.verify(connection) };
      } else {
        let account = await provider.verify(connection);
        if (!account && connection.refresh) {
          const tokens = await provider.token({ grant_type: 'refresh_token', refresh_token: connection.refresh });
          connection = { ...connection, access: tokens.access, refresh: tokens.refresh ?? connection.refresh, workspace: tokens.workspace ?? connection.workspace };
          await save(session, id, connection);
          account = await provider.verify(connection);
        }
        if (!account) throw new PluginError(409, `Reconnect ${provider.label} to verify access.`);
        connection = { ...connection, account };
      }
      connection.verifiedAt = new Date().toISOString();
      await save(session, id, connection);
      return connection;
    });
    res.json(publicStatus(provider, updated));
  }));
  router.delete('/:id', run(async (req, res) => {
    assertConnectionsOpen();
    const { id } = req.params;
    const session = req.pluginSession;
    pending.delete(`${session}:${id}`);
    await mutate(session, id, () => rm(storagePath(session, id), { force: true }));
    res.sendStatus(204);
  }));
  router.use((error, _req, res, _next) => {
    if (!(error instanceof PluginError) && !['TimeoutError', 'TypeError'].includes(error.name)) {
      console.warn('Plugin operation failed:', error.code ?? error.name);
    }
    res.status(error instanceof PluginError ? error.status : 502).json({
      error: error instanceof PluginError ? error.message : 'Could not complete the plugin request. Try again.',
    });
  });
  return router;
}
