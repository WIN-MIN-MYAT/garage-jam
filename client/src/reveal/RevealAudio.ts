import { Quaternion, Vector3 } from '@iwsdk/core';
import type { Camera } from '@iwsdk/core';

type Point = { x: number; y: number; z: number };

const gameplayGain = {
  paper_pickup: 0.27,
  paper_crumple_01: 0.42,
  paper_crumple_02: 0.42,
  paper_toss: 0.30,
  paper_bin_catch: 0.39,
  task_done: 0.41,
  paper_pin: 0.29,
  focus_shutter_close: 0.43,
  focus_break_start: 0.39,
  setup_point_mark: 0.28,
  setup_lock: 0.32,
  stream_first_picture: 0.30,
  ui_action_blocked: 0.32,
};

const ambienceGain = { amb_garage_interior: 0.18, amb_dusk_doorway: 0.25 };

const sampleGain = {
  ...gameplayGain,
  ...ambienceGain,
  rev_blueprint_draw: 0.42,
  rev_floor_spray_loop: 0.25,
  rev_wall_wipe_01: 0.40,
  rev_door_roll: 0.52,
  rev_sunbeam_swell: 0.24,
  rev_prop_wood_01: 0.35,
  rev_prop_metal_01: 0.33,
  rev_neon_on: 0.34,
  rev_ready_chime: 0.46,
  ui_press_01: 0.30,
  ui_press_02: 0.30,
  ui_panel_open: 0.26,
  table_yep_stamp: 0.54,
};

type SampleId = keyof typeof sampleGain;
type GameplayId = keyof typeof gameplayGain;
type AmbienceId = keyof typeof ambienceGain;
type SampleVoice = { source: AudioBufferSourceNode; gain: GainNode; panner: PannerNode | null };

