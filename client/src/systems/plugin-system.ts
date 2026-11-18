import { createSystem, Mesh, Vector3, VisibilityState } from '@iwsdk/core';
import type { Object3D } from '@iwsdk/core';
import { emit, garageEvents } from '../events.js';
import { garageState } from '../garage-state.js';
import { garageRootsVisible } from '../garage-visibility.js';
import { revealAudio } from '../reveal/RevealAudio.js';
import { apiUrl } from '../backend.js';

type PluginStatus = {
  configured?: boolean; connected?: boolean; account?: string; verifiedAt?: string; sample?: any;
  taskBoard?: { configured?: boolean; source?: string };
};
type Statuses = Record<string, PluginStatus>;
type SpotifyState = {
  active: boolean; connected?: boolean; playing?: boolean; title?: string; artists?: string; album?: string; art?: string | null;
  progressMs?: number; durationMs?: number; device?: { id: string; name: string; type: string; volume: number } | null;
  shuffle?: boolean; repeat?: string;
};

export class PluginSystem extends createSystem({}) {
  private profile = this.loadProfile();
  private statuses: Statuses = {};
  private spotify: SpotifyState = { active: false };
  private calendar: any[] = [];
  private weather: any = null;
  private playlists: any[] = [];
  private spotifyBackoffUntil = 0;
  private pairingUntil = 0;
  private localMusic = false;
  private speakers: Mesh[] = [];
  private boombox?: Object3D;
  private musicPosition = new Vector3();
  private musicFacing = new Vector3(0, 0, 1);
  private listener = new Vector3();
  private listenerFacing = new Vector3();
  private musicOffset = new Vector3();
  private standHidden = false;
  private manualPassthrough = false;
  private lastMixAt = 0;
  private lastSpotifyVolume = -1;
  private settingVolume = false;
  private pollTimer = 0;
  private lastPoll = 0;
  private active = false;
  private spotifyPlayer: any = null;
  private spotifyDeviceId?: string;
  private spotifySdkPromise?: Promise<void>;
  private spotifyHeadsetStarting = false;
  private headsetRequested = false;
  private pendingSpotifyPlay = false;
  private headsetStatus: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  private headsetMessage = '';

