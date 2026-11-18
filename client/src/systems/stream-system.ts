import { createSystem, Grabbed, GrabSystem, Group, LinearFilter, Mesh, MeshBasicMaterial, OneHandGrabbable, PlaneGeometry, RayInteractable, SRGBColorSpace, Vector3, VideoTexture, VisibilityState } from '@iwsdk/core';
import type { Entity } from '@iwsdk/core';
import { roomConfig } from '../room-config.js';
import { emit, garageEvents } from '../events.js';
import { garageState } from '../garage-state.js';
import { garageRootsVisible, registerGarageRoot, unregisterGarageRoot } from '../garage-visibility.js';
import { streamConfig } from '../stream-shared/config.js';
import { createMonitorModel, monitorScreenHeight, monitorScreenWidth, monitorStandDrop } from '../monitor-model.js';
import { seatToWorld, worldToSeat } from '../device-model.js';
import { getStreamRoom, streamChannel } from '../stream-room.js';
import { backendOrigin, signalUrl } from '../backend.js';
import { ConnectionLog, watchPeer } from '../stream-shared/ConnectionLog.js';
import { ConnectionStateMachine } from '../stream-shared/ConnectionStateMachine.js';
import { SignalingClient } from '../stream-shared/SignalingClient.js';
import { collectStats, show } from '../stream-shared/StreamStats.js';
import { latencySample, percentile } from '../stream-shared/LatencyProbe.js';
import { isUdpCandidate, udpOnlyDescription } from '../stream-shared/IcePolicy.js';
import { showComicWord } from '../comic-word.js';
import { revealAudio } from '../reveal/RevealAudio.js';
import { GarageBuildSystem } from './garage-build-system.js';
import { uiInputActive } from '../ui-press.js';

type Channel = {
  name: string; root: Group; screen: Mesh<PlaneGeometry, MeshBasicMaterial>; video: HTMLVideoElement; enabled: boolean;
  signal?: any; peer?: RTCPeerConnection; log: any; machine: any; generation: number; remoteSession?: string;
  pendingCandidates: Map<number, RTCIceCandidateInit[]>; previousStats?: RTCStatsReport; lastPackets?: number; lastTraffic?: number; lastHeartbeat?: number;
  statsTimer?: number; probeTimer?: number; frameCallback?: number; texture?: VideoTexture; stats?: any; samples: number[];
  probeCanvas: HTMLCanvasElement; probeContext: CanvasRenderingContext2D; jitterTarget: number; lastFreeze?: number; lastFrame?: number;
  lastJitterChange?: number;
  highJitterCount?: number;
  pairingStart?: number;
  peerCreatedOnce?: boolean;
  entity?: Entity;
  grabTranslate?: boolean;
};
type MonitorPreset = 'desk' | 'arc';
type SavedMonitor = { enabled: boolean; pose?: ReturnType<typeof worldToSeat> };
type MonitorLayout = { preset: MonitorPreset | 'custom'; monitors: SavedMonitor[] };
type HandTurn = { side: 'left' | 'right'; channel: Channel; start: Vector3; right: Vector3; yaw: number; appliedYaw: number; changed: boolean };

