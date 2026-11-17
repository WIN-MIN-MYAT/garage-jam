import { CanvasTexture, createSystem, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from '@iwsdk/core';
import { emit, garageEvents } from '../events.js';
import { garageState } from '../garage-state.js';
import { registerGarageRoot, unregisterGarageRoot } from '../garage-visibility.js';
import { completedToday, focusMinutesToday, loadProgress, saveProgress, streakDays, type GarageProgress, type MuralSplat } from '../progress-store.js';
import { slotRules } from '../slot-rules.js';
import type { SlotPlacement } from '../placement-solver.js';
import type { Vec2 } from '../room-model.js';

type Task = { id: string; title: string; priority?: string | null; due?: string | null };
type CalendarEvent = { id: string; title: string; start: string | null; end: string | null; allDay: boolean };
type FocusState = { running: boolean; remaining: number; duration: number; phase: 'focus' | 'break' };

const boardInk = '#f5ecd7';
const boardBg = '#171b22';
const palette = ['#ff2d95', '#19e3ff', '#e8ff2a', '#ff8a1f', '#b388ff'];

function canvasTexture(width = 512, height = 384) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return { canvas, ctx: canvas.getContext('2d')!, texture };
}

function boardBase(ctx: CanvasRenderingContext2D, width: number, height: number, title: string) {
  ctx.fillStyle = boardBg; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#0d0d10'; ctx.lineWidth = 18; ctx.strokeRect(9, 9, width - 18, height - 18);
  ctx.fillStyle = '#ff2d95'; ctx.font = 'bold 18px "GarageDisplay", sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('GARAGE JAM / ' + title, 34, 46);
  ctx.strokeStyle = '#394150'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(34, 62); ctx.lineTo(width - 34, 62); ctx.stroke();
}

function fitted(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, start: number, maxLines = 3) {
  let size = start;
  let lines: string[] = [];
  do {
    ctx.font = `bold ${size}px "GarageDisplay", "GarageCJK", sans-serif`;
    lines = []; let line = '';
    for (const character of Array.from(text.toUpperCase())) {
      const next = line + character;
      if (ctx.measureText(next).width > maxWidth && line) { lines.push(line); line = character; }
      else line = next;
    }
    if (line) lines.push(line);
    size -= 2;
  } while (lines.length > maxLines && size > 16);
  return lines.slice(0, maxLines);
}

export class TaskBoardSystem extends createSystem({}) {
  private root = new Group();
  private content = new Map<string, { mesh: Mesh; texture: CanvasTexture }>();
  private tasks: Task[] = [];
  private calendar: CalendarEvent[] = [];
  private focus: FocusState = { running: false, remaining: 0, duration: 0, phase: 'focus' };
  private progress: GarageProgress = loadProgress();
  private mural = new Group();
  private splatMeshes = new Map<string, Group>();
  private built = false;
  private refreshTimer = 0;

