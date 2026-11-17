import { createSystem, loadUIKitMLAsset, PokeInteractable, RayInteractable, Vector3, VisibilityState } from '@iwsdk/core';
import type { UIKitMLAsset } from '@iwsdk/core';
import { emit, garageEvents } from '../events.js';
import { garageState, loadLastRoom, saveLastRoom, setPreference } from '../garage-state.js';
import { GarageBuildSystem } from './garage-build-system.js';
import {
  describeLastRoom, flowDebug, isProductEntry, loadFlow, needsTableConfirm, resetFlow, resumeAvailable, revealModeFor, saveFlow,
  type AppStage, type FlowSave, type RevealMode,
} from '../app-flow/app-flow.js';
import {
  hideLanding, landingVisible, onEnter, onRecheck, refreshCapabilities, renderLanding, setLandingBusy, showEntering,
  showLanding, showLandingError,
} from '../app-flow/landing-page.js';
import { revealAudio } from '../reveal/RevealAudio.js';
import { showComicWord } from '../comic-word.js';
import { bindPress, sendPanelToFront } from '../ui-press.js';
import type { RoomModel } from '../room-model.js';
import type { ScanInfo } from '../room-scan.js';

type PanelPage = 'scan' | 'mode' | 'devices' | 'pairing' | 'ready';

const stageOrder: AppStage[] = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9a', 'S9b', 'S10', 'S11'];

export class AppFlowSystem extends createSystem({}) {
  private builder?: GarageBuildSystem;
  private panel?: UIKitMLAsset;
  private stage: AppStage = 'S0';
  private flow: FlowSave = loadFlow();
  private resume = false;
  private resumeStage: AppStage = 'S0';
  private resumeDirectToLive = false;
  private sessionWasVisible = false;
  private enterTimeout?: number;
  private live = false;
  private panelReady = false;
  private lastScanProgress = 0;
  private showedScanLock = false;
  private scanMissing = false;
  private revealHandled = false;
  private markTableAfterBuild = false;

