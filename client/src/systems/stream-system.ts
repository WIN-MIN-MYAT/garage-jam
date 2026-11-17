import { CanvasTexture, createSystem, DoubleSide, Group, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, VideoTexture, VisibilityState } from '@iwsdk/core';
import { roomConfig } from '../room-config.js';
import { emit, garageEvents } from '../events.js';
import { garageState } from '../garage-state.js';
import { garageRootsVisible, registerGarageRoot, unregisterGarageRoot } from '../garage-visibility.js';
import { streamConfig } from '../stream-shared/config.js';
import { ConnectionLog, watchPeer } from '../stream-shared/ConnectionLog.js';
import { ConnectionStateMachine } from '../stream-shared/ConnectionStateMachine.js';
import { SignalingClient } from '../stream-shared/SignalingClient.js';
import { collectStats, show } from '../stream-shared/StreamStats.js';
import { latencySample, percentile } from '../stream-shared/LatencyProbe.js';
import { isUdpCandidate, udpOnlyDescription } from '../stream-shared/IcePolicy.js';

type Channel = {
  name: string; root: Group; screen: Mesh; video: HTMLVideoElement; placeholder: CanvasTexture;
  signal?: any; peer?: RTCPeerConnection; log: any; machine: any; generation: number; remoteSession?: string;
  pendingCandidates: Map<number, RTCIceCandidateInit[]>; previousStats?: RTCStatsReport; lastPackets?: number; lastTraffic?: number; lastHeartbeat?: number;
  statsTimer?: number; probeTimer?: number; frameCallback?: number; texture?: VideoTexture; stats?: any; samples: number[];
  probeCanvas: HTMLCanvasElement; probeContext: CanvasRenderingContext2D; jitterTarget: number; lastFreeze?: number; lastFrame?: number;
  lastJitterChange?: number;
  highJitterCount?: number;
  pairingStart?: number;
  peerCreatedOnce?: boolean;
};
function placeholder(index: number) {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 576;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#101822'; ctx.fillRect(0, 0, 1024, 576);
  ctx.strokeStyle = '#f254aa'; ctx.lineWidth = 18; ctx.strokeRect(12, 12, 1000, 552);
  ctx.fillStyle = '#ffe3a2'; ctx.textAlign = 'center'; ctx.font = 'bold 60px sans-serif'; ctx.fillText(`MONITOR ${index}`, 512, 265);
  ctx.font = '32px sans-serif'; ctx.fillText('Waiting for Chrome sender', 512, 340);
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; return texture;
}
export class StreamSystem extends createSystem({}) {
  private channels: Channel[] = [];
  private active = true;
  private diagnosticsVisible = true;
  init() {
    const config = roomConfig.monitors;
    const query = new URLSearchParams(location.search);
    const count = Math.max(1, Math.min(3, Number(query.get('monitors')) || config.count));
    for (let i = 0; i < count; i++) {
      const angle = (i - (count - 1) / 2) * config.stepDegrees * Math.PI / 180;
      const root = new Group(); root.name = `Monitor ${i + 1}`;
      root.position.set(Math.sin(angle) * config.radius, config.height, -Math.cos(angle) * config.radius);
      root.rotation.y = -angle;
      const ph = placeholder(i + 1);
      const screen = new Mesh(new PlaneGeometry(1.25, 0.7), new MeshBasicMaterial({ map: ph, side: DoubleSide }));
      screen.name = `Monitor ${i + 1} video`; root.add(screen);
      const frame = new Mesh(new PlaneGeometry(1.31, 0.76), new MeshBasicMaterial({ color: 0xf44ca5, side: DoubleSide }));
      frame.position.z = -0.008; root.add(frame);
      const bezel = new Mesh(new PlaneGeometry(1.4, 0.85), new MeshBasicMaterial({ color: 0x0d0d10, side: DoubleSide }));
      bezel.position.z = -0.016; root.add(bezel);
      root.visible = new URLSearchParams(location.search).get('demo') === '1';
      this.world.createTransformEntity(root);
      registerGarageRoot(root);
      const video = document.createElement('video'); video.muted = true; video.autoplay = true; video.playsInline = true;
      video.disableRemotePlayback = true; video.controls = false; video.style.cssText = 'position:absolute;width:1px;height:1px;left:-10000px;top:-10000px'; document.body.append(video);
      const probeCanvas = document.createElement('canvas');
      const channel: Channel = { name: `monitor${i + 1}`, root, screen, video, placeholder: ph, log: null, machine: null, generation: -1, pendingCandidates: new Map(), samples: [], probeCanvas, probeContext: probeCanvas.getContext('2d', { willReadFrequently: true })!, jitterTarget: streamConfig.jitterMs };
      channel.log = new ConnectionLog('viewer', channel.name);
      channel.machine = new ConnectionStateMachine(channel.log, streamConfig, () => this.updateStatus());
      for (const name of ['stalled', 'waiting', 'playing', 'pause', 'emptied', 'resize']) video.addEventListener(name, () => channel.log.add(`video-${name}`));
      this.channels.push(channel);
      this.connect(channel);
    }
    this.updateStatus();
    const onLayout = () => this.layout();
    const onRefresh = () => this.updateStatus();
    const onForget = () => this.forget();
    const onRecenter = () => this.layout();
    const onMode = () => this.layout();
    const onPassthrough = () => { if (garageRootsVisible()) this.layout(); };
    const onOverlay = (event: Event) => { if (!(event as CustomEvent<boolean>).detail) this.layout(); };
    garageEvents.addEventListener('garage-revealed', onLayout);
    garageEvents.addEventListener('stream-refresh', onRefresh);
    garageEvents.addEventListener('stream-forget', onForget);
    garageEvents.addEventListener('stream-recenter', onRecenter);
    garageEvents.addEventListener('mode-changed', onMode);
    garageEvents.addEventListener('garage-passthrough-changed', onPassthrough);
    garageEvents.addEventListener('device-marking-active', onOverlay);
    garageEvents.addEventListener('table-confirm-visibility', onOverlay);
    this.cleanupFuncs.push(() => {
      garageEvents.removeEventListener('garage-revealed', onLayout);
      garageEvents.removeEventListener('stream-refresh', onRefresh);
      garageEvents.removeEventListener('stream-forget', onForget);
      garageEvents.removeEventListener('stream-recenter', onRecenter);
      garageEvents.removeEventListener('mode-changed', onMode);
      garageEvents.removeEventListener('garage-passthrough-changed', onPassthrough);
      garageEvents.removeEventListener('device-marking-active', onOverlay);
      garageEvents.removeEventListener('table-confirm-visibility', onOverlay);
      for (const channel of this.channels) unregisterGarageRoot(channel.root);
    });
    if (location.hostname === 'localhost') {
      (window as any).garageStreamDebug = {
        recenter: () => this.layout(),
        get states() { return system.channels.map(channel => ({ name: channel.name, state: channel.machine.state, live: channel.machine.state === 'live' })); },
      };
      const system = this;
    }
    this.cleanupFuncs.push(this.world.visibilityState.subscribe(state => {
      this.channels.forEach(channel => channel.log.add('xr-visibility', { state }));
      if (state === VisibilityState.Visible) this.channels.forEach(channel => this.checkHealth(channel, 'xr-visible'));
    }));
    const visibility = () => this.channels.forEach(channel => { channel.log.add('visibilitychange', { visibility: document.visibilityState }); if (document.visibilityState === 'visible') this.checkHealth(channel, 'page-visible'); });
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
    });
  }
  private layout() {
    const room = garageState.room;
    if (!room) return;
    const forwardLength = Math.hypot(room.forward.x, room.forward.z) || 1;
    const forward = { x: room.forward.x / forwardLength, z: room.forward.z / forwardLength };
    const right = { x: -forward.z, z: forward.x };
    const floor = room.floor.y;
    const height = Math.max((room.table?.topY ?? floor + 0.75) + 0.62, floor + 1.28);
    const distance = 1.75;
    this.channels.forEach((channel, index) => {
      const offset = (index - (this.channels.length - 1) / 2) * 0.68;
      channel.root.position.set(room.seat.x + forward.x * distance + right.x * offset, height, room.seat.z + forward.z * distance + right.z * offset);
      channel.root.lookAt(room.seat.x, height, room.seat.z);
      channel.root.visible = garageState.preferences.mode === 'streaming' && garageRootsVisible();
    });
  }

  private forget() {
    for (const channel of this.channels) {
      this.resetPeer(channel, 'forget');
      channel.machine.set('pairing', 'forget');
    }
    emit('status', 'Forgot paired laptop. Open /sender on Chrome to pair again.');
    this.updateStatus();
  }

  private updateStatus() {
    emit('streams', this.channels.map(channel => `${channel.name.slice(-1)}:${channel.machine.state}`).join('  '));
    emit('stream-status', this.channels.map(channel => ({
      name: channel.name, state: channel.machine.state, connected: channel.machine.state === 'live',
      live: channel.machine.state === 'live', stats: channel.stats,
    })));
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
    if (channel.frameCallback != null && 'cancelVideoFrameCallback' in channel.video) channel.video.cancelVideoFrameCallback(channel.frameCallback);
    if (channel.peer) { channel.log.add('peer-close', { reason }); channel.peer.close(); channel.peer = undefined; }
    channel.pendingCandidates.clear(); channel.previousStats = undefined; channel.video.srcObject = null;
    channel.lastPackets = undefined; channel.lastTraffic = undefined; channel.lastHeartbeat = undefined;
    const material = channel.screen.material as MeshBasicMaterial;
    if (channel.texture) { channel.texture.dispose(); channel.texture = undefined; }
    material.map = channel.placeholder; material.needsUpdate = true;
  }
  private connect(channel: Channel) {
    channel.signal = new SignalingClient(channel.name, 'viewer', channel.log, streamConfig, (msg: any) => void this.onMessage(channel, msg), (state: string) => {
      if (state === 'replaced') { this.resetPeer(channel, 'taken-over'); channel.machine.set('failed', 'taken over by another device'); }
      else if (state === 'failed' && !channel.peer) channel.machine.set('failed', 'signaling-retries-exhausted');
      else if (state === 'closed') channel.log.add('signaling-lost-media-kept');
    });
    channel.machine.set('pairing', 'viewer-start'); channel.signal.start();
  }
  private async onMessage(channel: Channel, msg: any) {
    try {
      if (msg.type === 'offer') {
        if (!Number.isInteger(msg.generation)) return;
        if (msg.generation < channel.generation) { channel.log.add('stale-offer', { generation: msg.generation }); return; }
        if (!channel.peer || msg.generation > channel.generation) this.makePeer(channel, msg.generation, 'new-offer');
        const peer = channel.peer!;
        if (peer.signalingState !== 'stable') { channel.log.add('offer-wrong-state', { signaling: peer.signalingState }); return; }
        await peer.setRemoteDescription(udpOnlyDescription(msg.sdp)); channel.log.add('set-remote-description', { type: 'offer', generation: msg.generation });
        for (const candidate of channel.pendingCandidates.get(msg.generation) || []) await peer.addIceCandidate(candidate);
        channel.pendingCandidates.delete(msg.generation);
        await peer.setLocalDescription(await peer.createAnswer()); channel.log.add('set-local-description', { type: 'answer', generation: msg.generation });
        channel.signal.send({ type: 'answer', sdp: udpOnlyDescription(peer.localDescription), generation: msg.generation });
      } else if (msg.type === 'ice-candidate' && Number.isInteger(msg.generation) && isUdpCandidate(msg.candidate)) {
        if (msg.generation < channel.generation) return;
        if (channel.peer && msg.generation === channel.generation && channel.peer.remoteDescription) await channel.peer.addIceCandidate(msg.candidate);
        else { const pending = channel.pendingCandidates.get(msg.generation) || []; pending.push(msg.candidate); channel.pendingCandidates.set(msg.generation, pending); }
      } else if (msg.type === 'leave' && msg.role === 'sender' && msg.sessionId === channel.remoteSession) {
        this.resetPeer(channel, 'sender-left'); channel.machine.set('pairing', 'sender-left'); channel.remoteSession = undefined;
      } else if (msg.type === 'peer-ready' && msg.role === 'sender') {
        channel.pairingStart = Date.now();
        if (channel.remoteSession && channel.remoteSession !== msg.sessionId) { this.resetPeer(channel, 'new-sender'); channel.generation = -1; }
        channel.remoteSession = msg.sessionId;
      } else if (msg.type === 'joined') channel.log.add('joined', { resumed: msg.resumed, peerPresent: msg.peerPresent });
    } catch (error) { channel.log.add('signal-message-error', { type: msg.type, message: String(error) }); channel.machine.set('failed', 'signal-error'); }
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
      channel.log.add('track', { kind: event.track.kind });
      event.track.onended = () => { channel.log.add('track-ended'); channel.machine.set('source-stopped', 'track-ended'); };
      event.track.onmute = () => { channel.log.add('track-muted'); channel.machine.set('source-paused', 'track-muted'); };
      event.track.onunmute = () => { channel.log.add('track-unmuted'); this.checkHealth(channel, 'track-unmuted'); };
      channel.video.srcObject = event.streams[0] || new MediaStream([event.track]);
      this.setJitter(channel, channel.jitterTarget);
      void channel.video.play().then(() => {
        if (channel.peer !== peer) return;
        const texture = new VideoTexture(channel.video); texture.colorSpace = SRGBColorSpace; texture.generateMipmaps = false; texture.minFilter = LinearFilter; texture.magFilter = LinearFilter;
        channel.texture = texture;
        const material = channel.screen.material as MeshBasicMaterial; material.map = texture; material.needsUpdate = true;
        const updateAspect = () => { if (channel.video.videoWidth) channel.screen.scale.x = (channel.video.videoWidth / channel.video.videoHeight) / (16 / 9); };
        channel.video.addEventListener('loadedmetadata', updateAspect, { once: true }); updateAspect();
        this.watchFrames(channel);
        this.checkHealth(channel, 'video-playing');
      }).catch(error => { channel.log.add('video-play-error', { message: String(error) }); channel.machine.set('failed', 'video-play-error'); });
    };
    channel.statsTimer = streamConfig.diagnostics ? window.setInterval(() => void this.updateStats(channel), streamConfig.statsMs) : undefined;
    channel.probeTimer = streamConfig.probe ? window.setInterval(() => this.updateProbe(channel), 250) : undefined;
    channel.machine.set('connecting', reason);
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
