import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeTimecode, latencySample, percentile } from '../../client/src/stream-shared/LatencyProbe.js';
import { ConnectionStateMachine } from '../../client/src/stream-shared/ConnectionStateMachine.js';

test('timecode decodes 32-bit timestamps and handles wraparound', () => {
  const stamp = 0xfffffff0;
  const bits = [1, 0, 1, 0, ...Array.from({ length: 32 }, (_, i) => (stamp >>> (31 - i)) & 1)];
  const pixels = new Uint8ClampedArray(360 * 4);
  bits.forEach((bit, i) => { for (let x = i * 10; x < (i + 1) * 10; x++) pixels[x * 4] = bit ? 255 : 0; });
  const context = { drawImage() {}, getImageData() { return { data: pixels }; } };
  const video = { videoWidth: 1152, videoHeight: 720 }, canvas = {};
  assert.equal(decodeTimecode(video, canvas, context), stamp);
  assert.equal(latencySample(video, canvas, context, 0x00000020), 48);
  pixels[5 * 4] = 0;
  assert.equal(decodeTimecode(video, canvas, context), null);
  assert.equal(percentile([10, 30, 20, 40], .5), 20);
});

test('short degraded state is suppressed by hysteresis', async () => {
  const events = [], machine = new ConnectionStateMachine({ add: (...args) => events.push(args) }, { reconnectHysteresisMs: 30, minStatusMs: 0 }, () => {});
  machine.set('live'); machine.set('degraded'); machine.set('live');
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(machine.state, 'live');
  assert.equal(machine.suppressed, 1);
  assert.equal(events.filter(([type, detail]) => type === 'status' && detail.state === 'degraded').length, 0);
  machine.dispose();
});