export class StreamSystem extends createSystem({ grabbed: { required: [Grabbed] } }) {
  private builder?: GarageBuildSystem;
  private channels: Channel[] = [];
  private monitorRoot = new Group();
  private editingLayout = false;
  private showMonitors = false;
  private active = true;
  private suspended = false;
  private announcedPicture = false;
  private diagnosticsVisible = true;
  private preset: MonitorLayout['preset'] = 'arc';
  private wasGrabbed = false;
  private handTurn?: HandTurn;
  private pinchPoint = new Vector3();
  private rayStart = new Vector3();
  private rayDirection = new Vector3();
  private screenPoint = new Vector3();
  private screenNormal = new Vector3();
  private layoutKey = 'garage-jam-monitor-layout-v2';
  private saved: MonitorLayout | null = this.loadLayout();
  private room = getStreamRoom();
  init() {
    this.builder = this.world.getSystem(GarageBuildSystem) ?? undefined;
    const config = roomConfig.monitors;
    const query = new URLSearchParams(location.search);
    const count = Math.max(1, Math.min(2, Number(query.get('monitors')) || config.count));
    this.showMonitors = garageState.preferences.mode === 'streaming' || query.get('demo') === '1';
    this.monitorRoot.name = 'Streamed monitors';
    this.monitorRoot.visible = garageRootsVisible();
    const parent = this.world.createTransformEntity(this.monitorRoot, { persistent: true });
    registerGarageRoot(this.monitorRoot);
    this.preset = this.saved?.preset ?? 'arc';
    const defaultEnabled = this.saved ? 1 : Math.min(2, this.legacyMonitorCount());
    for (let i = 0; i < count; i++) {
      const angle = (i - (count - 1) / 2) * config.stepDegrees * Math.PI / 180;
      const root = new Group(); root.name = `Monitor ${i + 1}`;
      root.position.set(Math.sin(angle) * config.radius, config.height, -Math.cos(angle) * config.radius);
      root.rotation.y = -angle;
      const screen = new Mesh(new PlaneGeometry(monitorScreenWidth, monitorScreenHeight), new MeshBasicMaterial({ color: 0xffffff }));
      screen.name = `Monitor ${i + 1} video`;
      screen.position.z = 0.003;
      screen.visible = false;
      root.add(screen);
      root.visible = false;
      const entity = this.world.createTransformEntity(root, { parent, persistent: true });
      entity.addComponent(RayInteractable, {});
      const backing = new Mesh(new PlaneGeometry(monitorScreenWidth, monitorScreenHeight), new MeshBasicMaterial({ color: 0x191721 }));
      backing.name = 'Monitor loading face';
      root.add(backing);
      void createMonitorModel(monitorScreenWidth, monitorScreenHeight).then(({ mount }) => {
        if (!this.active) return;
        root.add(mount);
        backing.removeFromParent();
        backing.geometry.dispose();
        backing.material.dispose();
      }).catch(error => console.warn('[stream] Monitor model could not load', error));
      const video = document.createElement('video'); video.muted = true; video.autoplay = true; video.playsInline = true;
      video.disableRemotePlayback = true; video.controls = false; video.style.cssText = 'position:absolute;width:1px;height:1px;left:-10000px;top:-10000px'; document.body.append(video);
      const probeCanvas = document.createElement('canvas');
      const channel: Channel = { name: streamChannel(this.room, i + 1), root, screen, video, enabled: this.saved?.monitors[i]?.enabled ?? i < defaultEnabled, log: null, machine: null, generation: -1, pendingCandidates: new Map(), samples: [], probeCanvas, probeContext: probeCanvas.getContext('2d', { willReadFrequently: true })!, jitterTarget: streamConfig.jitterMs, entity };
      channel.log = new ConnectionLog('viewer', channel.name, backendOrigin);
      channel.machine = new ConnectionStateMachine(channel.log, streamConfig, () => this.updateStatus());
      for (const name of ['stalled', 'waiting', 'playing', 'pause', 'emptied', 'resize']) video.addEventListener(name, () => channel.log.add(`video-${name}`));
      video.addEventListener('resize', () => this.fitVideo(channel));
      this.channels.push(channel);
    }
    this.syncConnections();
    this.updateStatus();
    const onLayout = () => this.layout();
    const onRefresh = () => this.updateStatus();
    const onForget = () => this.forget();
    const onRecenter = () => this.recenter();
    const onMode = () => this.layout();
    const onPassthrough = () => { if (garageRootsVisible()) this.layout(); };
    const onOverlay = (event: Event) => { if (!(event as CustomEvent<boolean>).detail) this.layout(); };
    garageEvents.addEventListener('garage-revealed', onLayout);
    garageEvents.addEventListener('garage-reset', onRefresh);
    garageEvents.addEventListener('stream-refresh', onRefresh);
    garageEvents.addEventListener('stream-forget', onForget);
    garageEvents.addEventListener('stream-recenter', onRecenter);
    garageEvents.addEventListener('mode-changed', onMode);
    garageEvents.addEventListener('garage-passthrough-changed', onPassthrough);
    garageEvents.addEventListener('room-shown', onRefresh);
    garageEvents.addEventListener('device-marking-active', onOverlay);
    garageEvents.addEventListener('table-confirm-visibility', onOverlay);
    this.cleanupFuncs.push(() => {
      garageEvents.removeEventListener('garage-revealed', onLayout);
      garageEvents.removeEventListener('garage-reset', onRefresh);
      garageEvents.removeEventListener('stream-refresh', onRefresh);
      garageEvents.removeEventListener('stream-forget', onForget);
      garageEvents.removeEventListener('stream-recenter', onRecenter);
      garageEvents.removeEventListener('mode-changed', onMode);
      garageEvents.removeEventListener('garage-passthrough-changed', onPassthrough);
      garageEvents.removeEventListener('room-shown', onRefresh);
      garageEvents.removeEventListener('device-marking-active', onOverlay);
      garageEvents.removeEventListener('table-confirm-visibility', onOverlay);
      unregisterGarageRoot(this.monitorRoot);
    });
    if (location.hostname === 'localhost') {
      (window as any).garageStreamDebug = {
        room: this.room,
        recenter: () => this.layout(),
        toggle: (index: number) => system.toggleMonitor(index),
        setPreset: (preset: MonitorPreset) => system.setPreset(preset),
        get layout() {
          const room = garageState.room;
          return system.channels.map(channel => {
            const pose = room
              ? worldToSeat(room, channel.root.position, channel.root.rotation.y)
              : { point: channel.root.position, yaw: channel.root.rotation.y };
            return {
              enabled: channel.enabled,
              visible: channel.root.visible,
              x: pose.point.x, y: pose.point.y, z: pose.point.z,
              yaw: Math.atan2(Math.sin(pose.yaw), Math.cos(pose.yaw)),
              grabbable: channel.entity?.hasComponent(OneHandGrabbable) ?? false,
              grabTranslate: channel.grabTranslate ?? null,
            };
          });
        },
        get states() {
          return system.channels.map(channel => {
            const state = system.displayState(channel);
            return { name: channel.name, state, live: state === 'live' };
          });
        },
      };
      const system = this;
    }
    this.cleanupFuncs.push(this.world.visibilityState.subscribe(state => {
      this.channels.forEach(channel => channel.log.add('xr-visibility', { state }));
      if (state === VisibilityState.NonImmersive) {
        this.suspendChannels();
      } else {
        this.resumeChannels();
        if (state === VisibilityState.Visible) this.channels.forEach(channel => this.checkHealth(channel, 'xr-visible'));
      }
    }));
    const visibility = () => {
      const hidden = document.visibilityState !== 'visible';
      this.channels.forEach(channel => channel.log.add('visibilitychange', { visibility: document.visibilityState }));
      if (hidden && !this.world.session) this.suspendChannels();
      else if (!hidden) {
        this.resumeChannels();
        this.channels.forEach(channel => this.checkHealth(channel, 'page-visible'));
      }
    };
    const freeze = () => this.channels.forEach(channel => channel.log.add('page-freeze'));
    const resume = () => this.channels.forEach(channel => { channel.log.add('page-resume'); this.checkHealth(channel, 'page-resume'); });
    const toggle = () => { this.diagnosticsVisible = !this.diagnosticsVisible; this.updateStatus(); };
    const record = () => this.channels.forEach(channel => channel.log.download());
    document.addEventListener('visibilitychange', visibility); document.addEventListener('freeze', freeze); document.addEventListener('resume', resume);
    garageEvents.addEventListener('stream-diagnostics-toggle', toggle); garageEvents.addEventListener('stream-record', record);
    this.cleanupFuncs.push(() => {
      this.active = false;
      document.removeEventListener('visibilitychange', visibility); document.removeEventListener('freeze', freeze); document.removeEventListener('resume', resume);
      garageEvents.removeEventListener('stream-diagnostics-toggle', toggle); garageEvents.removeEventListener('stream-record', record);
      this.channels.forEach(channel => { channel.signal?.stop(); this.resetPeer(channel, 'dispose'); channel.machine.dispose(); channel.video.remove(); });
      for (const channel of this.channels) {
        channel.screen.geometry.dispose();
        channel.screen.material.dispose();
        const backing = channel.root.getObjectByName('Monitor loading face');
        if (backing instanceof Mesh) { backing.geometry.dispose(); backing.material.dispose(); }
        channel.entity?.destroy();
      }
      parent.destroy();
    });
  }
  private layout() {
    this.showMonitors = garageState.preferences.mode === 'streaming';
    this.syncConnections();
    this.placeMonitors();
    this.updateStatus();
    for (const channel of this.channels) {
      if (channel.texture && channel.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !channel.video.paused) {
        this.announcePicture(channel);
      }
    }
  }

