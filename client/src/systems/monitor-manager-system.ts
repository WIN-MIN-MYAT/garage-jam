import { createSystem, loadUIKitMLAsset, PokeInteractable, RayInteractable, Vector3, VisibilityState } from '@iwsdk/core';
import type { UIKitMLAsset } from '@iwsdk/core';
import { emit, garageEvents } from '../events.js';
import { garageState, setWorkMode } from '../garage-state.js';
import { revealAudio } from '../reveal/RevealAudio.js';
import { getStreamRoom, streamSenderUrl } from '../stream-room.js';
import { bindPress, clearUiInput, PanelInput, sendPanelToFront } from '../ui-press.js';
import { pulseGamepads } from '../feedback.js';
import { StreamSystem } from './stream-system.js';

type Page = 'layout' | 'connect';
const streamLabels: Record<string, string> = {
  off: 'Disabled', live: 'Sharing', connecting: 'Connecting', recovering: 'Reconnecting',
  degraded: 'Connection interrupted', 'source-paused': 'Sharing paused', failed: 'Check laptop connection',
};

export class MonitorManagerSystem extends createSystem({}) {
  private panel?: UIKitMLAsset;
  private stream?: StreamSystem;
  private page: Page = 'layout';
  private open = false;

  init() {
    this.stream = this.world.getSystem(StreamSystem) ?? undefined;
    const onOpen = () => this.show('layout');
    const onConnect = () => this.show('connect');
    const onChange = () => { if (this.open) this.refresh(); };
    const onHidden = () => this.hide();
    garageEvents.addEventListener('monitor-manager-open', onOpen);
    garageEvents.addEventListener('stream-guide-open', onConnect);
    garageEvents.addEventListener('monitor-layout', onChange);
    garageEvents.addEventListener('monitor-status', onChange);
    garageEvents.addEventListener('mode-changed', onChange);
    garageEvents.addEventListener('room-hidden', onHidden);
    this.cleanupFuncs.push(this.world.visibilityState.subscribe(state => {
      if (state !== VisibilityState.Visible) this.hide();
    }));
    this.cleanupFuncs.push(() => {
      garageEvents.removeEventListener('monitor-manager-open', onOpen);
      garageEvents.removeEventListener('stream-guide-open', onConnect);
      garageEvents.removeEventListener('monitor-layout', onChange);
      garageEvents.removeEventListener('monitor-status', onChange);
      garageEvents.removeEventListener('mode-changed', onChange);
      garageEvents.removeEventListener('room-hidden', onHidden);
      this.hide();
      this.panel?.dispose();
    });
    void this.createPanel().catch(error => emit('status', 'Monitor panel failed: ' + String(error)));
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
    new PanelInput(panel, () => {});
    const on = (id: string, action: () => void) => bindPress(panel, id, () => {
      pulseGamepads(this.input.xr.gamepads, 0.3, 26);
      revealAudio.playPress(panel);
      action();
    });
    on('mm-close', () => this.hide());
    on('mm-sharing', () => this.show('connect'));
    on('mm-back', () => this.show('layout'));
    on('mm-layout-desk', () => this.stream?.setPreset('desk'));
    on('mm-layout-arc', () => this.stream?.setPreset('arc'));
    on('mm-use-streaming', () => setWorkMode('streaming'));
    for (let index = 0; index < 2; index++) on('mm-monitor-' + (index + 1), () => this.stream?.toggleMonitor(index));
    if (this.open) this.show(this.page);
    if (location.hostname === 'localhost') {
      (window as any).garageMonitorDebug = {
        show: () => this.show('layout'), guide: () => this.show('connect'), hide: () => this.hide(),
        state: () => this.stream?.managerState(),
      };
    }
  }

  private show(page: Page) {
    if (!this.open) emit('monitor-manager-visibility', true);
    this.open = true;
    this.page = page;
    if (!this.panel) return;
    if (!this.panel.visible) {
      const head = this.world.camera.getWorldPosition(new Vector3());
      const forward = this.world.camera.getWorldDirection(new Vector3());
      forward.y = 0;
      if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
      forward.normalize();
      const side = garageState.preferences.dominantHand === 'left' ? 1 : -1;
      this.panel.position.copy(head).addScaledVector(forward, 1).addScaledVector(new Vector3(-forward.z, 0, forward.x), side * 0.38);
      this.panel.position.y -= 0.23;
      this.panel.lookAt(head);
    }
    this.panel.visible = true;
    this.refresh();
  }

  private hide() {
    if (this.open) emit('monitor-manager-visibility', false);
    this.open = false;
    this.stream?.setLayoutEditing(false);
    if (this.panel) this.panel.visible = false;
    clearUiInput();
  }

  private refresh() {
    if (!this.panel) return;
    const state = this.stream?.managerState();
    const editing = this.page === 'layout';
    const streaming = garageState.preferences.mode === 'streaming';
    const set = (id: string, props: object) => this.panel?.getElementById(id)?.setProperties(props);
    this.stream?.setLayoutEditing(editing);
    set('mm-title', { text: editing ? 'Manage monitors' : 'Screen sharing' });
    set('mm-layout', { display: editing ? 'flex' : 'none' });
    set('mm-connect', { display: editing ? 'none' : 'flex' });
    if (!editing) {
      set('mm-address', { text: streamSenderUrl('') });
      set('mm-code', { text: getStreamRoom() });
      return;
    }
    for (let index = 0; index < 2; index++) {
      const monitor = state?.monitors[index];
      set('mm-monitor-' + (index + 1), {
        text: monitor?.enabled ? 'On' : 'Off',
        backgroundColor: monitor?.enabled ? '#ddb396' : '#4c424d',
        color: monitor?.enabled ? '#29232d' : '#f3e5df',
        disabled: !monitor,
      });
      set('mm-state-' + (index + 1), { text: streamLabels[monitor?.state ?? 'off'] ?? 'Ready to share' });
    }
    set('mm-use-streaming', { display: streaming ? 'none' : 'flex' });
    set('mm-placement-note', { display: streaming ? 'flex' : 'none' });
    for (const preset of ['desk', 'arc']) {
      set('mm-layout-' + preset, {
        backgroundColor: state?.preset === preset ? '#6b4d62' : '#39313e',
      });
    }
  }
}
