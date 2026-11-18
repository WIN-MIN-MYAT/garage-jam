import { Color, createSystem, Group, Vector3, VisibilityState } from '@iwsdk/core';
import config from './reveal.config.json';
import { buildRevealTimeline, beatOf, beatProgress, quantize, type RevealTimeline } from './RevealTimeline.js';
import { RevealParticles } from './RevealParticles.js';
import { revealAudio } from './RevealAudio.js';
import type { RevealRuntime } from './reveal-types.js';
import type { RevealMode } from '../app-flow/app-flow.js';
import { revealModeFor, revealSpeed } from '../app-flow/app-flow.js';
import { garageState } from '../garage-state.js';
import { emit, garageEvents } from '../events.js';
import { GarageBuildSystem } from '../systems/garage-build-system.js';
import { comicWords, type ComicWordCue } from '../comic-word.js';
import { garageRootsVisible } from '../garage-visibility.js';

const query = new URLSearchParams(location.search);
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

export class RevealSystem extends createSystem({}) {
  private builder?: GarageBuildSystem;
  private runtime: RevealRuntime | null = null;
  private timeline: RevealTimeline | null = null;
  private mode: RevealMode = 'full';
  private requestedMode: RevealMode | null = null;
  private active = false;
  private finished = false;
  private elapsed = 0;
  private presenceProgress = 1;
  private presenceFade?: { from: number; to: 0 | 1; elapsed: number; duration: number };
  private readySpawned = false;
  private doorSoundStarted = false;
  private focusShutter = 0;
  private wallSoundStarted = false;
  private blueprintSoundStarted = false;
  private sunbeamSoundStarted = false;
  private stickerSoundStarted = false;
  private tableSoundStarted = false;
  private lampActivated = false;
  private audioVisible = false;
  private doorwayAudio = new Vector3();
  private doorwayOut = new Vector3();
  private roomAudio = new Vector3();
  private cuePosition = new Vector3();
  private hasDoorwayAudio = false;
  private sprayCursor = 0;
  private lampGlow: any = null;
  private fallbackStep = 0;
  private frameTimes = new Float32Array(20);
  private frameCursor = 0;
  private frameCount = 0;
  private frameAverageMs = 0;
  private framePaused = false;
  private dissolveStart = -1;
  private dissolveFrom: number[] = [];
  private lastDebugAt = 0;
  private particlesRoot = new Group();
  private particles?: RevealParticles;