  private placeMonitors() {
    this.endHandTurn();
    const room = garageState.room;
    if (!room) return;
    const active = this.channels.filter(channel => channel.enabled);
    if (!active.length) return;
    const table = room.table;
    const tableCenter = table?.polygon.reduce((center, point) => ({
      x: center.x + point.x / table.polygon.length,
      z: center.z + point.z / table.polygon.length,
    }), { x: 0, z: 0 });
    const forwardLength = Math.hypot(room.forward.x, room.forward.z) || 1;
    const fx = room.forward.x / forwardLength, fz = room.forward.z / forwardLength;
    const desk = this.preset === 'desk';
    let depth = 1.36;
    if (table && tableCenter) {
      const backEdge = Math.max(...table.polygon.map(point => (point.x - tableCenter.x) * fx + (point.z - tableCenter.z) * fz));
      const setback = Math.max(0, Math.min(0.22, backEdge - 0.14));
      depth = (tableCenter.x - room.seat.x) * fx + (tableCenter.z - room.seat.z) * fz + setback;
    }
    // Keep the pair symmetrical around the viewer, even when the scanned table is slightly off-axis.
    const center = { x: room.seat.x + fx * depth, z: room.seat.z + fz * depth };
    const height = (table?.topY ?? room.floor.y + 0.76) + monitorStandDrop;
    const squareYaw = Math.atan2(-fx, -fz);
    const faceSeatYaw = (x: number, z: number) => Math.atan2(room.seat.x - x, room.seat.z - z);
    active.forEach((channel, order) => {
      const pose = this.preset === 'custom' ? this.saved?.monitors[this.channels.indexOf(channel)]?.pose : undefined;
      if (pose && [pose.point?.x, pose.point?.y, pose.point?.z, pose.yaw].every(Number.isFinite)) {
        const { point, yaw } = seatToWorld(room, pose.point, pose.yaw);
        channel.root.position.set(point.x, point.y, point.z);
        channel.root.rotation.set(0, yaw, 0);
        return;
      }
      if (active.length === 1) {
        channel.root.position.set(center.x, height, center.z);
        channel.root.rotation.set(0, squareYaw, 0);
        return;
      }
      const side = order === 0 ? -1 : 1;
      const offset = side * (desk ? 0.78 : 0.72) / 2;
      const curve = desk ? 0 : -0.09;
      const x = center.x - fz * offset + fx * curve;
      const z = center.z + fx * offset + fz * curve;
      channel.root.position.set(x, height, z);
      channel.root.rotation.set(0, faceSeatYaw(x, z), 0);
    });
  }

  setLayoutEditing(editing: boolean) {
    if (editing === this.editingLayout) return;
    this.editingLayout = editing;
    this.refreshPresentation();
  }

