import { createSystem, loadUIKitMLAsset, PokeInteractable, Quaternion, Ray, RayInteractable, Vector3 } from '@iwsdk/core';
import type { UIKitMLAsset } from '@iwsdk/core';
import { emit, garageEvents } from '../events.js';
import { formatLength, formatSize, garageState, savePreferences } from '../garage-state.js';
import { bindPress, clearUiInput, PanelInput, sendPanelToFront } from '../ui-press.js';
import { pulseGamepads } from '../feedback.js';
import { isProductEntry } from '../app-flow/app-flow.js';
import { GarageBuildSystem } from './garage-build-system.js';
import { revealAudio } from '../reveal/RevealAudio.js';

export class TableConfirmSystem extends createSystem({}) {
  private panel?: UIKitMLAsset;
  private panelInput?: PanelInput;
  private touchRay = new Ray();
  private touchRotation = new Quaternion();
  private builder?: GarageBuildSystem;
  private touchMode = false;
  private triggerWasDown = false;
  private showTimer?: number;
  private stopFrame?: () => void;
  private markingOutline = false;

  init() {
    this.builder = this.world.getSystem(GarageBuildSystem) ?? undefined;
    const onBuilt = () => { if (!isProductEntry && this.builder?.isRevealed()) this.show(); };
    const onRevealed = () => { if (!isProductEntry) this.show(); };
    const onTableUpdated = () => this.refresh();
    const onShow = () => this.show();
    const onHide = () => this.hide();
    const onConfirmed = () => this.hide();
    const onCalibrationEnd = (event: Event) => {
      if (!this.markingOutline) return;
      this.markingOutline = false;
      if (!(event as CustomEvent<{ saved: boolean }>).detail.saved && this.world.session) this.show();
    };
    garageEvents.addEventListener('garage-built', onBuilt);
    garageEvents.addEventListener('garage-revealed', onRevealed);
    garageEvents.addEventListener('table-updated', onTableUpdated);
    garageEvents.addEventListener('table-view-changed', onTableUpdated);
    garageEvents.addEventListener('table-confirm-refresh', onTableUpdated);
    garageEvents.addEventListener('table-confirm-show', onShow);
    garageEvents.addEventListener('table-confirm-hide', onHide);
    garageEvents.addEventListener('table-confirmed', onConfirmed);
    garageEvents.addEventListener('room-manual-ended', onCalibrationEnd);
    this.stopFrame = this.world.onXRFrame(frame => this.watchTouch(frame));
    this.cleanupFuncs.push(() => {
      if (this.showTimer != null) window.clearTimeout(this.showTimer);
      this.stopFrame?.();
      garageEvents.removeEventListener('garage-built', onBuilt);
      garageEvents.removeEventListener('garage-revealed', onRevealed);
      garageEvents.removeEventListener('table-updated', onTableUpdated);
      garageEvents.removeEventListener('table-view-changed', onTableUpdated);
      garageEvents.removeEventListener('table-confirm-refresh', onTableUpdated);
      garageEvents.removeEventListener('table-confirm-show', onShow);
      garageEvents.removeEventListener('table-confirm-hide', onHide);
      garageEvents.removeEventListener('table-confirmed', onConfirmed);
      garageEvents.removeEventListener('room-manual-ended', onCalibrationEnd);
      this.panel?.dispose();
    });
    void this.createPanel();
  }

  private async createPanel() {
    try {
      const panel = await loadUIKitMLAsset('/ui/table-confirm.uikitml', { kit: 'horizon', preferredColorScheme: 'dark' });
      panel.name = 'Table confirm panel';
      panel.scale.setScalar(0.09);
      panel.visible = false;
      sendPanelToFront(panel);
      const entity = this.world.createTransformEntity(panel, { persistent: true });
      entity.addComponent(RayInteractable, {});
      entity.addComponent(PokeInteractable, {});
      panel.visible = false;
      this.panel = panel;
      this.panelInput = new PanelInput(panel);
      const on = (id: string, handler: () => void) => bindPress(panel, id, () => {
        pulseGamepads(this.input.xr.gamepads, 0.3, 26);
        if (id === 'yep-button') revealAudio.playTableStamp(panel);
        else revealAudio.playPress(panel);
        handler();
      });
      on('height-minus', () => this.adjust(-0.005));
      on('height-plus', () => this.adjust(0.005));
      on('touch-table', () => {
        this.touchMode = !this.touchMode;
        this.triggerWasDown = true;
        this.refresh();
      });
      on('shape-check', () => {
        this.markingOutline = true;
        this.hide();
        emit('room-manual-start', { mode: 'table' });
      });
      on('view-workbench', () => this.builder?.setTableView('workbench'));
      on('view-real', () => this.builder?.setTableView('real'));
      on('yep-button', () => {
        this.builder?.confirmTable();
        this.hide();
      });
      if (location.hostname === 'localhost') {
        (window as any).garageTableDebug = {
          panel,
          show: () => this.show(),
          hide: () => this.hide(),
          adjust: (delta: number) => this.adjust(delta),
        };
      }
      if (!isProductEntry && this.builder?.isRevealed()) this.show();
    } catch (error) {
      emit('status', `Table panel failed: ${String(error)}`);
      console.warn('[table-confirm]', error);
    }
  }