export class RevealAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private spraySource: AudioBufferSourceNode | null = null;
  private sprayGain: GainNode | null = null;
  private sprayPanner: PannerNode | null = null;
  private volume = 0.65;
  private unlocked = false;
  private sampleLoad?: Promise<void>;
  private samples = new Map<SampleId, AudioBuffer>();
  private revealVoices = new Set<SampleVoice>();
  private gameplayVoices = new Set<SampleVoice>();
  private ambience = new Map<AmbienceId, SampleVoice>();
  private lastGameplay = new Map<GameplayId, number>();
  private crumpleVariant = false;
  private shutterClosed = false;
  private lastPress = -Infinity;
  private lastProp = -Infinity;
  private lastPanel = -Infinity;
  private pressVariant = false;

  async unlock() {
    if (!this.context) {
      const Context = window.AudioContext ?? (window as any).webkitAudioContext;
      if (!Context) return;
      this.context = new Context();
      this.master = this.context.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.context.destination);
      this.noiseBuffer = this.makeNoiseBuffer(this.context);
    }
    this.preload(this.context);
    if (this.context.state === 'suspended') {
      try { await this.context.resume(); } catch { /* needs a fresh gesture */ }
    }
    this.unlocked = this.context.state === 'running';
  }

  setVolume(percent: number) {
    this.volume = Math.max(0, Math.min(1, percent / 100));
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.02);
  }

  private preload(context: AudioContext) {
    this.sampleLoad ??= Promise.allSettled((Object.keys(sampleGain) as SampleId[]).map(async id => {
      const response = await fetch(`/assets/audio/${id}.ogg`);
      if (!response.ok) throw new Error(`Audio request returned ${response.status}`);
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      if (this.context === context) this.samples.set(id, buffer);
    })).then(() => undefined);
  }

  private startSample(id: SampleId, position?: Point, loop = false, rate = 1, level = sampleGain[id], attack = 0.008, delay = 0) {
    const context = this.context;
    const master = this.master;
    const buffer = this.samples.get(id);
    if (!this.unlocked || !context || !master || !buffer) return null;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.playbackRate.value = rate;
    const gain = context.createGain();
    const panner = position ? this.panner(position) : null;
    const now = context.currentTime + delay;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + attack);
    source.connect(gain);
    if (panner) gain.connect(panner).connect(master);
    else gain.connect(master);
    const voice = { source, gain, panner };
    source.onended = () => {
      this.revealVoices.delete(voice);
      this.gameplayVoices.delete(voice);
      source.disconnect();
      gain.disconnect();
      panner?.disconnect();
    };
    source.start(now);
    return voice;
  }

  private fadeOut(voice: SampleVoice, seconds: number) {
    if (!this.context) return;
    const now = this.context.currentTime;
    voice.gain.gain.cancelAndHoldAtTime(now);
    voice.gain.gain.linearRampToValueAtTime(0, now + seconds);
    voice.source.stop(now + seconds);
  }

  private playReveal(id: SampleId, position?: Point, rate = 1, level = sampleGain[id]) {
    const voice = this.startSample(id, position, false, rate, level);
    if (voice) this.revealVoices.add(voice);
    return !!voice;
  }

  stopRevealSamples() {
    for (const voice of this.revealVoices) this.fadeOut(voice, 0.05);
    this.revealVoices.clear();
  }

  updateAmbience(active: boolean, exterior: Point | null) {
    if (!active) {
      for (const voice of this.ambience.values()) this.fadeOut(voice, 0.45);
      this.ambience.clear();
      return;
    }
    this.ensureAmbience('amb_garage_interior', undefined, ambienceGain.amb_garage_interior);
    if (exterior) this.ensureAmbience('amb_dusk_doorway', exterior, this.doorwayGain());
    else {
      const voice = this.ambience.get('amb_dusk_doorway');
      if (voice) this.fadeOut(voice, 0.45);
      this.ambience.delete('amb_dusk_doorway');
    }
  }

  private ensureAmbience(id: AmbienceId, position: Point | undefined, level: number) {
    const current = this.ambience.get(id);
    if (current) {
      if (position && current.panner) this.setPannerPosition(current.panner, position);
      return;
    }
    const voice = this.startSample(id, position, true, 1, level, 1.15);
    if (voice) this.ambience.set(id, voice);
  }

  private doorwayGain() {
    return ambienceGain.amb_dusk_doorway * (this.shutterClosed ? 0.22 : 1);
  }

  setShutterClosed(closed: boolean) {
    if (this.shutterClosed === closed) return;
    this.shutterClosed = closed;
    const exterior = this.ambience.get('amb_dusk_doorway');
    if (!exterior || !this.context) return;
    const now = this.context.currentTime;
    exterior.gain.gain.cancelAndHoldAtTime(now);
    exterior.gain.gain.setTargetAtTime(this.doorwayGain(), now, 0.3);
  }

  playGameplay(id: GameplayId, position?: Point, { rate = 1, delay = 0 } = {}) {
    if (!this.context) return false;
    const now = this.context.currentTime;
    if (now - (this.lastGameplay.get(id) ?? -Infinity) < 0.075 || this.gameplayVoices.size >= 8) return true;
    const voice = this.startSample(id, position, false, rate, gameplayGain[id], 0.006, delay);
    if (!voice) return false;
    this.lastGameplay.set(id, now);
    this.gameplayVoices.add(voice);
    return true;
  }

  stopGameplaySamples() {
    for (const voice of this.gameplayVoices) this.fadeOut(voice, 0.04);
    this.gameplayVoices.clear();
    this.lastGameplay.clear();
  }

  playPress() {
    const now = this.context?.currentTime ?? 0;
    if (now - this.lastPress < 0.065) return;
    this.pressVariant = !this.pressVariant;
    if (this.startSample(this.pressVariant ? 'ui_press_01' : 'ui_press_02')) this.lastPress = now;
  }

  playPanel() {
    const now = this.context?.currentTime ?? 0;
    if (now - this.lastPanel < 0.22 || now - this.lastPress < 0.08) return;
    if (this.startSample('ui_panel_open')) this.lastPanel = now;
  }

  playTableStamp() {
    if (this.startSample('table_yep_stamp') && this.context) this.lastPanel = this.context.currentTime;
  }

  playBlueprint(duration: number) {
    this.playReveal('rev_blueprint_draw', undefined, this.beatRate('rev_blueprint_draw', duration));
  }

  playSunbeam(position: Point) {
    this.playReveal('rev_sunbeam_swell', position);
  }

  private beatRate(id: SampleId, duration: number) {
    return Math.max(0.85, Math.min(1.6, (this.samples.get(id)?.duration ?? duration) / duration));
  }

  private makeNoiseBuffer(context: AudioContext) {
    const buffer = context.createBuffer(1, Math.floor(context.sampleRate * 2), context.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 9173;
    for (let i = 0; i < data.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    return buffer;
  }

  private panner(position?: Point) {
    if (!this.context) return null;
    const panner = this.context.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 1;
    panner.rolloffFactor = 0.65;
    panner.maxDistance = 12;
    if (position) this.setPannerPosition(panner, position);
    return panner;
  }

  private setPannerPosition(panner: PannerNode, position: Point) {
    try {
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
    } catch {
      panner.setPosition(position.x, position.y, position.z);
    }
  }

  private connect(panner: PannerNode | null) {
    if (!this.context || !this.master) return null;
    if (panner) { panner.connect(this.master); return panner; }
    return this.master;
  }

  playWhoosh(soft = false, duration = 0.9) {
    if (!this.unlocked || !this.context || !this.noiseBuffer) return;
    if (!soft && this.playReveal('rev_wall_wipe_01', undefined, this.beatRate('rev_wall_wipe_01', duration))) return;
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    const filter = this.context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(soft ? 300 : 180, now);
    filter.frequency.exponentialRampToValueAtTime(soft ? 900 : 1400, now + 0.34);
    filter.frequency.exponentialRampToValueAtTime(260, now + 0.9);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(soft ? 0.08 : 0.14, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.92);
    source.connect(filter).connect(gain).connect(this.connect(null)!);
    source.start(now);
    source.stop(now + 0.95);
  }

  startSpray(position: Point) {
    if (!this.unlocked || !this.context || !this.noiseBuffer || this.spraySource) return;
    const sample = this.startSample('rev_floor_spray_loop', position, true, 1, sampleGain.rev_floor_spray_loop, 0.08);
    if (sample) {
      this.spraySource = sample.source;
      this.sprayGain = sample.gain;
      this.sprayPanner = sample.panner;
      return;
    }
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    const filter = this.context.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 2400;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.055, now + 0.15);
    const panner = this.panner(position);
    source.connect(filter).connect(gain);
    if (panner) gain.connect(panner);
    else gain.connect(this.connect(null)!);
    if (panner) this.connect(panner);
    source.start(now);
    this.spraySource = source;
    this.sprayGain = gain;
    this.sprayPanner = panner ?? null;
  }

  moveSpray(position: Point) {
    if (this.sprayPanner) this.setPannerPosition(this.sprayPanner, position);
  }

  stopSpray() {
    if (!this.context || !this.spraySource) return;
    const now = this.context.currentTime;
    try {
      this.sprayGain?.gain.cancelAndHoldAtTime(now);
      this.sprayGain?.gain.linearRampToValueAtTime(0, now + 0.18);
      this.spraySource.stop(now + 0.2);
    } catch { /* already stopped */ }
    this.spraySource = null;
    this.sprayGain = null;
    this.sprayPanner = null;
  }

  playThud(position: Point, weight = 1, material?: 'wood' | 'metal') {
    if (!this.unlocked || !this.context) return;
    const now = this.context.currentTime;
    if (now - this.lastProp < 0.075) return;
    this.lastProp = now;
    if (material) {
      const id = material === 'metal' ? 'rev_prop_metal_01' : 'rev_prop_wood_01';
      if (this.playReveal(id, position, 0.96 + Math.random() * 0.08, sampleGain[id] * weight)) return;
    }
    const output = this.panner(position);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.18 * weight, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
    const osc = this.context.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(46, now + 0.18);
    osc.connect(gain);
    if (output) gain.connect(output); else gain.connect(this.connect(null)!);
    if (output) this.connect(output);
    osc.start(now); osc.stop(now + 0.24);
    if (this.noiseBuffer) {
      const noise = this.context.createBufferSource();
      noise.buffer = this.noiseBuffer;
      const noiseFilter = this.context.createBiquadFilter();
      noiseFilter.type = 'lowpass'; noiseFilter.frequency.value = 700;
      const noiseGain = this.context.createGain();
      noiseGain.gain.setValueAtTime(0.06 * weight, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
      noise.connect(noiseFilter).connect(noiseGain);
      if (output) noiseGain.connect(output); else noiseGain.connect(this.connect(null)!);
      noise.start(now); noise.stop(now + 0.15);
    }
  }

  playNeon(position: Point, lamp = false) {
    if (!this.unlocked || !this.context) return;
    if (!lamp && this.playReveal('rev_neon_on', position)) return;
    const now = this.context.currentTime;
    const output = this.panner(position);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.035, now + 0.02);
    gain.gain.setValueAtTime(0.035, now + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
    const osc = this.context.createOscillator();
    osc.type = 'sawtooth'; osc.frequency.value = 92;
    const filter = this.context.createBiquadFilter();
    filter.type = 'bandpass'; filter.frequency.value = 740; filter.Q.value = 3;
    osc.connect(filter).connect(gain);
    if (output) gain.connect(output); else gain.connect(this.connect(null)!);
    if (output) this.connect(output);
    osc.start(now); osc.stop(now + 0.32);
  }

  playDoor(position: Point, duration: number) {
    if (!this.unlocked || !this.context || !this.noiseBuffer) return;
    if (this.playReveal('rev_door_roll', position, this.beatRate('rev_door_roll', duration))) return;
    const now = this.context.currentTime;
    const source = this.context.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 280;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.10);
    gain.gain.setValueAtTime(0.08, now + 0.55);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.82);
    source.connect(filter).connect(gain).connect(this.connect(null)!);
    source.start(now); source.stop(now + 0.86);
  }

  playChime(position?: Point) {
    if (!this.unlocked || !this.context) return;
    if (this.playReveal('rev_ready_chime', position)) return;
    const now = this.context.currentTime;
    const output = position ? this.panner(position) : null;
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.07, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
    [880, 1320].forEach((frequency, index) => {
      const osc = this.context!.createOscillator();
      osc.type = 'sine'; osc.frequency.value = frequency;
      const local = this.context!.createGain();
      local.gain.value = index === 0 ? 1 : 0.55;
      osc.connect(local).connect(gain);
      osc.start(now); osc.stop(now + 0.58);
      osc.onended = () => { try { local.disconnect(); } catch { /* noop */ } };
    });
    if (output) { gain.connect(output); this.connect(output); } else gain.connect(this.connect(null)!);
  }

  playTick(position: Point) {
    if (!this.unlocked || !this.context) return;
    if (this.playGameplay('setup_point_mark', position, { rate: 0.97 + Math.random() * 0.06 })) return;
    const now = this.context.currentTime;
    const output = this.panner(position);
    const gain = this.context.createGain();
    gain.gain.setValueAtTime(0.035, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    const osc = this.context.createOscillator();
    osc.type = 'square'; osc.frequency.value = 1450;
    osc.connect(gain);
    if (output) gain.connect(output); else gain.connect(this.connect(null)!);
    if (output) this.connect(output);
    osc.start(now); osc.stop(now + 0.08);
  }

  private noiseBurst(now: number, duration: number, level: number, filterType: BiquadFilterType, frequency: number, position?: Point) {
    const context = this.context;
    if (!context || !this.noiseBuffer) return;
    const output = position ? this.panner(position) : null;
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, frequency * 0.35), now + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(gain);
    if (output) { gain.connect(output); this.connect(output); }
    else gain.connect(this.connect(null)!);
    source.start(now); source.stop(now + duration + 0.02);
  }

  playPaperGrab(position?: Point) {
    if (!this.unlocked || !this.context) return;
    if (this.playGameplay('paper_pickup', position)) return;
    this.noiseBurst(this.context.currentTime, 0.11, 0.05, 'highpass', 2200, position);
  }

  playPaperCrumple(position?: Point) {
    if (!this.unlocked || !this.context) return;
    this.crumpleVariant = !this.crumpleVariant;
    if (this.playGameplay(this.crumpleVariant ? 'paper_crumple_01' : 'paper_crumple_02', position)) return;
    const now = this.context.currentTime;
    this.noiseBurst(now, 0.16, 0.075, 'bandpass', 1800, position);
    this.noiseBurst(now + 0.11, 0.2, 0.06, 'bandpass', 1200, position);
    this.noiseBurst(now + 0.23, 0.18, 0.04, 'highpass', 2600, position);
  }

  playPaperThrow(position: Point, speed: number) {
    if (!this.unlocked || !this.context) return;
    if (this.playGameplay('paper_toss', position, { rate: Math.min(1.18, 0.9 + speed * 0.06) })) return;
    this.noiseBurst(this.context.currentTime, 0.26, 0.055, 'bandpass', 900, position);
  }

  playTrash(position?: Point) {
    if (!this.unlocked || !this.context) return;
    if (this.playGameplay('paper_bin_catch', position)) return;
    const now = this.context.currentTime;
    this.playThud(position ?? { x: 0, y: 1, z: 0 }, 0.65, 'metal');
    this.noiseBurst(now + 0.04, 0.22, 0.05, 'bandpass', 1500, position);
  }

  playTaskDone() {
    if (!this.unlocked || !this.context) return;
    if (!this.playGameplay('task_done', undefined, { delay: 0.12 })) this.playChime();
  }

  playFocusClose(position: Point) {
    if (!this.playGameplay('focus_shutter_close', position)) this.playDoor(position, 0.8);
  }

  playNudge() {
    if (!this.unlocked || !this.context) return;
    this.playNeon({ x: 0, y: 1.8, z: -2 }, true);
  }

  private musicGain: GainNode | null = null;
  private musicNodes: AudioNode[] = [];
  private musicVolume = 0.4;

  setMusicVolume(percent: number) {
    this.musicVolume = Math.max(0, Math.min(1, percent / 100));
    if (this.musicGain && this.context) this.musicGain.gain.setTargetAtTime(this.musicVolume * 0.16, this.context.currentTime, 0.08);
  }

  startLoFi() {
    if (!this.unlocked || !this.context || this.musicGain) return false;
    const context = this.context;
    const now = context.currentTime;
    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.linearRampToValueAtTime(this.musicVolume * 0.16, now + 1.2);
    master.connect(this.connect(null)!);
    this.musicGain = master;
    // A soft three-note bed with a slow tremolo. This is a fallback for users
    // without Spotify, not a replacement for the real music connector.
    const frequencies = [110, 164.81, 220, 277.18];
    frequencies.forEach((frequency, index) => {
      const osc = context.createOscillator();
      osc.type = index % 2 ? 'triangle' : 'sine';
      osc.frequency.value = frequency / 2;
      const gain = context.createGain();
      gain.gain.value = index === 3 ? 0.12 : 0.2;
      const tremolo = context.createGain();
      tremolo.gain.value = 0.7;
      const lfo = context.createOscillator();
      lfo.frequency.value = 0.08 + index * 0.017;
      const depth = context.createGain();
      depth.gain.value = 0.25;
      lfo.connect(depth).connect(tremolo.gain);
      osc.connect(gain).connect(tremolo).connect(master);
      osc.start(now); lfo.start(now);
      this.musicNodes.push(osc, gain, tremolo, lfo, depth);
    });
    this.noiseBurst(now, 1.2, 0.012, 'lowpass', 700);
    return true;
  }

  stopLoFi() {
    if (!this.context || !this.musicGain) return;
    const now = this.context.currentTime;
    this.musicGain.gain.cancelAndHoldAtTime(now);
    this.musicGain.gain.linearRampToValueAtTime(0.0001, now + 0.35);
    const gain = this.musicGain;
    const nodes = this.musicNodes;
    this.musicGain = null;
    this.musicNodes = [];
    window.setTimeout(() => {
      for (const node of nodes) {
        try { (node as OscillatorNode).stop?.(); } catch { /* noop */ }
        try { node.disconnect(); } catch { /* noop */ }
      }
      try { gain.disconnect(); } catch { /* noop */ }
    }, 450);
  }

  updateListener(camera: Camera) {
    if (!this.context) return;
    const listener = this.context.listener;
    const position = camera.getWorldPosition(this.tmpPosition);
    const direction = camera.getWorldDirection(this.tmpDirection);
    const up = this.tmpUp.set(0, 1, 0).applyQuaternion(camera.getWorldQuaternion(this.tmpRotation));
    try {
      listener.positionX.value = position.x; listener.positionY.value = position.y; listener.positionZ.value = position.z;
      listener.forwardX.value = direction.x; listener.forwardY.value = direction.y; listener.forwardZ.value = direction.z;
      listener.upX.value = up.x; listener.upY.value = up.y; listener.upZ.value = up.z;
    } catch {
      listener.setPosition(position.x, position.y, position.z);
      listener.setOrientation(direction.x, direction.y, direction.z, up.x, up.y, up.z);
    }
  }

  private tmpPosition = new Vector3();
  private tmpDirection = new Vector3(0, 0, -1);
  private tmpUp = new Vector3(0, 1, 0);
  private tmpRotation = new Quaternion();

  dispose() {
    this.stopLoFi();
    this.stopSpray();
    this.stopRevealSamples();
    this.stopGameplaySamples();
    this.updateAmbience(false, null);
    this.context?.close().catch(() => { /* noop */ });
    this.context = null;
    this.master = null;
    this.unlocked = false;
    this.sampleLoad = undefined;
    this.samples.clear();
    this.shutterClosed = false;
    this.lastPress = this.lastProp = this.lastPanel = -Infinity;
  }
}

export const revealAudio = new RevealAudio();