  init() {
    this.builder = this.world.getSystem(GarageBuildSystem) ?? undefined;
    this.flow = loadFlow();
    this.resume = resumeAvailable();
    onEnter(() => this.enter());
    onRecheck(() => { void refreshCapabilities(); });
    renderLanding({ resume: this.resume, roomSummary: describeLastRoom(loadLastRoom()) });
    void this.createPanel();

    const onBuilt = () => this.onGarageBuilt();
    const onRevealed = () => this.onGarageRevealed();
    const onTableConfirmed = () => this.chooseTableDone();
    const onScanProgress = (event: Event) => this.onScanProgress((event as CustomEvent).detail);
    const onScanMissing = () => this.onScanMissing();
    const onTrackingPending = () => {
      if (this.stage !== 'S2') return;
      this.showScanChoices(false);
      this.scanTitle('WAITING FOR POSITION TRACKING');
      this.scanBody('The headset is not giving the browser a tracked position. Hold still and look at the room.');
      this.panel?.getElementById('scan-detail')?.setProperties({ text: 'Waiting for a tracked headset pose' });
    };
    const onManualSaved = (event: Event) => {
      if (this.stage === 'S3') this.startManualBuild((event as CustomEvent<RoomModel>).detail);
    };
    const onManualEnded = (event: Event) => {
      const { saved, mode } = (event as CustomEvent<{ saved: boolean; mode: 'room' | 'table' }>).detail;
      if (saved || !this.sessionWasVisible) return;
      if (mode === 'table' && this.stage === 'S7' && !garageState.room?.table) this.chooseTableDone();
      if (this.stage !== 'S3') return;
      this.setStage('S2');
      this.refreshScanPage();
      this.builder?.beginRoomScan();
    };
    const onRescan = () => this.rescan();
    const onSpaceReset = () => { if (this.sessionWasVisible) this.rescan(true); };
    const onRevealStarted = (event: Event) => {
      if ((event as CustomEvent<{ mode: RevealMode }>).detail.mode !== 'props' && this.stage !== 'S6') this.setStage('S6');
    };
    const onRevealFinished = () => { if (this.stage === 'S6') this.onGarageRevealed(); };
    const onDevicesDone = () => { if (this.stage === 'S9a') this.goLive(); };
    const onDevicesCancelled = () => {
      if (this.stage === 'S9a') {
        this.setStage('S9a');
        this.showPage('devices');
      }
    };
    const onStreams = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      this.panel?.getElementById('flow-monitor-status')?.setProperties({ text: `Monitors: ${detail || 'waiting for sender'}` });
    };
    garageEvents.addEventListener('garage-built', onBuilt);
    garageEvents.addEventListener('garage-revealed', onRevealed);
    garageEvents.addEventListener('table-confirmed', onTableConfirmed);
    garageEvents.addEventListener('scan-progress', onScanProgress);
    garageEvents.addEventListener('room-scan-missing', onScanMissing);
    garageEvents.addEventListener('room-tracking-pending', onTrackingPending);
    garageEvents.addEventListener('room-manual-saved', onManualSaved);
    garageEvents.addEventListener('room-manual-ended', onManualEnded);
    garageEvents.addEventListener('app-flow-rescan', onRescan);
    garageEvents.addEventListener('garage-space-reset', onSpaceReset);
    garageEvents.addEventListener('reveal-started', onRevealStarted);
    garageEvents.addEventListener('reveal-finished', onRevealFinished);
    garageEvents.addEventListener('device-marking-done', onDevicesDone);
    garageEvents.addEventListener('device-marking-cancelled', onDevicesCancelled);
    garageEvents.addEventListener('streams', onStreams);
    const stopVisibility = this.world.visibilityState.subscribe(state => {
      const visible = state === VisibilityState.Visible || state === VisibilityState.VisibleBlurred;
      if (visible && !this.sessionWasVisible) {
        this.sessionWasVisible = true;
        this.onSessionVisible();
      } else if (state === VisibilityState.NonImmersive && this.sessionWasVisible) {
        this.sessionWasVisible = false;
        this.onSessionHidden();
      }
    });
    this.cleanupFuncs.push(() => {
      garageEvents.removeEventListener('garage-built', onBuilt);
      garageEvents.removeEventListener('garage-revealed', onRevealed);
      garageEvents.removeEventListener('table-confirmed', onTableConfirmed);
      garageEvents.removeEventListener('scan-progress', onScanProgress);
      garageEvents.removeEventListener('room-scan-missing', onScanMissing);
      garageEvents.removeEventListener('room-tracking-pending', onTrackingPending);
      garageEvents.removeEventListener('room-manual-saved', onManualSaved);
      garageEvents.removeEventListener('room-manual-ended', onManualEnded);
      garageEvents.removeEventListener('app-flow-rescan', onRescan);
      garageEvents.removeEventListener('garage-space-reset', onSpaceReset);
      garageEvents.removeEventListener('reveal-started', onRevealStarted);
      garageEvents.removeEventListener('reveal-finished', onRevealFinished);
      garageEvents.removeEventListener('device-marking-done', onDevicesDone);
      garageEvents.removeEventListener('device-marking-cancelled', onDevicesCancelled);
      garageEvents.removeEventListener('streams', onStreams);
      stopVisibility();
      if (this.enterTimeout != null) window.clearTimeout(this.enterTimeout);
      this.panel?.dispose();
    });