  private adjust(delta: number) {
    const info = this.builder?.getTableInfo();
    if (info && this.builder) this.builder.setTableHeight(info.topY + delta);
  }

  private positionPanel() {
    if (!this.panel) return;
    const head = this.world.camera.getWorldPosition(new Vector3());
    const direction = this.world.camera.getWorldDirection(new Vector3());
    const forward = new Vector3(direction.x, 0, direction.z);
    if (forward.lengthSq() < 0.001) forward.set(0, 0, -1);
    forward.normalize();
    const side = garageState.preferences.dominantHand === 'left' ? 0.33 : -0.33;
    this.panel.position.copy(head).addScaledVector(forward, 1)
      .addScaledVector(new Vector3(-forward.z, 0, forward.x), side);
    this.panel.position.y += Math.max(-0.33, Math.min(0.06, direction.y * 0.42 - 0.12));
    this.panel.lookAt(head);
  }

  private renderContent(info: NonNullable<ReturnType<GarageBuildSystem['getTableInfo']>>) {
    const panel = this.panel;
    if (!panel) return;
    panel.getElementById('table-height')?.setProperties({ text: formatLength(info.height, info.units) });
    panel.getElementById('table-size')?.setProperties({ text: `Surface ${formatSize(info.width, info.depth, info.units)}` });
    panel.getElementById('table-room')?.setProperties({ text: `Room ${formatSize(info.roomWidth, info.roomDepth, info.units)}` });
    panel.getElementById('height-minus')?.setProperties({ text: `-${formatLength(0.005, info.units)}` });
    panel.getElementById('height-plus')?.setProperties({ text: `+${formatLength(0.005, info.units)}` });
    panel.getElementById('touch-table')?.setProperties({ text: this.touchMode ? 'Cancel touch' : 'Touch tabletop' });
    panel.getElementById('table-touch-guide')?.setProperties({ display: this.touchMode ? 'flex' : 'none' });
    for (const [view, id] of [['workbench', 'view-workbench'], ['real', 'view-real']] as const) {
      const selected = info.tableView === view;
      panel.getElementById(id)?.setProperties({
        backgroundColor: selected ? '#30483f' : '#403644',
        color: selected ? '#c3efdf' : '#f9e9e3',
      });
    }
    const warn = info.height < 0.55 || info.height > 1.2;
    panel.getElementById('table-warning')?.setProperties({ display: warn ? 'flex' : 'none', text: warn ? 'This height is unusual. Check that the surface meets your tabletop.' : '' });
    panel.getElementById('table-tip')?.setProperties({ display: info.tableView === 'workbench' && !garageState.preferences.clearTableTipShown ? 'flex' : 'none' });
  }

  private show() {
    if (!this.panel || !this.builder) return;
    const info = this.builder.getTableInfo();
    if (!info) return;
    this.positionPanel();
    if (!this.panel.visible) revealAudio.playPanel(this.panel);
    this.panel.visible = true;
    emit('table-confirm-visibility', true);
    this.renderContent(info);
    if (!garageState.preferences.clearTableTipShown) {
      garageState.preferences = { ...garageState.preferences, clearTableTipShown: true };
      savePreferences();
    }
  }

  private hide() {
    if (this.panel) this.panel.visible = false;
    clearUiInput();
    emit('table-confirm-visibility', false);
    this.touchMode = false;
  }

  private refresh() {
    if (!this.panel || !this.builder) return;
    const info = this.builder.getTableInfo();
    if (!info) return;
    this.renderContent(info);
  }

  private watchTouch(frame: XRFrame) {
    if (!this.touchMode || !this.builder || !this.world.session) return;
    const referenceSpace = this.world.renderer.xr.getReferenceSpace();
    if (!referenceSpace) return;
    for (const source of this.world.session.inputSources) {
      if (source.handedness !== garageState.preferences.dominantHand || !source.gamepad || !source.targetRaySpace) continue;
      const pose = frame.getPose(source.targetRaySpace, referenceSpace);
      if (!pose) continue;
      const pressed = source.gamepad.buttons[0]?.pressed ?? false;
      const newPress = pressed && !this.triggerWasDown;
      this.triggerWasDown = pressed;
      if (newPress) {
        const { position, orientation } = pose.transform;
        this.touchRay.origin.set(position.x, position.y, position.z);
        this.touchRay.direction.set(0, 0, -1).applyQuaternion(
          this.touchRotation.set(orientation.x, orientation.y, orientation.z, orientation.w),
        );
        const parent = this.world.camera.parent;
        if (parent) {
          parent.updateWorldMatrix(true, false);
          this.touchRay.applyMatrix4(parent.matrixWorld);
        }
        if (this.panelInput?.owns(this.touchRay)) continue;
        this.touchMode = false;
        pulseGamepads(this.input.xr.gamepads, 0.32, 24);
        this.builder.setTableHeight(pose.transform.position.y);
        this.refresh();
      }
    }
  }
}
