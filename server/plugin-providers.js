import { createHash } from 'node:crypto';

const notionVersion = '2022-06-28';
const notionHeaders = { 'Notion-Version': notionVersion };

export class PluginError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createProviders(env, fetcher) {
  async function request(url, label, options) {
    const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(8000), redirect: 'error' });
    if (!response.ok) throw new PluginError(502, `${label} returned HTTP ${response.status}.`);
    return response.json();
  }

  async function authorized(url, label, connection, options = {}) {
    const response = await fetcher(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${connection.access}` },
      signal: AbortSignal.timeout(8000),
      redirect: 'error',
    });
    if (response.status === 401) throw new PluginError(401, `${label} needs to be reconnected.`);
    if (response.status === 429) throw new PluginError(429, `${label} is rate limited. Try again shortly.`);
    if (response.status === 204) return null;
    if (!response.ok) throw new PluginError(502, `${label} returned HTTP ${response.status}.`);
    const type = response.headers.get('content-type') ?? '';
    return type.includes('application/json') ? response.json() : null;
  }

  function oauth(id, label, authorizeUrl, tokenUrl, profileUrl, extra = {}) {
    const prefix = id.toUpperCase();
    const clientId = env[`${prefix}_CLIENT_ID`]?.trim();
    const clientSecret = env[`${prefix}_CLIENT_SECRET`]?.trim();
    const redirectUri = env[`${prefix}_REDIRECT_URI`]?.trim() ?? '';
    const redirect = URL.canParse(redirectUri) ? new URL(redirectUri) : undefined;
    const pkce = !!extra.pkce;
    const loopback = redirect?.hostname === '127.0.0.1' || redirect?.hostname === '[::1]';
    const https = redirect?.protocol === 'https:' && (!pkce || redirect.hostname !== 'localhost');
    const configured = !!(clientId && (pkce || clientSecret) && redirect &&
      (https || (loopback && redirect.protocol === 'http:')) &&
      redirect.pathname === `/api/plugins/${id}/callback` && !redirect.search && !redirect.hash &&
      !redirect.username && !redirect.password);

    return {
      label, configured, origin: redirect?.origin,
      authorize(state, verifier) {
        const url = new URL(authorizeUrl);
        const params = { client_id: clientId, redirect_uri: redirect.href, response_type: 'code', state };
        if (pkce) {
          params.code_challenge_method = 'S256';
          params.code_challenge = createHash('sha256').update(verifier).digest('base64url');
        }
        for (const [key, value] of Object.entries(extra.params ?? {})) params[key] = value;
        url.search = new URLSearchParams(params).toString();
        return url.href;
      },
      async token(fields) {
        const body = { ...fields };
        if (fields.grant_type === 'authorization_code') body.redirect_uri = redirect.href;
        const form = !!extra.form;
        if (form) {
          body.client_id = clientId;
          if (!pkce && clientSecret) body.client_secret = clientSecret;
        }
        const credentials = form ? {} : { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` };
        const reply = await request(tokenUrl, label, {
          method: 'POST',
          headers: { ...(extra.tokenHeaders ?? {}), ...credentials, 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
          body: form ? new URLSearchParams(body) : JSON.stringify(body),
        });
        if (typeof reply.access_token !== 'string' || !reply.access_token) throw new PluginError(502, `${label} did not return an access token.`);
        return { access: reply.access_token, refresh: reply.refresh_token, workspace: reply.workspace_name };
      },
      async verify(connection) {
        let profile;
        try { profile = await authorized(profileUrl, label, connection); }
        catch (error) { if (error?.status === 401) return null; throw error; }
        if (!profile || (profile.id == null && profile.account_id == null && !profile.email)) {
          throw new PluginError(502, `${label} did not return a valid account.`);
        }
        if (extra.profile) return extra.profile(profile) || connection.workspace || 'Account';
        return connection.workspace || profile.name || 'Notion workspace';
      },
    };
  }

  const notion = oauth('notion', 'Notion', 'https://api.notion.com/v1/oauth/authorize', 'https://api.notion.com/v1/oauth/token', 'https://api.notion.com/v1/users/me', {
    tokenHeaders: notionHeaders,
    params: { owner: 'user' },
  });
  const spotify = oauth('spotify', 'Spotify', 'https://accounts.spotify.com/authorize', 'https://accounts.spotify.com/api/token', 'https://api.spotify.com/v1/me', {
    pkce: true,
    form: true,
    params: { scope: env.SPOTIFY_SCOPES || 'user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private' },
    profile: profile => profile.display_name || 'Spotify account',
  });
  spotify.api = (connection, pathname, options = {}) => authorized(new URL(`https://api.spotify.com/v1${pathname}`), 'Spotify', connection, options);

  const calendar = oauth('calendar', 'Google Calendar', 'https://accounts.google.com/o/oauth2/v2/auth', 'https://oauth2.googleapis.com/token', 'https://www.googleapis.com/oauth2/v2/userinfo', {
    form: true,
    params: {
      scope: env.CALENDAR_SCOPES || 'openid email https://www.googleapis.com/auth/calendar.readonly',
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    },
    profile: profile => profile.email || profile.name || 'Google Calendar',
  });
  calendar.api = (connection, pathname) => authorized(new URL(`https://www.googleapis.com/calendar/v3${pathname}`), 'Google Calendar', connection);

  const weather = {
    label: 'Weather', configured: true,
    async search(name) {
      const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
      url.search = new URLSearchParams({ name, count: '6', language: 'en' }).toString();
      const { results = [] } = await request(url, 'Weather location search');
      return results.filter(item => Number.isFinite(item.latitude) && Number.isFinite(item.longitude)).map(item => ({
        name: [...new Set([item.name, item.admin1, item.country].filter(Boolean))].join(', '),
        latitude: item.latitude,
        longitude: item.longitude,
      }));
    },
    async verify({ latitude, longitude }) {
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.search = new URLSearchParams({ latitude, longitude, current: 'temperature_2m', timezone: 'auto' }).toString();
      const { current, current_units: units } = await request(url, 'Weather');
      if (!Number.isFinite(current?.temperature_2m) || typeof current.time !== 'string') {
        throw new PluginError(502, 'Weather did not return current conditions.');
      }
      return { temperature: current.temperature_2m, unit: units?.temperature_2m ?? '°C', localTime: current.time };
    },
    async current(connection) {
      const { latitude, longitude } = connection;
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new PluginError(409, 'Choose a weather location first.');
      const url = new URL('https://api.open-meteo.com/v1/forecast');
      url.search = new URLSearchParams({
        latitude, longitude,
        current: 'temperature_2m,weather_code,wind_speed_10m,is_day',
        daily: 'sunrise,sunset',
        timezone: 'auto',
      }).toString();
      const reply = await request(url, 'Weather');
      const current = reply.current;
      if (!current || !Number.isFinite(current.temperature_2m)) throw new PluginError(502, 'Weather did not return current conditions.');
      return {
        temperature: current.temperature_2m,
        unit: reply.current_units?.temperature_2m ?? '°C',
        code: Number(current.weather_code),
        wind: current.wind_speed_10m,
        isDay: current.is_day === 1,
        localTime: current.time,
        sunrise: reply.daily?.sunrise?.[0] ?? null,
        sunset: reply.daily?.sunset?.[0] ?? null,
        location: connection.account,
      };
    },
  };

  return { notion, spotify, calendar, weather };
}