    if (location.hostname === 'localhost') {
      const thisSystem = this;
      (window as any).garageFlowDebug = {
        get stage() { return thisSystem.stage; },
        get resume() { return thisSystem.resume; },
        get live() { return thisSystem.live; },
        get panel() { return thisSystem.panel; },
        enter: () => thisSystem.enter(),
        setStage: (stage: AppStage) => thisSystem.setStage(stage),
        manual: () => thisSystem.beginManual(),
        scanMissing: () => thisSystem.onScanMissing(),
        chooseMode: (mode: 'passthrough' | 'streaming') => thisSystem.chooseMode(mode),
        rescan: () => thisSystem.rescan(),
        resumeAvailable: () => resumeAvailable(),
        resumeDebug: () => {
          const flow = loadFlow();
          const room = loadLastRoom();
          return { flow, room: room ? { source: room.source, walls: room.walls?.length, polygon: room.floor?.polygon?.length, table: !!room.table } : null };
        },
        refreshLanding: () => { void refreshCapabilities(); },
        flow: () => thisSystem.flow,
      };
    }
  }

  private enter() {
    if (this.world.session) return;
    const saved = loadFlow();
    this.resume = resumeAvailable();
    this.resumeStage = saved.stage;
    this.resumeDirectToLive = saved.completed.includes('S10') || saved.stage === 'S10' || saved.stage === 'S11';
    this.flow = { ...this.flow, lastEnteredAt: Date.now() };
    saveFlow(this.flow);
    const mode: RevealMode = this.resume ? 'quick' : revealModeFor();
    emit('reveal-request', { mode });
    setLandingBusy(true);
    showEntering();
    revealAudio.unlock().then(() => revealAudio.playWhoosh(true)).catch(() => { /* audio is optional */ });
    this.setStage('S1', false);
    try {
      this.world.launchXR();
    } catch (error) {
      setLandingBusy(false);
      showLanding();
      showLandingError(`Could not start the mixed-reality session: ${String(error)}`);
      return;
    }
    this.enterTimeout = window.setTimeout(() => {
      if (!this.world.session) {
        setLandingBusy(false);
        showLanding();
        showLandingError('Seems the headset did not take over. Check that this page is open in Quest Browser and allow the room-data prompt.');
      }
    }, 12000);
  }

  private onSessionVisible() {
    if (this.enterTimeout != null) window.clearTimeout(this.enterTimeout);
    this.enterTimeout = undefined;
    hideLanding();
    setLandingBusy(false);
    void revealAudio.unlock().catch(() => { /* audio is optional */ });
    this.lastScanProgress = 0;
    this.showedScanLock = false;
    this.scanMissing = false;
    this.revealHandled = false;
    this.markTableAfterBuild = false;
    this.setStage('S2');
    this.placePanel('scan');
    this.refreshScanPage();
    this.builder?.beginRoomScan();
  }

  private onSessionHidden() {
    if (this.stage === 'S1') {
      setLandingBusy(false);
      showLanding();
      return;
    }
    const completed = this.flow.completed.includes('S10') ? this.flow.completed : [...this.flow.completed];
    if (this.live && !completed.includes('S10')) completed.push('S10');
    this.flow = { ...this.flow, stage: this.live ? 'S11' : this.stage, completed, lastExitAt: Date.now() };
    saveFlow(this.flow);
    this.setStage('S11', false);
    this.panel && (this.panel.visible = false);
    emit('table-confirm-hide');
    this.builder?.resetForRescan(false);
    this.resume = resumeAvailable();
    this.resumeStage = this.flow.stage;
    this.resumeDirectToLive = completed.includes('S10') || this.flow.stage === 'S10' || this.flow.stage === 'S11';
    renderLanding({ resume: this.resume, roomSummary: describeLastRoom(loadLastRoom()) });
  }

  private onGarageBuilt() {
    if (this.builder?.isRevealed()) {
      this.onGarageRevealed();
      return;
    }
    if (this.stage === 'S2' || this.stage === 'S3' || this.stage === 'S5' || this.stage === 'S11') this.setStage('S6');
    this.scanMissing = false;
  }

  private onGarageRevealed() {
    if (this.revealHandled) return;
    this.revealHandled = true;
    const room = garageState.room;
    this.live = false;
    if (this.markTableAfterBuild && room && !room.table) {
      this.markTableAfterBuild = false;
      this.setStage('S7');
      emit('room-manual-start', { mode: 'table' });
    } else if ((this.resume && room?.table) || needsTableConfirm(room, garageState.preferences)) {
      this.setStage('S7');
      this.hidePanel();
      emit('table-confirm-show');
    } else if (this.resumeDirectToLive) {
      this.goLive();
    } else if (this.resume && (this.resumeStage === 'S8' || this.resumeStage === 'S9a' || this.resumeStage === 'S9b')) {
      this.setStage(this.resumeStage);
    } else {
      this.setStage('S8');
    }
  }

  private chooseTableDone() {
    if (this.stage !== 'S7') return;
    if (this.resumeDirectToLive) this.goLive();
    else if (this.resume && (this.resumeStage === 'S8' || this.resumeStage === 'S9a' || this.resumeStage === 'S9b')) this.setStage(this.resumeStage);
    else this.setStage('S8');
  }

  private chooseMode(mode: 'passthrough' | 'streaming') {
    setPreference('mode', mode);
    emit('mode-changed', mode);
    this.setStage(mode === 'passthrough' ? 'S9a' : 'S9b');
  }

  private goLive() {
    this.live = true;
    this.setStage('S10');
    this.showPage('ready');
    this.placePanel('ready');
    emit('status', 'Garage live');
  }

  private onScanProgress(detail: { info?: ScanInfo; progress?: number; needsChoice?: boolean }) {
    if (!detail?.info) return;
    this.lastScanProgress = detail.progress ?? 0;
    const progress = this.panel?.getElementById('scan-progress');
    progress?.setProperties({ text: `${detail.progress ?? 0} / 3` });
    const width = detail.info.floorSize?.[0]?.toFixed(1) ?? '?';
    const depth = detail.info.floorSize?.[1]?.toFixed(1) ?? '?';
    const table = detail.info.tableTopY != null ? `${((detail.info.tableTopY - detail.info.floorY) * 100).toFixed(0)} cm table` : 'table pending';
    const detailText = this.panel?.getElementById('scan-detail');
    detailText?.setProperties({ text: `FLOOR ${width} x ${depth} M / ${detail.info.planeCount} PLANES / ${table}` });
    this.showScanChoices(!!detail.needsChoice, detail.info.tableTopY != null);
    if (detail.needsChoice) {
      this.scanTitle(detail.info.tableTopY != null ? 'CHECK THE TABLE OUTLINE' : 'CHOOSE YOUR TABLE');
      this.scanBody(detail.info.tableCandidateCount
        ? 'Look down at the tabletop you want. Use it when the outline turns yellow, or mark its corners.'
        : 'Quest Browser has a floor for this room. You can mark just the tabletop.');
    } else if ((detail.progress ?? 0) >= 2) {
      this.scanTitle('ROOM LOCKED');
      this.scanBody('Hold still for a moment while the garage is measured.');
      if (!this.showedScanLock) {
        revealAudio.playGameplay('setup_lock', this.panel?.getWorldPosition(new Vector3()));
        showComicWord('KLIK.');
      }
      this.showedScanLock = true;
    }
  }

  private onScanMissing() {
    this.scanMissing = true;
    this.showScanChoices(false);
    this.scanTitle('NO ROOM SCAN FOUND');
    this.scanBody('Space Setup gives us the real floor, walls and table. Or mark the room by touching four corners.');
    this.panel?.getElementById('scan-progress')?.setProperties({ text: '—' });
    this.panel?.getElementById('scan-detail')?.setProperties({ text: 'Space Setup is optional; the touch path works without it.' });
    this.showPage('scan');
    this.placePanel('scan');
  }

  private beginManual() {
    this.builder?.cancelRoomScan();
    this.scanMissing = false;
    this.setStage('S3');
    emit('room-manual-start');
    emit('status', 'Manual room: touch the floor corners with the controller tip');
  }

  private startManualBuild(room: RoomModel) {
    this.revealHandled = false;
    this.setStage('S5');
    this.showPage('scan');
    this.scanTitle('ROOM SAVED');
    this.scanBody('Building the garage at your measured table height…');
    this.panel?.getElementById('scan-progress')?.setProperties({ text: '3 / 3' });
    this.builder?.startFromManualRoom(room);
  }

  private rescan(realign = false) {
    this.showedScanLock = false;
    this.resumeDirectToLive = this.stage === 'S10' || this.resumeDirectToLive;
    this.resume = realign && this.resumeDirectToLive;
    this.revealHandled = false;
    this.markTableAfterBuild = false;
    if (!realign) {
      resetFlow();
      this.flow = loadFlow();
    }
    this.live = false;
    emit('table-confirm-hide');
    this.builder?.resetForRescan();
    this.setStage('S2');
    emit('room-manual-cancel');
    this.showPage('scan');
    this.placePanel('scan');
    this.scanTitle(realign ? 'REALIGNING THE ROOM' : 'GETTING THE ROOM');
    this.scanBody(realign ? 'The headset changed its tracking origin. Checking the live room again.' : 'Look around slowly. Keep your table in view.');
    this.showScanChoices(false);
    this.panel?.getElementById('scan-progress')?.setProperties({ text: '0 / 3' });
    this.panel?.getElementById('scan-detail')?.setProperties({ text: 'Waiting for floor, walls and table' });
  }

  private setStage(stage: AppStage, persist = true) {
    if (this.stage === stage && stage !== 'S6') return;
    this.stage = stage;
    if (persist) {
      const completed = new Set(this.flow.completed);
      if (stageOrder.indexOf(stage) >= stageOrder.indexOf('S7')) completed.add(stage);
      if (stage === 'S10') completed.add('S10');
      this.flow = { ...this.flow, stage, completed: [...completed] };
      saveFlow(this.flow);
    }
    this.panel?.getElementById('flow-stage')?.setProperties({ text: this.stageLabel(stage) });
    const page = this.pageForStage(stage);
    if (page) {
      this.showPage(page);
      this.placePanel(page);
    } else {
      this.hidePanel();
    }
    emit('app-flow-stage', { stage });
  }

  private stageLabel(stage: AppStage) {
    if (stage === 'S10') return 'LIVE';
    if (stage === 'S11') return 'RETURNING';
    if (stage === 'S7') return 'TABLE';
    if (stage === 'S8' || stage.startsWith('S9')) return 'MODE';
    if (stage === 'S6') return 'BUILD';
    if (stage === 'S3') return 'CALIBRATE';
    return 'SETUP';
  }

  private pageForStage(stage: AppStage): PanelPage | null {
    if (stage === 'S2' || stage === 'S5') return 'scan';
    if (stage === 'S6' || stage === 'S11') return null;
    if (stage === 'S7') return null;
    if (stage === 'S8') return 'mode';
    if (stage === 'S9a') return 'devices';
    if (stage === 'S9b') return 'pairing';
    if (stage === 'S10') return 'ready';
    return null;
  }

  private scanTitle(text: string) {
    this.panel?.getElementById('scan-title')?.setProperties({ text });
  }

  private scanBody(text: string) {
    this.panel?.getElementById('scan-status')?.setProperties({ text });
  }

  private refreshScanPage() {
    this.scanTitle(this.resume ? 'WELCOME BACK' : 'GETTING THE ROOM');
    this.scanBody(this.resume ? 'Aligning the garage with your current room scan…' : 'Look around slowly. Keep your table in view.');
    this.showScanChoices(false);
    this.panel?.getElementById('scan-progress')?.setProperties({ text: this.lastScanProgress ? `${this.lastScanProgress} / 3` : '0 / 3' });
    this.panel?.getElementById('scan-detail')?.setProperties({ text: 'Waiting for floor, walls and table' });
  }

  private showScanChoices(visible: boolean, selected = false) {
    this.panel?.getElementById('flow-table-choices')?.setProperties({ display: visible ? 'flex' : 'none' });
    this.panel?.getElementById('flow-use-table')?.setProperties({ display: selected ? 'flex' : 'none' });
  }

  private showPage(page: PanelPage) {
    if (!this.panel) return;
    const pages: PanelPage[] = ['scan', 'mode', 'devices', 'pairing', 'ready'];
    for (const name of pages) this.panel.getElementById(`page-${name}`)?.setProperties({ display: name === page ? 'flex' : 'none' });
    if (page === 'pairing') {
      this.panel.getElementById('flow-pair-url')?.setProperties({ text: `${location.host}/sender` });
      emit('stream-refresh');
    }
    const opening = !this.panel.visible && this.sessionWasVisible;
    this.panel.visible = this.sessionWasVisible;
    this.panelReady = true;
    this.placePanel(page);
    if (opening) revealAudio.playPanel(this.panel);
  }

  private hidePanel() {
    if (this.panel) this.panel.visible = false;
  }

  private placePanel(_page: PanelPage) {
    if (!this.panel || !this.sessionWasVisible) return;
    const camera = this.world.camera;
    const head = camera.getWorldPosition(new Vector3());
    const forward = camera.getWorldDirection(new Vector3());
    const up = new Vector3(0, 1, 0);
    const right = new Vector3().crossVectors(forward, up).normalize();
    const distance = 0.98;
    const lift = -0.02;
    this.panel.position.copy(head)
      .addScaledVector(forward, distance)
      .addScaledVector(right, 0)
      .addScaledVector(up, lift);
    this.panel.lookAt(head.x, head.y + lift, head.z);
    this.panel.visible = true;
  }

  private async createPanel() {
    try {
      const panel = await loadUIKitMLAsset('/ui/app-flow.uikitml', { kit: 'horizon', preferredColorScheme: 'dark' });
      panel.name = 'App flow panel';
      panel.scale.setScalar(0.094);
      panel.visible = false;
      sendPanelToFront(panel);
      const entity = this.world.createTransformEntity(panel, { persistent: true });
      entity.addComponent(RayInteractable, {});
      entity.addComponent(PokeInteractable, {});
      this.panel = panel;
      const on = (id: string, handler: () => void) => bindPress(panel, id, () => {
        revealAudio.playPress(panel);
        handler();
      });
      on('flow-run-scan', () => {
        this.scanTitle('REQUESTING SPACE SETUP');
        this.scanBody('Confirm the room capture in your headset.');
        void this.builder?.requestRoomCapture();
      });
      on('flow-manual', () => this.beginManual());
      on('flow-use-table', () => { this.builder?.useLiveScan(true); });
      on('flow-skip-table', () => { this.builder?.useLiveScan(false); });
      on('flow-mark-table', () => { this.markTableAfterBuild = this.builder?.useLiveScan(false) ?? false; });
      on('flow-mode-passthrough', () => this.chooseMode('passthrough'));
      on('flow-mode-streaming', () => this.chooseMode('streaming'));
      on('flow-continue', () => this.goLive());
      on('flow-continue-2', () => this.goLive());
      on('flow-refresh-streams', () => emit('stream-refresh'));
      on('flow-forget-streams', () => emit('stream-forget'));
      on('flow-mark-devices', () => {
        this.hidePanel();
        emit('device-marking-open');
      });
      on('flow-skip-devices', () => this.goLive());
      on('flow-start', () => {
        this.hidePanel();
        this.live = true;
        emit('status', 'Garage live - look at your left wrist or palm-up pinch for the menu');
      });
      this.panelReady = true;
      if (this.sessionWasVisible) this.setStage(this.stage, false);
    } catch (error) {
      emit('status', `Flow panel failed: ${String(error)}`);
      console.warn('[app-flow]', error);
    }
  }
}
