import { WebSocketServer, WebSocket } from 'ws';

const channelPattern = /^[A-Za-z0-9_-]{4,32}:monitor[123]$/;
export const validChannel = value => typeof value === 'string' && (/^monitor[123]$/.test(value) || channelPattern.test(value));
const signalEvents = [];
export const getSignalLog = channel => signalEvents.filter(event => !channel || event.channel === channel).slice(-3000);
const peerIp = request => (request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.socket.remoteAddress || '').replace(/^::ffff:/, '');
const privateIp = ip => /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[0-1])\.)/.test(ip);
export function rewriteMdns(candidate, ip) {
  if (typeof candidate !== 'string' || !privateIp(ip)) return candidate;
  return candidate.replace(/\b[a-zA-Z0-9-]+\.local\b/g, ip);
}
export function attachSignaling(server) {
  const rooms = new Map();
  const replacedSessions = new Map();
  const wss = new WebSocketServer({ server, path: '/signal' });
  let nextSocketId = 0;
  const send = (socket, data) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data)); };
  const log = (type, detail) => {
    if (process.env.GARAGE_SIGNAL_LOG === '0') return;
    const event = { at: Date.now(), type, ...detail };
    signalEvents.push(event); if (signalEvents.length > 10000) signalEvents.shift();
    console.info('[signal]', JSON.stringify(event));
  };
  const otherRole = role => role === 'sender' ? 'viewer' : 'sender';
  function remove(socket, explicit = false) {
    const { channel, role } = socket;
    if (!channel) return;
    const room = rooms.get(channel), entry = room?.[role];
    socket.channel = null;
    if (!entry || entry.socket !== socket) return;
    entry.socket = null;
    log(explicit ? 'leave' : 'socket-close', { channel, role, socketId: socket.id, sessionId: entry.sessionId });
    if (explicit) expire(channel, role, entry);
    else entry.timer = setTimeout(() => expire(channel, role, entry), 30000);
  }
  function expire(channel, role, entry) {
    const room = rooms.get(channel);
    if (room?.[role] !== entry || entry.socket) return;
    clearTimeout(entry.timer); delete room[role];
    log('session-expired', { channel, role, sessionId: entry.sessionId });
    send(room[otherRole(role)]?.socket, { type: 'leave', channel, role, sessionId: entry.sessionId });
    if (!room.sender && !room.viewer) rooms.delete(channel);
  }
  wss.on('connection', (socket, request) => {
    socket.id = ++nextSocketId;
    socket.peerIp = peerIp(request);
    socket.isAlive = true;
    log('socket-open', { socketId: socket.id, ip: socket.peerIp });
    socket.on('pong', () => { socket.isAlive = true; });
    socket.on('message', raw => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'clock-ping' && Number.isFinite(msg.clientTime)) {
        send(socket, { type: 'clock-pong', clientTime: msg.clientTime, serverTime: Date.now() }); return;
      }
      if (!validChannel(msg.channel)) return;
      if (msg.type === 'join') {
        if (!['sender', 'viewer'].includes(msg.role)) return;
        if (socket.channel) remove(socket, true);
        const room = rooms.get(msg.channel) || {};
        const previous = room[msg.role];
        const sessionId = typeof msg.sessionId === 'string' && msg.sessionId.length < 100 ? msg.sessionId : `legacy-${socket.id}`;
        if (sessionId.startsWith('legacy-') && previous?.socket) {
          send(socket, { type: 'replaced', channel: msg.channel, sessionId: previous.sessionId });
          socket.close(4000, 'Upgrade or close duplicate tab');
          log('rejected-legacy-duplicate', { channel: msg.channel, role: msg.role, socketId: socket.id });
          return;
        }
        const replacementKey = `${msg.channel}:${msg.role}:${sessionId}`;
        if (replacedSessions.get(replacementKey) > Date.now()) {
          send(socket, { type: 'replaced', channel: msg.channel, sessionId: room[msg.role]?.sessionId });
          socket.close(4000, 'Session was replaced');
          log('rejected-replaced-session', { channel: msg.channel, role: msg.role, socketId: socket.id, sessionId });
          return;
        }
        const resumed = previous?.sessionId === sessionId;
        if (previous) {
          clearTimeout(previous.timer);
          if (!resumed) replacedSessions.set(`${msg.channel}:${msg.role}:${previous.sessionId}`, Date.now() + 60000);
          if (previous.socket && previous.socket !== socket) {
            send(previous.socket, { type: 'replaced', channel: msg.channel, sessionId });
            previous.socket.close(4000, 'Replaced by new peer');
            log('replace', { channel: msg.channel, role: msg.role, oldSocketId: previous.socket.id, socketId: socket.id, resumed });
          }
        }
        room[msg.role] = { socket, sessionId, timer: null };
        rooms.set(msg.channel, room);
        socket.channel = msg.channel; socket.role = msg.role;
        log(resumed ? 'rejoin' : 'join', { channel: msg.channel, role: msg.role, socketId: socket.id, sessionId });
        send(socket, { type: 'joined', channel: msg.channel, role: msg.role, resumed, peerPresent: Boolean(room[otherRole(msg.role)]?.socket), peerSessionId: room[otherRole(msg.role)]?.sessionId });
        if (room[otherRole(msg.role)]?.socket) {
          if (!resumed) send(room[otherRole(msg.role)].socket, { type: 'peer-ready', channel: msg.channel, role: msg.role, sessionId });
          send(socket, { type: 'peer-ready', channel: msg.channel, role: otherRole(msg.role), sessionId: room[otherRole(msg.role)].sessionId });
        }
        return;
      }
      if (socket.channel !== msg.channel || rooms.get(msg.channel)?.[socket.role]?.socket !== socket) return;
      if (msg.type === 'leave') { remove(socket, true); return; }
      if (!['offer', 'answer', 'ice-candidate'].includes(msg.type)) return;
      if (msg.type === 'offer' && socket.role !== 'sender') return;
      if (msg.type === 'answer' && socket.role !== 'viewer') return;
      const other = rooms.get(msg.channel)?.[otherRole(socket.role)]?.socket;
      if (!other) return;
      if (msg.type === 'ice-candidate' && msg.candidate?.candidate) msg.candidate.candidate = rewriteMdns(msg.candidate.candidate, socket.peerIp);
      send(other, msg);
    });
    socket.on('close', (code, reason) => { log('ws-close', { channel: socket.channel, role: socket.role, socketId: socket.id, code, reason: reason.toString() }); remove(socket); });
  });
  const heartbeat = setInterval(() => {
    for (const [key, until] of replacedSessions) if (until < Date.now()) replacedSessions.delete(key);
    for (const socket of wss.clients) {
      if (socket.isAlive === false) { log('dead-socket', { socketId: socket.id }); socket.terminate(); continue; }
      socket.isAlive = false; socket.ping();
    }
  }, 15000);
  wss.on('close', () => { clearInterval(heartbeat); for (const room of rooms.values()) for (const entry of [room.sender, room.viewer]) clearTimeout(entry?.timer); rooms.clear(); replacedSessions.clear(); });
  return wss;
}
