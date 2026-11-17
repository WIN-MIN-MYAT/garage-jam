import {
  createSystem,
  Hovered,
  InputComponent,
  loadUIKitMLAsset,
  PokeInteractable,
  Pressed,
  Quaternion,
  RayInteractable,
  Vector3,
  VisibilityState,
} from '@iwsdk/core';
import type { UIKitMLAsset } from '@iwsdk/core';
import { emit, garageEvents } from '../events.js';
import { garageState, lastRoomStorageKey, resetPreferences, setPreference, setWorkMode } from '../garage-state.js';
import { clearDeviceCollection } from '../device-model.js';
import { isProductEntry, resetFlow, type AppStage } from '../app-flow/app-flow.js';
import { manualRoomStorageKey } from '../room-model.js';
import { resetProgress } from '../progress-store.js';
import { revealAudio } from '../reveal/RevealAudio.js';
import { bindPress, clearUiInput, PanelInput, sendPanelToFront, uiInputActive } from '../ui-press.js';
import { pulseGamepads } from '../feedback.js';
import { GarageBuildSystem } from './garage-build-system.js';
import { clearStandSeat } from '../stand-seat-memory.js';

const pages = ['home', 'room', 'music', 'settings', 'plugins'] as const;
type Page = typeof pages[number];
type Side = 'left' | 'right';

const wristAngle = Math.cos(14 * Math.PI / 180);
const panelAngle = Math.cos(22 * Math.PI / 180);
const panelScale = 0.082;
const panelDistance = 0.50;
const panelDrop = 0;
const glanceDelay = 600;
const autoCloseDelay = 3500;
const handHold = 450;
const pinchOpen = 0.7;
const reopenCooldown = 900;

export class WristMenuSystem extends createSystem({}) {
  private panel?: UIKitMLAsset;
  private panelEntity?: { hasComponent: (component: any) => boolean };
  private builder?: GarageBuildSystem;
  private page: Page = 'home';
  private settingsPage: 'preferences' | 'room' = 'preferences';
  private standSeatState = 'SET';
  private pinned = false;
  private stage: AppStage = 'S0';
  private calibrating = false;
  private editingTable = false;
  private markingDevices = false;
  private managingMonitors = false;
  private standHidden = false;
  private restoreAfterStand = false;
  private passthrough = false;
  private glanceStarted: number | null = null;
  private handStarted: number | null = null;
  private lastLook = 0;
  private dismissed = false;
  private placeOnOpen = false;
  private dirty = true;
  private reopenAt = 0;
  private hoverTone = '';
  private head = new Vector3();
  private forward = new Vector3(0, 0, -1);
  private right = new Vector3(1, 0, 0);
  private menuHead = new Vector3();
  private menuForward = new Vector3();
  private parentRotation = new Quaternion();
  private rotation = new Quaternion();
  private offset = new Vector3();
  private backOfHand = new Vector3();
  private gesture = { lookingAtWrist: false, lookingAtMenu: false, distance: 0, dot: 0 };
  private hand = { side: null as Side | null, palmUp: false, pinch: 0, lift: 0, active: false, backY: 0, note: 'idle' };
  private frames = 0;
  private gate = 'init';
  private menuSide: Side = 'left';
  private pluginStatus: Record<string, any> = {};
  private pluginPairing: { provider: string; code: string; url: string } | null = null;
  private spotify: any = { active: false };
  private calendar: any[] = [];
  private focus: any = { running: false, paused: false, remaining: 0, duration: 0, phase: 'focus' };
  private playlists: any[] = [];
  private headsetMessage = '';
  private headsetReady = false;
  private playlistIndex = -1;
  private localMusic = false;

