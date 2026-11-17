const BLOCKS = 36, MAGIC = [1, 0, 1, 0];
export function drawTimecode(ctx, width, height, timestamp) {
  const bits = [...MAGIC, ...Array.from({ length: 32 }, (_, i) => (timestamp >>> (31 - i)) & 1)];
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < BLOCKS; i++) {
    ctx.fillStyle = bits[i] ? '#fff' : '#000';
    ctx.fillRect(i * width / BLOCKS, 0, Math.ceil(width / BLOCKS), height);
  }
}
export function decodeTimecode(video, canvas, ctx) {
  if (!video.videoWidth || !video.videoHeight) return null;
  if (canvas.width !== 360) canvas.width = 360;
  if (canvas.height !== 24) canvas.height = 24;
  try {
    ctx.drawImage(video, 0, 0, video.videoWidth, Math.min(64, video.videoHeight), 0, 0, 360, 24);
    const pixels = ctx.getImageData(0, 12, 360, 1).data;
    const bits = Array.from({ length: BLOCKS }, (_, i) => pixels[(i * 10 + 5) * 4] > 128 ? 1 : 0);
    if (!MAGIC.every((bit, i) => bits[i] === bit)) return null;
    return bits.slice(4).reduce((number, bit) => (number * 2 + bit) >>> 0, 0);
  } catch { return null; }
}
export function latencySample(video, canvas, ctx, syncedNow) {
  const stamp = decodeTimecode(video, canvas, ctx);
  if (stamp == null) return null;
  const delay = ((syncedNow >>> 0) - stamp) >>> 0;
  return delay < 10000 ? delay : null;
}
export function percentile(samples, fraction) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(fraction * sorted.length) - 1];
}
