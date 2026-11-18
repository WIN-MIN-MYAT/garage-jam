import {
  createSystem,
  loadUIKitMLAsset,
  PokeInteractable,
  RayInteractable,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import type { UIKitMLAsset } from '@iwsdk/core';
import { emit, garageEvents } from '../events.js';
import { bindPress, clearUiInput, PanelInput, sendPanelToFront } from '../ui-press.js';
import { pulseGamepads } from '../feedback.js';
import { revealAudio } from '../reveal/RevealAudio.js';

type Track = {
  id: string;
  uri: string;
  name: string;
  artists: string;
  album?: string;
  art?: string | null;
  durationMs?: number;
};

type SearchResponse = { query: string; results: Track[]; error?: string };

const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
const digits = '1234567890'.split('');
const maxQuery = 64;
const maxResults = 5;

export class SpotifySearchSystem extends createSystem({}) {
  private panel?: UIKitMLAsset;
  private query = '';
  private results: Track[] = [];
  private status = 'Search Spotify, then pick a track.';
  private searching = false;
  private opened = false;
  private openRequested = false;
  private spotifyConnected = false;
  private headsetStatus = 'idle';
  private headsetMessage = '';
  private headsetDeviceId?: string;
  private pending?: Track;
  private pendingTimer = 0;

  init() {
    const onOpen = () => this.openPanel();
    const onResults = (event: Event) => this.onResults((event as CustomEvent<SearchResponse>).detail);
    const onPlugins = (event: Event) => {
      const statuses = (event as CustomEvent<Record<string, any>>).detail ?? {};
      this.spotifyConnected = !!statuses.spotify?.connected;
      if (this.opened) {
        if (!this.spotifyConnected) this.status = 'Connect Spotify in the wrist CONNECT page.';
        else if (this.status.startsWith('Connect Spotify')) this.status = 'Search Spotify, then pick a track.';
        this.render();
      }
    };
    const onHeadset = (event: Event) => {
      const detail = (event as CustomEvent<{ status: string; message: string; deviceId?: string }>).detail;
      this.headsetStatus = detail.status;
      this.headsetMessage = detail.message;
      this.headsetDeviceId = detail.status === 'ready' ? detail.deviceId : undefined;
      if (detail.status === 'ready' && this.pending) {
        const track = this.pending;
        this.pending = undefined;
        window.clearTimeout(this.pendingTimer);
        this.playNow(track);
      } else if (detail.status === 'error' && this.pending) {
        this.pending = undefined;
        window.clearTimeout(this.pendingTimer);
        this.status = detail.message || 'Headset audio is unavailable.';
        if (this.opened) this.render();
      }
    };
    const close = () => this.close();
    const onOtherPanel = (event: Event) => {
      if ((event as CustomEvent<boolean>).detail) this.close();
    };
    garageEvents.addEventListener('spotify-search-open', onOpen);
    garageEvents.addEventListener('spotify-search-results', onResults);
    garageEvents.addEventListener('plugin-status', onPlugins);
    garageEvents.addEventListener('spotify-headset', onHeadset);
    garageEvents.addEventListener('garage-reset', close);
    garageEvents.addEventListener('garage-space-reset', close);
    garageEvents.addEventListener('room-hidden', close);
    garageEvents.addEventListener('device-marking-active', onOtherPanel);
    garageEvents.addEventListener('monitor-manager-visibility', onOtherPanel);
    garageEvents.addEventListener('table-confirm-visibility', onOtherPanel);
    garageEvents.addEventListener('room-manual-active', onOtherPanel);
    const stopVisibility = this.world.visibilityState.subscribe(state => {
      if (state === VisibilityState.NonImmersive) this.close();
    });
    this.cleanupFuncs.push(() => {
      garageEvents.removeEventListener('spotify-search-open', onOpen);
      garageEvents.removeEventListener('spotify-search-results', onResults);
      garageEvents.removeEventListener('plugin-status', onPlugins);
      garageEvents.removeEventListener('spotify-headset', onHeadset);
      garageEvents.removeEventListener('garage-reset', close);
      garageEvents.removeEventListener('garage-space-reset', close);
      garageEvents.removeEventListener('room-hidden', close);
      garageEvents.removeEventListener('device-marking-active', onOtherPanel);
      garageEvents.removeEventListener('monitor-manager-visibility', onOtherPanel);
      garageEvents.removeEventListener('table-confirm-visibility', onOtherPanel);
      garageEvents.removeEventListener('room-manual-active', onOtherPanel);
      stopVisibility();
      window.clearTimeout(this.pendingTimer);
      this.panel?.dispose();
    });
    if (location.hostname === 'localhost') {
      const system = this;
      (window as any).garageSpotifySearchDebug = {
        open: () => system.openPanel(),
        close: () => system.close(),
        type: (text: string) => { for (const character of String(text)) system.type(character); },
        search: () => system.search(),
        play: (index: number) => system.playResult(index),
        get panel() { return system.panel; },
        get state() {
          return {
            open: system.opened, query: system.query, results: system.results, status: system.status,
            spotifyConnected: system.spotifyConnected, headsetStatus: system.headsetStatus, deviceId: system.headsetDeviceId,
          };
        },
      };
    }
    void this.createPanel().catch(error => {
      console.error('[spotify-search]', error);
      emit('status', `Spotify search failed: ${String(error)}`);
    });
  }

  private async createPanel() {
    const panel = await loadUIKitMLAsset('/ui/spotify-search.uikitml', { kit: 'horizon', preferredColorScheme: 'dark' });
    panel.name = 'Spotify search panel';
    panel.scale.setScalar(0.09);
    panel.visible = false;
    sendPanelToFront(panel);
    const entity = this.world.createTransformEntity(panel, { persistent: true });
    entity.addComponent(RayInteractable, {});
    entity.addComponent(PokeInteractable, {});
    this.panel = panel;
    new PanelInput(panel);
    const on = (id: string, action: () => void, sound = false) => bindPress(panel, id, () => {
      pulseGamepads(this.input.xr.gamepads, 0.18, 14);
      if (sound) revealAudio.playPress(panel);
      action();
    });
    for (const letter of letters) on(`ss-key-${letter}`, () => this.type(letter));
    for (const digit of digits) on(`ss-key-${digit}`, () => this.type(digit));
    on('ss-space', () => this.type(' '));
    on('ss-back', () => this.backspace());
    on('ss-clear', () => this.clearQuery());
    on('ss-search', () => this.search(), true);
    on('ss-close', () => this.close(), true);
    for (let index = 0; index < maxResults; index++) on(`ss-result-${index}`, () => this.playResult(index));
    this.render();
    if (this.openRequested) {
      this.openRequested = false;
      this.openPanel();
    }
  }

  private openPanel() {
    if (!this.panel) {
      this.openRequested = true;
      return;
    }
    this.opened = true;
    const camera = this.world.camera;
    const head = camera.getWorldPosition(new Vector3());
    const forward = camera.getWorldDirection(new Vector3());
    forward.y = Math.max(-0.18, Math.min(0.08, forward.y * 0.35));
    forward.normalize();
    this.panel.position.copy(head).addScaledVector(forward, 0.82).add(new Vector3(0, -0.08, 0));
    this.panel.lookAt(head);
    this.panel.visible = true;
    sendPanelToFront(this.panel);
    if (!this.results.length) this.status = 'Search Spotify, then pick a track.';
    emit('plugin-refresh');
    emit('spotify-headset-enable');
    this.render();
  }

  private close() {
    this.opened = false;
    this.pending = undefined;
    window.clearTimeout(this.pendingTimer);
    if (this.panel) this.panel.visible = false;
    clearUiInput();
  }

  private type(character: string) {
    if (this.query.length >= maxQuery) return;
    this.query += character;
    if (this.results.length) this.status = 'Press SEARCH to update results.';
    this.render();
  }

  private backspace() {
    this.query = Array.from(this.query).slice(0, -1).join('');
    if (this.results.length) this.status = 'Press SEARCH to update results.';
    this.render();
  }

  private clearQuery() {
    this.query = '';
    this.results = [];
    this.status = 'Search Spotify, then pick a track.';
    this.render();
  }

  private search() {
    if (this.searching) return;
    const query = this.query.trim();
    if (query.length < 2) {
      this.status = 'Type at least 2 characters.';
      this.render();
      return;
    }
    if (!this.spotifyConnected) {
      this.status = 'Connect Spotify in the wrist CONNECT page.';
      this.render();
      return;
    }
    this.searching = true;
    this.results = [];
    this.status = 'Searching Spotify...';
    this.render();
    emit('spotify-search', { query });
  }

  private onResults(detail: SearchResponse) {
    if (!detail) return;
    this.searching = false;
    this.results = Array.isArray(detail.results) ? detail.results.slice(0, maxResults) : [];
    if (detail.error) this.status = detail.error;
    else this.status = this.results.length ? `${this.results.length} tracks. Pick one to play.` : 'No matching tracks.';
    if (this.opened) this.render();
  }

  private playResult(index: number) {
    const track = this.results[index];
    if (!track) return;
    if (!this.spotifyConnected) {
      this.status = 'Connect Spotify in the wrist CONNECT page.';
      this.render();
      return;
    }
    if (this.headsetStatus !== 'ready') {
      this.pending = track;
      this.status = this.headsetMessage || 'Starting headset audio...';
      this.render();
      emit('spotify-headset-enable');
      window.clearTimeout(this.pendingTimer);
      this.pendingTimer = window.setTimeout(() => {
        if (this.pending !== track || this.headsetStatus === 'ready') return;
        this.pending = undefined;
        this.status = 'Headset audio is not ready. Open wrist MUSIC and press Play first.';
        if (this.opened) this.render();
      }, 8000);
      return;
    }
    this.playNow(track);
  }

  private playNow(track: Track) {
    this.status = `Playing ${fit(track.name, 38)}...`;
    this.render();
    emit('spotify-action', { action: 'play', uris: [track.uri] });
    pulseGamepads(this.input.xr.gamepads, 0.35, 30);
  }

  private render() {
    const panel = this.panel;
    if (!panel) return;
    const set = (id: string, text: string) => panel.getElementById(id)?.setProperties({ text });
    set('ss-query', this.query || 'Type a song or artist');
    set('ss-status', this.status);
    for (let index = 0; index < maxResults; index++) {
      const track = this.results[index];
      panel.getElementById(`ss-result-${index}`)?.setProperties({ display: track ? 'flex' : 'none' });
      if (!track) continue;
      set(`ss-result-title-${index}`, fit(track.name, 52));
      set(`ss-result-artist-${index}`, fit(track.artists || track.album || '', 64));
    }
  }
}

function fit(text: string, length: number) {
  const characters = Array.from(text);
  return characters.length > length ? characters.slice(0, length - 1).join('') + '...' : text;
}