  init() {
    this.builder = this.world.getSystem(GarageBuildSystem) ?? undefined;
    const onStage = (event: Event) => {
      this.stage = (event as CustomEvent<{ stage: AppStage }>).detail.stage;
      if (isProductEntry && this.stage !== 'S10') this.close();
    };
    const calibration = (event: Event) => {
      this.calibrating = (event as CustomEvent<boolean>).detail;
      if (this.calibrating) this.close();
    };
    const tablePanel = (event: Event) => {
      this.editingTable = (event as CustomEvent<boolean>).detail;
      if (this.editingTable) this.close();
    };
    const passthrough = (event: Event) => {
      this.passthrough = (event as CustomEvent<boolean>).detail;
      this.resetGesture();
      this.refresh();
    };
    const onMonitorPanel = (event: Event) => {
      this.managingMonitors = (event as CustomEvent<boolean>).detail;
      if (this.managingMonitors) this.close(true);
    };
    const onRoomHidden = () => {
      this.standHidden = true;
      this.restoreAfterStand = !!this.panel?.visible;
      if (this.panel) this.panel.visible = false;
      clearUiInput();
      this.resetGesture();
    };
    const onRoomShown = () => {
      this.standHidden = false;
      this.placeOnOpen = true;
      this.resetGesture();
    };
    const onRoomReset = () => {
      this.standHidden = this.restoreAfterStand = false;
      this.close();
    };
    const onMode = () => this.refresh();
    const devices = (event: Event) => {
      this.markingDevices = (event as CustomEvent<boolean>).detail;
      if (this.markingDevices) this.close(true);
    };
    const onPlugins = (event: Event) => { this.pluginStatus = (event as CustomEvent<Record<string, any>>).detail ?? {}; this.refresh(); };
    const onPairing = (event: Event) => { this.pluginPairing = (event as CustomEvent<any>).detail ?? null; this.showPage('plugins'); this.openPanel(); this.refresh(); };
    const onSpotify = (event: Event) => { this.spotify = (event as CustomEvent<any>).detail ?? { active: false }; this.refresh(); };
    const onHeadset = (event: Event) => {
      const { status, message } = (event as CustomEvent<{ status: string; message: string }>).detail;
      this.headsetReady = status === 'ready';
      this.headsetMessage = message;
      this.refresh();
    };
    const onCalendar = (event: Event) => { this.calendar = (event as CustomEvent<any[]>).detail ?? []; this.refresh(); };
    const onFocus = (event: Event) => { this.focus = (event as CustomEvent<any>).detail ?? this.focus; this.refresh(); };
    const onLocalMusic = (event: Event) => { this.localMusic = (event as CustomEvent<boolean>).detail; this.refresh(); };
    const onPlaylists = (event: Event) => {
      const selected = this.playlists[this.playlistIndex]?.uri;
      this.playlists = (event as CustomEvent<any[]>).detail ?? [];
      this.playlistIndex = this.playlists.findIndex(playlist => playlist.uri === selected);
      this.refresh();
    };
    const onStandSeat = (event: Event) => {
      this.standSeatState = (event as CustomEvent<string>).detail;
      this.refresh();
    };
    garageEvents.addEventListener('stand-seat-state', onStandSeat);
    garageEvents.addEventListener('app-flow-stage', onStage);
    garageEvents.addEventListener('room-manual-active', calibration);
    garageEvents.addEventListener('table-confirm-visibility', tablePanel);
    garageEvents.addEventListener('garage-passthrough-changed', passthrough);
    garageEvents.addEventListener('device-marking-active', devices);
    garageEvents.addEventListener('monitor-manager-visibility', onMonitorPanel);
    garageEvents.addEventListener('room-hidden', onRoomHidden);
    garageEvents.addEventListener('room-shown', onRoomShown);
    garageEvents.addEventListener('garage-reset', onRoomReset);
    garageEvents.addEventListener('garage-space-reset', onRoomReset);
    garageEvents.addEventListener('mode-changed', onMode);
    garageEvents.addEventListener('local-music-state', onLocalMusic);
    garageEvents.addEventListener('plugin-status', onPlugins);
    garageEvents.addEventListener('plugin-pairing', onPairing);
    garageEvents.addEventListener('spotify-state', onSpotify);
    garageEvents.addEventListener('spotify-headset', onHeadset);
    garageEvents.addEventListener('calendar-events', onCalendar);
    garageEvents.addEventListener('focus-state', onFocus);
    garageEvents.addEventListener('spotify-playlists', onPlaylists);
    const stopFrame = this.world.onXRFrame(frame => this.updateFromFrame(frame));
    const stopVisibility = this.world.visibilityState.subscribe(state => {
      if (state === VisibilityState.NonImmersive) {
        clearUiInput();
        onRoomReset();
      }
    });
    this.cleanupFuncs.push(() => {
      garageEvents.removeEventListener('stand-seat-state', onStandSeat);
      garageEvents.removeEventListener('app-flow-stage', onStage);
      garageEvents.removeEventListener('room-manual-active', calibration);
      garageEvents.removeEventListener('table-confirm-visibility', tablePanel);
      garageEvents.removeEventListener('garage-passthrough-changed', passthrough);
      garageEvents.removeEventListener('device-marking-active', devices);
      garageEvents.removeEventListener('monitor-manager-visibility', onMonitorPanel);
      garageEvents.removeEventListener('room-hidden', onRoomHidden);
      garageEvents.removeEventListener('room-shown', onRoomShown);
      garageEvents.removeEventListener('garage-reset', onRoomReset);
      garageEvents.removeEventListener('garage-space-reset', onRoomReset);
      garageEvents.removeEventListener('mode-changed', onMode);
      garageEvents.removeEventListener('local-music-state', onLocalMusic);
      garageEvents.removeEventListener('plugin-status', onPlugins);
      garageEvents.removeEventListener('plugin-pairing', onPairing);
      garageEvents.removeEventListener('spotify-state', onSpotify);
      garageEvents.removeEventListener('spotify-headset', onHeadset);
      garageEvents.removeEventListener('calendar-events', onCalendar);
      garageEvents.removeEventListener('focus-state', onFocus);
      garageEvents.removeEventListener('spotify-playlists', onPlaylists);
      stopFrame();
      stopVisibility();
      this.panel?.dispose();
    });
    void this.createPanel().catch(error => emit('status', `Wrist menu failed: ${String(error)}`));
  }

