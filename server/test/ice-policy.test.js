import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUdpCandidate, udpOnlyDescription } from '../../client/src/stream-shared/IcePolicy.js';

test('only UDP candidates cross signaling', () => {
  const udp = 'candidate:1 1 udp 2122260223 192.168.1.5 52444 typ host';
  const tcp = 'candidate:2 1 tcp 1518280447 192.168.1.5 9 typ host tcptype active';
  assert.equal(isUdpCandidate({ candidate: udp }), true);
  assert.equal(isUdpCandidate({ candidate: tcp }), false);
  const sdp = `v=0\r\na=${udp}\r\na=${tcp}\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n`;
  const result = udpOnlyDescription({ type: 'offer', sdp });
  assert.match(result.sdp, /a=candidate:1 1 udp/);
  assert.doesNotMatch(result.sdp, /a=candidate:2 1 tcp/);
  assert.match(result.sdp, /m=video/);
});
