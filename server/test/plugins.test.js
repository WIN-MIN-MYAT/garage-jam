import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { createPluginRouter } from '../plugins.js';

test('plugin OAuth state, account verification, refresh, storage and weather connections', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'garage-plugins-'));
  const app = express();
  app.use(express.json());
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const base = '/api/plugins';
  const env = {
    NOTION_CLIENT_ID: 'notion-client', NOTION_CLIENT_SECRET: 'notion-secret', NOTION_REDIRECT_URI: origin + base + '/notion/callback',
    SPOTIFY_CLIENT_ID: 'spotify-client', SPOTIFY_REDIRECT_URI: origin + base + '/spotify/callback',
    CALENDAR_CLIENT_ID: 'calendar-client', CALENDAR_CLIENT_SECRET: 'calendar-secret', CALENDAR_REDIRECT_URI: origin + base + '/calendar/callback',
  };
  let challenge;
  let spotifyExpired = false;
  let notionVerified = false;
  const fetcher = async (url, options) => {
    const { hostname, pathname } = new URL(url);
    if (hostname === 'api.notion.com' && pathname === '/v1/oauth/token') {
      assert.equal(options.headers.Authorization, 'Basic ' + Buffer.from('notion-client:notion-secret').toString('base64'));
      assert.deepEqual(JSON.parse(options.body), { grant_type: 'authorization_code', code: 'auth-code', redirect_uri: env.NOTION_REDIRECT_URI });
      return Response.json({ access_token: 'notion-access', refresh_token: 'notion-refresh', workspace_name: 'Test Workspace' });
    }
    if (hostname === 'api.notion.com' && pathname === '/v1/users/me') {
      assert.equal(options.headers.Authorization, 'Bearer notion-access');
      notionVerified = true;
      return Response.json({ id: 'bot-id' });
    }
    if (hostname === 'accounts.spotify.com' && pathname === '/api/token') {
      assert.equal(options.body.get('client_id'), 'spotify-client');
      if (options.body.get('grant_type') === 'refresh_token') {
        assert.equal(options.body.get('refresh_token'), 'spotify-refresh');
        return Response.json({ access_token: 'spotify-replacement' });
      }
      assert.equal(options.body.get('redirect_uri'), env.SPOTIFY_REDIRECT_URI);
      assert.equal(createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'), challenge);
      return Response.json({ access_token: 'spotify-access', refresh_token: 'spotify-refresh' });
    }
    if (hostname === 'api.spotify.com' && pathname === '/v1/me') {
      if (spotifyExpired && options.headers.Authorization === 'Bearer spotify-access') return new Response(null, { status: 401 });
      assert.equal(options.headers.Authorization, spotifyExpired ? 'Bearer spotify-replacement' : 'Bearer spotify-access');
      return Response.json({ account_id: 'spotify-account', display_name: 'Spotify Tester' });
    }
    if (hostname === 'api.spotify.com' && pathname === '/v1/me/player' && (!options.method || options.method === 'GET')) {
      return Response.json({
        is_playing: true, progress_ms: 30000, shuffle_state: false, repeat_state: 'off',
        item: { name: 'Garage Loop', duration_ms: 180000, artists: [{ name: 'Lo-Fi Crew' }], album: { name: 'Concrete', images: [{ url: 'https://i.scdn.co/image/test.jpg' }] } },
        device: { id: 'device-1', name: 'Quest', type: 'Headset', volume_percent: 55 },
      });
    }
    if (hostname === 'api.spotify.com' && pathname === '/v1/me/player/devices') {
      return Response.json({ devices: [{ id: 'device-1', name: 'Quest', type: 'Headset', is_active: true, volume_percent: 55 }] });
    }
    if (hostname === 'api.spotify.com' && pathname === '/v1/me/playlists') {
      return Response.json({ items: [{ id: 'list-1', name: 'Focus', uri: 'spotify:playlist:list-1', tracks: { total: 12 }, images: [{ url: 'https://i.scdn.co/image/playlist.jpg' }] }] });
    }
    if (hostname === 'api.spotify.com' && pathname.startsWith('/v1/me/player/')) {
      assert.match(options.headers.Authorization, /^Bearer spotify-(access|replacement)$/);
      return new Response(null, { status: 204 });
    }
    if (hostname === 'oauth2.googleapis.com' && pathname === '/token') {
      assert.equal(options.body.get('client_id'), 'calendar-client');
      return Response.json(options.body.get('grant_type') === 'refresh_token'
        ? { access_token: 'calendar-replacement' }
        : { access_token: 'calendar-access', refresh_token: 'calendar-refresh' });
    }
    if (hostname === 'www.googleapis.com' && pathname === '/oauth2/v2/userinfo') {
      return Response.json({ email: 'tester@example.com', name: 'Calendar Tester' });
    }
    if (hostname === 'www.googleapis.com' && pathname === '/calendar/v3/calendars/primary/events') {
      assert.equal(options.headers.Authorization, 'Bearer calendar-access');
      return Response.json({ items: [{ id: 'event-1', summary: 'Design review', start: { dateTime: '2026-11-17T10:00:00Z' }, end: { dateTime: '2026-11-17T11:00:00Z' }, location: 'Desk' }] });
    }
    if (hostname === 'geocoding-api.open-meteo.com') {
      assert.equal(new URL(url).searchParams.get('name'), 'Singapore');
      return Response.json({ results: [{ name: 'Singapore', country: 'Singapore', latitude: 1.29, longitude: 103.85 }] });
    }
    if (hostname === 'api.open-meteo.com') {
      assert.equal(new URL(url).searchParams.get('latitude'), '1.29');
      if (new URL(url).searchParams.get('current')?.includes('weather_code')) {
        return Response.json({
          current: { temperature_2m: 29, weather_code: 2, wind_speed_10m: 8, is_day: 1, time: '2026-11-17T12:00' },
          current_units: { temperature_2m: '°C' },
          daily: { sunrise: ['2026-11-17T06:45'], sunset: ['2026-11-17T18:55'] },
        });
      }
      return Response.json({ current: { temperature_2m: 29, time: '2026-11-17T12:00' }, current_units: { temperature_2m: '°C' } });
    }
    assert.fail(`Unexpected provider request: ${url}`);
  };
  let router = createPluginRouter({ directory, env, fetcher });
  app.use(base, (req, res, next) => router(req, res, next));
  const session = async () => {
    const response = await fetch(origin + base + '/status');
    assert.equal(response.status, 200);
    const cookie = response.headers.get('set-cookie').split(';')[0];
    assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
    return cookie;
  };
  const owner = await session(), stranger = await session();
  const get = (path, cookie = owner) => fetch(origin + base + path, { headers: { cookie }, redirect: 'manual' });
  const post = (path, body, requestOrigin = origin) => fetch(origin + base + path, {
    method: 'POST', headers: { cookie: owner, origin: requestOrigin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const authorize = async id => {
    const response = await post(`/${id}/authorize`);
    assert.equal(response.status, 200);
    return new URL((await response.json()).url);
  };
  const callback = (id, state, cookie = owner, params = 'code=auth-code') =>
    get(`/${id}/callback?state=${state}&${params}`, cookie).then(response => response.headers.get('location'));

  assert.equal((await post('/notion/authorize', {}, 'https://another.example')).status, 403);
  const notion = await authorize('notion');
  assert.equal(notion.searchParams.get('owner'), 'user');
  const notionState = notion.searchParams.get('state');
  assert.match(await callback('notion', 'wrong-state'), /result=expired$/);
  assert.match(await callback('notion', notionState, stranger), /result=expired$/);
  assert.equal(notionVerified, false);
  assert.match(await callback('notion', notionState), /result=connected$/);
  assert.equal(notionVerified, true);
  assert.match(await callback('notion', notionState), /result=expired$/);
  const spotify = await authorize('spotify');
  assert.equal(spotify.searchParams.get('code_challenge_method'), 'S256');
  assert.match(await callback('spotify', spotify.searchParams.get('state'), owner, 'error=access_denied'), /result=denied$/);
  const retry = await authorize('spotify');
  challenge = retry.searchParams.get('code_challenge');
  assert.match(await callback('spotify', retry.searchParams.get('state')), /result=connected$/);
  const calendar = await authorize('calendar');
  assert.match(await callback('calendar', calendar.searchParams.get('state')), /result=connected$/);
  spotifyExpired = true;
  assert.equal((await post('/spotify/verify')).status, 200);
  const [location] = await (await get('/weather/locations?name=Singapore')).json();
  assert.equal((await post('/weather/connect', { ...location, latitude: 150 })).status, 400);
  const weather = await (await post('/weather/connect', location)).json();
  assert.equal(weather.sample.temperature, 29);
  const spotifyState = await (await get('/spotify/state')).json();
  assert.equal(spotifyState.title, 'Garage Loop');
  assert.equal(spotifyState.playing, true);
  assert.equal(spotifyState.device.name, 'Quest');
  assert.equal((await (await get('/spotify/devices')).json())[0].id, 'device-1');
  assert.equal((await (await get('/spotify/playlists')).json())[0].name, 'Focus');
  assert.equal((await post('/spotify/player', { action: 'next' })).status, 200);
  const today = await (await get('/calendar/today')).json();
  assert.equal(today[0].title, 'Design review');
  const current = await (await get('/weather/current')).json();
  assert.equal(current.code, 2);
  assert.equal(current.sunset, '2026-11-17T18:55');
  for (const file of await readdir(directory)) {
    assert.doesNotMatch((await readFile(join(directory, file))).toString(), /secret|spotify-access|spotify-replacement|notion-access/);
  }

  router = createPluginRouter({ directory, env, fetcher });
  const status = await (await get('/status')).json();
  assert.equal(status.notion.account, 'Test Workspace');
  assert.equal(status.spotify.account, 'Spotify Tester');
  assert.equal(status.calendar.account, 'tester@example.com');
  assert.equal(status.weather.account, 'Singapore');
  assert.equal(Object.values(await (await get('/status', stranger)).json()).some(value => value.connected), false);
  assert.doesNotMatch(JSON.stringify(status), /spotify-replacement|notion-access|notion-secret|spotify-refresh/);
  const disconnected = await fetch(origin + base + '/spotify', { method: 'DELETE', headers: { cookie: owner, origin } });
  assert.equal(disconnected.status, 204);
  assert.equal((await (await get('/status')).json()).spotify.connected, false);
});
