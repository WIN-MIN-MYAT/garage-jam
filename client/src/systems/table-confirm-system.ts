import { createSystem, loadUIKitMLAsset, PokeInteractable, RayInteractable, Vector3 } from '@iwsdk/core';
import type { UIKitMLAsset } from '@iwsdk/core';
import { emit, garageEvents } from '../events.js';
import { formatLength, formatSize, garageState, saveLastRoom, savePreferences } from '../garage-state.js';
import { bindPress, sendPanelToFront } from '../ui-press.js';
import { isProductEntry } from '../app-flow/app-flow.js';
import { GarageBuildSystem } from './garage-build-system.js';
import { revealAudio } from '../reveal/RevealAudio.js';

export class TableConfirmSystem extends createSystem({}) {
  private panel?: UIKitMLAsset;
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
      const on = (id: string, handler: () => void) => bindPress(panel, id, () => {
        if (id === 'yep-button') revealAudio.playTableStamp();
        else revealAudio.playPress();
        handler();
      });
      on('height-minus', () => this.adjust(-0.005));
      on('height-plus', () => this.adjust(0.005));
      on('touch-table', () => {
        this.touchMode = true;
        this.triggerWasDown = true;
        emit('status', 'Touch the table top with the controller tip, then pull the trigger');
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
      on('fix-button', () => {
        emit('status', 'Use + / - or TOUCH TABLE to fix the table height');
        panel.getElementById('table-tip')?.setProperties({ text: 'Touch the real tabletop with the controller tip for an exact height.' });
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

  private positionPanel(info: NonNullable<ReturnType<GarageBuildSystem['getTableInfo']>>) {
    if (!this.panel) return;
    const room = garageState.room;
    if (!room?.table) return;
    const points = room.table.polygon;
    const center = points.reduce((sum, point) => ({ x: sum.x + point.x / points.length, z: sum.z + point.z / points.length }), { x: 0, z: 0 });
    const dx = room.seat.x - center.x, dz = room.seat.z - center.z;
    const length = Math.hypot(dx, dz) || 1;
    const right = { x: dz / length, z: -dx / length };
    const offset = info.width / 2 + 0.16;
    this.panel.position.set(
      center.x + right.x * offset + (dx / length) * 0.08,
      info.topY + 0.28,
      center.z + right.z * offset + (dz / length) * 0.08,
    );
    this.panel.lookAt(new Vector3(room.seat.x, info.topY + 1.05, room.seat.z));
  }

  private renderContent(info: NonNullable<ReturnType<GarageBuildSystem['getTableInfo']>>) {
    const panel = this.panel;
    if (!panel) return;
    panel.getElementById('table-height')?.setProperties({ text: formatLength(info.height, info.units) });
    panel.getElementById('table-size')?.setProperties({ text: `Table top ${formatSize(info.width, info.depth, info.units)}` });
    panel.getElementById('table-room')?.setProperties({ text: `Room ${formatSize(info.roomWidth, info.roomDepth, info.units)}` });
    const warn = info.height < 0.55 || info.height > 1.2;
    panel.getElementById('table-warning')?.setProperties({ display: warn ? 'flex' : 'none', text: warn ? 'WARNING: CHECK TABLE HEIGHT (55–120 cm)' : '' });
    panel.getElementById('table-tip')?.setProperties({ display: garageState.preferences.clearTableTipShown ? 'none' : 'flex' });
  }

  private show() {
    if (!this.panel || !this.builder) return;
    const info = this.builder.getTableInfo();
    if (!info) return;
    this.positionPanel(info);
    if (!this.panel.visible) revealAudio.playPanel();
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
    emit('table-confirm-visibility', false);
    this.touchMode = false;
  }

  private refresh() {
    if (!this.panel || !this.builder) return;
    const info = this.builder.getTableInfo();
    if (!info) return;
    this.renderContent(info);
    if (this.panel.visible) this.positionPanel(info);
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
      if (pressed && !this.triggerWasDown) {
        this.builder.setTableHeight(pose.transform.position.y);
        this.touchMode = false;
        this.triggerWasDown = true;
        emit('status', `Table height set from controller tip: ${(pose.transform.position.y * 100).toFixed(1)} cm`);
      }
      this.triggerWasDown = pressed;
    }
  }
}