  private async createPanel() {
    const panel = await loadUIKitMLAsset('/ui/wrist-menu.uikitml', { kit: 'horizon', preferredColorScheme: 'dark' });
    panel.name = 'Left wrist menu';
    panel.scale.setScalar(panelScale);
    panel.visible = false;
    sendPanelToFront(panel);
    const entity = this.world.createTransformEntity(panel, { persistent: true });
    entity.addComponent(RayInteractable, {});
    entity.addComponent(PokeInteractable, {});
    this.panelEntity = entity;
    this.panel = panel;
    new PanelInput(panel, () => { this.lastLook = performance.now(); });
    const on = (id: string, action: () => void) => bindPress(panel, id, () => {
      pulseGamepads(this.input.xr.gamepads);
      if (id !== 'wm-sound') revealAudio.playPress(panel);
      action();
    });
    on('wm-pin', () => {
      this.pinned = !this.pinned;
      this.lastLook = performance.now();
      this.refresh();
    });
    on('wm-close', () => this.close(true));
    on('wm-tab-home', () => this.showPage('home'));
    on('wm-tab-room', () => this.showPage('room'));
    on('wm-tab-music', () => { this.showPage('music'); emit('spotify-headset-enable'); emit('plugin-refresh'); });
    on('wm-tab-settings', () => this.showPage('settings'));
    on('wm-settings-preferences', () => { this.settingsPage = 'preferences'; this.refresh(); });
    on('wm-settings-room', () => { this.settingsPage = 'room'; this.refresh(); });
    on('wm-tab-plugins', () => { this.showPage('plugins'); emit('plugin-refresh'); });
    on('wm-connect-screen', () => { this.close(true); emit('stream-guide-open'); });
    for (const provider of ['notion', 'spotify', 'calendar', 'weather']) {
      on(`wm-connect-${provider}`, () => emit('plugin-connect', { provider }));
    }
    on('wm-focus', () => {
      if (this.focus.running) emit('focus-pause');
      else emit('focus-start', { minutes: garageState.preferences.focusMinutes });
      this.refresh();
    });
    on('wm-focus-end', () => emit('focus-cancel'));
    on('wm-voice', () => { this.close(true); emit('voice-start'); });
    on('wm-mode-real', () => setWorkMode('passthrough'));
    on('wm-mode-stream', () => setWorkMode('streaming'));
    on('wm-monitors', () => { this.close(true); emit('monitor-manager-open'); });
    on('wm-music-prev', () => emit('spotify-action', { action: 'previous' }));
    on('wm-music-next', () => emit('spotify-action', { action: 'next' }));
    on('wm-music-play', () => emit('music-toggle'));
    on('wm-music-vol-down', () => this.musicVolume(-5));
    on('wm-music-vol-up', () => this.musicVolume(5));
    on('wm-music-playlist', () => {
      if (!this.playlists.length) { emit('plugin-refresh'); emit('status', 'No Spotify playlists loaded.'); return; }
      this.playlistIndex = (this.playlistIndex + 1) % this.playlists.length;
      const playlist = this.playlists[this.playlistIndex];
      emit('spotify-action', { action: 'play', contextUri: playlist.uri });
      this.refresh();
    });
    on('wm-place', () => {
      this.placePanel();
      this.lastLook = performance.now();
    });
    on('wm-cutouts', () => {
      const next = !garageState.preferences.cutouts;
      setPreference('cutouts', next);
      emit('garage-cutouts-changed', next);
      this.refresh();
    });
    on('wm-mark-devices', () => {
      this.close(true);
      emit('device-marking-open');
    });
    on('wm-passthrough', () => emit('garage-passthrough-toggle'));
    on('wm-table-view', () => {
      if (!garageState.room?.table) return;
      this.builder?.setTableView(garageState.preferences.tableView === 'workbench' ? 'real' : 'workbench');
      this.refresh();
    });
    on('wm-rescan', () => {
      this.close(true);
      emit('table-confirm-hide');
      if (isProductEntry) emit('app-flow-rescan');
      else this.builder?.resetForRescan();
    });
    on('wm-edit-table', () => {
      if (garageState.room?.table) emit('table-confirm-show');
      else emit('room-manual-start', { mode: 'table' });
    });
    on('wm-mark-table', () => emit('room-manual-start', { mode: 'table' }));
    on('wm-rearrange', () => {
      this.close(true);
      void this.builder?.rearrangeProps().catch(error => emit('status', `Could not rearrange props: ${String(error)}`));
    });
    on('wm-debug', () => {
      setPreference('debugOverlay', !garageState.preferences.debugOverlay);
      emit('garage-debug-toggle', garageState.preferences.debugOverlay);
      this.refresh();
    });
    on('wm-units', () => {
      setPreference('units', garageState.preferences.units === 'cm' ? 'in' : 'cm');
      emit('table-confirm-refresh');
      this.refresh();
    });
    on('wm-hand', () => {
      setPreference('dominantHand', garageState.preferences.dominantHand === 'right' ? 'left' : 'right');
      this.refresh();
    });
    on('wm-motion', () => {
      setPreference('reducedMotion', !garageState.preferences.reducedMotion);
      this.refresh();
    });
    on('wm-reveal', () => {
      setPreference('revealOff', !garageState.preferences.revealOff);
      this.refresh();
    });
    on('wm-sound', () => {
      setPreference('revealSound', !garageState.preferences.revealSound);
      this.applySound();
      if (garageState.preferences.revealSound) revealAudio.playPress(panel);
      this.refresh();
    });
    on('wm-outlines', () => {
      setPreference('outlines', !garageState.preferences.outlines);
      this.builder?.setOutlines(garageState.preferences.outlines);
      this.refresh();
    });
    on('wm-sky', () => {
      const modes = ['golden', 'time', 'weather'] as const;
      const next = modes[(modes.indexOf(garageState.preferences.skyMode) + 1) % modes.length];
      setPreference('skyMode', next);
      emit('sky-mode-changed', next);
      if (next === 'weather' && !this.pluginStatus.weather?.connected) emit('status', 'Connect Weather in Plugins for live sky.');
      this.refresh();
    });
    on('wm-standup', () => {
      const next = !garageState.preferences.standUpFade;
      setPreference('standUpFade', next);
      emit('stand-up-fade-changed', next);
      if (!next) emit('status', 'Stand-up fade OFF. Garage stays visible.');
      this.refresh();
    });
    on('wm-save-seat', () => emit('standup-seat-store'));
    on('wm-clear-board', () => emit('whiteboard-clear'));
    on('wm-focus-length', () => {
      const values = [25, 45, 60];
      const next = values[(values.indexOf(garageState.preferences.focusMinutes) + 1) % values.length];
      setPreference('focusMinutes', next);
      this.refresh();
    });
    on('wm-reset', () => {
      resetPreferences();
      emit('stand-up-fade-changed', garageState.preferences.standUpFade);
      emit('garage-cutouts-changed', garageState.preferences.cutouts);
      emit('music-volume', { volume: garageState.preferences.musicVolume });
      emit('sky-mode-changed', garageState.preferences.skyMode);
      this.builder?.setTableView(garageState.preferences.tableView);
      this.builder?.setOutlines(garageState.preferences.outlines);
      emit('garage-debug-toggle', garageState.preferences.debugOverlay);
      emit('table-confirm-refresh');
      this.applySound();
      this.refresh();
      emit('status', 'Preferences reset');
    });
    on('wm-forget', () => {
      resetPreferences();
      clearDeviceCollection();
      clearStandSeat();
      localStorage.removeItem(manualRoomStorageKey);
      localStorage.removeItem(lastRoomStorageKey);
      localStorage.removeItem('garage-jam-progress-v1');
      localStorage.removeItem('garage-jam-whiteboard-v1');
      resetProgress();
      emit('whiteboard-clear');
      resetFlow();
      location.reload();
    });
    this.refresh(true);
    if (location.hostname === 'localhost') {
      const system = this;
      (window as any).garageWristDebug = {
        panel,
        show: (page: Page = 'home') => {
          this.pinned = true;
          this.placeOnOpen = true;
          this.showPage(page);
          this.openPanel();
        },
        hide: () => this.close(true),
        page: (page: Page) => this.showPage(page),
        place: () => this.placePanel(),
        get gesture() { return system.gesture; },
        get hand() { return system.hand; },
        get gate() { return { gate: system.gate, frames: system.frames }; },
        get autoVisible() { return panel.visible && !system.pinned; },
        get info() {
          return {
            visible: panel.visible,
            pinned: system.pinned,
            scale: panel.scale.x,
            position: panel.position.toArray(),
            size: { width: 256 * panelScale * 0.01, height: 332 * panelScale * 0.01 },
          };
        },
      };
    }
  }

