import { drawTimecode } from '/stream-shared/LatencyProbe.js';
const canvas = document.getElementById('strip'), ctx = canvas.getContext('2d');
const clock = document.getElementById('clock');
let offset = 0, bestRtt = Infinity, ws, keepalive;
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/signal`);
  ws.onopen = () => { for (let i = 0; i < 5; i++) setTimeout(ping, i * 200); keepalive = window.setInterval(ping, 12000); };
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.type !== 'clock-pong') return;
    const rtt = Date.now() - msg.clientTime;
    if (rtt < bestRtt) { bestRtt = rtt; offset = msg.serverTime - (msg.clientTime + rtt / 2); }
  };
  ws.onclose = () => { clearInterval(keepalive); setTimeout(connect, 2000); };
}
function ping() { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'clock-ping', clientTime: Date.now() })); }
function frame() {
  const now = Date.now() + offset;
  drawTimecode(ctx, canvas.width, canvas.height, now >>> 0);
  clock.textContent = new Date(now).toISOString().slice(11, 23);
  requestAnimationFrame(frame);
}
connect(); frame();