  init() {
    this.root.name = 'Garage boards';
    this.mural.name = 'Progress mural';
    this.root.add(this.mural);
    this.world.scene.add(this.root);
    registerGarageRoot(this.root);
    const onBuilt = () => { this.built = true; this.schedule(); };
    const onTasks = (event: Event) => {
      const detail = (event as CustomEvent<{ tasks: Task[] }>).detail;
      this.tasks = detail?.tasks ?? [];
      this.schedule();
    };
    const onCalendar = (event: Event) => { this.calendar = (event as CustomEvent<CalendarEvent[]>).detail ?? []; this.schedule(); };
    const onFocus = (event: Event) => { this.focus = (event as CustomEvent<FocusState>).detail ?? this.focus; this.schedule(); };
    const onDone = () => { this.progress = loadProgress(); this.addSplat(); this.schedule(); };
    const onReset = () => { this.clear(); };
    garageEvents.addEventListener('garage-revealed', onBuilt);
    garageEvents.addEventListener('garage-props-rebuilt', onBuilt);
    garageEvents.addEventListener('tasks-updated', onTasks);
    garageEvents.addEventListener('calendar-events', onCalendar);
    garageEvents.addEventListener('focus-state', onFocus);
    garageEvents.addEventListener('task-done', onDone);
    garageEvents.addEventListener('progress-updated', () => { this.progress = loadProgress(); this.rebuildSplats(); this.schedule(); });
    garageEvents.addEventListener('garage-reset', onReset);
    if (location.hostname === 'localhost') {
      const system = this;
      (window as any).garageBoardDebug = {
        redraw: () => this.schedule(),
        addSplat: () => this.addSplat(),
        get splats() { return system.progress.mural.length; },
        get tasks() { return system.tasks.length; },
      };
    }
    void fetch('/api/state').then(response => response.ok ? response.json() : null).then((remote: GarageProgress | null) => {
      if (!remote || typeof remote !== 'object') return;
      const local = this.progress;
      const completed = { ...remote.completedByDay };
      for (const [day, count] of Object.entries(local.completedByDay)) completed[day] = Math.max(completed[day] ?? 0, count);
      const focus = { ...remote.focusMinutesByDay };
      for (const [day, minutes] of Object.entries(local.focusMinutesByDay)) focus[day] = Math.max(focus[day] ?? 0, minutes);
      const mural = new Map<string, MuralSplat>();
      for (const splat of [...(remote.mural ?? []), ...local.mural]) if (splat?.id) mural.set(splat.id, splat);
      this.progress = {
        completedByDay: completed,
        focusMinutesByDay: focus,
        mural: [...mural.values()].slice(-36),
        pinned: [...new Set([...(remote.pinned ?? []), ...local.pinned])].slice(0, 3),
        lastCompletion: local.lastCompletion ?? remote.lastCompletion ?? null,
      };
      saveProgress(this.progress);
      this.rebuildSplats();
      this.schedule();
    }).catch(() => { /* local progress is enough */ });
    this.cleanupFuncs.push(() => {
      garageEvents.removeEventListener('garage-revealed', onBuilt);
      garageEvents.removeEventListener('garage-props-rebuilt', onBuilt);
      garageEvents.removeEventListener('tasks-updated', onTasks);
      garageEvents.removeEventListener('calendar-events', onCalendar);
      garageEvents.removeEventListener('focus-state', onFocus);
      garageEvents.removeEventListener('task-done', onDone);
      garageEvents.removeEventListener('garage-reset', onReset);
      unregisterGarageRoot(this.root);
      this.clear();
      this.root.removeFromParent();
    });
  }

  private schedule() {
    if (!this.built || this.refreshTimer) return;
    this.refreshTimer = window.setTimeout(() => { this.refreshTimer = 0; this.refresh(); }, 80);
  }

  private clear() {
    for (const { mesh, texture } of this.content.values()) {
      mesh.geometry.dispose();
      (mesh.material as MeshBasicMaterial).dispose();
      texture.dispose();
      mesh.removeFromParent();
    }
    this.content.clear();
    for (const group of this.splatMeshes.values()) group.removeFromParent();
    this.splatMeshes.clear();
    this.mural.clear();
  }

  private wallFor(placement: SlotPlacement) {
    const room = garageState.room;
    if (!room) return null;
    return room.walls.find(wall => wall.id === placement.wallId) ?? null;
  }

  private normalFor(placement: SlotPlacement) {
    const wall = this.wallFor(placement);
    if (wall) return { x: wall.normal.x, z: wall.normal.z };
    const forward = garageState.room?.forward ?? { x: 0, z: -1 };
    return { x: -forward.x, z: -forward.z };
  }

  private boardPlacement(id: string) {
    return garageState.placements.find(placement => placement.slotId === id) ?? null;
  }