  private applySound() {
    const prefs = garageState.preferences;
    revealAudio.setVolume(prefs.revealSound ? prefs.sfxVolume : 0);
  }

  private musicVolume(delta: number) {
    const value = Math.max(0, Math.min(100, garageState.preferences.musicVolume + delta));
    setPreference('musicVolume', value);
    emit('music-volume', { volume: value });
    this.refresh();
  }

  private showPage(page: Page) {
    this.page = page;
    this.refresh();
  }

  private close(dismissed = false) {
    this.pinned = false;
    this.restoreAfterStand = false;
    this.resetGesture();
    this.dismissed = dismissed;
    if (dismissed) {
      this.reopenAt = performance.now() + reopenCooldown;
      pulseGamepads(this.input.xr.gamepads, 0.22, 18);
    }
    if (this.panel) this.panel.visible = false;
    clearUiInput();
    this.dirty = true;
  }

  private resetGesture() {
    this.glanceStarted = null;
    this.handStarted = null;
    this.dismissed = false;
    this.lastLook = performance.now();
  }

  private openPanel() {
    const panel = this.panel;
    if (!panel) return;
    const alreadyOpen = panel.visible && !this.placeOnOpen;
    if (alreadyOpen) {
      if (this.dirty) this.refresh();
      this.lastLook = performance.now();
      this.glanceStarted = null;
      this.handStarted = null;
      this.placeOnOpen = false;
      return;
    }
    if (!panel.visible || this.placeOnOpen) this.placePanel();
    panel.visible = true;
    this.refresh();
    revealAudio.playPanel(panel);
    pulseGamepads(this.input.xr.gamepads, 0.24, 20);
    this.lastLook = performance.now();
    this.glanceStarted = null;
    this.handStarted = null;
    this.placeOnOpen = false;
  }