  init() {
    revealAudio.setMusicVolume(garageState.preferences.musicVolume);
    const onRevealed = () => {
      this.speakers = [];
      this.boombox = this.world.scene.getObjectByName('PLACED_boombox');
      this.boombox?.traverse(object => { if (object instanceof Mesh && object.name.startsWith('Boombox speaker')) this.speakers.push(object); });
    };
    garageEvents.addEventListener('garage-revealed', onRevealed);
    garageEvents.addEventListener('garage-props-rebuilt', onRevealed);
    const roomHidden = () => { this.standHidden = true; this.updateMusicPresence(); };
    const roomShown = () => { this.standHidden = false; this.updateMusicPresence(); };
    const onReset = () => { this.boombox = undefined; this.speakers = []; roomShown(); };
    const passthrough = (event: Event) => {
      this.manualPassthrough = (event as CustomEvent<boolean>).detail;
      this.updateMusicPresence();
    };
    garageEvents.addEventListener('room-hidden', roomHidden);
    garageEvents.addEventListener('room-shown', roomShown);
    garageEvents.addEventListener('garage-reset', onReset);
    garageEvents.addEventListener('garage-space-reset', onReset);
    garageEvents.addEventListener('garage-passthrough-changed', passthrough);
    this.cleanupFuncs.push(this.world.visibilityState.subscribe(state => {
      this.active = state !== VisibilityState.NonImmersive;
      if (this.active) void this.refresh();
    }));
    const refresh = () => { void this.refresh(); };
    const connect = (event: Event) => { void this.connect((event as CustomEvent<{ provider: string }>).detail?.provider); };
    const action = (event: Event) => { void this.playerAction((event as CustomEvent).detail); };
    const headsetEnable = () => { this.headsetRequested = true; void this.ensureHeadsetPlayer(); };
    const musicPlay = () => { void this.playMusic(); };
    const musicStop = () => { void this.stopMusic(); };
    const musicToggle = () => {
      if (this.localMusic || this.isHeadsetPlaying() || this.pendingSpotifyPlay) musicStop();
      else musicPlay();
    };
    const volume = (event: Event) => {
      const value = Number((event as CustomEvent).detail?.volume ?? garageState.preferences.musicVolume);
      revealAudio.setMusicVolume(value);
      this.lastMixAt = 0;
    };
    garageEvents.addEventListener('plugin-refresh', refresh);
    garageEvents.addEventListener('plugin-connect', connect);
    garageEvents.addEventListener('spotify-action', action);
    garageEvents.addEventListener('spotify-headset-enable', headsetEnable);
    garageEvents.addEventListener('music-play', musicPlay);
    garageEvents.addEventListener('music-stop', musicStop);
    garageEvents.addEventListener('music-toggle', musicToggle);
    garageEvents.addEventListener('music-volume', volume);
    this.pollTimer = window.setInterval(() => {
      if (!this.active) return;
      const now = Date.now();
      if (now - this.lastPoll < (now < this.pairingUntil ? 3000 : 12000)) return;
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
        get playlists() { return system.playlists; },
        get headset() { return { status: system.headsetStatus, deviceId: system.spotifyDeviceId, message: system.headsetMessage }; },
        enableHeadset: () => system.ensureHeadsetPlayer(),
        refresh: () => system.refresh(),
        player: (detail: any) => system.playerAction(detail),
      };
    }
    this.cleanupFuncs.push(() => {
      window.clearInterval(this.pollTimer);
      garageEvents.removeEventListener('garage-revealed', onRevealed);
      garageEvents.removeEventListener('garage-props-rebuilt', onRevealed);
      garageEvents.removeEventListener('room-hidden', roomHidden);
      garageEvents.removeEventListener('room-shown', roomShown);
      garageEvents.removeEventListener('garage-reset', onReset);
      garageEvents.removeEventListener('garage-space-reset', onReset);
      garageEvents.removeEventListener('garage-passthrough-changed', passthrough);
      garageEvents.removeEventListener('plugin-refresh', refresh);
      garageEvents.removeEventListener('plugin-connect', connect);
      garageEvents.removeEventListener('spotify-action', action);
      garageEvents.removeEventListener('spotify-headset-enable', headsetEnable);
      garageEvents.removeEventListener('music-play', musicPlay);
      garageEvents.removeEventListener('music-stop', musicStop);
      garageEvents.removeEventListener('music-toggle', musicToggle);
      garageEvents.removeEventListener('music-volume', volume);
      this.spotifyPlayer?.disconnect?.();
      this.spotifyPlayer = null;
      this.stopLocalMusic();
    });
  }

  private loadProfile() {
    try {
      let value = localStorage.getItem('garage-jam-plugin-profile');
      if (!value || !/^[A-Za-z0-9_-]{20,80}$/.test(value)) {
        value = Array.from(crypto.getRandomValues(new Uint8Array(32))).map(byte => byte.toString(16).padStart(2, '0')).join('');
        localStorage.setItem('garage-jam-plugin-profile', value);
      }
      return value;
    } catch {
      return Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    }
  }

  private api(path: string, options: RequestInit = {}) {
    return fetch(apiUrl(path), { ...options, headers: { ...(options.headers ?? {}), 'X-Garage-Profile': this.profile } });
  }

  private async connect(provider: string) {
    const notion = this.statuses.notion;
    if (provider === 'notion' && notion?.taskBoard?.configured && !notion.connected) {
      emit('status', 'Notion tasks are connected to the shared database. No account sign-in needed.');
      return;
    }
    try {
      const response = await this.api(`/api/plugins/${encodeURIComponent(provider)}/pair`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'Could not create a pairing code.');
      this.pairingUntil = Date.now() + 600000;
      emit('plugin-pairing', { provider, code: result.code, url: result.url });
      emit('status', `Connect ${provider}: open ${result.url} or enter code ${result.code}`);
    } catch (error) {
      emit('status', `Could not start ${provider} sign-in: ${(error as Error).message}`);
    }
  }


