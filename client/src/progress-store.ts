export type MuralSplat = {
  id: string;
  wallId: string | null;
  x: number;
  y: number;
  z: number;
  normalX: number;
  normalZ: number;
  size: number;
  color: string;
  rotation: number;
};

export type GarageProgress = {
  completedByDay: Record<string, number>;
  focusMinutesByDay: Record<string, number>;
  mural: MuralSplat[];
  pinned: string[];
  lastCompletion: string | null;
};

const storageKey = 'garage-jam-progress-v1';
const empty = (): GarageProgress => ({ completedByDay: {}, focusMinutesByDay: {}, mural: [], pinned: [], lastCompletion: null });

function today(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function loadProgress(): GarageProgress {
  try {
    const stored = localStorage.getItem(storageKey);
    if (!stored) return empty();
    const parsed = JSON.parse(stored) as Partial<GarageProgress>;
    return {
      ...empty(),
      ...parsed,
      completedByDay: parsed.completedByDay ?? {},
      focusMinutesByDay: parsed.focusMinutesByDay ?? {},
      mural: Array.isArray(parsed.mural) ? parsed.mural : [],
      pinned: Array.isArray(parsed.pinned) ? parsed.pinned : [],
    };
  } catch { return empty(); }
}

export function saveProgress(progress: GarageProgress) {
  try { localStorage.setItem(storageKey, JSON.stringify(progress)); } catch { /* private mode */ }
  void fetch('/api/state', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(progress),
    keepalive: true,
  }).catch(() => { /* local progress still works offline */ });
}

export function addCompletion(progress: GarageProgress, at = today()) {
  progress.completedByDay[at] = (progress.completedByDay[at] ?? 0) + 1;
  progress.lastCompletion = new Date().toISOString();
  saveProgress(progress);
}

export function addFocusMinutes(progress: GarageProgress, minutes: number, at = today()) {
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  progress.focusMinutesByDay[at] = (progress.focusMinutesByDay[at] ?? 0) + minutes;
  saveProgress(progress);
}

export function completedToday(progress: GarageProgress) {
  return progress.completedByDay[today()] ?? 0;
}

export function focusMinutesToday(progress: GarageProgress) {
  return Math.round(progress.focusMinutesByDay[today()] ?? 0);
}

export function streakDays(progress: GarageProgress) {
  let streak = 0;
  for (let offset = 0; offset < 366; offset++) {
    if ((progress.completedByDay[today(-offset)] ?? 0) > 0) streak++;
    else if (offset === 0) continue;
    else break;
  }
  return streak;
}

export function clearMural(progress: GarageProgress) {
  progress.mural = [];
  saveProgress(progress);
}

export function resetProgress() {
  saveProgress(empty());
}

export function setPinned(progress: GarageProgress, pinned: string[]) {
  progress.pinned = [...new Set(pinned)].slice(0, 3);
  saveProgress(progress);
}
