import { createSystem, loadUIKitMLAsset, PokeInteractable, RayInteractable, Vector3 } from '@iwsdk/core';
import type { UIKitMLAsset } from '@iwsdk/core';
import { emit, garageEvents } from '../events.js';
import { revealAudio } from '../reveal/RevealAudio.js';
import { bindPress, PanelInput, sendPanelToFront } from '../ui-press.js';
import { StreamSystem } from './stream-system.js';

const presets = ['arc', 'table', 'stacked', 'ultrawide', 'free'] as const;

export class MonitorManagerSystem extends createSystem({}) {
  private panel?: UIKitMLAsset;
  private stream?: StreamSystem;
  private open = false;

  init() {
    this.stream = this.world.getSystem(StreamSystem) ?? undefined;
    const onOpen = () => this.show();
    const onLayout = () => { if (this.open) this.refresh(); };
    garageEvents.addEventListener('monitor-manager-open', onOpen);
    garageEvents.addEventListener('monitor-layout', onLayout);
    this.cleanupFuncs.push(() => {
      garageEvents.removeEventListener('monitor-manager-open', onOpen);
      garageEvents.removeEventListener('monitor-layout', onLayout);
      this.panel?.dispose();
    });
    void this.createPanel().catch(error => emit('status', `Monitor panel failed: ${String(error)}`));
  }

  private async createPanel() {
    const panel = await loadUIKitMLAsset('/ui/monitor-manager.uikitml', { kit: 'horizon', preferredColorScheme: 'dark' });
    panel.name = 'Monitor manager panel';
    panel.scale.setScalar(0.09);
    panel.visible = false;
    sendPanelToFront(panel);
    const entity = this.world.createTransformEntity(panel, { persistent: true });
    entity.addComponent(RayInteractable, {});
    entity.addComponent(PokeInteractable, {});
    this.panel = panel;
    new PanelInput(panel, () => { /* keep open while pressed */ });
    const on = (id: string, action: () => void) => bindPress(panel, id, () => { revealAudio.playPress(); action(); });
    on('mm-close', () => this.hide());
    for (let index = 0; index < 3; index++) on(`mm-monitor-${index + 1}`, () => this.emit('monitor-select', { index }));
    on('mm-preset', () => {
      const state = this.stream?.managerState();
      const index = presets.indexOf((state?.preset ?? 'arc') as typeof presets[number]);
      this.emit('monitor-preset', { preset: presets[(index + 1) % presets.length] });
    });
    on('mm-curve-down', () => this.emit('monitor-curve', { delta: -0.08 }));
    on('mm-curve-up', () => this.emit('monitor-curve', { delta: 0.08 }));
    on('mm-width-down', () => this.emit('monitor-resize', { dw: -0.06, dh: 0 }));
    on('mm-width-up', () => this.emit('monitor-resize', { dw: 0.06, dh: 0 }));
    on('mm-height-down', () => this.emit('monitor-resize', { dw: 0, dh: -0.06 }));
    on('mm-height-up', () => this.emit('monitor-resize', { dw: 0, dh: 0.06 }));
    on('mm-lock', () => this.emit('monitor-lock'));
    on('mm-recenter', () => this.emit('monitor-preset', { preset: 'arc' }));
    on('mm-save', () => { this.emit('monitor-save'); emit('monitor-layout', this.stream?.managerState()); });
    this.refresh();
    if (location.hostname === 'localhost') (window as any).garageMonitorDebug = { show: () => this.show(), hide: () => this.hide(), state: () => this.stream?.managerState() };
  }

  private emit(type: string, detail?: unknown) {
    garageEvents.dispatchEvent(new CustomEvent(type, { detail }));
  }

  private show() {
    if (!this.panel) return;
    this.open = true;
    this.panel.visible = true;
    const head = this.world.camera.getWorldPosition(new Vector3());
    const forward = this.world.camera.getWorldDirection(new Vector3());
    forward.y = 0;
    if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
    forward.normalize();
    const side = garageStateSide();
    this.panel.position.copy(head).addScaledVector(forward, 0.92).addScaledVector(new Vector3(-forward.z, 0, forward.x), side * 0.26);
    this.panel.position.y += 0.02;
    this.panel.lookAt(head);
    this.refresh();
  }

  private hide() {
    this.open = false;
    if (this.panel) this.panel.visible = false;
  }

  private refresh() {
    if (!this.panel) return;
    const state = this.stream?.managerState();
    if (!state) return;
    const set = (id: string, props: object) => this.panel?.getElementById(id)?.setProperties(props);
    for (let index = 0; index < 3; index++) {
      set(`mm-monitor-${index + 1}`, {
        backgroundColor: state.selected === index ? '#e8ff70' : '#263243',
        color: state.selected === index ? '#161a22' : '#ebf3fe',
        display: index < state.count ? 'flex' : 'none',
      });
    }
    set('mm-status', { text: `Monitor ${state.selected + 1} / ${String(state.preset).toUpperCase()} / ${state.locked ? 'LOCKED' : 'UNLOCKED'}` });
    set('mm-preset', { text: `PRESET: ${String(state.preset).toUpperCase()}` });
    set('mm-lock', { text: `LOCK: ${state.locked ? 'ON' : 'OFF'}` });
  }
}

function garageStateSide() {
  try { return JSON.parse(localStorage.getItem('garage-jam-preferences-v1') || '{}').dominantHand === 'left' ? 1 : -1; }
  catch { return -1; }
}
