export class SignalingClient {
  constructor(channel, role, log, config, onMessage, onStatus, signalUrl) {
    this.channel = channel; this.role = role; this.log = log; this.config = config;
    this.onMessage = onMessage; this.onStatus = onStatus;
    this.signalUrl = signalUrl;
    this.sessionId = crypto.randomUUID(); this.attempts = 0; this.stopped = false; this.replaced = false;
    this.clockBestRtt = Infinity; this.offset = 0;
  }
  start() { this.stopped = false; this.connect('start'); }
  send(message) {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify({ channel: this.channel, ...message })); return true;
  }
  connect(trigger) {
    if (this.stopped || this.replaced || this.ws?.readyState === WebSocket.CONNECTING || this.ws?.readyState === WebSocket.OPEN) return;
    this.log.add('ws-attempt', { trigger, attempt: this.attempts + 1 });
    const ws = new WebSocket(this.signalUrl ?? `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/signal`);
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempts = 0; this.log.add('ws-open'); this.onStatus('open');
      this.send({ type: 'join', role: this.role, sessionId: this.sessionId });
      this.pingBurst = Array.from({ length: 5 }, (_, i) => setTimeout(() => { if (this.ws === ws) this.ping(); }, i * 200));
      this.keepalive = setInterval(() => this.ping(), 12000);
    };
    ws.onmessage = event => {
      if (this.ws !== ws) return;
      let msg; try { msg = JSON.parse(event.data); } catch { return; }
      if (msg.type === 'clock-pong') {
        const rtt = Date.now() - msg.clientTime;
        if (rtt < this.clockBestRtt) { this.clockBestRtt = rtt; this.offset = msg.serverTime - (msg.clientTime + rtt / 2); this.log.offset = this.offset; this.log.add('clock-sync', { rttMs: rtt, offsetMs: this.offset }); }
      } else if (msg.type === 'replaced') {
        this.replaced = true; this.log.add('replaced', { by: msg.sessionId }); this.onStatus('replaced'); ws.close(4000, 'Replaced');
      } else this.onMessage(msg);
    };
    ws.onerror = () => this.log.add('ws-error');
    ws.onclose = event => {
      if (this.ws !== ws) return;
      clearInterval(this.keepalive); this.pingBurst?.forEach(clearTimeout); this.ws = null;
      this.log.add('ws-close', { code: event.code, reason: event.reason });
      if (event.code === 4000 && !this.replaced) { this.replaced = true; this.onStatus('replaced'); }
      if (this.stopped || this.replaced) return;
      this.onStatus('closed');
      if (++this.attempts > this.config.maxRetries) { this.onStatus('failed'); return; }
      const delay = Math.min(10000, 500 * 2 ** (this.attempts - 1)) * (0.8 + Math.random() * 0.4);
      this.retry = setTimeout(() => this.connect('socket-close'), delay);
    };
  }
  ping() { this.send({ type: 'clock-ping', clientTime: Date.now() }); }
  retryNow() { this.attempts = 0; clearTimeout(this.retry); this.connect('manual-retry'); }
  stop() { this.stopped = true; clearInterval(this.keepalive); clearTimeout(this.retry); this.pingBurst?.forEach(clearTimeout); this.ws?.close(); this.ws = null; }
}
