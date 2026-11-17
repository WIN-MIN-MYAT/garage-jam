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
import { garageState, lastRoomStorageKey, resetPreferences, setPreference } from '../garage-state.js';
import { clearDeviceCollection } from '../device-model.js';
import { isProductEntry, resetFlow, type AppStage } from '../app-flow/app-flow.js';
import { manualRoomStorageKey } from '../room-model.js';
import { resetProgress } from '../progress-store.js';
import { revealAudio } from '../reveal/RevealAudio.js';
import { bindPress, PanelInput, sendPanelToFront } from '../ui-press.js';
import { GarageBuildSystem } from './garage-build-system.js';
import { clearStandSeat } from '../stand-seat-memory.js';

const pages = ['home', 'room', 'music', 'settings', 'plugins'] as const;
type Page = typeof pages[number];
type Side = 'left' | 'right';

const wristAngle = Math.cos(14 * Math.PI / 180);
const panelAngle = Math.cos(22 * Math.PI / 180);
const panelScale = 0.15;
const panelDistance = 0.92;
const panelDrop = 0.03;
const panelSide = -0.02;
const glanceDelay = 140;
const autoCloseDelay = 1500;
const handHold = 180;
const pinchOpen = 0.7;

export class WristMenuSystem extends createSystem({}) {
  private panel?: UIKitMLAsset;
  private panelEntity?: { hasComponent: (component: any) => boolean };
  private builder?: GarageBuildSystem;
  private page: Page = 'home';
  private standSeatState = 'SET';
  private pinned = false;
  private stage: AppStage = 'S0';
  private calibrating = false;
  private editingTable = false;
  private markingDevices = false;
  private passthrough = false;
  private glanceStarted: number | null = null;
  private handStarted: number | null = null;
  private lastLook = 0;
  private dismissed = false;
  private placeOnOpen = false;
  private hoverTone = '';
  private head = new Vector3();
  private forward = new Vector3(0, 0, -1);
  private right = new Vector3(1, 0, 0);
  private rotation = new Quaternion();
  private offset = new Vector3();
  private backOfHand = new Vector3();
  private gesture = { lookingAtWrist: false, lookingAtMenu: false, distance: 0, dot: 0 };
  private hand = { side: null as Side | null, palmUp: false, pinch: 0, lift: 0, active: false, backY: 0, note: 'idle' };
  private frames = 0;
  private gate = 'init';
  private pluginStatus: Record<string, any> = {};
  private pluginPairing: { provider: string; code: string; url: string } | null = null;
  private spotify: any = { active: false };
  private calendar: any[] = [];
  private weather: any = null;
  private focus: any = { running: false, paused: false, remaining: 0, duration: 0, phase: 'focus' };
  private devices: any[] = [];
  private playlists: any[] = [];
  private headsetMessage = '';
  private deviceIndex = 0;
  private playlistIndex = 0;
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
      this.refresh();
    };
    const devices = (event: Event) => {
      this.markingDevices = (event as CustomEvent<boolean>).detail;
      if (this.markingDevices) this.close(true);
    };
    const onPlugins = (event: Event) => { this.pluginStatus = (event as CustomEvent<Record<string, any>>).detail ?? {}; this.refresh(); };
    const onPairing = (event: Event) => { this.pluginPairing = (event as CustomEvent<any>).detail ?? null; this.showPage('plugins'); this.openPanel(); this.refresh(); };
    const onSpotify = (event: Event) => { this.spotify = (event as CustomEvent<any>).detail ?? { active: false }; this.refresh(); };
    const onHeadset = (event: Event) => { this.headsetMessage = String((event as CustomEvent<any>).detail?.message ?? ''); this.refresh(); };
    const onCalendar = (event: Event) => { this.calendar = (event as CustomEvent<any[]>).detail ?? []; this.refresh(); };
    const onWeather = (event: Event) => { this.weather = (event as CustomEvent<any>).detail; this.refresh(); };
    const onFocus = (event: Event) => { this.focus = (event as CustomEvent<any>).detail ?? this.focus; this.refresh(); };
    const onDevices = (event: Event) => { this.devices = (event as CustomEvent<any[]>).detail ?? []; this.deviceIndex = 0; this.refresh(); };
    const onPlaylists = (event: Event) => { this.playlists = (event as CustomEvent<any[]>).detail ?? []; this.playlistIndex = 0; this.refresh(); };
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
    garageEvents.addEventListener('plugin-status', onPlugins);
    garageEvents.addEventListener('plugin-pairing', onPairing);
    garageEvents.addEventListener('spotify-state', onSpotify);
    garageEvents.addEventListener('spotify-headset', onHeadset);
    garageEvents.addEventListener('calendar-events', onCalendar);
    garageEvents.addEventListener('weather-current', onWeather);
    garageEvents.addEventListener('focus-state', onFocus);
    garageEvents.addEventListener('spotify-devices', onDevices);
    garageEvents.addEventListener('spotify-playlists', onPlaylists);
    const stopFrame = this.world.onXRFrame(frame => this.updateFromFrame(frame));
    const stopVisibility = this.world.visibilityState.subscribe(state => {
      if (state === VisibilityState.NonImmersive) this.close();
    });
    this.cleanupFuncs.push(() => {
      garageEvents.removeEventListener('stand-seat-state', onStandSeat);
      garageEvents.removeEventListener('app-flow-stage', onStage);
      garageEvents.removeEventListener('room-manual-active', calibration);
      garageEvents.removeEventListener('table-confirm-visibility', tablePanel);
      garageEvents.removeEventListener('garage-passthrough-changed', passthrough);
      garageEvents.removeEventListener('device-marking-active', devices);
      garageEvents.removeEventListener('plugin-status', onPlugins);
      garageEvents.removeEventListener('plugin-pairing', onPairing);
      garageEvents.removeEventListener('spotify-state', onSpotify);
      garageEvents.removeEventListener('spotify-headset', onHeadset);
      garageEvents.removeEventListener('calendar-events', onCalendar);
      garageEvents.removeEventListener('weather-current', onWeather);
      garageEvents.removeEventListener('focus-state', onFocus);
      garageEvents.removeEventListener('spotify-devices', onDevices);
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
    on('wm-voice', () => { this.close(true); emit('voice-start'); });
    on('wm-mode', () => {
      const mode = garageState.preferences.mode === 'passthrough' ? 'streaming' : 'passthrough';
      setPreference('mode', mode);
      emit('mode-changed', mode);
      emit('status', mode === 'streaming' ? 'Streaming mode: virtual monitors' : 'Passthrough mode: real devices');
      this.refresh();
    });
    on('wm-monitors', () => { this.close(true); emit('monitor-manager-open'); });
    on('wm-music-prev', () => emit('spotify-action', { action: 'previous' }));
    on('wm-music-next', () => emit('spotify-action', { action: 'next' }));
    on('wm-music-play', () => {
      if (this.pluginStatus.spotify?.connected) emit('spotify-action', { action: this.spotify.playing ? 'pause' : 'play' });
      else {
        this.localMusic = !this.localMusic;
        emit(this.localMusic ? 'music-play' : 'music-stop');
        this.refresh();
      }
    });
    on('wm-music-vol-down', () => this.musicVolume(-5));
    on('wm-music-vol-up', () => this.musicVolume(5));
    on('wm-music-device', () => {
      if (!this.devices.length) { emit('plugin-refresh'); emit('status', 'No Spotify devices yet.'); return; }
      this.deviceIndex = (this.deviceIndex + 1) % this.devices.length;
      const device = this.devices[this.deviceIndex];
      emit('spotify-action', { action: 'transfer', deviceId: device.id });
      this.refresh();
    });
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
    this.refresh();
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
            size: { width: 232 * panelScale * 0.01, height: 292 * panelScale * 0.01 },
          };
        },
      };
    }
  }

  private applySound() {
    const prefs = garageState.preferences;
    revealAudio.setVolume(prefs.revealSound ? prefs.sfxVolume : 0);
    revealAudio.setMusicVolume(prefs.musicVolume);
  }

  private musicVolume(delta: number) {
    const value = Math.max(0, Math.min(100, garageState.preferences.musicVolume + delta));
    setPreference('musicVolume', value);
    revealAudio.setMusicVolume(value);
    emit('music-volume', { volume: value });
    this.refresh();
  }

  private showPage(page: Page) {
    this.page = page;
    this.refresh();
  }

  private close(dismissed = false) {
    this.pinned = false;
    this.glanceStarted = null;
    this.handStarted = null;
    this.dismissed = dismissed;
    if (this.panel) this.panel.visible = false;
    this.refresh();
  }

  private openPanel() {
    const panel = this.panel;
    if (!panel) return;
    if (!panel.visible || this.placeOnOpen) this.placePanel();
    if (!panel.visible) {
      this.refresh();
      revealAudio.playPanel(panel);
    }
    panel.visible = true;
    this.lastLook = performance.now();
    this.glanceStarted = null;
    this.placeOnOpen = false;
  }

  private refresh() {
    const panel = this.panel;
    if (!panel) return;
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
    panel.requireElementById('wm-table-view').setProperties({ display: hasTable ? 'flex' : 'none' });
    panel.requireElementById('wm-edit-table').setProperties({ display: hasTable ? 'flex' : 'none' });
    panel.requireElementById('wm-pin').setProperties({
      backgroundColor: this.pinned ? '#e8ff70' : '#22262e',
      color: this.pinned ? '#14161c' : '#c9c4b8',
    });
    set('wm-pin', this.pinned ? 'UNPIN' : 'PIN');
    set('wm-page-label', this.page.toUpperCase());
    set('wm-passthrough-label', this.passthrough ? 'Return to garage' : 'Show passthrough');
    set('wm-table-view-value', p.tableView === 'workbench' ? 'REAL' : 'WORK');
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
    set('wm-focus-value', this.focus.running ? (this.focus.paused ? 'PAUSED' : `${Math.floor(this.focus.remaining / 60)}:${String(Math.floor(this.focus.remaining) % 60).padStart(2, '0')}`) : 'START');
    set('wm-mode-value', p.mode === 'streaming' ? 'STREAM' : 'PASS');
    const next = this.calendar[0];
    set('wm-next-event', next ? `${next.allDay ? 'ALL DAY' : new Date(next.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${next.title}` : 'No events today');
    set('wm-music-title', this.spotify.active ? this.spotify.title || 'Spotify ready' : this.pluginStatus.spotify?.connected ? 'No active device' : 'Not connected');
    set('wm-music-artist', this.spotify.active ? this.spotify.artists || this.spotify.album || '' : this.pluginStatus.spotify?.connected ? 'Open Spotify, then Refresh' : 'Open CONNECT to link Spotify');
    set('wm-music-play', this.spotify.playing ? 'PAUSE' : 'PLAY');
    set('wm-music-device-value', this.devices[this.deviceIndex]?.name ?? this.spotify.device?.name ?? 'NONE');
    set('wm-music-playlist-value', this.playlists[this.playlistIndex]?.name ?? 'NONE');
    set('wm-music-note', this.headsetMessage || (this.weather ? `${Math.round(this.weather.temperature)}${this.weather.unit} / ${this.weather.location ?? 'weather'}` : 'Local fallback available'));
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
    this.head.set(position.x, position.y, position.z);
    this.forward.set(0, 0, -1).applyQuaternion(this.rotation.set(orientation.x, orientation.y, orientation.z, orientation.w));
    this.readHand(frame, space);

    const left = this.input.xr.getPrimaryInputSource?.('left')
      ?? Array.from(this.world.session.inputSources).find(input => input.handedness === 'left');
    const wristJoint = left?.hand?.get('wrist');
    const wristPose = wristJoint ? frame.getJointPose?.(wristJoint, space) : left?.gripSpace ? frame.getPose(left.gripSpace, space) : null;
    const wrist = wristPose?.transform.position;
    const distance = wrist ? this.offset.set(wrist.x, wrist.y, wrist.z).sub(this.head).length() : 0;
    const dot = distance ? this.offset.dot(this.forward) / distance : 0;
    const lookingAtWrist = distance >= 0.18 && distance <= 0.95 && dot >= wristAngle;
    const lookingAtMenu = panel.visible && this.offset.copy(panel.position).sub(this.head).normalize().dot(this.forward) >= panelAngle;
    this.gesture = { lookingAtWrist, lookingAtMenu, distance, dot };
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
    if (!lookingAtWrist) this.dismissed = false;
    if (!this.dismissed && lookingAtWrist) this.glanceStarted ??= now;
    else this.glanceStarted = null;
    if (lookingAtWrist && !this.dismissed && this.hand.side === 'left' && this.hand.active && this.hand.pinch >= pinchOpen) {
      this.handStarted ??= now;
    } else {
      this.handStarted = null;
    }
    const gestureHold = this.handStarted !== null && now - this.handStarted >= handHold;
    if (!panel.visible && (gestureHold || (this.glanceStarted !== null && now - this.glanceStarted >= glanceDelay))) {
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
    if (lookingAtWrist || lookingAtMenu || this.panelEntity?.hasComponent(Pressed)) this.lastLook = now;
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
    this.offset.y = Math.max(-0.48, Math.min(0.12, this.forward.y + 0.17));
    this.offset.normalize();
    panel.position.copy(head)
      .addScaledVector(this.offset, panelDistance)
      .addScaledVector(this.right, panelSide);
    panel.position.y -= panelDrop;
    panel.lookAt(head);
    this.placeOnOpen = false;
  }
}