  turnMonitor(index: number, degrees: number) {
    const channel = this.channels[index];
    if (!channel?.root.visible || !garageRootsVisible()) return;
    this.endHandTurn();
    const yaw = channel.root.rotation.y + degrees * Math.PI / 180;
    channel.root.rotation.set(0, Math.atan2(Math.sin(yaw), Math.cos(yaw)), 0);
    this.preset = 'custom';
    this.saveLayout();
  }

  private refreshPresentation() {
    const show = this.showMonitors && garageRootsVisible() && (this.builder?.isRevealed() ?? true);
    this.channels.forEach(channel => {
      channel.root.visible = show && channel.enabled;
      channel.screen.visible = !!channel.texture && channel.machine.state !== 'source-stopped';
      if (!channel.entity) return;
      const turnable = channel.root.visible;
      const translate = this.editingLayout;
      const has = channel.entity.hasComponent(OneHandGrabbable);
      if (!turnable) {
        if (has) channel.entity.removeComponent(OneHandGrabbable);
        channel.grabTranslate = undefined;
        return;
      }
      if (!has || channel.grabTranslate !== translate) {
        if (has) channel.entity.removeComponent(OneHandGrabbable);
        channel.entity.addComponent(OneHandGrabbable, {
          rotate: true,
          translate,
          rotateMin: [0, -Math.PI, 0],
          rotateMax: [0, Math.PI, 0],
        });
        channel.grabTranslate = translate;
      }
    });
  }

  private loadLayout(): MonitorLayout | null {
    try {
      const saved = JSON.parse(localStorage.getItem(this.layoutKey) || 'null');
      return saved && ['desk', 'arc', 'custom'].includes(saved.preset) && Array.isArray(saved.monitors)
        ? { preset: saved.preset, monitors: saved.monitors.slice(0, 2) }
        : null;
    } catch { return null; }
  }

  private legacyMonitorCount() {
    try {
      const legacy = JSON.parse(localStorage.getItem('garage-jam-monitor-layout-v1') || 'null');
      return Array.isArray(legacy?.monitors) ? Math.max(1, Math.min(2, legacy.monitors.length)) : 1;
    } catch { return 1; }
  }

  private saveLayout() {
    const room = garageState.room;
    this.saved = {
      preset: this.preset,
      monitors: this.channels.map((channel, index) => ({
        enabled: channel.enabled,
        pose: room && channel.enabled ? worldToSeat(room, channel.root.position, channel.root.rotation.y) : this.saved?.monitors[index]?.pose,
      })),
    };
    try { localStorage.setItem(this.layoutKey, JSON.stringify(this.saved)); } catch { /* private mode */ }
    emit('monitor-layout', this.managerState());
  }

  private recenter() {
    this.setPreset('arc');
  }

  setPreset(preset: MonitorPreset) {
    this.preset = preset;
    this.placeMonitors();
    this.saveLayout();
  }

  toggleMonitor(index: number) {
    const channel = this.channels[index];
    if (!channel) return;
    channel.enabled = !channel.enabled;
    if (this.preset === 'custom') this.preset = 'arc';
    this.syncConnections();
    this.placeMonitors();
    this.saveLayout();
    this.updateStatus();
  }

  managerState() {
    return {
      preset: this.preset,
      monitors: this.channels.map(channel => ({
        enabled: channel.enabled,
        state: this.displayState(channel),
      })),
    };
  }

  private displayState(channel: Channel): string {
    if (!channel.enabled) return 'off';
    if (!this.showMonitors) return 'idle';
    if (channel.machine.state === 'live' && !channel.texture) return 'connecting';
    return channel.machine.state;
  }

  private monitorAtHand(side: HandTurn['side']) {
    const xr = this.input.xr;
    xr.xrOrigin.indexTipSpaces[side].getWorldPosition(this.pinchPoint);
    const ray = xr.xrOrigin.raySpaces[side];
    ray.getWorldPosition(this.rayStart);
    ray.getWorldDirection(this.rayDirection).negate();
    let closest: Channel | undefined;
    let closestDistance = Infinity;
    for (const channel of this.channels) {
      const root = channel.root;
      if (!root.visible) continue;
      root.worldToLocal(this.screenPoint.copy(this.pinchPoint));
      if (Math.abs(this.screenPoint.z) < 0.13 && this.insideMonitor()) return channel;
      root.getWorldDirection(this.screenNormal);
      const denom = this.rayDirection.dot(this.screenNormal);
      if (Math.abs(denom) < 0.001) continue;
      root.getWorldPosition(this.screenPoint);
      const distance = this.screenPoint.sub(this.rayStart).dot(this.screenNormal) / denom;
      if (distance < 0 || distance > 4 || distance >= closestDistance) continue;
      root.worldToLocal(this.screenPoint.copy(this.rayStart).addScaledVector(this.rayDirection, distance));
      if (!this.insideMonitor()) continue;
      closest = channel;
      closestDistance = distance;
    }
    return closest;
  }

  private insideMonitor() {
    return Math.abs(this.screenPoint.x) <= monitorScreenWidth / 2 + 0.065
      && Math.abs(this.screenPoint.y) <= monitorScreenHeight / 2 + 0.055;
  }

