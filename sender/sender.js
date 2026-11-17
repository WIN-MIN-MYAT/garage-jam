import { streamConfig, presets } from '/stream-shared/config.js';
import { ConnectionLog, watchPeer } from '/stream-shared/ConnectionLog.js';
import { ConnectionStateMachine } from '/stream-shared/ConnectionStateMachine.js';
import { SignalingClient } from '/stream-shared/SignalingClient.js';
import { collectStats, show } from '/stream-shared/StreamStats.js';
import { latencySample, percentile } from '/stream-shared/LatencyProbe.js';
import { isUdpCandidate, udpOnlyDescription } from '/stream-shared/IcePolicy.js';

const channels = document.getElementById('channels');
const states = new Map();
const named = state => `${state.channel} ${state.machine.state}`;
function send(state, message) { return state.signal?.send(message); }
function closePeer(state, reason) {
  clearTimeout(state.iceTimer); clearTimeout(state.recoveryTimer); clearInterval(state.heartbeatTimer); clearInterval(state.statsTimer); clearInterval(state.probeTimer);
  if (state.peer) { state.log.add('peer-close', { reason }); state.peer.close(); state.peer = null; }
  state.heartbeat = null; state.pendingCandidates.length = 0; state.previousStats = null;
  state.lastPackets = null; state.lastTraffic = null; state.lastHeartbeat = null; state.recovering = false; state.disconnectedAt = null;
}
function stop(state, reason = 'manual-stop') {
  closePeer(state, reason); state.signal?.stop(); state.signal = null;
  state.stream?.getTracks().forEach(track => track.stop()); state.stream = null;
  state.preview.srcObject = null; state.button.textContent = 'Start'; state.machine.set('idle', reason);
}
function setSource(state, event) {
  state.log.add(`source-${event}`);
  if (event === 'ended') {
    closePeer(state, 'source-stopped'); state.signal?.stop(); state.signal = null;
    state.stream = null; state.preview.srcObject = null; state.button.textContent = 'Re-share'; state.machine.set('source-stopped', 'track-ended');
  } else if (event === 'mute') state.machine.set('source-paused', 'track-muted');
  else if (state.peer?.connectionState === 'connected') state.machine.set('live', 'track-unmuted');
}
function makePeer(state, reason) {
  closePeer(state, reason);
  if (state.peerCreatedOnce) state.machine.recreations++;
  state.peerCreatedOnce = true;
  state.log.add('peer-create', { reason, recreations: state.machine.recreations });
  const peer = new RTCPeerConnection({ iceServers: [] }); state.peer = peer;
  watchPeer(peer, state.log);
  state.generation++;
  const generation = state.generation;
  peer.onicecandidate = event => { if (event.candidate && state.peer === peer) {
    if (isUdpCandidate(event.candidate)) send(state, { type: 'ice-candidate', candidate: event.candidate, generation });
    else state.log.add('candidate-rejected', { protocol: event.candidate.protocol });
  } };
  peer.oniceconnectionstatechange = () => connectionChanged(state);
  peer.onconnectionstatechange = () => connectionChanged(state);
  peer.onnegotiationneeded = () => { if (state.peer === peer && !state.negotiating && peer.signalingState === 'stable') void negotiate(state, 'negotiationneeded'); };
  const track = state.stream.getVideoTracks()[0];
  const transceiver = peer.addTransceiver(track, { direction: 'sendonly', streams: [state.stream] });
  const codecs = RTCRtpSender.getCapabilities?.('video')?.codecs;
  if (codecs && transceiver.setCodecPreferences) {
    const choice = state.codec.value.toLowerCase();
    const preferred = codec => codec.mimeType.toLowerCase() === `video/${choice}` && (choice !== 'h264' || /packetization-mode=1/.test(codec.sdpFmtpLine || ''));
    try {
      transceiver.setCodecPreferences([...codecs].sort((a, b) => Number(preferred(b)) - Number(preferred(a))));
      state.log.add('codec-preference', { choice, supported: codecs.some(preferred) });
    }
    catch (error) { state.log.add('codec-preference-error', { message: String(error) }); }
  }
  const heartbeat = peer.createDataChannel('heartbeat', { ordered: false, maxRetransmits: 0 }); state.heartbeat = heartbeat;
  heartbeat.onopen = () => {
    state.log.add('heartbeat-open');
    heartbeat.send(JSON.stringify({ type: 'ping', at: Date.now() }));
    state.heartbeatTimer = setInterval(() => {
      if (heartbeat.readyState === 'open') heartbeat.send(JSON.stringify({ type: 'ping', at: Date.now() }));
    }, streamConfig.heartbeatMs);
  };
  heartbeat.onmessage = event => { try { const msg = JSON.parse(event.data); if (msg.type === 'ack') { state.lastHeartbeat = Date.now(); state.heartbeatRtt = Date.now() - msg.at; if (state.peer?.connectionState === 'connected' && !state.stream?.getVideoTracks()[0]?.muted) state.machine.set('live', 'heartbeat'); } } catch {} };
  heartbeat.onclose = () => state.log.add('heartbeat-close');
  state.statsTimer = streamConfig.diagnostics ? setInterval(() => void updateStats(state), streamConfig.statsMs) : null;
  state.probeTimer = streamConfig.probe ? setInterval(() => updateProbe(state), 250) : null;
  state.machine.set('connecting', reason);
  return peer;
}
async function negotiate(state, caller) {
  const peer = state.peer;
  if (!peer || state.negotiating || !state.signal?.ws || state.signal.ws.readyState !== WebSocket.OPEN) return;
  if (peer.signalingState !== 'stable') return;
  state.negotiating = true;
  try {
    const sender = peer.getSenders().find(item => item.track?.kind === 'video');
    if (sender) await applyPreset(state, sender);
    state.log.add('create-offer', { caller, generation: state.generation });
    const offer = await peer.createOffer();
    if (state.peer !== peer) return;
    await peer.setLocalDescription(offer);
    state.log.add('set-local-description', { caller, generation: state.generation, type: 'offer' });
    send(state, { type: 'offer', sdp: udpOnlyDescription(peer.localDescription), generation: state.generation });
  } catch (error) { state.log.add('offer-error', { message: String(error) }); state.machine.set('failed', 'offer-error'); }
  finally { state.negotiating = false; }
}
async function applyPreset(state, sender) {
  const preset = presets[state.preset] || presets.balanced;
  const bitrate = Number(state.maxBitrate.value);
  const cap = Math.min(streamConfig.maxBitrate, bitrate > 0 ? bitrate * 1000000 : preset.bitrate);
  const params = sender.getParameters();
  params.encodings = [{ ...(params.encodings?.[0] || {}), maxBitrate: cap, maxFramerate: preset.fps }];
  params.degradationPreference = state.degradation.value;
  try {
    await sender.setParameters(params);
    state.log.add('sender-parameters', { maxBitrate: cap, degradationPreference: params.degradationPreference });
  } catch (error) {
    state.log.add('sender-parameters-fallback', { message: String(error) });
    try {
      const fallback = sender.getParameters();
      fallback.encodings = [{ ...(fallback.encodings?.[0] || {}), maxBitrate: cap, maxFramerate: preset.fps }];
      await sender.setParameters(fallback);
      state.log.add('sender-bitrate-cap', { maxBitrate: cap, degradationPreference: 'unsupported' });
    } catch (fallbackError) { state.log.add('sender-bitrate-cap-failed', { message: String(fallbackError) }); state.stats.textContent = `Bitrate cap unsupported: ${fallbackError.message}`; }
  }
}
function connectionChanged(state) {
  const peer = state.peer; if (!peer) return;
  state.log.add('connection-health', { connection: peer.connectionState, ice: peer.iceConnectionState });
  if (peer.connectionState === 'connected') {
    clearTimeout(state.iceTimer); clearTimeout(state.recoveryTimer);
    state.recovering = false; state.recoveryAttempts = 0; state.disconnectedAt = null;
    if (state.stream?.getVideoTracks()[0]?.muted) state.machine.set('source-paused', 'peer-connected-track-muted');
    else if (Date.now() - Math.max(state.lastTraffic || 0, state.lastHeartbeat || 0) < 3000) state.machine.set('live', 'peer-connected');
    else state.machine.set('connecting', 'awaiting-heartbeat');
  } else if (peer.connectionState === 'disconnected' || peer.iceConnectionState === 'disconnected') {
    state.disconnectedAt ||= Date.now();
    state.machine.set('degraded', 'ice-disconnected');
    if (!state.iceTimer) state.iceTimer = setTimeout(() => { state.iceTimer = null; if (state.peer === peer && ['disconnected', 'failed'].includes(peer.iceConnectionState)) restartIce(state, 'ice-grace-expired'); }, streamConfig.graceMs);
  } else if (peer.connectionState === 'failed' || peer.iceConnectionState === 'failed') restartIce(state, 'ice-failed');
}
function restartIce(state, reason) {
  const peer = state.peer; if (!peer || state.recovering) return;
  state.recovering = true; state.machine.set('recovering', reason); state.log.add('restart-ice', { reason, generation: state.generation });
  peer.restartIce();
  void negotiate(state, 'restart-ice');
  state.recoveryTimer = setTimeout(() => {
    state.recovering = false; state.recoveryTimer = null;
    if (state.peer !== peer || peer.connectionState === 'connected') return;
    if (state.recoveryAttempts++ >= 2) { state.machine.set('failed', 'ice-restart-failed'); return; }
    if (state.signal?.ws?.readyState === WebSocket.OPEN) { makePeer(state, 'ice-restart-failed'); void negotiate(state, 'peer-recreated'); }
  }, 10000);
}
async function onMessage(state, msg) {
  try {
    if (msg.type === 'peer-ready' && msg.role === 'viewer' && state.stream) {
      if (state.remoteSession === msg.sessionId && state.peer) return;
      state.remoteSession = msg.sessionId;
      makePeer(state, 'new-viewer'); void negotiate(state, 'peer-ready');
    } else if (msg.type === 'joined') {
      state.log.add('joined', { resumed: msg.resumed, peerPresent: msg.peerPresent });
      if (state.peer && state.recovering) void negotiate(state, 'signaling-restored');
      else if (state.peer?.iceConnectionState === 'failed' || state.peer?.iceConnectionState === 'disconnected' && Date.now() - (state.disconnectedAt || Date.now()) >= streamConfig.graceMs) restartIce(state, 'signaling-restored');
    } else if (msg.type === 'answer' && state.peer && msg.generation === state.generation && state.peer.signalingState === 'have-local-offer') {
      const peer = state.peer;
        await peer.setRemoteDescription(udpOnlyDescription(msg.sdp)); state.log.add('set-remote-description', { type: 'answer', generation: msg.generation });
      for (const candidate of state.pendingCandidates.splice(0)) await peer.addIceCandidate(candidate);
    } else if (msg.type === 'ice-candidate' && state.peer && msg.generation === state.generation && isUdpCandidate(msg.candidate)) {
      if (state.peer.remoteDescription) await state.peer.addIceCandidate(msg.candidate);
      else state.pendingCandidates.push(msg.candidate);
    } else if (msg.type === 'leave' && msg.role === 'viewer' && msg.sessionId === state.remoteSession) {
      closePeer(state, 'viewer-left'); state.remoteSession = null; state.machine.set('pairing', 'viewer-left');
    }
  } catch (error) { state.log.add('signal-message-error', { type: msg.type, message: String(error) }); }
}
async function updateStats(state) {
  if (!state.peer || !streamConfig.diagnostics) return;
  try {
    const result = await collectStats(state.peer, state.previousStats, 'sender'); state.previousStats = result.report;
    const d = result.data; state.log.sample({ stats: d, state: state.machine.state });
    if (d.packets != null && d.packets > (state.lastPackets ?? -1)) { state.lastPackets = d.packets; state.lastTraffic = Date.now(); }
    if (state.peer?.connectionState === 'connected' && !state.stream?.getVideoTracks()[0]?.muted && Date.now() - Math.max(state.lastTraffic || 0, state.lastHeartbeat || 0) < 3000) state.machine.set('live', 'stats-traffic');
    if (state.peer?.connectionState === 'connected' && Date.now() - Math.max(state.lastTraffic || 0, state.lastHeartbeat || 0) > 3000) state.machine.set('degraded', 'no-heartbeat-or-packets');
    const pathType = d.localType === 'host' && d.remoteType === 'host' && d.protocol === 'udp' ? 'DIRECT UDP' : d.localType === 'relay' || d.remoteType === 'relay' ? 'RELAY' : d.protocol === 'tcp' ? 'TCP' : d.localType === 'srflx' || d.remoteType === 'srflx' ? 'SERVER REFLEXIVE' : 'UNVERIFIED';
    const path = `${pathType} (${d.localType || 'n/a'}/${d.remoteType || 'n/a'} ${d.protocol || 'n/a'})`;
    const software = Boolean(d.implementation && /software|libvpx|openh264/i.test(d.implementation) || d.efficient === false);
    const warning = [d.localType === 'relay' || d.remoteType === 'relay' || d.protocol === 'tcp' ? '⚠ RELAY/TCP PATH' : '', software ? '⚠ SOFTWARE ENCODER' : ''].filter(Boolean).join(' ');
    state.stats.textContent = `Surface ${state.surface || 'n/a'} | ${show(d.width)}×${show(d.height)} ${show(d.fps)} fps | ${show(d.bitrateKbps)} kbps\nEncoder ${d.implementation || 'n/a'} | encode ${show(d.encodeMs, ' ms')} | ${d.quality || 'n/a'}\nPath ${path} | RTT ${show(d.rttMs, ' ms')} | heartbeat ${show(state.heartbeatRtt, ' ms')}\n${warning} | preview ${show(percentile(state.previewSamples, 0.5), ' ms')} | suppressed ${state.machine.suppressed} | peer creates ${state.machine.recreations}`;
    if (software && state.autoQuality.checked && !['multi', 'low'].includes(state.preset)) void lowerQuality(state, 'software-encoder');
    const overloaded = d.encodeMs > 25 || d.quality === 'cpu' || d.quality === 'bandwidth';
    if (overloaded && state.autoQuality.checked) { state.overloadCount++; state.stableSince = null; }
    else { state.overloadCount = 0; state.stableSince ||= Date.now(); }
    if (state.overloadCount >= 5) { state.overloadCount = 0; void lowerQuality(state, 'encode-overload'); }
    if (state.autoQuality.checked && !software && state.stableSince && Date.now() - state.stableSince > 120000 && Date.now() - (state.lastStepAt || 0) > 120000) void raiseQuality(state);
  } catch (error) { state.log.add('stats-error', { message: String(error) }); }
}
async function lowerQuality(state, reason) {
  const ladder = ['balanced', 'weak', 'multi', 'low'];
  const next = reason === 'software-encoder' ? 'multi' : ladder[Math.min(ladder.length - 1, Math.max(0, ladder.indexOf(state.preset)) + 1)];
  if (next === state.preset) return;
  state.preset = next; state.presetSelect.value = next; state.lastStepAt = Date.now(); state.stableSince = null; state.log.add('quality-step-down', { reason, preset: next });
  state.maxBitrate.value = '';
  const sender = state.peer?.getSenders().find(item => item.track?.kind === 'video');
  if (sender) await applyPreset(state, sender);
  try { await state.stream?.getVideoTracks()[0]?.applyConstraints({ width: { ideal: presets[next].width }, height: { ideal: presets[next].height }, frameRate: { ideal: presets[next].fps, max: presets[next].fps } }); }
  catch (error) { state.log.add('capture-constraint-unsupported', { message: String(error) }); }
}
async function raiseQuality(state) {
  const ladder = ['balanced', 'weak', 'multi', 'low'];
  const current = ladder.indexOf(state.preset), requested = ladder.indexOf(state.requestedPreset);
  if (current <= requested || current < 1 || requested < 0) return;
  const next = ladder[current - 1]; state.preset = next; state.presetSelect.value = next;
  state.lastStepAt = Date.now(); state.stableSince = null; state.log.add('quality-step-up', { preset: next });
  const sender = state.peer?.getSenders().find(item => item.track?.kind === 'video');
  if (sender) await applyPreset(state, sender);
  try { await state.stream?.getVideoTracks()[0]?.applyConstraints({ width: { ideal: presets[next].width }, height: { ideal: presets[next].height }, frameRate: { ideal: presets[next].fps, max: presets[next].fps } }); }
  catch (error) { state.log.add('capture-constraint-unsupported', { message: String(error) }); }
}
function updateProbe(state) {
  const sample = latencySample(state.preview, state.probeCanvas, state.probeContext, Date.now() + (state.signal?.offset || 0));
  if (sample != null) { state.previewSamples.push(sample); if (state.previewSamples.length > 120) state.previewSamples.shift(); state.log.sample({ previewLatencyMs: sample }); }
}
async function start(state) {
  if (state.stream) { stop(state); return; }
  try {
    const selected = state.presetSelect.value;
    state.requestedPreset = selected;
    const activeCount = [...states.values()].filter(item => item.stream).length;
    state.preset = activeCount && selected === 'balanced' ? 'multi' : selected;
    const p = presets[state.preset] || presets.balanced;
    const stream = await navigator.mediaDevices.getDisplayMedia({ monitorTypeSurfaces: 'exclude', video: { displaySurface: 'window', width: { ideal: p.width }, height: { ideal: p.height }, frameRate: { ideal: p.fps, max: p.fps }, cursor: 'always' }, audio: false });
    state.stream = stream; state.preview.srcObject = stream; void state.preview.play();
    const track = stream.getVideoTracks()[0]; track.contentHint = state.contentHint.value;
    state.surface = track.getSettings().displaySurface || 'unknown';
    if (track.getSettings().displaySurface === 'monitor' && !streamConfig.allowScreen) {
      stream.getTracks().forEach(item => item.stop()); state.stream = null; state.preview.srcObject = null;
      state.label.textContent = 'Choose an app window or tab, not the whole screen'; return;
    }
    track.onended = () => setSource(state, 'ended'); track.onmute = () => setSource(state, 'mute'); track.onunmute = () => setSource(state, 'unmute');
    state.log.add('capture-start', { preset: state.preset, settings: track.getSettings(), contentHint: track.contentHint, codec: state.codec.value, bitrateOverrideMbps: state.maxBitrate.value || null, degradation: state.degradation.value });
    state.button.textContent = 'Stop'; state.machine.set('pairing', 'capture-start');
    state.signal = new SignalingClient(state.channel, 'sender', state.log, streamConfig, msg => void onMessage(state, msg), status => {
      if (status === 'replaced') { closePeer(state, 'taken-over'); state.machine.set('failed', 'taken over by another device'); state.label.textContent = 'Taken over by another device'; }
      else if (status === 'failed' && !state.peer) state.machine.set('failed', 'signaling-retries-exhausted');
      else if (status === 'closed') state.log.add('signaling-lost-media-kept');
    });
    state.signal.start();
  } catch (error) { state.log.add('capture-error', { message: String(error) }); state.machine.set('failed', 'capture-failed'); state.label.textContent = `Capture failed: ${error.message}`; }
}
for (let i = 1; i <= 3; i++) {
  const section = document.createElement('section');
  section.innerHTML = `<h2>Monitor ${i}</h2><div class="controls"><button class="start">Start</button><span class="status">Idle</span></div><div class="controls"><label>Preset <select class="preset"><option value="balanced">1080p30 balanced</option><option value="fast">720p60 fast</option><option value="weak">900p30 weak laptop</option><option value="sharp">1440p30 sharp text</option><option value="multi">720p30 multi</option><option value="low">720p15 low</option></select></label><label>Content <select class="hint"><option>detail</option><option>text</option><option>motion</option></select></label><label>Codec <select class="codec"><option value="h264">H.264</option><option value="vp8">VP8</option><option value="vp9">VP9</option><option value="av1">AV1</option></select></label><label>Max Mbps <input class="bitrate" type="number" min="0.5" max="2" step="0.25" placeholder="2 cap" style="width:5em"></label><label>Degrade <select class="degradation"><option value="maintain-framerate">keep FPS</option><option value="maintain-resolution">keep resolution</option><option value="balanced">balanced</option></select></label><label><input class="auto" type="checkbox" checked> Auto quality</label></div><video muted autoplay playsinline></video><pre class="stats">Stats available after connection</pre><button class="record">Download run JSON</button> <button class="retry">Retry signaling</button>`;
  channels.append(section);
  const state = { channel: `monitor${i}`, button: section.querySelector('.start'), label: section.querySelector('.status'), preview: section.querySelector('video'), stats: section.querySelector('.stats'), presetSelect: section.querySelector('.preset'), contentHint: section.querySelector('.hint'), codec: section.querySelector('.codec'), maxBitrate: section.querySelector('.bitrate'), degradation: section.querySelector('.degradation'), autoQuality: section.querySelector('.auto'), stream: null, signal: null, peer: null, generation: 0, pendingCandidates: [], previewSamples: [], probeCanvas: document.createElement('canvas'), recoveryAttempts: 0, overloadCount: 0 };
  state.probeContext = state.probeCanvas.getContext('2d', { willReadFrequently: true });
  state.log = new ConnectionLog('sender', state.channel);
  state.machine = new ConnectionStateMachine(state.log, streamConfig, value => { state.label.textContent = value; });
  state.button.addEventListener('click', () => start(state));
  section.querySelector('.record').addEventListener('click', () => state.log.download());
  section.querySelector('.retry').addEventListener('click', () => state.signal?.retryNow());
  state.presetSelect.value = streamConfig.preset in presets ? streamConfig.preset : 'balanced';
  states.set(state.channel, state);
}
document.getElementById('timecode-link').href = '/sender/timecode';
window.addEventListener('pagehide', () => states.forEach(state => stop(state, 'pagehide')));
document.addEventListener('visibilitychange', () => states.forEach(state => state.log.add('visibilitychange', { visibility: document.visibilityState })));
document.addEventListener('freeze', () => states.forEach(state => state.log.add('page-freeze')));
document.addEventListener('resume', () => states.forEach(state => { state.log.add('page-resume'); if (state.peer) connectionChanged(state); }));