  private ensureBoard(id: string) {
    const placement = this.boardPlacement(id);
    if (!placement) return null;
    const rule = slotRules.find(item => item.id === id);
    if (!rule) return null;
    let entry = this.content.get(id);
    if (!entry) {
      const { ctx, canvas, texture } = canvasTexture();
      const mesh = new Mesh(new PlaneGeometry(rule.footprint.width, rule.height), new MeshBasicMaterial({ map: texture, transparent: true, side: DoubleSide, depthWrite: false }));
      mesh.name = `Board content ${id}`;
      mesh.renderOrder = 3;
      this.root.add(mesh);
      entry = { mesh, texture };
      this.content.set(id, entry);
      (entry as any).canvas = canvas;
      (entry as any).ctx = ctx;
    }
    const normal = this.normalFor(placement);
    const centerY = placement.position.y + rule.height * placement.scale / 2;
    const offset = placement.footprint.depth * placement.scale / 2 + 0.005;
    entry.mesh.position.set(placement.position.x + normal.x * offset, centerY, placement.position.z + normal.z * offset);
    entry.mesh.lookAt(placement.position.x + normal.x, centerY, placement.position.z + normal.z);
    entry.mesh.scale.setScalar(placement.scale);
    return entry as typeof entry & { ctx: CanvasRenderingContext2D; canvas: HTMLCanvasElement };
  }

