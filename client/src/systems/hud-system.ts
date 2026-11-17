import { createSystem, InputComponent, UIKitMLAsset, VisibilityState } from '@iwsdk/core';
import { emit, garageEvents } from '../events.js';
import { sendPanelToFront } from '../ui-press.js';
import { slotManager } from './scene-system.js';
import { garageRootsActive, setGarageRootsVisible } from '../garage-visibility.js';
import { garageState } from '../garage-state.js';
import projectOptions from 'virtual:iwsdk-project';

const immersiveVR = ((projectOptions as any).world?.xr?.mode ?? (projectOptions as any).xr?.mode) === 'vr';
const fixedGarage = new URLSearchParams(location.search).get('demo') === '1';

export class HudSystem extends createSystem({}) {
  private passthrough = false;
  private calibrating = false;
  private calibrationClearAlpha = 0;
  private calibrationHudWasVisible = false;
  private revealing = false;
  private shell: any;
  private panel?: UIKitMLAsset;
  private status: any;
  private streams: any;
  private metrics: any;
  private streamDiagnostics: any;
  private roomMeasurements: any;
  private sceneMetrics = 'scene loading';
  private frameCount = 0;
  private lastFrameTime = performance.now();
  init() {
    this.world.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.world.renderer.xr.setReferenceSpaceType('local-floor');
    this.world.renderer.xr.setFramebufferScaleFactor(1);
    this.shell = this.world.getSceneObject('garage-shell');
    this.panel = this.world.getSceneObject<UIKitMLAsset>('garage-hud');
    if (this.panel) sendPanelToFront(this.panel);
    if (garageState.preferences.debugOverlay && this.panel) this.panel.visible = true;
    const enter = this.panel?.getElementById('xr-button');
    const exit = this.panel?.getElementById('exit-button');
    const toggle = this.panel?.getElementById('passthrough-button');
    const sunset = this.panel?.getElementById('sunset-button');
    this.status = this.panel?.getElementById('status');
    this.streams = this.panel?.getElementById('streams');
    this.metrics = this.panel?.getElementById('metrics');
    this.streamDiagnostics = this.panel?.getElementById('stream-diagnostics');
    this.roomMeasurements = this.panel?.getElementById('room-measurements');
    const diagnosticsButton = this.panel?.getElementById('diagnostics-button');
    const scanButton = this.panel?.getElementById('scan-button');
    const manualRoomButton = this.panel?.getElementById('manual-room-button');
    const manualUndoButton = this.panel?.getElementById('manual-undo-button');
    const manualSkipTableButton = this.panel?.getElementById('manual-skip-table-button');
    const roomSpike = new URLSearchParams(location.search).get('roomSpike') === '1';
    if (roomSpike) {
      scanButton?.setProperties({ display: 'flex' });
      manualRoomButton?.setProperties({ display: 'flex' });
      manualUndoButton?.setProperties({ display: 'flex' });
      manualSkipTableButton?.setProperties({ display: 'flex' });
      this.roomMeasurements?.setProperties({ display: 'flex', text: 'MEASURING FLOOR AND TABLE...' });
      this.streams?.setProperties({ display: 'none' });
    }
    const recordButton = this.panel?.getElementById('record-button');
    if (immersiveVR) { toggle?.setProperties({ display: 'none' }); this.status?.setProperties({ text: 'VR mode: use the system passthrough shortcut' }); }
    const onEnter = () => this.world.launchXR();
    const onExit = () => this.world.exitXR();
    const onToggle = () => this.togglePassthrough();
    const onSunset = () => emit('sunset-start');
    const onDiagnostics = () => emit('stream-diagnostics-toggle');
    const onScan = () => emit('room-scan-request');
    const onManual = () => emit('room-manual-start');
    const onUndo = () => emit('room-manual-undo');
    const onSkipTable = () => emit('room-manual-skip-table');
    const onRecord = () => emit('stream-record');
    const onPassthroughToggle = () => this.togglePassthrough();
    enter?.addEventListener('click', onEnter);
    exit?.addEventListener('click', onExit);
    toggle?.addEventListener('click', onToggle);
    sunset?.addEventListener('click', onSunset);
    diagnosticsButton?.addEventListener('click', onDiagnostics);
    scanButton?.addEventListener('click', onScan);
    manualRoomButton?.addEventListener('click', onManual);
    manualUndoButton?.addEventListener('click', onUndo);
    manualSkipTableButton?.addEventListener('click', onSkipTable);
    recordButton?.addEventListener('click', onRecord);
    garageEvents.addEventListener('garage-passthrough-toggle', onPassthroughToggle);
    const onDebugToggle = (event: Event) => {
      if (this.panel) this.panel.visible = (event as CustomEvent<boolean>).detail;
    };
    garageEvents.addEventListener('garage-debug-toggle', onDebugToggle);
    const calibrationPanels = new Set<string>();
    const onCalibration = (event: Event) => {
      if ((event as CustomEvent<boolean>).detail) calibrationPanels.add(event.type);
      else calibrationPanels.delete(event.type);
      const active = calibrationPanels.size > 0;
      if (active === this.calibrating) return;
      if (active) {
        this.calibrationClearAlpha = this.world.renderer.getClearAlpha();
        this.calibrationHudWasVisible = !!this.panel?.visible;
      }
      this.calibrating = active;
      if (this.panel) this.panel.visible = !active && this.calibrationHudWasVisible;
      this.applyPassthrough();
      if (!active && !immersiveVR) this.world.renderer.setClearAlpha(this.calibrationClearAlpha);
    };
    const onRevealStart = () => { this.revealing = true; };
    const onRevealEnd = () => { this.revealing = false; };
    garageEvents.addEventListener('room-manual-active', onCalibration);
    garageEvents.addEventListener('device-marking-active', onCalibration);
    garageEvents.addEventListener('reveal-started', onRevealStart);
    garageEvents.addEventListener('reveal-finished', onRevealEnd);
    garageEvents.addEventListener('garage-reset', onRevealEnd);
    this.cleanupFuncs.push(() => {
      garageEvents.removeEventListener('room-manual-active', onCalibration);
      garageEvents.removeEventListener('device-marking-active', onCalibration);
      garageEvents.removeEventListener('reveal-started', onRevealStart);
      garageEvents.removeEventListener('reveal-finished', onRevealEnd);
      garageEvents.removeEventListener('garage-reset', onRevealEnd);
    });
    this.cleanupFuncs.push(() => { enter?.removeEventListener('click', onEnter); exit?.removeEventListener('click', onExit); toggle?.removeEventListener('click', onToggle); sunset?.removeEventListener('click', onSunset); diagnosticsButton?.removeEventListener('click', onDiagnostics); scanButton?.removeEventListener('click', onScan); manualRoomButton?.removeEventListener('click', onManual); manualUndoButton?.removeEventListener('click', onUndo); manualSkipTableButton?.removeEventListener('click', onSkipTable); recordButton?.removeEventListener('click', onRecord); garageEvents.removeEventListener('garage-passthrough-toggle', onPassthroughToggle); garageEvents.removeEventListener('garage-debug-toggle', onDebugToggle); });
    const onStatus = (event: Event) => this.status?.setProperties({ text: (event as CustomEvent<string>).detail });
    const onStreams = (event: Event) => this.streams?.setProperties({ text: `Monitors: ${(event as CustomEvent<string>).detail}` });
    const onStreamDiagnostics = (event: Event) => this.streamDiagnostics?.setProperties({ text: (event as CustomEvent<string>).detail });
    const onRoomMeasurements = (event: Event) => this.roomMeasurements?.setProperties({ text: (event as CustomEvent<string>).detail });
    const onSlots = (event: Event) => {
      const detail = (event as CustomEvent<{ records: unknown[]; totalTriangles: number; outlineTriangles: number; solverMs?: number }>).detail;
      this.sceneMetrics = `Slots ${detail.records.length} | ${detail.totalTriangles} triangles (${detail.outlineTriangles} ink)${detail.solverMs == null ? '' : ` | solver ${detail.solverMs.toFixed(1)} ms`}`;
    };
    garageEvents.addEventListener('status', onStatus); garageEvents.addEventListener('streams', onStreams); garageEvents.addEventListener('stream-diagnostics', onStreamDiagnostics); garageEvents.addEventListener('room-measurements', onRoomMeasurements); garageEvents.addEventListener('slots', onSlots);
    this.cleanupFuncs.push(() => { garageEvents.removeEventListener('status', onStatus); garageEvents.removeEventListener('streams', onStreams); garageEvents.removeEventListener('stream-diagnostics', onStreamDiagnostics); garageEvents.removeEventListener('room-measurements', onRoomMeasurements); garageEvents.removeEventListener('slots', onSlots); });
    this.cleanupFuncs.push(this.world.visibilityState.subscribe(state => {
      const inXR = state !== VisibilityState.NonImmersive;
      if (inXR) this.world.renderer.xr.setFoveation(1);
      enter?.setProperties({ display: inXR ? 'none' : 'flex' });
      exit?.setProperties({ display: inXR ? 'flex' : 'none' });
      if (!inXR && this.passthrough) this.togglePassthrough();
    }));
  }
  private togglePassthrough() {
    if (immersiveVR) { this.status?.setProperties({ text: 'Use the system passthrough shortcut in VR mode' }); return; }
    if (this.calibrating) return;
    this.passthrough = !this.passthrough;
    this.applyPassthrough();
    emit('garage-passthrough-changed', this.passthrough);
    this.status?.setProperties({ text: this.passthrough ? 'Passthrough: look at your keyboard' : 'Garage view restored' });
  }
  private applyPassthrough() {
    if (immersiveVR) return;
    const visible = !this.passthrough && !this.calibrating;
    if (this.shell) this.shell.visible = visible && fixedGarage && !garageRootsActive();
    slotManager.setVisible(visible);
    setGarageRootsVisible(visible);
    this.world.renderer.setClearColor(0x000000, visible ? 1 : 0);
  }
  update() {
    const left = this.input.xr.gamepads.left, right = this.input.xr.gamepads.right;
    if (!this.revealing && (left?.getButtonDown(InputComponent.Y_Button) || right?.getButtonDown(InputComponent.B_Button))) this.togglePassthrough();
    if (++this.frameCount >= 72) {
      const now = performance.now(); const fps = Math.round(1000 * this.frameCount / (now - this.lastFrameTime));
      const render = this.world.renderer.info.render;
      const frameMs = (now - this.lastFrameTime) / this.frameCount;
      this.metrics?.setProperties({ text: `XR loop ${fps} FPS / ${frameMs.toFixed(1)} ms | ${render.triangles} tri | ${render.calls} calls | ${this.sceneMetrics}` });
      this.frameCount = 0; this.lastFrameTime = now;
    }
  }
}
