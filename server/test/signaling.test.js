import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { attachSignaling, rewriteMdns, validChannel } from '../signaling.js';

test('mDNS host candidates are replaced only for private LAN signalling', () => {
  const candidate = 'candidate:1 1 udp 2122260223 abc-123.local 52444 typ host';
  assert.match(rewriteMdns(candidate, '192.168.1.25'), /192\.168\.1\.25 52444/);
  assert.equal(rewriteMdns(candidate, '203.0.113.5'), candidate);
  assert.equal(rewriteMdns(candidate, '::1'), candidate);
});

test('signalling channels support legacy and per-room names', () => {
  assert.equal(validChannel('monitor1'), true);
  assert.equal(validChannel('abcd1234:monitor1'), true);
  assert.equal(validChannel('abcd1234:monitor4'), false);
  assert.equal(validChannel('x:monitor1'), false);
});

test('socket rejoin preserves session, while a second owner is replaced', async () => {
  const server = createServer(), wss = attachSignaling(server);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `ws://127.0.0.1:${server.address().port}/signal`;
  const open = async () => { const ws = new WebSocket(url); await once(ws, 'open'); return ws; };
  const sender = await open(), viewer = await open();
  const received = (ws, type) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', onMessage); reject(new Error(`No ${type}`)); }, 1500);
    const onMessage = raw => { const msg = JSON.parse(raw); if (msg.type === type) { clearTimeout(timer); ws.off('message', onMessage); resolve(msg); } };
    ws.on('message', onMessage);
  });
  sender.send(JSON.stringify({ type: 'join', role: 'sender', channel: 'monitor1', sessionId: 'sender-a' }));
  viewer.send(JSON.stringify({ type: 'join', role: 'viewer', channel: 'monitor1', sessionId: 'viewer-a' }));
  await new Promise(resolve => setTimeout(resolve, 40));
  const pong = received(sender, 'clock-pong');
  sender.send(JSON.stringify({ type: 'clock-ping', channel: 'monitor1', clientTime: 1234 }));
  assert.equal((await pong).clientTime, 1234);
  let prematureLeave = false;
  const watchLeave = raw => { if (JSON.parse(raw).type === 'leave') prematureLeave = true; };
  viewer.on('message', watchLeave);
  sender.close(); await once(sender, 'close');
  await new Promise(resolve => setTimeout(resolve, 80));
  viewer.off('message', watchLeave);
  assert.equal(prematureLeave, false, 'a brief signaling loss must not notify the media peer of a leave');
  const resumed = await open(), joined = received(resumed, 'joined'), peerReady = received(resumed, 'peer-ready');
  resumed.send(JSON.stringify({ type: 'join', role: 'sender', channel: 'monitor1', sessionId: 'sender-a' }));
  assert.equal((await joined).resumed, true);
  assert.equal((await peerReady).sessionId, 'viewer-a');
  const takeover = await open(), replaced = received(resumed, 'replaced'), resumedClosed = once(resumed, 'close');
  takeover.send(JSON.stringify({ type: 'join', role: 'sender', channel: 'monitor1', sessionId: 'sender-b' }));
  assert.equal((await replaced).sessionId, 'sender-b');
  await resumedClosed;
  const stale = await open(), staleReplaced = received(stale, 'replaced'), staleClosed = once(stale, 'close');
  stale.send(JSON.stringify({ type: 'join', role: 'sender', channel: 'monitor1', sessionId: 'sender-a' }));
  assert.equal((await staleReplaced).sessionId, 'sender-b');
  await staleClosed;
  const legacy = await open(), legacyReplaced = received(legacy, 'replaced'), legacyClosed = once(legacy, 'close');
  legacy.send(JSON.stringify({ type: 'join', role: 'sender', channel: 'monitor1' }));
  assert.equal((await legacyReplaced).sessionId, 'sender-b');
  await legacyClosed;
  viewer.close(); takeover.close();
  await Promise.all([once(viewer, 'close'), once(takeover, 'close')]);
  await new Promise(resolve => wss.close(resolve)); server.close();
});

test('signaling isolates monitor channels and relays offers', async () => {
  const server = createServer();
  const wss = attachSignaling(server);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const url = `ws://127.0.0.1:${server.address().port}/signal`;
  const sender = new WebSocket(url, { headers: { 'x-forwarded-for': '192.168.1.25' } });
  const viewer = new WebSocket(url);
  await Promise.all([once(sender, 'open'), once(viewer, 'open')]);
  sender.send(JSON.stringify({ type: 'join', role: 'sender', channel: 'monitor1' }));
  viewer.send(JSON.stringify({ type: 'join', role: 'viewer', channel: 'monitor1' }));
  await new Promise(resolve => setTimeout(resolve, 50));
  const received = new Promise(resolve => viewer.once('message', data => resolve(JSON.parse(data))));
  sender.send(JSON.stringify({ type: 'offer', channel: 'monitor1', sdp: { type: 'offer', sdp: 'test' } }));
  assert.equal((await received).sdp.sdp, 'test');
  sender.close(); viewer.close();
  await Promise.all([once(sender, 'close'), once(viewer, 'close')]);
  await new Promise(resolve => wss.close(resolve));
  server.close();
});
