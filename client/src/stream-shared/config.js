const query = new URLSearchParams(location.search);
const number = (name, fallback, min, max) => Math.min(max, Math.max(min, Number(query.get(name)) || fallback));
export const streamConfig = {
  diagnostics: query.get('stats') !== '0',
  logging: query.get('log') !== '0',
  probe: query.get('probe') === '1',
  graceMs: number('iceGrace', 5000, 1000, 30000),
  reconnectHysteresisMs: number('hysteresis', 3000, 0, 10000),
  minStatusMs: number('minStatus', 1500, 0, 10000),
  heartbeatMs: number('heartbeat', 1500, 500, 10000),
  statsMs: number('statsInterval', 1000, 500, 10000),
  maxRetries: number('maxRetries', 6, 1, 20),
  jitterMs: number('jitter', 0, 0, 80),
  adaptiveJitter: query.get('adaptiveJitter') === '1',
  preset: query.get('preset') || 'balanced',
  allowScreen: query.get('allowScreen') === '1',
  maxBitrate: 6000000,
};
export const presets = {
  fast: { width: 1280, height: 720, fps: 60, bitrate: 2500000 },
  balanced: { width: 1920, height: 1080, fps: 30, bitrate: 4000000 },
  weak: { width: 1600, height: 900, fps: 30, bitrate: 2000000 },
  sharp: { width: 2560, height: 1440, fps: 30, bitrate: 5000000 },
  multi: { width: 1280, height: 720, fps: 30, bitrate: 2000000 },
  low: { width: 1280, height: 720, fps: 15, bitrate: 1500000 },
};
export const formats = {
  best: {
    preset: 'balanced', bitrate: 4000000, degradation: 'maintain-resolution', contentHint: 'text',
    label: 'Best quality', detail: '1080p / 30 fps / sharp text',
  },
  lowLatency: {
    preset: 'fast', bitrate: 2500000, degradation: 'maintain-framerate', contentHint: 'motion',
    label: 'Lowest latency', detail: '720p / 60 fps / high motion',
  },
};