  init() {
    this.builder = this.world.getSystem(GarageBuildSystem) ?? undefined;
    this.particlesRoot.name = 'Reveal particle pools';
    this.world.scene.add(this.particlesRoot);
    this.particles = new RevealParticles(this.particlesRoot);
    const particleBudget = clamp(Number(query.get('revealParticles') ?? config.particleBudget), 0, 200);
    this.particles.setBudget(Number.isFinite(particleBudget) ? particleBudget : config.particleBudget);
    const popBudget = Number(query.get('revealPops') ?? config.popBudget);
    this.particles.setPopBudget(Number.isFinite(popBudget) ? popBudget : config.popBudget);
    revealAudio.setVolume(garageState.preferences.revealSound ? garageState.preferences.sfxVolume : 0);

    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ mode?: RevealMode }>).detail;
      if (detail?.mode) this.requestedMode = detail.mode;
    };
    const onBuilt = () => this.startFromBuilder();
    const onPropsRebuilt = () => this.startPropsOnly();
    const onRoomEnter = () => this.enter();
    const onRoomLeave = () => this.leave();
    const onReset = () => {
      this.active = false;
      this.finished = false;
      this.presenceFade = undefined;
      this.presenceProgress = 1;
      this.runtime = null;
      this.timeline = null;
      this.particles?.clear();
      revealAudio.stopSpray();
      revealAudio.stopRevealSamples();
      revealAudio.stopGameplaySamples();
      revealAudio.updateAmbience(false, null);
    };
    const onStage = (event: Event) => {
      const stage = (event as CustomEvent<{ stage?: string }>).detail?.stage;
      if (stage === 'S11') this.requestedMode = 'quick';
    };
    const onFocusShutter = (event: Event) => {
      this.focusShutter = (event as CustomEvent<number>).detail;
      const door = this.runtime?.door;
      if (door) this.setDoorLighting(door.opacity);
    };
    const lastComicWord = new Map<ComicWordCue['word'], number>();
    const wordPoint = new Vector3();
    const head = new Vector3();
    const forward = new Vector3();
    const onComicWord = (event: Event) => {
      if (!this.audioVisible || this.presenceFade?.to === 0 || !garageRootsVisible() || garageState.preferences.reducedMotion) return;
      const { word, position } = (event as CustomEvent<ComicWordCue>).detail;
      const now = performance.now();
      if (now - (lastComicWord.get(word) ?? -Infinity) < (word === 'PIP.' ? 1800 : 400)) return;
      lastComicWord.set(word, now);
      const camera = this.world.camera;
      camera.getWorldPosition(head);
      if (position) {
        wordPoint.set(position.x, position.y + 0.12, position.z);
        forward.copy(wordPoint).sub(head);
        if (forward.lengthSq() < 0.49) wordPoint.copy(head).addScaledVector(forward.normalize(), 0.7);
      } else {
        wordPoint.copy(head).addScaledVector(camera.getWorldDirection(forward), 1.15);
        wordPoint.y -= 0.24;
      }
      const style = comicWords[word];
      this.particles?.spawnPop(word, wordPoint.x, wordPoint.y, wordPoint.z, style.scale, new Color(style.tint));
    };
    garageEvents.addEventListener('reveal-request', onRequest);
    garageEvents.addEventListener('garage-built', onBuilt);
    garageEvents.addEventListener('garage-props-rebuilt', onPropsRebuilt);
    garageEvents.addEventListener('garage-reset', onReset);
    garageEvents.addEventListener('room-enter', onRoomEnter);
    garageEvents.addEventListener('room-leave', onRoomLeave);
    garageEvents.addEventListener('app-flow-stage', onStage);
    garageEvents.addEventListener('focus-shutter', onFocusShutter);
    garageEvents.addEventListener('comic-word', onComicWord);
    const stopVisibility = this.world.visibilityState.subscribe(state => {
      this.audioVisible = state === VisibilityState.Visible;
      if (!this.audioVisible) {
        lastComicWord.clear();
        this.particles?.clearPops();
        revealAudio.stopSpray();
        revealAudio.updateAmbience(false, null);
        revealAudio.stopRevealSamples();
        revealAudio.stopGameplaySamples();
      }
      if (state === VisibilityState.Hidden || state === VisibilityState.NonImmersive) {
        if (this.active) this.finishReveal(true);
      }
    });
    const stopAudioFrame = this.world.onXRFrame(frame => {
      if (!this.audioVisible) return;
      const space = this.world.renderer.xr.getReferenceSpace();
      const pose = space && frame.getViewerPose(space);
      if (pose) revealAudio.updateListener(this.world.camera, pose.transform);
    });
    this.cleanupFuncs.push(() => {
      garageEvents.removeEventListener('reveal-request', onRequest);
      garageEvents.removeEventListener('garage-built', onBuilt);
      garageEvents.removeEventListener('garage-props-rebuilt', onPropsRebuilt);
      garageEvents.removeEventListener('garage-reset', onReset);
      garageEvents.removeEventListener('room-enter', onRoomEnter);
      garageEvents.removeEventListener('room-leave', onRoomLeave);
      garageEvents.removeEventListener('app-flow-stage', onStage);
      garageEvents.removeEventListener('focus-shutter', onFocusShutter);
      garageEvents.removeEventListener('comic-word', onComicWord);
      stopVisibility();
      stopAudioFrame();
      this.particles?.dispose();
      this.particlesRoot.removeFromParent();
      revealAudio.dispose();
    });

    if (location.hostname === 'localhost') {
      (window as any).garageRevealDebug = {
        get active() { return thisSystem.active; },
        get finished() { return thisSystem.finished; },
        get elapsed() { return thisSystem.elapsed; },
        get timeline() { return thisSystem.timeline; },
        get mode() { return thisSystem.mode; },
        get fallbackStep() { return thisSystem.fallbackStep; },
        get runtime() { return thisSystem.runtime; },
        finish: () => this.finishReveal(true),
        start: (mode: RevealMode) => { this.requestedMode = mode; this.startFromBuilder(); },
        leave: () => this.leave(),
        enter: () => this.enter(),
        get leaving() { return thisSystem.presenceFade?.to === 0; },
        forceFallback: () => this.applyFallback(),
        state: () => ({
          active: thisSystem.active, elapsed: thisSystem.elapsed, mode: thisSystem.mode,
          duration: thisSystem.timeline?.duration ?? 0, fallbackStep: thisSystem.fallbackStep,
          averageFrameMs: Math.round(thisSystem.frameAverageMs * 100) / 100,
          surfaces: thisSystem.runtime?.surfaces.map(surface => ({ id: surface.id, progress: surface.uniforms.uRevealProgress.value })) ?? [],
        }),
      };
    }
    const thisSystem = this;
  }

  private startFromBuilder() {
    if (!this.builder || this.active) return;
    const runtime = this.builder.getRevealRuntime();
    if (!runtime) return;
    this.runtime = runtime;
    const mode = this.requestedMode ?? this.pickMode();
    this.requestedMode = null;
    this.start(mode);
  }

  private pickMode(): RevealMode {
    const forced = query.get('revealMode') as RevealMode | null;
    if (forced === 'full' || forced === 'quick' || forced === 'dissolve' || forced === 'off' || forced === 'props') return forced;
    if (query.get('revealQuick') === '1') return 'quick';
    if (query.get('revealOff') === '1' || garageState.preferences.revealOff) return 'off';
    if (query.get('reducedMotion') === '1' || garageState.preferences.reducedMotion) return 'dissolve';
    return revealModeFor(garageState.preferences);
  }

  private start(mode: RevealMode) {
    const runtime = this.runtime;
    if (!runtime) return;
    revealAudio.stopSpray();
    revealAudio.stopRevealSamples();
    this.setAudioAnchors(runtime);
    this.mode = mode;
    this.timeline = buildRevealTimeline({
      mode,
      roomDiagonal: this.builder?.roomDiagonal() ?? 5,
      speed: revealSpeed(),
      reducedMotion: garageState.preferences.reducedMotion,
      revealOff: garageState.preferences.revealOff,
    });
    this.active = true;
    this.finished = false;
    this.presenceFade = undefined;
    this.presenceProgress = 1;
    this.elapsed = 0;
    this.readySpawned = false;
    this.doorSoundStarted = false;
    this.wallSoundStarted = false;
    this.blueprintSoundStarted = false;
    this.sunbeamSoundStarted = false;
    this.stickerSoundStarted = false;
    this.tableSoundStarted = false;
    this.lampActivated = false;
    this.sprayCursor = 0;
    this.sprayStarted = false;
    this.fallbackStep = 0;
    this.dissolveStart = -1;
    this.dissolveFrom = [];
    this.frameCount = 0;
    this.frameCursor = 0;
    this.frameTimes.fill(0);
    for (const surface of runtime.surfaces) {
      surface.uniforms.uRevealProgress.value = mode === 'props' ? 1.05 : 0;
      surface.uniforms.uRevealUseNoise.value = 1;
      surface.uniforms.uRevealUseDrips.value = 1;
      surface.uniforms.uRevealTime.value = 0;
    }
    if (runtime.blueprint) runtime.blueprint.group.visible = mode !== 'props';
    if (runtime.door) {
      const visible = mode === 'props' || this.timeline.duration === 0;
      this.setDoorOpacity(visible ? 1 : 0);
    }
    const lamp = runtime.props.find(prop => prop.id === 'lamp');
    this.lampGlow = lamp?.object.getObjectByName('Lamp glow') ?? null;
    if (this.lampGlow?.material) this.lampGlow.material.opacity = 0;
    for (const prop of runtime.props) {
      prop.landed = false;
      prop.object.visible = mode === 'props' ? prop.finalVisible : false;
      prop.object.position.copy(prop.basePosition);
      prop.object.scale.copy(prop.baseScale);
    }
    const showStickers = mode === 'props' || this.timeline.revealOff || this.timeline.reducedMotion;
    for (const sticker of runtime.stickers ?? []) {
      sticker.landed = showStickers;
      sticker.object.visible = showStickers;
      sticker.object.position.copy(sticker.basePosition);
      sticker.object.quaternion.copy(sticker.baseQuaternion);
      sticker.object.scale.copy(sticker.baseScale);
    }
    this.particles?.clear();
    const budget = clamp(Number(query.get('revealParticles') ?? config.particleBudget), 0, 200);
    this.particles?.setBudget(Number.isFinite(budget) ? budget : config.particleBudget);
    if (this.timeline.revealOff) {
      this.finishReveal(true);
      return;
    }
    emit('reveal-started', { mode, duration: this.timeline.duration });
    if (this.timeline.reducedMotion) {
      this.fallbackStep = Math.max(this.fallbackStep, 2);
      this.dissolveStart = 0;
      this.dissolveFrom = runtime.surfaces.map(() => 0);
      this.particles?.setBudget(0);
    }
  }

  update(delta: number) {
    const atmosphere = this.runtime?.door?.atmosphere;
    if (atmosphere && atmosphere.uniforms.uPresence.value > 0 && garageRootsVisible()) {
      const motion = garageState.preferences.reducedMotion ? 0 : 1;
      atmosphere.uniforms.uMotion.value = motion;
      atmosphere.uniforms.uTime.value += Math.min(delta, 0.1) * motion;
    }
    if (this.presenceFade) {
      this.stepPresenceFade(Math.min(delta, 0.1));
      this.particles?.update(Math.min(delta, 0.1));
      return;
    }
    if (this.active) {
      const dt = Math.min(delta, 0.1);
      this.elapsed += dt;
      if (this.dissolveStart >= 0) {
        this.stepDissolve();
      } else {
        this.stepReveal();
      }
      if (this.active) this.trackFrame(dt);
      if (this.active && this.timeline && this.elapsed >= this.timeline.duration) this.finishReveal(false);
    }
    if (this.audioVisible && garageRootsVisible() && this.presenceProgress > 0 && (this.finished || this.sunbeamSoundStarted) && this.runtime) {
      revealAudio.updateAmbience(true, this.hasDoorwayAudio ? this.doorwayAudio : null, this.roomAudio, this.doorwayOut);
    } else revealAudio.updateAmbience(false, null);
    this.particles?.update(Math.min(delta, 0.1));
    if (location.hostname === 'localhost' && this.active && performance.now() - this.lastDebugAt > 80) {
      this.lastDebugAt = performance.now();
      (window as any).garageRevealState = {
        elapsed: this.elapsed,
        mode: this.mode,
        duration: this.timeline?.duration ?? 0,
        fallbackStep: this.fallbackStep,
        radii: this.runtime?.surfaces.map(surface => surface.uniforms.uRevealProgress.value) ?? [],
      };
    }
  }

  private setAudioAnchors(runtime: RevealRuntime) {
    const room = garageState.room;
    const forward = room?.forward;
    this.roomAudio.set(runtime.seat.x + (forward?.x ?? 0) * 1.1, runtime.floorY + 0.9, runtime.seat.z + (forward?.z ?? -1) * 1.1);
    const door = garageState.placements.find(item => item.slotId === 'door');
    this.hasDoorwayAudio = !!(runtime.door && door);
    if (!door) return;
    this.doorwayAudio.set(door.position.x, runtime.floorY + 1.15, door.position.z);
    const wall = room?.walls.find(item => item.id === door.wallId);
    if (wall) this.doorwayOut.set(-wall.normal.x, 0, -wall.normal.z);
    else this.doorwayOut.set(door.position.x - runtime.seat.x, 0, door.position.z - runtime.seat.z);
    if (!this.doorwayOut.lengthSq()) this.doorwayOut.set(0, 0, -1);
    this.doorwayOut.normalize();
  }

  private stepReveal() {
    const runtime = this.runtime;
    const timeline = this.timeline;
    if (!runtime || !timeline) return;
    const time = Math.min(this.elapsed, timeline.duration);
    const inkTime = time >= timeline.duration ? time : quantize(time, timeline.fps);
    if (timeline.mode === 'props') {
      for (const surface of runtime.surfaces) surface.uniforms.uRevealProgress.value = 1.05;
      if (runtime.blueprint) runtime.blueprint.group.visible = false;
      this.setDoorOpacity(1);
      this.stepProps(time, beatOf(timeline, 'props'));
      return;
    }
    const floorBeat = beatOf(timeline, 'floor');
    const wallsBeat = beatOf(timeline, 'walls');
    const ceilingBeat = beatOf(timeline, 'ceiling');
    const tableBeat = beatOf(timeline, 'table');
    const doorBeat = beatOf(timeline, 'door');
    const finishBeat = beatOf(timeline, 'finish');
    const propsBeat = beatOf(timeline, 'props');
    const stickersBeat = beatOf(timeline, 'stickers');
    const blueprintBeat = beatOf(timeline, 'blueprint');
    const wallOrderRange = Math.max(1, (garageState.room?.walls.length ?? 1) - 1);
    let maxWallProgress = 0;
    let tableWipeVisible = false;

    for (const surface of runtime.surfaces) {
      let beatStart = 0, beatDuration = 0;
      let progress = 0;
      if (surface.beat === 'floor') {
        beatStart = floorBeat?.start ?? 0; beatDuration = floorBeat?.duration ?? 0;
        progress = beatProgress(floorBeat, time);
      } else if (surface.beat === 'walls') {
        const base = wallsBeat;
        if (base) {
          const wall = surface.id.startsWith('wall-');
          const stagger = wall ? Math.min(0.55, base.duration * 0.26) : 0;
          beatStart = base.start + stagger * surface.order / wallOrderRange;
          beatDuration = base.duration - stagger;
          progress = clamp((time - beatStart) / beatDuration, 0, 1);
          progress = progress * progress * (3 - 2 * progress);
        } else progress = timeline.mode === 'quick' ? 1 : 0;
      } else if (surface.beat === 'ceiling') {
        beatStart = ceilingBeat?.start ?? 0; beatDuration = ceilingBeat?.duration ?? 0;
        progress = timeline.mode === 'quick' ? 1 : beatProgress(ceilingBeat, time);
      } else if (surface.beat === 'table') {
        beatStart = tableBeat?.start ?? 0; beatDuration = tableBeat?.duration ?? 0;
        progress = timeline.mode === 'quick' ? 1 : beatProgress(tableBeat, time);
        tableWipeVisible = !!tableBeat && progress > 0;
      } else if (surface.beat === 'props') {
        progress = 1;
      }
      surface.start = beatStart;
      surface.duration = beatDuration;
      surface.uniforms.uRevealTime.value = inkTime;
      surface.uniforms.uRevealProgress.value = 1.05 * progress;
      if (surface.beat === 'walls' && surface.id.startsWith('wall-')) maxWallProgress = Math.max(maxWallProgress, progress);
    }

    if (runtime.blueprint) {
      const progress = beatProgress(blueprintBeat, time);
      const visible = !!blueprintBeat && time < blueprintBeat.start + blueprintBeat.duration;
      const fade = visible ? 1 - clamp((progress - 0.72) / 0.28, 0, 1) : 0;
      runtime.blueprint.group.visible = visible;
      runtime.blueprint.group.scale.setScalar(1 + 0.06 * (1 - progress));
      if (runtime.blueprint.lineMaterial) (runtime.blueprint.lineMaterial as any).opacity = fade * (0.17 + 0.24 * Math.sin(progress * Math.PI));
      const pulse = 1 + Math.sin(progress * Math.PI * 2) * 0.04;
      runtime.blueprint.ring.scale.setScalar(pulse);
      if (runtime.blueprint.ringMaterial) (runtime.blueprint.ringMaterial as any).opacity = fade * (0.28 + 0.12 * Math.sin(progress * Math.PI * 2));
    }
    if (runtime.door) {
      const target = timeline.mode === 'quick'
        ? Math.max(0, Math.min(1, (maxWallProgress - 0.68) / 0.32))
        : beatProgress(doorBeat, time);
      this.setDoorOpacity(target);
    }

    this.stepProps(time, propsBeat);
    this.stepStickers(inkTime, stickersBeat);

    const soundEnabled = this.canPlayRevealSound();
    if (wallsBeat && !this.wallSoundStarted && time >= wallsBeat.start) {
      this.wallSoundStarted = true;
      if (soundEnabled) {
        const surface = runtime.surfaces.find(item => item.id.startsWith('wall-') && item.order === 0);
        const wall = garageState.room?.walls.find(item => `wall-${item.id}` === surface?.id);
        const position = wall ? this.cuePosition.set((wall.p0.x + wall.p1.x) / 2, runtime.floorY + 0.95, (wall.p0.z + wall.p1.z) / 2) : this.roomAudio;
        revealAudio.playWhoosh(false, wallsBeat.start + wallsBeat.duration - time, position);
      }
    }
    if (tableBeat && tableWipeVisible && !this.tableSoundStarted) {
      this.tableSoundStarted = true;
      const table = garageState.room?.table;
      if (soundEnabled && table?.polygon.length && garageState.preferences.tableView === 'workbench') {
        const center = this.cuePosition.set(0, table.topY, 0);
        for (const vertex of table.polygon) {
          center.x += vertex.x / table.polygon.length;
          center.z += vertex.z / table.polygon.length;
        }
        revealAudio.playWorkbenchRoller(center, tableBeat.start + tableBeat.duration - time);
      }
    }
    if (doorBeat && runtime.door?.group.visible && !this.doorSoundStarted) {
      this.doorSoundStarted = true;
      if (soundEnabled) {
        revealAudio.playDoor(this.hasDoorwayAudio ? this.doorwayAudio : this.roomAudio, doorBeat.start + doorBeat.duration - time);
      }
    }
    if (doorBeat && runtime.door && !this.sunbeamSoundStarted && beatProgress(doorBeat, time) >= 0.75) {
      this.sunbeamSoundStarted = true;
      if (soundEnabled) revealAudio.playSunbeam(this.hasDoorwayAudio ? this.doorwayAudio : this.roomAudio);
    }
    if (blueprintBeat && runtime.blueprint && !this.blueprintSoundStarted && time >= blueprintBeat.start) {
      this.blueprintSoundStarted = true;
      if (soundEnabled) revealAudio.playBlueprint(blueprintBeat.start + blueprintBeat.duration - time, runtime.blueprint.ring.getWorldPosition(this.cuePosition));
    }

    if (floorBeat && time >= floorBeat.start && time < floorBeat.start + floorBeat.duration) {
      const progress = beatProgress(floorBeat, time);
      if (this.sprayCursor++ % 5 === 0) {
        const seat = runtime.seat;
        const angle = Math.random() * Math.PI * 2;
        const radius = 0.2 + progress * runtime.radius;
        const x = seat.x + Math.cos(angle) * radius;
        const z = seat.z + Math.sin(angle) * radius;
        this.particles?.spawnSpray(x, runtime.floorY + 0.02, z, 1);
        revealAudio.moveSpray({ x, y: runtime.floorY + 0.05, z });
      }
      if (!this.sprayStarted) {
        this.sprayStarted = true;
        this.particles?.spawnDust(runtime.seat.x, runtime.floorY + 0.5, runtime.seat.z, 4);
        if (soundEnabled) revealAudio.startSpray({ x: runtime.seat.x, y: runtime.floorY + 0.1, z: runtime.seat.z });
      }
    }
    if (floorBeat && time >= floorBeat.start + floorBeat.duration) {
      if (this.sprayStarted) { this.sprayStarted = false; revealAudio.stopSpray(); }
    }
    if (doorBeat) {
      const progress = beatProgress(doorBeat, time);
      if (progress > 0.05 && progress < 0.95 && this.sprayCursor++ % 8 === 0) {
        const door = runtime.door?.group;
        const center = door ? door.position : runtime.seat;
        this.particles?.spawnDust(center.x, runtime.floorY + 1.1, center.z, 1);
      }
    }
    if (finishBeat && !this.readySpawned && time >= finishBeat.start) {
      this.readySpawned = true;
      this.spawnReady(runtime);
      emit('reveal-ready');
    }
  }

  private canPlayRevealSound() {
    return this.audioVisible && garageState.preferences.revealSound;
  }

  private stepStickers(stepped: number, beat: ReturnType<typeof beatOf>) {
    const runtime = this.runtime;
    if (!beat || !runtime?.stickers?.length) return;
    const stickers = runtime.stickers;
    const count = stickers.length;
    const base = beat.start;
    const spread = Math.min(beat.duration * 0.64, 0.058 * count);
    const interval = count > 1 ? spread / (count - 1) : 0;
    for (let index = 0; index < count; index++) {
      const sticker = stickers[index];
      const start = base + index * interval;
      sticker.start = start;
      if (stepped < start) {
        sticker.object.visible = false;
        continue;
      }
      sticker.object.visible = true;
      const duration = Math.min(sticker.duration * 1.2, beat.duration - index * interval);
      const t = clamp((stepped - start) / duration, 0, 1);
      const eased = easeOutCubic(t);
      const lift = (1 - eased) * 0.045;
      sticker.object.position.copy(sticker.basePosition).addScaledVector(sticker.normal, lift);
      sticker.object.scale.copy(sticker.baseScale).multiplyScalar(0.72 + 0.28 * eased);
      sticker.object.quaternion.copy(sticker.baseQuaternion);
      sticker.object.rotateZ((1 - eased) * sticker.roll);
      if (!sticker.landed && t >= 0.82) {
        sticker.landed = true;
        if (!this.stickerSoundStarted) {
          this.stickerSoundStarted = true;
          if (this.canPlayRevealSound()) revealAudio.playStickerSnap(sticker.basePosition);
        }
        if (this.particles && index % 3 === 0) {
          this.particles.spawnPoof(sticker.basePosition.x, sticker.basePosition.y, sticker.basePosition.z, { r: 0.95, g: 0.9, b: 0.75 } as any, 2);
        }
      }
    }
  }

  private stepProps(time: number, propsBeat: ReturnType<typeof beatOf>) {
    const runtime = this.runtime;
    if (!runtime) return;
    const count = Math.max(1, runtime.props.length);
    const base = propsBeat?.start ?? 0;
    const spread = propsBeat?.duration ? Math.min(propsBeat.duration * 0.5, 0.12 * count) : 0;
    const interval = count > 1 ? spread / (count - 1) : 0;
    for (let i = 0; i < runtime.props.length; i++) {
      const prop = runtime.props[i];
      const start = base + i * interval;
      prop.start = start;
      if (!propsBeat || this.timeline?.reducedMotion) {
        prop.object.visible = prop.finalVisible;
        prop.object.position.copy(prop.basePosition);
        prop.object.scale.copy(prop.baseScale);
        continue;
      }
      if (time < start) {
        prop.object.visible = false;
        continue;
      }
      prop.object.visible = prop.finalVisible;
      // Reserve part of the prop beat for the lamp flicker before READY.
      const dropDuration = Math.min(prop.dropDuration * 1.25, propsBeat.duration * 0.34);
      const t = clamp((time - start) / dropDuration, 0, 1);
      const eased = t * (0.3 + 0.7 * t);
      prop.object.position.set(
        prop.basePosition.x,
        prop.basePosition.y + 0.4 * (1 - eased),
        prop.basePosition.z,
      );
      if (!prop.landed && t >= 1) {
        prop.landed = true;
        const scale = prop.baseScale;
        if (prop.finalVisible && prop.priority === 0) {
          this.particles?.spawnPoof(prop.basePosition.x, prop.basePosition.y + 0.04, prop.basePosition.z, { r: 1, g: 0.83, b: 0.55 } as any, 3);
        }
        if (prop.finalVisible && this.canPlayRevealSound()) {
          const material = ['shelf', 'crates', 'pegboard'].includes(prop.id) ? 'wood'
            : ['trash', 'toolbox', 'mini-fridge', 'lamp'].includes(prop.id) ? 'metal' : undefined;
          if (prop.id === 'neon') revealAudio.playNeon(prop.basePosition);
          else if (prop.id !== 'lamp' || !this.lampGlow) {
            revealAudio.playThud(prop.basePosition, Math.min(1.2, 0.6 + scale.x * 0.2), material);
          }
        }
      }
      const sinceLanding = time - (start + dropDuration);
      const settleWindow = propsBeat.start + propsBeat.duration - start - dropDuration;
      const landing = clamp(sinceLanding / Math.min(0.20, settleWindow), 0, 1);
      const squash = t >= 1 ? Math.sin(landing * Math.PI) : 0;
      prop.object.scale.set(
        prop.baseScale.x * (1 + squash * 0.04),
        prop.baseScale.y * (1 - squash * 0.07),
        prop.baseScale.z * (1 + squash * 0.04),
      );
      if (prop.id === 'lamp' && this.lampGlow?.material) {
        const settle = clamp(sinceLanding / Math.min(0.42, settleWindow), 0, 1);
        const on = prop.finalVisible && settle >= 0.28 && (Math.sin((settle - 0.28) * Math.PI * 2) > -0.25 || settle > 0.92);
        this.lampGlow.material.opacity = on ? 0.86 : 0;
        if (on && !this.lampActivated) {
          this.lampActivated = true;
          if (this.canPlayRevealSound()) revealAudio.playLampSwitch(this.lampGlow.getWorldPosition(this.cuePosition));
        }
      }
      if (prop.id === 'neon' && t >= 1) {
        const flicker = clamp(sinceLanding / Math.min(0.45, settleWindow), 0, 1);
        prop.object.visible = flicker >= 1 ? prop.finalVisible : Math.sin(flicker * Math.PI * 2) > -0.20;
      }
    }
  }

  private spawnReady(runtime: RevealRuntime) {
    const camera = this.world.camera;
    const position = camera.getWorldPosition(new Vector3());
    const direction = camera.getWorldDirection(new Vector3());
    const x = position.x + direction.x * 1.15;
    const z = position.z + direction.z * 1.15;
    if (this.mode !== 'quick') {
      this.particles?.spawnPop('READY!', x, position.y + 0.10, z, 0.42, { r: 0.91, g: 1, b: 0.16 } as any);
      emit('status', 'GARAGE READY');
    }
    if (this.canPlayRevealSound()) revealAudio.playChime({ x, y: position.y + 0.10, z });
    const neon = runtime.props.find(prop => prop.id === 'neon');
    if (neon) neon.object.visible = true;
  }

  private sprayStarted = false;

  private setDoorOpacity(opacity: number) {
    const door = this.runtime?.door;
    if (!door) return;
    door.opacity = opacity;
    door.group.visible = opacity > 0.001;
    for (const material of door.materials) {
      const mat = material as any;
      if (!mat) continue;
      const transparent = opacity < 0.999;
      if (mat.transparent !== transparent) {
        mat.transparent = transparent;
        mat.needsUpdate = true;
      }
      mat.opacity = opacity;
      mat.depthWrite = opacity > 0.5;
    }
    this.setDoorLighting(opacity);
  }

  private setDoorLighting(opacity: number) {
    const atmosphere = this.runtime?.door?.atmosphere;
    if (!atmosphere) return;
    atmosphere.uniforms.uPresence.value = opacity;
    atmosphere.uniforms.uClosure.value = this.focusShutter;
  }

  private trackFrame(dt: number) {
    const adaptive = config.adaptive as any;
    const quest = /OculusBrowser/i.test(navigator.userAgent);
    const emulated = !!(window as any).IWER_DEVICE || !!(navigator as any).webdriver;
    const forced = query.has('revealAdaptive') || query.has('revealStress');
    if (this.framePaused) return;
    this.frameTimes[this.frameCursor] = dt * 1000;
    this.frameCursor = (this.frameCursor + 1) % this.frameTimes.length;
    this.frameCount = Math.min(this.frameCount + 1, this.frameTimes.length);
    if (this.frameCount < this.frameTimes.length) return;
    let total = 0;
    for (const value of this.frameTimes) total += value;
    const average = total / this.frameTimes.length;
    this.frameAverageMs = average;
    if (!adaptive.enabled || (!quest && !forced) || (emulated && !forced)) return;
    const budget = query.has('revealStress') ? 1 : adaptive.budgetMs * adaptive.headroom;
    if (average <= budget) return;
    this.applyFallback();
    this.frameCount = 0;
    this.frameTimes.fill(0);
  }

  private applyFallback() {
    if (this.fallbackStep >= 3) return;
    this.fallbackStep++;
    if (this.fallbackStep === 1) {
      this.particles?.setBudget(100);
      console.info('[reveal] adaptive fallback 1: particle budget halved');
      emit('status', 'Reveal quality: particles halved');
    } else if (this.fallbackStep === 2) {
      for (const surface of this.runtime?.surfaces ?? []) {
        surface.uniforms.uRevealUseNoise.value = 0;
        surface.uniforms.uRevealUseDrips.value = 0;
      }
      console.info('[reveal] adaptive fallback 2: drips and noise disabled');
      emit('status', 'Reveal quality: drips and noise off');
    } else {
      this.dissolveStart = this.elapsed;
      this.dissolveFrom = (this.runtime?.surfaces ?? []).map(surface => surface.uniforms.uRevealProgress.value);
      revealAudio.stopSpray();
      revealAudio.stopRevealSamples();
      this.particles?.clear();
      console.info('[reveal] adaptive fallback 3: simple 0.6 s dissolve');
      emit('status', 'Reveal quality: simplified dissolve');
    }
  }

  private stepDissolve() {
    const runtime = this.runtime;
    if (!runtime) return;
    const progress = clamp((this.elapsed - this.dissolveStart) / 0.6, 0, 1);
    const eased = progress * progress * (3 - 2 * progress);
    runtime.surfaces.forEach((surface, index) => {
      surface.uniforms.uRevealProgress.value = (this.dissolveFrom[index] ?? 0) + (1.05 - (this.dissolveFrom[index] ?? 0)) * eased;
    });
    if (runtime.blueprint) runtime.blueprint.group.visible = false;
    if (runtime.door) this.setDoorOpacity(Math.max(0, Math.min(1, (eased - 0.55) / 0.45)));
    for (const prop of runtime.props) {
      prop.object.visible = prop.finalVisible;
      prop.object.position.copy(prop.basePosition);
      prop.object.scale.copy(prop.baseScale);
    }
    for (const sticker of runtime.stickers ?? []) {
      sticker.landed = true;
      sticker.object.visible = true;
      sticker.object.position.copy(sticker.basePosition);
      sticker.object.quaternion.copy(sticker.baseQuaternion);
      sticker.object.scale.copy(sticker.baseScale);
    }
    if (progress >= 1) this.finishReveal(false);
  }

  leave() {
    const runtime = this.runtime;
    if (!runtime || this.presenceFade?.to === 0 || this.presenceProgress === 0) return;
    if (this.active) this.finishReveal(true);
    this.presenceFade = { from: this.presenceProgress, to: 0, elapsed: 0, duration: Math.max(0.05, 0.85 * this.presenceProgress) };
    if (runtime.blueprint) runtime.blueprint.group.visible = false;
    this.particles?.clear();
    revealAudio.stopRevealSamples();
    revealAudio.stopGameplaySamples();
    revealAudio.updateAmbience(false, null);
    emit('reveal-leave-started');
  }

  enter() {
    if (!this.runtime || this.presenceFade?.to === 1) return;
    this.presenceFade = {
      from: this.presenceProgress, to: 1, elapsed: 0,
      duration: Math.max(0.05, 0.55 * (1 - this.presenceProgress)),
    };
  }

  private stepPresenceFade(delta: number) {
    const runtime = this.runtime;
    const fade = this.presenceFade;
    if (!runtime || !fade) return;
    fade.elapsed = Math.min(fade.duration, fade.elapsed + delta);
    const t = fade.elapsed / fade.duration;
    const eased = t * t * (3 - 2 * t);
    const visible = fade.from + (fade.to - fade.from) * eased;
    this.presenceProgress = visible;
    for (const surface of runtime.surfaces) surface.uniforms.uRevealProgress.value = 1.05 * visible;
    this.setDoorOpacity(visible);
    for (const prop of runtime.props) {
      prop.object.visible = prop.finalVisible && visible > 0.01;
      prop.object.scale.copy(prop.baseScale).multiplyScalar(Math.max(0.001, visible));
    }
    for (const sticker of runtime.stickers ?? []) {
      sticker.object.visible = visible > 0.02;
      sticker.object.scale.copy(sticker.baseScale).multiplyScalar(Math.max(0.001, visible));
    }
    if (t >= 1) {
      this.presenceFade = undefined;
      this.active = false;
      this.finished = fade.to === 1;
      if (!this.finished) emit('reveal-left');
    }
  }

  finishReveal(skipped: boolean) {
    if (!this.active || this.finished) return;
    const runtime = this.runtime;
    if (runtime) {
      for (const surface of runtime.surfaces) {
        surface.uniforms.uRevealProgress.value = 1.05;
        surface.uniforms.uRevealUseNoise.value = 0;
        surface.uniforms.uRevealUseDrips.value = 0;
      }
      if (runtime.blueprint) runtime.blueprint.group.visible = false;
      this.setDoorOpacity(1);
      if (this.lampGlow?.material) this.lampGlow.material.opacity = 0.86;
      for (const prop of runtime.props) {
        prop.object.visible = prop.finalVisible;
        prop.object.position.copy(prop.basePosition);
        prop.object.scale.copy(prop.baseScale);
        prop.landed = true;
      }
      for (const sticker of runtime.stickers ?? []) {
        sticker.landed = true;
        sticker.object.visible = true;
        sticker.object.position.copy(sticker.basePosition);
        sticker.object.quaternion.copy(sticker.baseQuaternion);
        sticker.object.scale.copy(sticker.baseScale);
      }
    }
    this.active = false;
    this.finished = true;
    this.framePaused = true;
    this.sprayStarted = false;
    revealAudio.stopSpray();
    if (skipped) {
      revealAudio.stopRevealSamples();
      this.particles?.clear();
    }
    this.builder?.completeReveal();
    emit('reveal-finished', { skipped, fallbackStep: this.fallbackStep, duration: this.elapsed });
    this.framePaused = false;
  }

  /** Used by the wrist Rearrange action: only props drop again. */
  startPropsOnly() {
    if (!this.builder) return;
    const runtime = this.builder.getRevealRuntime();
    if (!runtime) return;
    this.runtime = runtime;
    this.start('props');
  }
}
