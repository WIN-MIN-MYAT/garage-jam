import config from './reveal.config.json';
import type { RevealBeatId } from './reveal-types.js';
import type { RevealMode } from '../app-flow/app-flow.js';

export type TimelineBeatId = RevealBeatId | 'welcome' | 'dissolve';
export type RevealBeat = {
  id: TimelineBeatId;
  start: number;
  duration: number;
  targets: string[];
  effect: string;
  sfx?: string;
};
export type RevealTimeline = {
  mode: RevealMode;
  duration: number;
  scale: number;
  fps: number;
  beats: RevealBeat[];
  roomDiagonal: number;
  reducedMotion: boolean;
  revealOff: boolean;
};

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const fullSfx: Partial<Record<RevealBeatId, string>> = {
  blueprint: 'draw', floor: 'spray', walls: 'whoosh', door: 'beam',
  stickers: 'sticker-snap', table: 'workbench-roller', props: 'thud', finish: 'chime',
};

export function roomScale(roomDiagonal: number) {
  return clamp(roomDiagonal / 6, 0.82, 1.18);
}

function scaledFullBeats(scale: number): RevealBeat[] {
  const entries = Object.entries(config.beats) as Array<[RevealBeatId, [number, number]]>;
  return entries.map(([id, [start, duration]]) => ({
    id,
    start: start * scale,
    duration: Math.max(0.12, duration * scale),
    targets: [id],
    effect: id === 'blueprint' ? 'blueprint' : id === 'finish' ? 'ready-pop' : id,
    sfx: fullSfx[id],
  }));
}

function quickBeats(scale: number): RevealBeat[] {
  const beats: RevealBeat[] = [
    { id: 'welcome', start: 0, duration: 0.18, targets: ['welcome'], effect: 'welcome-pop' },
    { id: 'floor', start: 0.1, duration: 0.75, targets: ['floor'], effect: 'floor', sfx: 'spray' },
    { id: 'walls', start: 0.53, duration: 1.12, targets: ['walls'], effect: 'walls', sfx: 'whoosh' },
    { id: 'stickers', start: 1.55, duration: 0.72, targets: ['stickers'], effect: 'stickers', sfx: fullSfx.stickers },
    { id: 'props', start: 1.25, duration: 1.26, targets: ['props'], effect: 'props', sfx: 'thud' },
    { id: 'finish', start: 2.55, duration: 0.55, targets: ['finish'], effect: 'ready-pop', sfx: 'chime' },
  ];
  return beats.map(beat => ({ ...beat, start: beat.start * scale, duration: Math.max(0.1, beat.duration * scale) }));
}

export function buildRevealTimeline(options: {
  mode: RevealMode;
  roomDiagonal?: number;
  speed?: number;
  reducedMotion?: boolean;
  revealOff?: boolean;
}): RevealTimeline {
  const roomDiagonal = options.roomDiagonal ?? 5;
  const scale = roomScale(roomDiagonal);
  const speed = clamp(options.speed ?? 1, 0.5, 3);
  const fps = config.quantizeFps;
  const reduced = options.reducedMotion === true;
  const off = options.revealOff === true || options.mode === 'off';
  if (off) {
    return { mode: 'off', duration: 0, scale, fps, beats: [], roomDiagonal, reducedMotion: reduced, revealOff: true };
  }
  if (reduced || options.mode === 'dissolve') {
    const duration = config.reducedDuration;
    return {
      mode: 'dissolve', duration, scale, fps, roomDiagonal, reducedMotion: true, revealOff: false,
      beats: [{ id: 'dissolve', start: 0, duration, targets: ['all'], effect: 'dissolve' }],
    };
  }
  if (options.mode === 'props') {
    return {
      mode: 'props', duration: 1.0, scale, fps, roomDiagonal, reducedMotion: false, revealOff: false,
      beats: [{ id: 'props', start: 0, duration: 0.92, targets: ['props'], effect: 'props', sfx: 'thud' }],
    };
  }
  if (options.mode === 'quick') {
    const quickScale = Math.min(scale, 3.45 / config.quickDuration) / speed;
    const beats = quickBeats(quickScale);
    const duration = Math.max(2, config.quickDuration * quickScale);
    return { mode: 'quick', duration, scale, fps, roomDiagonal, reducedMotion: false, revealOff: false, beats };
  }
  const baseFull = config.fullDuration * scale;
  const targetFull = clamp(baseFull, config.minDuration, config.maxDuration);
  const fullScale = (targetFull / config.fullDuration) / speed;
  const beats = scaledFullBeats(fullScale);
  const duration = Math.max(...beats.map(beat => beat.start + beat.duration));
  return { mode: 'full', duration, scale, fps, roomDiagonal, reducedMotion: false, revealOff: false, beats };
}

export function beatOf(timeline: RevealTimeline, id: TimelineBeatId): RevealBeat | null {
  return timeline.beats.find(beat => beat.id === id) ?? null;
}

export function beatProgress(beat: RevealBeat | null, elapsed: number, smooth = true) {
  if (!beat || beat.duration <= 0) return elapsed >= (beat?.start ?? 0) ? 1 : 0;
  const raw = clamp((elapsed - beat.start) / beat.duration, 0, 1);
  return smooth ? raw * raw * (3 - 2 * raw) : raw;
}

export function quantize(value: number, fps: number) {
  return Math.floor(value * fps) / fps;
}