  private refresh(force = false) {
    const panel = this.panel;
    if (!panel) return;
    if (!force && !panel.visible) {
      this.dirty = true;
      return;
    }
    this.dirty = false;
    const p = garageState.preferences;
    const set = (id: string, text: string) => panel.requireElementById(id).setProperties({ text });
    for (const name of pages) {
      panel.requireElementById(`page-${name}`).setProperties({ display: name === this.page ? 'flex' : 'none' });
      panel.requireElementById(`wm-tab-${name}`).setProperties({
        backgroundColor: name === this.page ? '#2a303a' : '#191c23',
        color: name === this.page ? '#e8ff70' : '#7f848f',
      });
    }
    const hasTable = !!garageState.room?.table;
    const streaming = p.mode === 'streaming';
    for (const [name, selected] of [['preferences', this.settingsPage === 'preferences'], ['room', this.settingsPage === 'room']] as const) {
      panel.requireElementById(`wm-settings-page-${name}`).setProperties({ display: selected ? 'flex' : 'none' });
      panel.requireElementById(`wm-settings-${name}`).setProperties({ backgroundColor: selected ? '#3d3c48' : '#1d2129' });
    }
    for (const [id, selected] of [['wm-mode-real', !streaming], ['wm-mode-stream', streaming]] as const) {
      panel.requireElementById(id).setProperties({ backgroundColor: selected ? '#e8ff70' : '#1d2129', color: selected ? '#14161c' : '#e8e2d6' });
    }
    panel.requireElementById('wm-physical-controls').setProperties({ display: streaming ? 'none' : 'flex' });
    panel.requireElementById('wm-stream-controls').setProperties({ display: streaming ? 'flex' : 'none' });
    panel.requireElementById('wm-table-view').setProperties({ display: hasTable ? 'flex' : 'none' });
    panel.requireElementById('wm-edit-table').setProperties({ display: hasTable ? 'flex' : 'none' });
    panel.requireElementById('wm-pin').setProperties({
      backgroundColor: this.pinned ? '#e8ff70' : '#22262e',
      color: this.pinned ? '#14161c' : '#c9c4b8',
    });
    set('wm-pin', this.pinned ? 'UNPIN' : 'PIN');
    set('wm-page-label', this.page.toUpperCase());
    set('wm-passthrough-label', this.passthrough ? 'Return to garage' : 'Show passthrough');
    set('wm-table-view-value', p.tableView === 'workbench' ? 'WORKBENCH' : 'REAL');
    set('wm-cutouts-value', p.cutouts ? 'ON' : 'OFF');
    set('wm-debug-value', p.debugOverlay ? 'ON' : 'OFF');
    set('wm-units-value', p.units.toUpperCase());
    set('wm-hand-value', p.dominantHand === 'right' ? 'RIGHT' : 'LEFT');
    set('wm-motion-value', p.reducedMotion ? 'REDUCED' : 'FULL');
    set('wm-reveal-value', p.revealOff ? 'OFF' : 'ON');
    set('wm-sound-value', p.revealSound ? 'ON' : 'OFF');
    set('wm-outlines-value', p.outlines ? 'ON' : 'OFF');
    set('wm-standup-value', p.standUpFade ? 'ON' : 'OFF');
    set('wm-save-seat-value', this.standSeatState);
    set('wm-sky-value', p.skyMode === 'golden' ? 'GOLD' : p.skyMode === 'time' ? 'TIME' : 'LIVE');
    set('wm-focus-length-value', `${p.focusMinutes}M`);
    const focusSeconds = Math.ceil(this.focus.remaining);
    const focusPhase = this.focus.phase === 'break' ? 'break' : 'focus';
    set('wm-focus-label', this.focus.running ? `${this.focus.paused ? 'Resume' : 'Pause'} ${focusPhase}` : 'Start focus');
    set('wm-focus-value', this.focus.running ? `${Math.floor(focusSeconds / 60)}:${String(focusSeconds % 60).padStart(2, '0')}` : `${p.focusMinutes}M`);
    this.panel?.requireElementById('wm-focus-end').setProperties({ display: this.focus.running ? 'flex' : 'none' });
    const next = this.calendar[0];
    set('wm-next-event', next ? `${next.allDay ? 'ALL DAY' : new Date(next.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${next.title}` : 'No events today');
    const connected = !!this.pluginStatus.spotify?.connected;
    set('wm-music-title', this.localMusic ? 'Garage lo-fi' : connected ? this.spotify.title || 'Spotify' : 'Garage lo-fi');
    set('wm-music-artist', this.localMusic || !connected ? 'Plays from the boombox' : this.spotify.artists || this.spotify.album || 'Choose a playlist or press Play');
    set('wm-music-play', this.localMusic || (connected && this.spotify.playing) ? 'PAUSE' : 'PLAY');
    set('wm-music-playlist-value', this.playlists[this.playlistIndex]?.name ?? 'NONE');
    set('wm-music-volume', `${p.musicVolume}%`);
    for (const id of ['wm-music-prev', 'wm-music-next', 'wm-music-playlist']) {
      panel.requireElementById(id).setProperties({ display: connected && !this.localMusic && this.headsetReady ? 'flex' : 'none' });
    }
    set('wm-music-note', connected ? this.headsetMessage : 'Link Spotify from Connect');
    for (const provider of ['notion', 'spotify', 'calendar', 'weather'] as const) {
      const status = this.pluginStatus[provider];
      set(`wm-plugin-${provider}`, status?.connected ? 'ON' : status?.configured === false ? 'SETUP' : 'OPEN');
    }
    set('wm-plugin-note', this.pluginPairing
      ? `CODE ${this.pluginPairing.code} / ${location.host}/api/plugins/connect`
      : this.pluginStatus.spotify?.connected ? 'Spotify connected' : 'Tap a provider, then open /connect');
  }