  private async refresh() {
    try {
      const response = await this.api('/api/plugins/status');
      if (!response.ok) return;
      this.statuses = await response.json();
      emit('plugin-status', this.statuses);
      if (!this.statuses.spotify?.connected) this.resetHeadsetPlayer();
      else if (this.headsetRequested) void this.ensureHeadsetPlayer();
      if (this.statuses.spotify?.connected) void this.pollSpotify();
      if (this.statuses.calendar?.connected) void this.pollCalendar();
      if (this.statuses.weather?.connected) void this.pollWeather();
    } catch { /* offline is fine */ }
  }

  private emitHeadset(status: 'idle' | 'loading' | 'ready' | 'error', message: string, deviceId?: string, detail = '') {
    this.headsetStatus = status;
    this.headsetMessage = message;
    if (status === 'error') this.pendingSpotifyPlay = false;
    if (detail) console.warn('[spotify-headset]', detail);
    if (status === 'error' && detail) emit('status', detail);
    emit('spotify-headset', { status, message, deviceId });
  }

  private resetHeadsetPlayer() {
    if (this.spotifyPlayer) {
      try { void this.spotifyPlayer.disconnect?.(); } catch { /* noop */ }
      this.spotifyPlayer = null;
    }
    this.spotifyDeviceId = undefined;
    this.pendingSpotifyPlay = false;
    this.lastSpotifyVolume = -1;
    this.spotifySdkPromise = undefined;
    this.spotifyHeadsetStarting = false;
    this.emitHeadset('idle', '');
  }

  private loadSpotifySdk() {
    if ((window as any).Spotify?.Player) return Promise.resolve();
    if (this.spotifySdkPromise) return this.spotifySdkPromise;
    this.spotifySdkPromise = new Promise<void>((resolve, reject) => {
      (window as any).onSpotifyWebPlaybackSDKReady = () => resolve();
      const script = document.createElement('script');
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      script.async = true;
      script.onerror = () => reject(new Error('Spotify player script failed to load.'));
      document.head.appendChild(script);
      window.setTimeout(() => {
        if ((window as any).Spotify?.Player) resolve();
        else reject(new Error('Spotify player SDK unavailable in this browser.'));
      }, 10000);
    });
    return this.spotifySdkPromise;
  }

