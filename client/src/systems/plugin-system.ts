import { createSystem, VisibilityState } from '@iwsdk/core';
import { emit, garageEvents } from '../events.js';
import { garageState } from '../garage-state.js';
import { revealAudio } from '../reveal/RevealAudio.js';

type PluginStatus = { configured?: boolean; connected?: boolean; account?: string; verifiedAt?: string; sample?: any };
type Statuses = Record<string, PluginStatus>;
type SpotifyState = {
  active: boolean; connected?: boolean; playing?: boolean; title?: string; artists?: string; album?: string; art?: string | null;
  progressMs?: number; durationMs?: number; device?: { id: string; name: string; type: string; volume: number } | null;
  shuffle?: boolean; repeat?: string;
};

export class PluginSystem extends createSystem({}) {
  private statuses: Statuses = {};
  private spotify: SpotifyState = { active: false };
  private calendar: any[] = [];
  private weather: any = null;
  private devices: any[] = [];
  private playlists: any[] = [];
  private spotifyBackoffUntil = 0;
  private pollTimer = 0;
  private lastPoll = 0;
  private active = false;

  init() {
    revealAudio.setMusicVolume(garageState.preferences.musicVolume);
    this.cleanupFuncs.push(this.world.visibilityState.subscribe(state => {
      this.active = state !== VisibilityState.NonImmersive;
      if (this.active) void this.refresh();
    }));
    const refresh = () => { void this.refresh(); };
    const action = (event: Event) => { void this.playerAction((event as CustomEvent).detail); };
    const musicPlay = () => { void this.playMusic(); };
    const musicStop = () => { void this.stopMusic(); };
    const volume = (event: Event) => {
      const value = Number((event as CustomEvent).detail?.volume ?? garageState.preferences.musicVolume);
      revealAudio.setMusicVolume(value);
    };
    garageEvents.addEventListener('plugin-refresh', refresh);
    garageEvents.addEventListener('spotify-action', action);
    garageEvents.addEventListener('music-play', musicPlay);
    garageEvents.addEventListener('music-stop', musicStop);
    garageEvents.addEventListener('music-volume', volume);
    this.pollTimer = window.setInterval(() => {
      if (!this.active) return;
      const now = Date.now();
      if (now - this.lastPoll < 12000) return;
      this.lastPoll = now;
      if (this.statuses.spotify?.connected) void this.pollSpotify();
      if (this.statuses.calendar?.connected) void this.pollCalendar();
      if (this.statuses.weather?.connected) void this.pollWeather();
    }, 5000);
    if (location.hostname === 'localhost') {
      const system = this;
      (window as any).garagePluginDebug = {
        get statuses() { return system.statuses; },
        get spotify() { return system.spotify; },
        get calendar() { return system.calendar; },
        get weather() { return system.weather; },
        get devices() { return system.devices; },
        get playlists() { return system.playlists; },
        refresh: () => system.refresh(),
        player: (detail: any) => system.playerAction(detail),
      };
    }
    this.cleanupFuncs.push(() => {
      window.clearInterval(this.pollTimer);
      garageEvents.removeEventListener('plugin-refresh', refresh);
      garageEvents.removeEventListener('spotify-action', action);
      garageEvents.removeEventListener('music-play', musicPlay);
      garageEvents.removeEventListener('music-stop', musicStop);
      garageEvents.removeEventListener('music-volume', volume);
    });
  }

  private async refresh() {
    try {
      const response = await fetch('/api/plugins/status');
      if (!response.ok) return;
      this.statuses = await response.json();
      emit('plugin-status', this.statuses);
      if (this.statuses.spotify?.connected) void this.pollSpotify();
      if (this.statuses.calendar?.connected) void this.pollCalendar();
      if (this.statuses.weather?.connected) void this.pollWeather();
    } catch { /* offline is fine */ }
  }

  private async pollSpotify() {
    if (Date.now() < this.spotifyBackoffUntil) return;
    try {
      const response = await fetch('/api/plugins/spotify/state');
      if (response.status === 429) { this.spotifyBackoffUntil = Date.now() + 30000; return; }
      if (!response.ok) return;
      this.spotify = await response.json();
      emit('spotify-state', this.spotify);
      void this.pollSpotifyExtras();
    } catch { /* no state */ }
  }

  private async pollSpotifyExtras() {
    try {
      const [devices, playlists] = await Promise.all([
        fetch('/api/plugins/spotify/devices').then(async response => response.ok ? response.json() : this.devices),
        fetch('/api/plugins/spotify/playlists').then(async response => response.ok ? response.json() : this.playlists),
      ]);
      this.devices = devices;
      this.playlists = playlists;
      emit('spotify-devices', devices);
      emit('spotify-playlists', playlists);
    } catch { /* keep cached lists */ }
  }

  private async pollCalendar() {
    try {
      const response = await fetch('/api/plugins/calendar/today');
      if (!response.ok) return;
      this.calendar = await response.json();
      emit('calendar-events', this.calendar);
    } catch { /* no calendar */ }
  }

  private async pollWeather() {
    try {
      const response = await fetch('/api/plugins/weather/current');
      if (!response.ok) return;
      this.weather = await response.json();
      emit('weather-current', this.weather);
    } catch { /* no weather */ }
  }

  private async playerAction(detail: { action?: string; value?: any; deviceId?: string; contextUri?: string; uris?: string[] }) {
    if (!this.statuses.spotify?.connected) {
      emit('status', 'Connect Spotify in Plugins first.');
      return;
    }
    try {
      const response = await fetch('/api/plugins/spotify/player', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(detail),
      });
      if (!response.ok) {
        if (response.status === 429) this.spotifyBackoffUntil = Date.now() + 30000;
        const body = await response.json().catch(() => ({}));
        emit('status', body.error ?? 'Spotify did not accept that action.');
        return;
      }
      await this.pollSpotify();
    } catch { emit('status', 'Spotify is unavailable right now.'); }
  }

  private async playMusic() {
    if (this.statuses.spotify?.connected) {
      await this.playerAction({ action: 'play' });
      return;
    }
    if (revealAudio.startLoFi()) emit('status', 'Playing local lo-fi fallback');
  }

  private async stopMusic() {
    if (this.statuses.spotify?.connected) await this.playerAction({ action: 'pause' });
    revealAudio.stopLoFi();
  }
}