  private updateFromFrame(frame: XRFrame) {
    const panel = this.panel;
    const space = this.world.renderer.xr.getReferenceSpace();
    if (!panel) { this.gate = 'no-panel'; return; }
    if (!space) { this.gate = 'no-space'; return; }
    if (!this.world.session) { this.gate = 'no-session'; return; }
    if (this.calibrating) { this.gate = 'calibrating'; return; }
    if (this.editingTable) { this.gate = 'table-panel'; return; }
    if (this.markingDevices) { this.gate = 'device-panel'; return; }
    if (this.managingMonitors) { this.gate = 'monitor-panel'; return; }
    if (this.standHidden && !this.passthrough) { this.gate = 'stand-fade'; return; }
    if (isProductEntry && this.stage !== 'S10') { this.gate = 'stage'; return; }
    if (!this.builder?.isRevealed()) { this.gate = 'not-revealed'; return; }
    this.gate = 'ok';
    this.frames++;
    const viewer = frame.getViewerPose(space);
    if (!viewer) {
      panel.visible = false;
      this.glanceStarted = null;
      this.handStarted = null;
      this.placeOnOpen = this.pinned;
      return;
    }
    const { position, orientation } = viewer.transform;
    if (this.restoreAfterStand && !this.standHidden) {
      this.restoreAfterStand = false;
      this.openPanel();
      return;
    }
    this.head.set(position.x, position.y, position.z);
    this.forward.set(0, 0, -1).applyQuaternion(this.rotation.set(orientation.x, orientation.y, orientation.z, orientation.w));
    this.readHand(frame, space);

    let wristSide: Side | null = null;
    let wristDistance = 0;
    let wristDot = 0;
    for (const side of ['left', 'right'] as const) {
      const source = this.input.xr.getPrimaryInputSource?.(side)
        ?? Array.from(this.world.session.inputSources).find(input => input.handedness === side);
      const wristJoint = source?.hand?.get('wrist');
      const wristPose = wristJoint ? frame.getJointPose?.(wristJoint, space) : source?.gripSpace ? frame.getPose(source.gripSpace, space) : null;
      const wrist = wristPose?.transform.position;
      if (!wrist) continue;
      const distance = this.offset.set(wrist.x, wrist.y, wrist.z).sub(this.head).length();
      if (distance < 0.18 || distance > 0.95) continue;
      const dot = this.offset.dot(this.forward) / distance;
      if (dot < wristAngle || dot <= wristDot) continue;
      wristSide = side;
      wristDistance = distance;
      wristDot = dot;
    }
    const lookingAtWrist = wristSide !== null;
    if (wristSide) this.menuSide = wristSide;
    this.menuHead.copy(this.head);
    this.menuForward.copy(this.forward);
    const cameraParent = this.world.camera.parent;
    if (cameraParent) {
      cameraParent.localToWorld(this.menuHead);
      this.menuForward.applyQuaternion(cameraParent.getWorldQuaternion(this.parentRotation));
    }
    const lookingAtMenu = panel.visible && panel.getWorldPosition(this.offset).sub(this.menuHead).normalize().dot(this.menuForward) >= panelAngle;
    this.gesture = { lookingAtWrist, lookingAtMenu, distance: wristDistance, dot: wristDot };
    const now = performance.now();
    const leftPad = this.input.xr.gamepads.left;
    const rightPad = this.input.xr.gamepads.right;
    if (leftPad?.getButtonDown(InputComponent.X_Button) || rightPad?.getButtonDown(InputComponent.A_Button)) {
      if (panel.visible) {
        this.close(true);
        return;
      }
      this.openPanel();
      return;
    }
    const palmPinch = this.hand.active && this.hand.pinch >= pinchOpen;
    if (!lookingAtWrist && !palmPinch) this.dismissed = false;
    if (!this.dismissed && lookingAtWrist) this.glanceStarted ??= now;
    else this.glanceStarted = null;
    if (!this.dismissed && palmPinch) {
      this.handStarted ??= now;
    } else {
      this.handStarted = null;
    }
    const gestureHold = this.handStarted !== null && now - this.handStarted >= handHold;
    if (!panel.visible && now >= this.reopenAt && !uiInputActive() && (gestureHold || (this.glanceStarted !== null && now - this.glanceStarted >= glanceDelay))) {
      if (gestureHold && this.hand.side) this.menuSide = this.hand.side;
      this.openPanel();
    }
    const interacting = this.panelEntity
      ? this.panelEntity.hasComponent(Hovered) || this.panelEntity.hasComponent(Pressed)
      : false;
    const tone = this.panelEntity?.hasComponent(Pressed) ? '#8ef5ef'
      : interacting ? '#e8ff70' : '#2a2f39';
    if (tone !== this.hoverTone) {
      this.hoverTone = tone;
      panel.requireElementById('wm-card').setProperties({ borderColor: tone });
    }
    if (lookingAtWrist || lookingAtMenu || interacting) this.lastLook = now;
    if (!this.pinned && panel.visible && now - this.lastLook > autoCloseDelay) this.close();
  }