  private refresh() {
    const stats = this.ensureBoard('stats-board');
    if (stats) {
      const ctx = stats.ctx, w = stats.canvas.width, h = stats.canvas.height;
      boardBase(ctx, w, h, 'STATS');
      ctx.fillStyle = boardInk; ctx.textAlign = 'left';
      ctx.font = 'bold 68px "GarageDisplay", sans-serif'; ctx.fillText(String(completedToday(this.progress)), 42, 158);
      ctx.font = 'bold 20px sans-serif'; ctx.fillText('TASKS TODAY', 44, 188);
      ctx.fillStyle = '#e8ff2a'; ctx.font = 'bold 58px "GarageDisplay", sans-serif'; ctx.fillText(`${focusMinutesToday(this.progress)}`, 42, 272);
      ctx.fillStyle = boardInk; ctx.font = 'bold 20px sans-serif'; ctx.fillText('FOCUS MIN', 44, 302);
      ctx.fillStyle = '#ff8a1f'; ctx.font = 'bold 42px "GarageDisplay", sans-serif'; ctx.fillText(`${streakDays(this.progress)}D`, 330, 158);
      ctx.fillStyle = boardInk; ctx.font = 'bold 18px sans-serif'; ctx.fillText('STREAK', 332, 188);
      ctx.fillStyle = '#19e3ff'; ctx.font = 'bold 18px sans-serif'; ctx.fillText(this.focus.running ? `FOCUS ${this.clock(this.focus.remaining)}` : 'READY TO FOCUS', 330, 250);
      stats.texture.needsUpdate = true;
    }
    const calendar = this.ensureBoard('calendar-board');
    if (calendar) {
      const ctx = calendar.ctx, w = calendar.canvas.width, h = calendar.canvas.height;
      ctx.fillStyle = '#644e53'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#eddcc7'; ctx.fillRect(14, 14, w - 28, h - 28);
      ctx.fillStyle = '#c8a098'; ctx.fillRect(197, 8, 118, 18);
      ctx.fillStyle = '#623b50'; ctx.font = '800 25px "GarageDisplay", sans-serif';
      ctx.fillText('TODAY', 37, 64);
      ctx.fillStyle = '#cbb4a7'; ctx.fillRect(37, 78, w - 74, 2);
      ctx.textAlign = 'left';
      if (!this.calendar.length) {
        ctx.fillStyle = '#403341'; ctx.font = 'bold 26px "GarageDisplay", sans-serif'; ctx.fillText('No events today', 38, 128);
        ctx.fillStyle = '#665254'; ctx.font = '18px sans-serif'; ctx.fillText('Connect Google Calendar in Plugins.', 38, 159);
      } else {
        this.calendar.slice(0, 3).forEach((event, index) => {
          const y = 112 + index * 76;
          const time = event.allDay ? 'ALL DAY' : event.start ? new Date(event.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
          ctx.fillStyle = '#79405c'; ctx.font = 'bold 18px sans-serif'; ctx.fillText(time, 38, y);
          ctx.fillStyle = '#403341'; ctx.font = 'bold 22px "GarageDisplay", sans-serif';
          ctx.fillText(fitted(ctx, event.title, 400, 22, 1)[0] ?? event.title, 38, y + 28, 420);
        });
      }
      calendar.texture.needsUpdate = true;
    }
    const cork = this.ensureBoard('corkboard');
    if (cork) {
      const ctx = cork.ctx, w = cork.canvas.width, h = cork.canvas.height;
      ctx.fillStyle = '#745144'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#b78a67'; ctx.fillRect(13, 13, w - 26, h - 26);
      ctx.strokeStyle = '#91664e'; ctx.lineWidth = 2; ctx.strokeRect(15, 15, w - 30, h - 30);
      let seed = 418;
      for (let i = 0; i < 360; i++) {
        ctx.fillStyle = i % 3 ? 'rgba(78,42,32,0.19)' : 'rgba(255,221,170,0.29)';
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        ctx.fillRect(18 + (seed >>> 16) % (w - 38), 18 + (seed & 0xffff) % (h - 38), 2 + i % 3, 2);
      }
      ctx.fillStyle = '#f5dfb7'; ctx.fillRect(32, 28, 135, 36);
      ctx.fillStyle = '#4b302d'; ctx.font = '800 23px "GarageDisplay", sans-serif';
      ctx.fillText('TOP 3', 46, 54);
      const ranked = [...this.tasks].sort((a, b) => {
        const pin = this.progress.pinned.indexOf(a.id) - this.progress.pinned.indexOf(b.id);
        if (pin && this.progress.pinned.includes(a.id) !== this.progress.pinned.includes(b.id)) return this.progress.pinned.includes(a.id) ? -1 : 1;
        const weight = { high: 0, medium: 1, low: 2 } as Record<string, number>;
        return (weight[(a.priority ?? '').toLowerCase()] ?? 3) - (weight[(b.priority ?? '').toLowerCase()] ?? 3);
      }).slice(0, 3);
      if (!ranked.length) {
        ctx.fillStyle = '#4b302d'; ctx.font = 'bold 24px "GarageDisplay", sans-serif'; ctx.fillText('No papers yet', 38, 128);
      }
      ranked.forEach((task, index) => {
        const y = 82 + index * 84;
        ctx.fillStyle = 'rgba(83,48,34,0.32)'; ctx.fillRect(42, y + 5, w - 80, 67);
        ctx.fillStyle = index % 2 ? '#f3dfae' : '#f9ebce'; ctx.fillRect(38, y, w - 80, 67);
        ctx.fillStyle = ['#a74463', '#4c7774', '#ac642f'][index];
        ctx.beginPath(); ctx.arc(55, y + 12, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#382a2c'; ctx.font = 'bold 22px "GarageDisplay", sans-serif';
        ctx.fillText(fitted(ctx, task.title, 380, 22, 1)[0] ?? task.title, 72, y + 34, 380);
        if (this.progress.pinned.includes(task.id)) {
          ctx.fillStyle = '#79405c'; ctx.font = 'bold 14px sans-serif'; ctx.fillText('PINNED', 72, y + 55);
        }
      });
      cork.texture.needsUpdate = true;
    }
    const whiteboard = this.ensureBoard('whiteboard');
    if (whiteboard) {
      const ctx = whiteboard.ctx, w = whiteboard.canvas.width, h = whiteboard.canvas.height;
      const enamel = ctx.createLinearGradient(0, 0, 0, h);
      enamel.addColorStop(0, '#f8f5e9');
      enamel.addColorStop(1, '#e8e1d2');
      ctx.fillStyle = enamel; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#655d66'; ctx.lineWidth = 12; ctx.strokeRect(6, 6, w - 12, h - 12);
      ctx.fillStyle = '#6e3d56'; ctx.font = 'bold 24px "GarageDisplay", sans-serif'; ctx.fillText('WORKSHOP BOARD', 34, 48);
      ctx.fillStyle = '#c5bdb1'; ctx.fillRect(34, 60, w - 68, 2);
      ctx.fillStyle = '#403341';
      if (this.focus.running) {
        ctx.font = 'bold 38px "GarageDisplay", sans-serif'; ctx.fillText(this.clock(this.focus.remaining), 35, 108);
        ctx.font = 'bold 17px sans-serif'; ctx.fillText(this.focus.phase === 'focus' ? 'Focus session' : 'On break', 145, 105);
      } else {
        ctx.font = 'bold 19px sans-serif'; ctx.fillText('Start Focus from the wrist menu.', 35, 103);
      }
      ctx.fillStyle = '#665760'; ctx.font = 'bold 18px sans-serif'; ctx.fillText(`${completedToday(this.progress)} done today  /  ${streakDays(this.progress)} day streak`, 35, h - 29);
      whiteboard.texture.needsUpdate = true;
    }
    for (const [id, entry] of this.content) entry.mesh.visible = !!this.boardPlacement(id);
  }

  private clock(seconds: number) {
    const value = Math.max(0, Math.round(seconds));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
  }

  private addSplat() {
    const room = garageState.room;
    if (!room) return;
    const count = this.progress.mural.length;
    const wall = this.bestWall();
    if (!wall) return;
    const length = Math.hypot(wall.p1.x - wall.p0.x, wall.p1.z - wall.p0.z) || 1;
    const t = 0.12 + ((count * 0.137) % 0.76);
    const point = { x: wall.p0.x + (wall.p1.x - wall.p0.x) * t, z: wall.p0.z + (wall.p1.z - wall.p0.z) * t };
    const normal = this.normalFor({ wallId: wall.id } as SlotPlacement);
    const splat: MuralSplat = {
      id: `splat-${Date.now()}-${count}`,
      wallId: wall.id,
      x: point.x + normal.x * 0.018,
      y: 1.1 + ((count * 0.083) % 0.65),
      z: point.z + normal.z * 0.018,
      normalX: normal.x,
      normalZ: normal.z,
      size: 0.28 + ((count * 0.071) % 0.22),
      color: palette[count % palette.length],
      rotation: ((count * 1.37) % Math.PI) - Math.PI / 2,
    };
    this.progress.mural = [...this.progress.mural, splat].slice(-36);
    saveProgress(this.progress);
    this.buildSplat(splat);
    emit('mural-updated', { count: this.progress.mural.length });
  }

  private bestWall() {
    const room = garageState.room;
    if (!room?.walls.length) return null;
    const door = garageState.placements.find(placement => placement.slotId === 'door');
    return [...room.walls].sort((a, b) => {
      const length = (wall: typeof a) => Math.hypot(wall.p1.x - wall.p0.x, wall.p1.z - wall.p0.z);
      const penal = (wall: typeof a) => door?.wallId === wall.id ? 1.4 : 1;
      return length(b) / penal(b) - length(a) / penal(a);
    })[0];
  }

  private buildSplat(splat: MuralSplat) {
    if (this.splatMeshes.has(splat.id)) return;
    const group = new Group();
    group.name = `Mural splat ${splat.id}`;
    const texture = this.splatTexture(splat.color);
    for (const [offset, color, opacity] of [[0.012, '#0d0d10', 0.9], [0, '#ffffff', 1]] as const) {
      const mesh = new Mesh(new PlaneGeometry(splat.size, splat.size), new MeshBasicMaterial({ map: texture, color, transparent: true, opacity, depthWrite: false }));
      mesh.position.set(splat.x + splat.normalX * offset, splat.y, splat.z + splat.normalZ * offset);
      mesh.lookAt(splat.x + splat.normalX, splat.y, splat.z + splat.normalZ);
      mesh.rotateZ(splat.rotation + (offset ? 0.08 : 0));
      group.add(mesh);
    }
    this.mural.add(group);
    this.splatMeshes.set(splat.id, group);
  }

  private splatTexture(color: string) {
    const { canvas, ctx, texture } = canvasTexture(128, 128);
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = color;
    ctx.beginPath();
    const points = 14;
    for (let i = 0; i <= points; i++) {
      const angle = (i / points) * Math.PI * 2;
      const radius = 28 + Math.sin(i * 2.7) * 12 + ((i * 17) % 13);
      const x = 64 + Math.cos(angle) * radius;
      const y = 64 + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill();
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      ctx.arc(20 + ((i * 31) % 92), 20 + ((i * 47) % 92), 3 + (i % 4), 0, Math.PI * 2);
      ctx.fill();
    }
    return texture;
  }

  private rebuildSplats() {
    for (const group of this.splatMeshes.values()) group.removeFromParent();
    this.splatMeshes.clear();
    this.mural.clear();
    for (const splat of this.progress.mural) this.buildSplat(splat);
  }
}
