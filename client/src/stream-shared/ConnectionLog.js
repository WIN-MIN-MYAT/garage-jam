export class ConnectionLog {
  constructor(role, channel) {
    this.role = role;
    this.channel = channel;
    this.events = [];
    this.samples = [];
    this.offset = 0;
    this.enabled = new URLSearchParams(location.search).get('log') !== '0';
  }
  add(type, detail = {}) {
    if (!this.enabled) return null;
    const entry = { at: Date.now(), syncedAt: Date.now() + this.offset, role: this.role, channel: this.channel, type, ...detail };
    this.events.push(entry);
    if (this.events.length > 3000) this.events.shift();
    if (type !== 'stats') console.info('[stream]', entry);
    return entry;
  }
  sample(data) {
    if (!this.enabled) return;
    this.samples.push({ at: Date.now() + this.offset, ...data });
    if (this.samples.length > 7200) this.samples.shift();
  }
  async download() {
    let serverEvents = [];
    try { const response = await fetch(`/api/signal-log?channel=${encodeURIComponent(this.channel)}`); if (response.ok) serverEvents = await response.json(); }
    catch {}
    const blob = new Blob([JSON.stringify({ role: this.role, channel: this.channel, config: location.search, clockOffsetMs: this.offset, events: this.events, serverEvents, samples: this.samples }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = `garage-${this.role}-${this.channel}-${Date.now()}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
}
export function watchPeer(peer, log) {
  if (!log.enabled) return;
  for (const name of ['iceconnectionstatechange', 'connectionstatechange', 'signalingstatechange', 'icegatheringstatechange', 'negotiationneeded', 'icecandidateerror']) {
    peer.addEventListener(name, e => log.add(name, { ice: peer.iceConnectionState, connection: peer.connectionState, signaling: peer.signalingState, gathering: peer.iceGatheringState, errorCode: e.errorCode }));
  }
}