  private readHand(frame: XRFrame, space: XRReferenceSpace) {
    this.hand.side = null;
    this.hand.palmUp = false;
    this.hand.pinch = 0;
    this.hand.lift = 0;
    this.hand.active = false;
    this.hand.backY = 0;
    this.hand.note = 'no-hand';
    let debugBackY = 0;
    let debugNote = 'no-hand';
    for (const side of ['left', 'right'] as const) {
      const source = this.input.xr.getPrimaryInputSource?.(side);
      const wristJoint = source?.hand?.get('wrist');
      if (!wristJoint) continue;
      const pose = frame.getJointPose?.(wristJoint, space);
      if (!pose) {
        if (debugNote === 'no-hand') debugNote = 'no-joint-pose';
        continue;
      }
      const { position, orientation } = pose.transform;
      this.backOfHand.set(0, 1, 0).applyQuaternion(
        this.rotation.set(orientation.x, orientation.y, orientation.z, orientation.w),
      );
      const backY = this.backOfHand.y;
      const palmUp = backY < -0.35;
      const lift = position.y - this.head.y;
      if (debugNote === 'no-hand') {
        debugBackY = backY;
        debugNote = palmUp ? 'palm' : 'not-palm-up';
      }
      if (!palmUp || lift < -0.55) {
        if (debugNote === 'palm') debugNote = 'too-low';
        continue;
      }
      const adapter = this.input.xr.visualAdapters.hand[side];
      const strength = adapter?.getPinchStrength?.() ?? 0;
      const select = this.input.xr.getSelectState?.(side);
      const pinch = Math.max(strength, select?.active ? 1 : 0);
      if (pinch <= this.hand.pinch) {
        if (debugNote === 'palm') debugNote = `pinch-${pinch.toFixed(2)}`;
        continue;
      }
      this.hand.side = side;
      this.hand.palmUp = true;
      this.hand.pinch = pinch;
      this.hand.lift = lift;
      this.hand.active = true;
      debugBackY = backY;
      debugNote = 'active';
    }
    this.hand.backY = debugBackY;
    this.hand.note = debugNote;
  }

  private placePanel() {
    const panel = this.panel;
    if (!panel) return;
    const head = this.world.camera.getWorldPosition(this.head);
    this.world.camera.getWorldDirection(this.forward);
    this.offset.set(this.forward.x, 0, this.forward.z);
    if (this.offset.lengthSq() < 1e-6) this.offset.set(0, 0, -1);
    this.offset.normalize();
    this.right.set(-this.offset.z, 0, this.offset.x);
    this.offset.y = Math.max(-0.45, Math.min(0, this.forward.y - 0.10));
    this.offset.normalize();
    const side = this.menuSide === 'left' ? -0.075 : 0.075;
    panel.position.copy(head)
      .addScaledVector(this.offset, panelDistance)
      .addScaledVector(this.right, side);
    panel.position.y -= panelDrop;
    panel.lookAt(head);
    this.placeOnOpen = false;
  }
}
