import { createSystem, loadUIKitMLAsset, PokeInteractable, RayInteractable, Vector3, VisibilityState } from '@iwsdk/core';
import type { UIKitMLAsset } from '@iwsdk/core';
import { emit, garageEvents } from '../events.js';
import { garageState, loadLastRoom, saveLastRoom, setWorkMode } from '../garage-state.js';
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
import { bindPress, clearUiInput, sendPanelToFront } from '../ui-press.js';
import { pulseGamepads } from '../feedback.js';
import type { RoomModel } from '../room-model.js';
import type { ScanInfo } from '../room-scan.js';
import { getStreamRoom, streamSenderUrl } from '../stream-room.js';

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
  private showedScanLock = false;
  private openingSpaceSetup = false;
  private showingTableChoices = false;
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
      if (this.stage !== 'S2' || this.openingSpaceSetup) return;
      this.showScanChoices(false);
      this.scanTitle('Finding your position');
      this.scanBody('Hold still and look around the room. You can mark the corners when tracking returns.');
      this.panel?.getElementById('scan-progress')?.setProperties({ display: 'none' });
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
      const { monitors } = (event as CustomEvent<{ monitors: { enabled: boolean; state: string }[] }>).detail;
      const enabled = monitors.filter(monitor => monitor.enabled);
      const sharing = enabled.filter(monitor => monitor.state === 'live').length;
      const text = enabled.length ? `${sharing} sharing · ${enabled.length} enabled` : 'Enable a monitor in Displays.';
      this.panel?.getElementById('flow-monitor-status')?.setProperties({ text });
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
    garageEvents.addEventListener('monitor-status', onStreams);
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
      garageEvents.removeEventListener('monitor-status', onStreams);
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
    this.showedScanLock = false;
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
    setWorkMode(mode);
    this.setStage(mode === 'passthrough' ? 'S9a' : 'S9b');
  }

  private goLive() {
    this.live = true;
    this.setStage('S10');
    this.showPage('ready');
    this.placePanel('ready');
    emit('status', 'Garage live');
  }

  private onScanProgress(detail: { info?: ScanInfo; hasFloor?: boolean; hasWalls?: boolean; hasTable?: boolean; needsChoice?: boolean }) {
    if (this.stage !== 'S2' || this.openingSpaceSetup || !detail?.info) return;
    const selected = detail.info.tableTopY != null;
    this.setScanProgress(!!detail.hasFloor, !!detail.hasWalls, !!detail.hasTable);
    this.showScanChoices(!!detail.needsChoice, selected);
    if (detail.needsChoice) {
      const hasCandidates = detail.info.tableCandidateCount > 0;
      this.scanTitle(selected ? 'Use this table?' : hasCandidates ? 'Choose your table' : 'Add a table');
      this.scanBody(selected
        ? 'Check the highlighted outline. If it fits your tabletop, use it to continue.'
        : hasCandidates
          ? 'Look directly at the tabletop you want. Its outline will light up when selected.'
          : 'The room is ready. Mark four tabletop corners or continue without a table.');
    } else if (detail.hasFloor && detail.hasWalls) {
      this.scanTitle(detail.hasTable ? 'Room found' : 'Looking for your table');
      this.scanBody(detail.hasTable ? 'Hold still for a moment while we fit the garage to your room.'
        : 'Look down at the tabletop you want to use.');
      if (!this.showedScanLock) {
        revealAudio.playGameplay('setup_lock', this.panel?.getWorldPosition(new Vector3()));
      }
      this.showedScanLock = true;
    } else {
      this.scanTitle('Scan your room');
      this.scanBody('Look around slowly, then look down at the table you want to use.');
    }
  }

  private onScanMissing() {
    if (this.stage !== 'S2' || this.openingSpaceSetup) return;
    this.showScanChoices(false, false, true);
    this.scanTitle('Set up your room');
    this.scanBody('Mark four floor corners to get started, or open Space Setup to scan your room.');
    this.panel?.getElementById('scan-progress')?.setProperties({ display: 'none' });
    this.showPage('scan');
    this.placePanel('scan');
  }

  private beginManual() {
    this.builder?.cancelRoomScan();
    this.setStage('S3');
    emit('room-manual-start');
    emit('status', 'Manual room: touch the floor corners with the controller tip');
  }

  private startManualBuild(room: RoomModel) {
    this.revealHandled = false;
    this.setStage('S5');
    this.showPage('scan');
    this.scanTitle('Room saved');
    this.scanBody('Fitting the garage to the space you marked.');
    this.panel?.getElementById('scan-progress')?.setProperties({ display: 'none' });
    this.panel?.getElementById('flow-scan-paths')?.setProperties({ display: 'none' });
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
    this.refreshScanPage();
    if (realign) {
      this.scanTitle('Finding your room again');
      this.scanBody('Look around slowly while we line up your saved garage.');
    }
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
    if (stage === 'S10') return 'Ready';
    if (stage === 'S9b') return 'Screen sharing';
    if (stage === 'S8' || stage === 'S9a') return 'Displays';
    return 'Room setup';
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
    this.scanTitle(this.resume ? 'Welcome back' : 'Scan your room');
    this.scanBody(this.resume ? 'Look around slowly while we line up your saved garage.' : 'Look around slowly, then look down at the table you want to use.');
    this.showScanChoices(false);
    this.setScanProgress(false, false, false);
  }

  private setScanProgress(floor: boolean, walls: boolean, table: boolean) {
    this.panel?.getElementById('scan-progress')?.setProperties({ display: 'flex' });
    for (const [label, found] of [['Floor', floor], ['Walls', walls], ['Table', table]] as const) {
      this.panel?.getElementById(`scan-found-${label.toLowerCase()}`)?.setProperties({
        text: found ? `${label} found` : label,
        backgroundColor: found ? '#30483f' : '#37313e',
        color: found ? '#c3efdf' : '#d6c8d4',
      });
    }
  }

  private showScanChoices(visible: boolean, selected = false, manualFirst = false) {
    const changed = this.showingTableChoices !== visible;
    this.showingTableChoices = visible;
    this.panel?.getElementById('flow-table-choices')?.setProperties({ display: visible ? 'flex' : 'none' });
    this.panel?.getElementById('flow-use-table')?.setProperties({ display: selected ? 'flex' : 'none' });
    this.panel?.getElementById('flow-scan-paths')?.setProperties({ display: visible ? 'none' : 'flex' });
    this.panel?.getElementById('flow-manual')?.setProperties({
      backgroundColor: manualFirst ? '#efbb96' : '#403644', color: manualFirst ? '#2c212d' : '#f9e9e3',
    });
    this.panel?.getElementById('flow-mark-table')?.setProperties({
      backgroundColor: selected ? '#403644' : '#efbb96', color: selected ? '#f9e9e3' : '#2c212d',
    });
    if (changed && this.stage === 'S2' && this.panel?.visible) this.placePanel('scan');
  }

  private showPage(page: PanelPage) {
    if (!this.panel) return;
    const pages: PanelPage[] = ['scan', 'mode', 'devices', 'pairing', 'ready'];
    for (const name of pages) this.panel.getElementById(`page-${name}`)?.setProperties({ display: name === page ? 'flex' : 'none' });
    if (page === 'pairing') {
      this.panel.getElementById('flow-pair-url')?.setProperties({ text: streamSenderUrl('') });
      this.panel.getElementById('flow-pair-code')?.setProperties({ text: getStreamRoom() });
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
    clearUiInput();
  }

  private placePanel(page: PanelPage) {
    if (!this.panel || !this.sessionWasVisible) return;
    const camera = this.world.camera;
    const head = camera.getWorldPosition(new Vector3());
    const forward = camera.getWorldDirection(new Vector3());
    const up = new Vector3(0, 1, 0);
    const right = new Vector3().crossVectors(forward, up).normalize();
    if (page === 'scan') forward.y = Math.max(-0.25, Math.min(0.12, forward.y * 0.45));
    forward.normalize();
    const side = page === 'scan' && this.showingTableChoices
      ? (garageState.preferences.dominantHand === 'left' ? 0.3 : -0.3)
      : 0;
    this.panel.position.copy(head)
      .addScaledVector(forward, 0.98)
      .addScaledVector(right, side)
      .addScaledVector(up, -0.05);
    this.panel.lookAt(head);
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
        pulseGamepads(this.input.xr.gamepads, 0.3, 26);
        revealAudio.playPress(panel);
        handler();
      });
      on('flow-run-scan', async () => {
        if (this.openingSpaceSetup) return;
        this.openingSpaceSetup = true;
        this.scanTitle('Opening Space Setup');
        this.scanBody('Follow the room setup instructions in your headset.');
        this.panel?.getElementById('scan-progress')?.setProperties({ display: 'none' });
        this.panel?.getElementById('flow-scan-paths')?.setProperties({ display: 'none' });
        const started = await this.builder?.requestRoomCapture();
        this.openingSpaceSetup = false;
        if (this.stage !== 'S2') return;
        if (started) this.refreshScanPage();
        else {
          this.onScanMissing();
          this.scanBody('Space Setup is unavailable here. Mark four floor corners to continue.');
        }
      });
      on('flow-manual', () => this.beginManual());
      on('flow-use-table', () => { this.builder?.useLiveScan(true); });
      on('flow-skip-table', () => { this.builder?.useLiveScan(false); });
      on('flow-mark-table', () => { this.markTableAfterBuild = this.builder?.useLiveScan(false) ?? false; });
      on('flow-mode-passthrough', () => this.chooseMode('passthrough'));
      on('flow-mode-streaming', () => this.chooseMode('streaming'));
      on('flow-continue-2', () => this.goLive());
      on('flow-mark-devices', () => {
        this.hidePanel();
        emit('device-marking-open');
      });
      on('flow-skip-devices', () => this.goLive());
      on('flow-start', () => {
        this.hidePanel();
        this.live = true;
        emit('status', 'Garage live - look at either wrist or palm-up pinch for the menu');
      });
      this.panelReady = true;
      if (this.sessionWasVisible) this.setStage(this.stage, false);
    } catch (error) {
      emit('status', `Flow panel failed: ${String(error)}`);
      console.warn('[app-flow]', error);
    }
  }
}