  private async headsetToken() {
    const response = await this.api('/api/plugins/spotify/headset-token');
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error ?? 'Spotify token unavailable.');
    }
    const data = await response.json();
    if (typeof data.access !== 'string' || !data.access) throw new Error('Spotify token missing.');
    return data.access;
  }

  private async ensureHeadsetPlayer() {
    if (this.spotifyPlayer || this.spotifyHeadsetStarting) return;
    if (!this.statuses.spotify?.connected) {
      this.emitHeadset('idle', 'Connect Spotify first.');
      return;
    }
    this.spotifyHeadsetStarting = true;
    this.emitHeadset('loading', 'Starting headset audio...');
    try {
      await this.loadSpotifySdk();
      const Spotify = (window as any).Spotify;
      const player = new Spotify.Player({
        name: 'Garage Jam Headset',
        volume: garageState.preferences.musicVolume / 100,
        getOAuthToken: (callback: (token: string) => void) => {
          void this.headsetToken().then(callback).catch(error => {
            this.emitHeadset('error', 'Spotify token failed', undefined, `Spotify headset token failed: ${String(error?.message ?? error)}`);
          });
        },
      });
      this.spotifyPlayer = player;
      player.addListener('ready', ({ device_id }: { device_id: string }) => {
        if (this.spotifyPlayer !== player) return;
        this.spotifyDeviceId = device_id;
        this.lastSpotifyVolume = -1;
        this.emitHeadset('ready', 'Headset audio ready', device_id);
        void this.pollSpotifyExtras();
        if (this.pendingSpotifyPlay) {
          this.pendingSpotifyPlay = false;
          void this.playMusic();
        }
      });
      player.addListener('not_ready', () => {
        this.spotifyDeviceId = undefined;
        this.emitHeadset('error', 'Headset player offline', undefined, 'Spotify headset player is offline.');
      });
      player.addListener('initialization_error', ({ message }: { message: string }) => this.emitHeadset('error', 'Headset audio unavailable', undefined, `Spotify headset audio unavailable: ${message}`));
      player.addListener('authentication_error', ({ message }: { message: string }) => this.emitHeadset('error', 'Reconnect Spotify', undefined, `Spotify headset authentication failed: ${message}`));
      player.addListener('account_error', ({ message }: { message: string }) => this.emitHeadset('error', 'Spotify Premium required', undefined, `Spotify headset account error: ${message}`));
      player.addListener('autoplay_failed', () => this.emitHeadset('error', 'Tap Play again', undefined, 'Spotify headset autoplay was blocked.'));
      const connected = await player.connect();
      if (!connected) this.emitHeadset('error', 'Headset player failed', undefined, 'Spotify headset player did not connect.');
    } catch (error) {
      this.spotifySdkPromise = undefined;
      this.emitHeadset('error', 'Headset audio unavailable', undefined, String((error as Error)?.message ?? error));
    } finally {
      this.spotifyHeadsetStarting = false;
    }
  }

  private async pollSpotify() {
    if (Date.now() < this.spotifyBackoffUntil) return;
    try {
      const response = await this.api('/api/plugins/spotify/state');
      if (response.status === 429) { this.spotifyBackoffUntil = Date.now() + 30000; return; }
      if (!response.ok) return;
      this.spotify = await response.json();
      emit('spotify-state', { ...this.spotify, playing: this.isHeadsetPlaying() });
      void this.pollSpotifyExtras();
    } catch { /* no state */ }
  }

  private async pollSpotifyExtras() {
    try {
      const response = await this.api('/api/plugins/spotify/playlists');
      if (!response.ok) return;
      this.playlists = await response.json();
      emit('spotify-playlists', this.playlists);
    } catch { /* keep cached lists */ }
  }

  private async pollCalendar() {
    try {
      const response = await this.api('/api/plugins/calendar/today');
      if (!response.ok) return;
      this.calendar = await response.json();
      emit('calendar-events', this.calendar);
    } catch { /* no calendar */ }
  }

  private async pollWeather() {
    try {
      const response = await this.api('/api/plugins/weather/current');
      if (!response.ok) return;
      this.weather = await response.json();
      emit('weather-current', this.weather);
    } catch { /* no weather */ }
  }

  private async playerAction(detail: { action?: string; value?: any; deviceId?: string; contextUri?: string; uris?: string[]; play?: boolean }) {
    if (this.spotifyPlayer) {
      try { void this.spotifyPlayer.activateElement?.().catch?.(() => { /* autoplay may be blocked */ }); } catch { /* optional */ }
    }
    if (!this.statuses.spotify?.connected) {
      emit('status', 'Connect Spotify in Plugins first.');
      return;
    }
    const deviceId = detail.deviceId ?? this.spotifyDeviceId;
    if (!deviceId || (['pause', 'next', 'previous'].includes(detail.action ?? '') && !this.isHeadsetPlaying() && this.spotify.device?.id !== deviceId)) return;
    try {
      const response = await this.api('/api/plugins/spotify/player', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...detail, deviceId }),
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
    if (this.statuses.spotify?.connected && this.headsetStatus !== 'error') {
      this.headsetRequested = true;
      if (!this.spotifyDeviceId) {
        this.pendingSpotifyPlay = true;
        await this.ensureHeadsetPlayer();
        return;
      }
      this.stopLocalMusic();
      if (this.spotify.device?.id === this.spotifyDeviceId) await this.playerAction({ action: 'play' });
      else await this.playerAction({ action: 'transfer', deviceId: this.spotifyDeviceId, play: true });
      return;
    }
    if (this.localMusic) return;
    this.updateSpeakerPosition();
    try { await revealAudio.unlock(); } catch { emit('status', 'Tap Play again to start audio.'); return; }
    if (revealAudio.startLoFi(this.musicPosition)) {
      this.localMusic = true;
      emit('local-music-state', true);
      emit('status', 'Playing local lo-fi fallback');
    }
  }

  private async stopMusic() {
    this.pendingSpotifyPlay = false;
    this.stopLocalMusic();
    if (this.isHeadsetPlaying()) await this.playerAction({ action: 'pause' });
  }

  private stopLocalMusic() {
    if (!this.localMusic) return;
    this.localMusic = false;
    revealAudio.stopLoFi();
    emit('local-music-state', false);
  }

  private isHeadsetPlaying() {
    return !!(this.spotifyDeviceId && this.spotify.device?.id === this.spotifyDeviceId && this.spotify.playing);
  }

  private updateMusicPresence() {
    revealAudio.setMusicPresence(!this.standHidden && !this.manualPassthrough);
    this.lastMixAt = 0;
  }

  private updateSpeakerPosition() {
    if (this.boombox) {
      this.boombox.localToWorld(this.musicPosition.set(0, 0.15, 0.12));
      this.boombox.getWorldDirection(this.musicFacing);
      return;
    }
    const room = garageState.room;
    this.musicPosition.set((room?.seat.x ?? 0) + 0.7, (room?.floor.y ?? 0) + 0.24, (room?.seat.z ?? 0) - 0.8);
    this.musicFacing.set(0, 0, 1);
  }

  private mixSpotify(now: number) {
    const player = this.spotifyPlayer;
    if (!this.active || !this.spotifyDeviceId || !player?.setVolume || this.settingVolume || now - this.lastMixAt < 180) return;
    this.lastMixAt = now;
    this.world.camera.getWorldPosition(this.listener);
    this.world.camera.getWorldDirection(this.listenerFacing);
    const offset = this.musicOffset.copy(this.musicPosition).sub(this.listener);
    const distance = offset.length();
    const facing = distance > 0.01 ? (1 + this.listenerFacing.dot(offset.multiplyScalar(1 / distance))) * 0.5 : 1;
    const distanceGain = 1 / (1 + 0.24 * Math.max(0, distance - 0.7));
    const presence = !this.standHidden && !this.manualPassthrough && garageRootsVisible() ? 1 : 0.22;
    const target = garageState.preferences.musicVolume / 100 * distanceGain * (0.78 + 0.22 * facing) * presence;
    const volume = this.lastSpotifyVolume < 0 || target === 0 ? target : this.lastSpotifyVolume + (target - this.lastSpotifyVolume) * 0.4;
    if (this.lastSpotifyVolume >= 0 && Math.abs(this.lastSpotifyVolume - volume) < 0.008 && target !== 0) return;
    if (volume === this.lastSpotifyVolume) return;
    this.settingVolume = true;
    void Promise.resolve().then(() => player.setVolume(volume)).then(() => {
      if (this.spotifyPlayer === player) this.lastSpotifyVolume = volume;
    }).catch(() => { /* SDK controls audio on unsupported platforms */ }).finally(() => { this.settingVolume = false; });
  }

  update() {
    const now = performance.now();
    const playing = this.isHeadsetPlaying() || this.localMusic;
    if (this.localMusic || this.spotifyDeviceId) this.updateSpeakerPosition();
    if (this.localMusic) revealAudio.moveLoFi(this.musicPosition, this.musicFacing);
    this.mixSpotify(now);
    if (!this.speakers.length) return;
    const pulse = playing ? 1 + Math.sin(now / 110) * 0.055 : 1;
    for (const speaker of this.speakers) {
      speaker.scale.setScalar(pulse);
    }
  }
}