  private endHandTurn() {
    const turn = this.handTurn;
    if (!turn) return;
    this.handTurn = undefined;
    if (turn.channel.entity?.hasComponent(OneHandGrabbable)) turn.channel.entity.setValue(OneHandGrabbable, 'rotate', true);
    if (turn.changed) {
      const yaw = turn.appliedYaw;
      turn.channel.root.rotation.y = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      this.preset = 'custom';
      this.saveLayout();
    }
  }

  private updateHandTurn(delta: number) {
    const xr = this.input.xr;
    const turn = this.handTurn;
    if (!this.world.session || !garageRootsVisible()) {
      this.endHandTurn();
      return;
    }
    if (turn) {
      if (!turn.channel.root.visible || !xr.isPrimary('hand', turn.side) || !xr.getSelectState(turn.side).active) {
        this.endHandTurn();
        return;
      }
      xr.xrOrigin.indexTipSpaces[turn.side].getWorldPosition(this.pinchPoint);
      const movement = this.pinchPoint.sub(turn.start).dot(turn.right);
      const drag = Math.sign(movement) * Math.max(0, Math.abs(movement) - 0.012);
      const target = turn.yaw - 4.5 * drag;
      const alpha = 1 - Math.exp(-Math.min(delta, 0.05) * 24);
      turn.appliedYaw += (target - turn.appliedYaw) * alpha;
      turn.channel.root.rotation.set(0, turn.appliedYaw, 0);
      turn.changed ||= Math.abs(drag) > 0.002;
      return;
    }
    if (uiInputActive()) return;
    const grab = this.world.getSystem(GrabSystem);
    for (const side of ['left', 'right'] as const) {
      if (!xr.isPrimary('hand', side) || !xr.getSelectState(side).start) continue;
      const held = this.channels.find(channel => channel.entity && grab?.getHolderHand(channel.entity) === side);
      if (held && this.editingLayout) continue;
      const channel = held ?? this.monitorAtHand(side);
      if (!channel?.entity?.hasComponent(OneHandGrabbable)) continue;
      const yaw = channel.root.rotation.y;
      xr.xrOrigin.indexTipSpaces[side].getWorldPosition(this.pinchPoint);
      channel.entity.setValue(OneHandGrabbable, 'rotate', false);
      this.handTurn = { side, channel, start: this.pinchPoint.clone(), right: new Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), yaw, appliedYaw: yaw, changed: false };
      break;
    }
  }

  update(delta: number) {
    this.updateHandTurn(delta);
    const grabbed = this.channels.some(channel => channel.entity && this.queries.grabbed.entities.has(channel.entity));
    if (grabbed === this.wasGrabbed) return;
    this.wasGrabbed = grabbed;
    if (!grabbed && !this.handTurn) {
      for (const channel of this.channels) {
        const direction = channel.root.getWorldDirection(new Vector3());
        channel.root.rotation.set(0, Math.atan2(direction.x, direction.z), 0);
      }
      this.preset = 'custom';
      this.saveLayout();
    }
  }

  private forget() {
    this.announcedPicture = false;
    for (const channel of this.channels) if (channel.signal) this.disconnect(channel, 'forget');
    this.syncConnections();
    emit('status', 'Forgot paired laptop. Open /sender on Chrome to pair again.');
    this.updateStatus();
  }

  private syncConnections() {
    for (const channel of this.channels) {
      if (this.showMonitors && channel.enabled) this.connect(channel);
      else if (channel.signal) this.disconnect(channel, channel.enabled ? 'display-mode-changed' : 'monitor-disabled');
    }
    if (!this.showMonitors) this.announcedPicture = false;
  }

  private disconnect(channel: Channel, reason: string) {
    const signal = channel.signal;
    channel.signal = undefined;
    signal?.stop();
    this.resetPeer(channel, reason);
    channel.remoteSession = undefined;
    channel.generation = -1;
    channel.machine.set('idle', reason);
  }

  private updateStatus() {
    this.refreshPresentation();
    emit('monitor-status', this.managerState());
    emit('streams', this.channels.map(channel => `${channel.name.slice(-1)}:${this.displayState(channel)}`).join('  '));
    emit('stream-status', this.channels.map(channel => {
      const state = this.displayState(channel);
      return { name: channel.name, state, connected: state === 'live', live: state === 'live', stats: channel.stats };
    }));
    emit('stream-diagnostics', this.diagnosticsVisible && streamConfig.diagnostics ? this.channels.map(channel => {
      const d = channel.stats || {};
      const pathType = d.localType === 'host' && d.remoteType === 'host' && d.protocol === 'udp' ? 'DIRECT' : d.localType === 'relay' || d.remoteType === 'relay' ? 'RELAY' : d.protocol === 'tcp' ? 'TCP' : d.localType === 'srflx' || d.remoteType === 'srflx' ? 'SRFLX' : '?';
      const path = `${pathType} ${d.localType || '?'}→${d.remoteType || '?'} ${d.protocol || '?'}`;
      const warning = d.localType === 'relay' || d.remoteType === 'relay' || d.protocol === 'tcp' ? ' !RELAY/TCP' : '';
      return `${channel.name.slice(-1)} video ${show(percentile(channel.samples, .5))}/${show(percentile(channel.samples, .95))}ms p50/p95 | ${show(d.jitterBufferMs)}ms jitter | ${show(d.decodeMs)}ms decode | ${show(d.fps)}fps | loss ${show(d.lost)} | freeze ${show(d.freezes)} | ${d.implementation || 'n/a'} | ${path}${warning} | flicker ${channel.machine.suppressed} | peers ${channel.machine.recreations} | states/min ${channel.machine.transitionsPerMinute}`;
    }).join('\n') : '');
  }
  private resetPeer(channel: Channel, reason: string) {
    clearInterval(channel.statsTimer); clearInterval(channel.probeTimer);
    channel.statsTimer = undefined; channel.probeTimer = undefined;
    if (channel.frameCallback != null && 'cancelVideoFrameCallback' in channel.video) channel.video.cancelVideoFrameCallback(channel.frameCallback);
    if (channel.peer) { channel.log.add('peer-close', { reason }); channel.peer.close(); channel.peer = undefined; }
    channel.pendingCandidates.clear(); channel.previousStats = undefined; channel.video.srcObject = null;
    channel.lastPackets = undefined; channel.lastTraffic = undefined; channel.lastHeartbeat = undefined;
    const material = channel.screen.material;
    if (channel.texture) { channel.texture.dispose(); channel.texture = undefined; }
    material.map = null; material.needsUpdate = true;
    channel.screen.scale.setScalar(1);
    channel.screen.visible = false;
    channel.lastFrame = undefined;
    channel.stats = undefined;
  }
  private connect(channel: Channel) {
    if (channel.signal) return;
    const signal = new SignalingClient(channel.name, 'viewer', channel.log, streamConfig, (msg: any) => {
      if (channel.signal === signal) void this.onMessage(channel, msg);
    }, (state: string) => {
      if (channel.signal !== signal) return;
      if (state === 'replaced') { this.resetPeer(channel, 'taken-over'); channel.machine.set('failed', 'taken over by another device'); }
      else if (state === 'failed' && !channel.peer) channel.machine.set('failed', 'signaling-retries-exhausted');
      else if (state === 'closed') channel.log.add('signaling-lost-media-kept');
    }, signalUrl());
    channel.signal = signal;
    channel.machine.set('pairing', 'viewer-start'); signal.start();
  }
  private async onMessage(channel: Channel, msg: any) {
    const signal = channel.signal;
    if (!signal) return;
    try {
      if (msg.type === 'offer') {
        if (!Number.isInteger(msg.generation)) return;
        if (msg.generation < channel.generation) { channel.log.add('stale-offer', { generation: msg.generation }); return; }
        if (!channel.peer || msg.generation > channel.generation) this.makePeer(channel, msg.generation, 'new-offer');
        const peer = channel.peer!;
        if (peer.signalingState !== 'stable') { channel.log.add('offer-wrong-state', { signaling: peer.signalingState }); return; }
        await peer.setRemoteDescription(udpOnlyDescription(msg.sdp)); channel.log.add('set-remote-description', { type: 'offer', generation: msg.generation });
        if (peer !== channel.peer) return;
        for (const candidate of channel.pendingCandidates.get(msg.generation) || []) await peer.addIceCandidate(candidate);
        if (peer !== channel.peer) return;
        channel.pendingCandidates.delete(msg.generation);
        await peer.setLocalDescription(await peer.createAnswer()); channel.log.add('set-local-description', { type: 'answer', generation: msg.generation });
        if (signal !== channel.signal || peer !== channel.peer) return;
        signal.send({ type: 'answer', sdp: udpOnlyDescription(peer.localDescription), generation: msg.generation });
      } else if (msg.type === 'ice-candidate' && Number.isInteger(msg.generation) && isUdpCandidate(msg.candidate)) {
        if (msg.generation < channel.generation) return;
        if (channel.peer && msg.generation === channel.generation && channel.peer.remoteDescription) await channel.peer.addIceCandidate(msg.candidate);
        else { const pending = channel.pendingCandidates.get(msg.generation) || []; pending.push(msg.candidate); channel.pendingCandidates.set(msg.generation, pending); }
      } else if (msg.type === 'leave' && msg.role === 'sender' && msg.sessionId === channel.remoteSession) {
        this.resetPeer(channel, 'sender-left'); channel.machine.set('pairing', 'sender-left'); channel.remoteSession = undefined;
        if (this.channels.every(item => !item.remoteSession)) this.announcedPicture = false;
      } else if (msg.type === 'peer-ready' && msg.role === 'sender') {
        channel.pairingStart = Date.now();
        if (channel.remoteSession && channel.remoteSession !== msg.sessionId) { this.resetPeer(channel, 'new-sender'); channel.generation = -1; }
        channel.remoteSession = msg.sessionId;
      } else if (msg.type === 'joined') channel.log.add('joined', { resumed: msg.resumed, peerPresent: msg.peerPresent });
    } catch (error) { if (signal !== channel.signal) return; channel.log.add('signal-message-error', { type: msg.type, message: String(error) }); channel.machine.set('failed', 'signal-error'); }
  }
  private makePeer(channel: Channel, generation: number, reason: string) {
    const earlyCandidates = channel.pendingCandidates.get(generation) || [];
    this.resetPeer(channel, reason);
    channel.pendingCandidates.set(generation, earlyCandidates);
    channel.generation = generation;
    if (channel.peerCreatedOnce) channel.machine.recreations++;
    channel.peerCreatedOnce = true;
    channel.log.add('peer-create', { generation, reason, recreations: channel.machine.recreations });
    const peer = new RTCPeerConnection({ iceServers: [] }); channel.peer = peer;
    watchPeer(peer, channel.log);
    peer.onicecandidate = event => { if (event.candidate && channel.peer === peer) {
      if (isUdpCandidate(event.candidate)) channel.signal.send({ type: 'ice-candidate', candidate: event.candidate, generation });
      else channel.log.add('candidate-rejected', { protocol: event.candidate.protocol });
    } };
    peer.onconnectionstatechange = () => this.checkHealth(channel, 'connection-change');
    peer.oniceconnectionstatechange = () => this.checkHealth(channel, 'ice-change');
    peer.ondatachannel = event => {
      if (event.channel.label !== 'heartbeat') return;
      event.channel.onmessage = data => {
        try { const msg = JSON.parse(data.data); if (msg.type === 'ping') { channel.lastHeartbeat = Date.now(); event.channel.send(JSON.stringify({ type: 'ack', at: msg.at })); this.checkHealth(channel, 'heartbeat'); } }
        catch {}
      };
      event.channel.onopen = () => channel.log.add('heartbeat-open');
      event.channel.onclose = () => channel.log.add('heartbeat-close');
    };
    peer.ontrack = event => {
      if (channel.peer !== peer || !channel.enabled) return;
      channel.log.add('track', { kind: event.track.kind });
      event.track.onended = () => { if (channel.peer === peer) channel.machine.set('source-stopped', 'track-ended'); };
      event.track.onmute = () => { if (channel.peer === peer) channel.machine.set('source-paused', 'track-muted'); };
      event.track.onunmute = () => { if (channel.peer === peer) this.checkHealth(channel, 'track-unmuted'); };
      channel.video.srcObject = event.streams[0] || new MediaStream([event.track]);
      this.setJitter(channel, channel.jitterTarget);
      void channel.video.play().then(() => {
        if (channel.peer !== peer) return;
        const texture = new VideoTexture(channel.video); texture.colorSpace = SRGBColorSpace; texture.generateMipmaps = false; texture.minFilter = LinearFilter; texture.magFilter = LinearFilter;
        channel.texture = texture;
        const material = channel.screen.material; material.map = texture; material.color.setHex(0xffffff); material.needsUpdate = true;
        this.fitVideo(channel);
        this.updateStatus();
        this.watchFrames(channel);
        if ('requestVideoFrameCallback' in channel.video) {
          channel.video.requestVideoFrameCallback(() => {
            if (channel.peer === peer) this.announcePicture(channel);
          });
        } else this.announcePicture(channel);
        this.checkHealth(channel, 'video-playing');
      }).catch(error => { if (channel.peer !== peer) return; channel.log.add('video-play-error', { message: String(error) }); channel.machine.set('failed', 'video-play-error'); });
    };
    if (!this.suspended) this.startChannelTimers(channel);
    channel.machine.set('connecting', reason);
  }

  private startChannelTimers(channel: Channel) {
    clearInterval(channel.statsTimer);
    clearInterval(channel.probeTimer);
    channel.statsTimer = streamConfig.diagnostics ? window.setInterval(() => void this.updateStats(channel), streamConfig.statsMs) : undefined;
    channel.probeTimer = streamConfig.probe ? window.setInterval(() => this.updateProbe(channel), 250) : undefined;
  }

  /**
   * Stop diagnostics and video compositing when XR is not immersive.
   *
   * The peer is deliberately kept alive so re-entering XR does not force a
   * reconnect (see docs/stability-report.md). Only the per-frame/per-second
   * work is suspended.
   */
  private suspendChannels() {
    if (this.suspended) return;
    this.suspended = true;
    for (const channel of this.channels) {
      clearInterval(channel.statsTimer); channel.statsTimer = undefined;
      clearInterval(channel.probeTimer); channel.probeTimer = undefined;
      try { channel.video.pause(); } catch { /* optional */ }
      channel.log.add('backgrounded', { suspended: true });
    }
  }

  private resumeChannels() {
    if (!this.suspended) return;
    this.suspended = false;
    for (const channel of this.channels) {
      if (!channel.peer) continue;
      this.startChannelTimers(channel);
      if (channel.video.srcObject) void channel.video.play().catch(() => { /* optional */ });
      channel.log.add('backgrounded', { suspended: false });
    }
  }

  private fitVideo(channel: Channel) {
    if (!channel.texture || !channel.video.videoWidth || !channel.video.videoHeight) return;
    const videoAspect = channel.video.videoWidth / channel.video.videoHeight;
    const apertureAspect = monitorScreenWidth / monitorScreenHeight;
    channel.screen.scale.set(Math.min(1, videoAspect / apertureAspect), Math.min(1, apertureAspect / videoAspect), 1);
  }

  private announcePicture(channel: Channel) {
    if (this.announcedPicture || !this.world.session || !this.active || !channel.root.visible || !garageRootsVisible()) return;
    this.announcedPicture = true;
    const position = channel.screen.getWorldPosition(new Vector3());
    revealAudio.playGameplay('stream_first_picture', position);
    showComicWord('PIP.', position);
  }
  private watchFrames(channel: Channel) {
    if (!streamConfig.diagnostics && !streamConfig.probe && !streamConfig.logging) return;
    if (!('requestVideoFrameCallback' in channel.video)) { channel.log.add('rvfc-unavailable'); return; }
    let lastLog = 0;
    const next = (_now: number, metadata: any) => {
      if (!channel.peer) return;
      channel.lastFrame = Date.now();
      if (channel.pairingStart != null) { channel.log.add('first-frame', { pairingToFrameMs: Date.now() - channel.pairingStart }); channel.pairingStart = undefined; }
      if (streamConfig.diagnostics && Date.now() - lastLog > 1000) {
        channel.log.sample({ frame: { receiveTime: metadata.receiveTime ?? null, captureTime: metadata.captureTime ?? null, processingDuration: metadata.processingDuration ?? null, presentationTime: metadata.presentationTime ?? null, expectedDisplayTime: metadata.expectedDisplayTime ?? null, presentedFrames: metadata.presentedFrames } });
        lastLog = Date.now();
      }
      channel.frameCallback = channel.video.requestVideoFrameCallback(next);
    };
    channel.frameCallback = channel.video.requestVideoFrameCallback(next);
  }
  private setJitter(channel: Channel, target: number) {
    const receiver = channel.peer?.getReceivers().find(item => item.track?.kind === 'video');
    if (!receiver) return;
    try {
      if ('jitterBufferTarget' in receiver) (receiver as any).jitterBufferTarget = target;
      else if ('playoutDelayHint' in receiver) (receiver as any).playoutDelayHint = target / 1000;
      else { channel.log.add('jitter-target-unsupported'); return; }
      channel.jitterTarget = target; channel.log.add('jitter-target', { ms: target, api: 'jitterBufferTarget' in receiver ? 'jitterBufferTarget' : 'playoutDelayHint' });
    } catch (error) { channel.log.add('jitter-target-error', { message: String(error) }); }
  }
  private async updateStats(channel: Channel) {
    if (!channel.peer || !streamConfig.diagnostics) return;
    try {
      const result = await collectStats(channel.peer, channel.previousStats, 'viewer'); channel.previousStats = result.report;
      const d: any = result.data; channel.stats = d; channel.log.sample({ stats: d, state: channel.machine.state, stability: { suppressed: channel.machine.suppressed, recreations: channel.machine.recreations, transitionsPerMinute: channel.machine.transitionsPerMinute, longestUnhealthyMs: channel.machine.longestUnhealthyMs } });
      if (d.packets != null && d.packets > (channel.lastPackets ?? -1)) { channel.lastPackets = d.packets; channel.lastTraffic = Date.now(); }
      if (streamConfig.adaptiveJitter) {
        channel.highJitterCount = d.jitterMs > 20 ? (channel.highJitterCount || 0) + 1 : 0;
        if (d.freezes != null && d.freezes > (channel.lastFreeze ?? d.freezes) || channel.highJitterCount >= 3) {
          this.setJitter(channel, Math.min(80, channel.jitterTarget + 10)); channel.lastJitterChange = Date.now(); channel.highJitterCount = 0;
        } else if (channel.jitterTarget > streamConfig.jitterMs && d.freezes === channel.lastFreeze && d.jitterMs != null && d.jitterMs < 10 && Date.now() - (channel.lastJitterChange || 0) > 30000) {
          this.setJitter(channel, Math.max(streamConfig.jitterMs, channel.jitterTarget - 10)); channel.lastJitterChange = Date.now();
        }
      }
      if (d.freezes != null) channel.lastFreeze = d.freezes;
      this.checkHealth(channel, 'stats'); this.updateStatus();
    } catch (error) { channel.log.add('stats-error', { message: String(error) }); }
  }
  private updateProbe(channel: Channel) {
    const sample = latencySample(channel.video, channel.probeCanvas, channel.probeContext, Date.now() + (channel.signal?.offset || 0));
    if (sample == null) return;
    channel.samples.push(sample); if (channel.samples.length > 240) channel.samples.shift();
    channel.log.sample({ timecodeToVideoMs: sample }); this.updateStatus();
  }
  private checkHealth(channel: Channel, trigger: string) {
    const peer = channel.peer; if (!peer) return;
    if (peer.connectionState === 'connected') {
      if (channel.video.srcObject && [...(channel.video.srcObject as MediaStream).getVideoTracks()].some(track => track.muted)) { channel.machine.set('source-paused', 'track-muted'); return; }
      const live = Date.now() - Math.max(channel.lastTraffic || 0, channel.lastHeartbeat || 0) < 3000;
      if (live || !streamConfig.diagnostics) channel.machine.set('live', trigger);
      else channel.machine.set('degraded', 'no-heartbeat-or-packets');
    } else if (peer.connectionState === 'disconnected' || peer.iceConnectionState === 'disconnected') channel.machine.set('degraded', 'ice-disconnected');
    else if (peer.connectionState === 'failed' || peer.iceConnectionState === 'failed') channel.machine.set('recovering', 'ice-failed-wait-sender');
  }
}
