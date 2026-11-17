import { Quaternion, Vector3 } from '@iwsdk/core';
import type { Camera, Object3D } from '@iwsdk/core';

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
const streetGain = {
  amb_distant_car_01: 0.125,
  amb_distant_car_02: 0.125,
  amb_distant_dog: 0.08,
  amb_distant_bike: 0.10,
  amb_distant_gate: 0.075,
};
const streetSounds = Object.keys(streetGain) as (keyof typeof streetGain)[];

const sampleGain = {
  ...gameplayGain,
  ...ambienceGain,
  ...streetGain,
  rev_blueprint_draw: 0.42,
  rev_floor_spray_loop: 0.25,
  rev_wall_wipe_01: 0.40,
  rev_door_roll: 0.52,
  rev_sunbeam_swell: 0.24,
  rev_prop_wood_01: 0.35,
  rev_prop_metal_01: 0.33,
  rev_neon_on: 0.34,
  rev_sticker_snap: 0.30,
  rev_workbench_roller: 0.28,
  rev_ceiling_lamp_on: 0.27,
  rev_ready_chime: 0.46,
  ui_press_01: 0.30,
  ui_press_02: 0.30,
  ui_panel_open: 0.26,
  table_yep_stamp: 0.54,
};

type SampleId = keyof typeof sampleGain;
type GameplayId = keyof typeof gameplayGain;
type AmbienceId = keyof typeof ambienceGain;
type StreetId = keyof typeof streetGain;
type SampleVoice = { source: AudioBufferSourceNode; gain: GainNode; panner: PannerNode | null };
type StreetPass = { voice: SampleVoice; start: number; end: number; depth: number; side: number; travel: number };

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
  private exteriorFilter?: BiquadFilterNode;
  private exteriorGain?: GainNode;
  private nextStreetAt?: number;
  private streetPass?: StreetPass;
  private lastStreet?: StreetId;
  private streetPosition = new Vector3();
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
      this.exteriorFilter = this.context.createBiquadFilter();
      this.exteriorFilter.type = 'lowpass';
      this.exteriorFilter.Q.value = 0.5;
      this.exteriorFilter.frequency.value = this.shutterClosed ? 630 : 4900;
      this.exteriorGain = this.context.createGain();
      this.exteriorGain.gain.value = this.shutterClosed ? 0.22 : 1;
      this.exteriorFilter.connect(this.exteriorGain).connect(this.master);
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
    if (this.volume === 0) this.stopStreet();
  }

  private preload(context: AudioContext) {
    this.sampleLoad ??= Promise.allSettled((Object.keys(sampleGain) as SampleId[]).map(async id => {
      const response = await fetch(`/assets/audio/${id}.ogg`);
      if (!response.ok) throw new Error(`Audio request returned ${response.status}`);
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      if (this.context === context) this.samples.set(id, buffer);
    })).then(() => undefined);
  }

  private startSample(id: SampleId, position?: Point, loop = false, rate = 1, level = sampleGain[id], attack = 0.008, delay = 0, destination: AudioNode | null | undefined = this.master) {
    const context = this.context;
    const buffer = this.samples.get(id);
    if (!this.unlocked || !context || !destination || !buffer) return null;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    source.playbackRate.value = rate;
    const gain = context.createGain();
    const panner = this.panner(position);
    const now = context.currentTime + delay;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + attack);
    source.connect(gain);
    if (panner) gain.connect(panner).connect(destination);
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

  private playReveal(id: SampleId, position?: Point, rate = 1, level = sampleGain[id], maxDuration = Infinity) {
    const voice = this.startSample(id, position, false, rate, level);
    if (!voice || !this.context) return false;
    this.revealVoices.add(voice);
    if ((voice.source.buffer?.duration ?? 0) / rate > maxDuration) {
      const end = this.context.currentTime + maxDuration;
      voice.gain.gain.setValueAtTime(level, end - Math.min(0.04, maxDuration * 0.4));
      voice.gain.gain.linearRampToValueAtTime(0, end);
      voice.source.stop(end);
    }
    return true;
  }

  stopRevealSamples() {
    for (const voice of this.revealVoices) this.fadeOut(voice, 0.05);
    this.revealVoices.clear();
  }

  updateAmbience(active: boolean, exterior: Point | null, interior?: Point, outward?: Point) {
    if (!active) {
      for (const voice of this.ambience.values()) this.fadeOut(voice, 0.45);
      this.ambience.clear();
      this.stopStreet();
      return;
    }
    this.ensureAmbience('amb_garage_interior', interior);
    if (exterior) {
      this.ensureAmbience('amb_dusk_doorway', exterior);
      if (outward) this.updateStreet(exterior, outward);
      else this.stopStreet();
    } else {
      const voice = this.ambience.get('amb_dusk_doorway');
      if (voice) this.fadeOut(voice, 0.45);
      this.ambience.delete('amb_dusk_doorway');
      this.stopStreet();
    }
  }

  private ensureAmbience(id: AmbienceId, position?: Point) {
    const current = this.ambience.get(id);
    if (current) {
      if (position && current.panner) this.setPannerPosition(current.panner, position);
      return;
    }
    const output = id === 'amb_dusk_doorway' ? this.exteriorFilter : this.master;
    const voice = this.startSample(id, position, true, 1, ambienceGain[id], 1.15, 0, output);
    if (voice) this.ambience.set(id, voice);
  }

  private updateStreet(door: Point, outward: Point) {
    if (!this.context || !this.unlocked || this.volume === 0) return;
    const now = this.context.currentTime;
    if (this.streetPass) {
      if (now >= this.streetPass.end) this.streetPass = undefined;
      else {
        const pass = this.streetPass;
        const progress = (now - pass.start) / (pass.end - pass.start);
        const position = this.streetPoint(door, outward, pass.depth, pass.side + pass.travel * progress);
        if (pass.voice.panner) this.setPannerPosition(pass.voice.panner, position);
        return;
      }
    }
    this.nextStreetAt ??= now + this.streetGap();
    if (now < this.nextStreetAt) return;
    const choices = streetSounds.filter(id => id !== this.lastStreet && this.samples.has(id));
    if (!choices.length) {
      this.nextStreetAt = now + this.streetGap();
      return;
    }
    const id = choices[Math.floor(Math.random() * choices.length)];
    const moving = id === 'amb_distant_bike' || id.startsWith('amb_distant_car');
    const sign = Math.random() < 0.5 ? -1 : 1;
    const depth = moving ? 7.5 + Math.random() * 3 : 11 + Math.random() * 5;
    const side = sign * (moving ? 11 : 4 + Math.random() * 5);
    const travel = moving ? -2 * side : 0;
    const voice = this.startSample(id, this.streetPoint(door, outward, depth, side), false, 1, streetGain[id], 0.24, 0, this.exteriorFilter);
    const duration = voice?.source.buffer?.duration ?? 0;
    this.nextStreetAt = now + duration + this.streetGap();
    if (!voice || !duration) return;
    if (voice.panner) {
      voice.panner.refDistance = 3;
      voice.panner.maxDistance = 40;
    }
    this.streetPass = { voice, start: now, end: now + duration, depth, side, travel };
    this.lastStreet = id;
  }

  private streetPoint(door: Point, outward: Point, depth: number, side: number) {
    return this.streetPosition.set(door.x + outward.x * depth - outward.z * side, door.y - 0.25, door.z + outward.z * depth + outward.x * side);
  }

  private streetGap() {
    return 45 + Math.random() * 75 + (Math.random() < 0.18 ? 40 : 0);
  }

  private stopStreet() {
    if (this.streetPass && this.context && this.context.currentTime < this.streetPass.end) this.fadeOut(this.streetPass.voice, 0.45);
    this.streetPass = undefined;
    this.nextStreetAt = undefined;
  }

  setShutterClosed(closed: boolean) {
    if (this.shutterClosed === closed) return;
    this.shutterClosed = closed;
    if (!this.exteriorGain || !this.exteriorFilter || !this.context) return;
    const now = this.context.currentTime;
    this.exteriorGain.gain.setTargetAtTime(closed ? 0.22 : 1, now, 0.3);
    this.exteriorFilter.frequency.setTargetAtTime(closed ? 630 : 4900, now, 0.3);
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

  playPress(panel?: Object3D) {
    const now = this.context?.currentTime ?? 0;
    if (now - this.lastPress < 0.065) return;
    this.pressVariant = !this.pressVariant;
    if (this.startSample(this.pressVariant ? 'ui_press_01' : 'ui_press_02', panel?.getWorldPosition(this.tmpSource))) this.lastPress = now;
  }

  playPanel(panel?: Object3D) {
    const now = this.context?.currentTime ?? 0;
    if (now - this.lastPanel < 0.22 || now - this.lastPress < 0.08) return;
    if (this.startSample('ui_panel_open', panel?.getWorldPosition(this.tmpSource))) this.lastPanel = now;
  }

  playTableStamp(panel?: Object3D) {
    if (this.startSample('table_yep_stamp', panel?.getWorldPosition(this.tmpSource)) && this.context) this.lastPanel = this.context.currentTime;
  }

  playBlueprint(duration: number, position: Point) {
    this.playBeatCue('rev_blueprint_draw', duration, position);
  }

  playSunbeam(position: Point) {
    this.playReveal('rev_sunbeam_swell', position);
  }

  playStickerSnap(position: Point) {
    this.playReveal('rev_sticker_snap', position);
  }

  playWorkbenchRoller(position: Point, duration: number) {
    this.playBeatCue('rev_workbench_roller', duration, position);
  }

  playLampSwitch(position: Point) {
    if (!this.playReveal('rev_ceiling_lamp_on', position)) this.playNeon(position, true);
  }

  private playBeatCue(id: SampleId, remaining: number, position?: Point) {
    const duration = Math.max(0.08, remaining);
    const rate = Math.max(0.85, Math.min(2.5, (this.samples.get(id)?.duration ?? duration) / duration));
    return this.playReveal(id, position, rate, sampleGain[id], duration);
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
    const source = position ?? this.tmpFallback.copy(this.tmpPosition).addScaledVector(this.tmpDirection, 1.1);
    this.setPannerPosition(panner, source);
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

  playWhoosh(soft = false, duration = 0.9, position?: Point) {
    if (!this.unlocked || !this.context || !this.noiseBuffer) return;
    if (!soft && this.playBeatCue('rev_wall_wipe_01', duration, position)) return;
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
    const output = this.panner(position);
    source.connect(filter).connect(gain).connect(this.connect(output)!);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); output?.disconnect(); };
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
      this.sprayGain?.gain.linearRampToValueAtTime(0, now + 0.065);
      this.spraySource.stop(now + 0.07);
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
    if (this.playBeatCue('rev_door_roll', duration, position)) return;
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
    const output = this.panner(position);
    source.connect(filter).connect(gain).connect(this.connect(output)!);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); output?.disconnect(); };
    source.start(now); source.stop(now + 0.86);
  }

  playChime(position?: Point) {
    if (!this.unlocked || !this.context) return;
    if (this.playReveal('rev_ready_chime', position)) return;
    const now = this.context.currentTime;
    const output = this.panner(position);
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
    const output = this.panner(position);
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

  playTaskDone(position: Point) {
    if (!this.unlocked || !this.context) return;
    if (!this.playGameplay('task_done', position, { delay: 0.12 })) this.playChime(position);
  }

  playFocusClose(position: Point) {
    if (!this.playGameplay('focus_shutter_close', position)) this.playDoor(position, 0.8);
  }

  playNudge(position?: Point) {
    if (!this.unlocked || !this.context) return;
    this.playNeon(position ?? this.tmpFallback.copy(this.tmpPosition).addScaledVector(this.tmpDirection, 1.1), true);
  }

  private musicGain: GainNode | null = null;
  private musicPanner: PannerNode | null = null;
  private musicNodes: AudioNode[] = [];
  private musicVolume = 0.4;

  setMusicVolume(percent: number) {
    this.musicVolume = Math.max(0, Math.min(1, percent / 100));
    if (this.musicGain && this.context) this.musicGain.gain.setTargetAtTime(this.musicVolume * 0.16, this.context.currentTime, 0.08);
  }

  startLoFi(position?: Point) {
    if (!this.unlocked || !this.context || this.musicGain) return false;
    const context = this.context;
    const now = context.currentTime;
    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.linearRampToValueAtTime(this.musicVolume * 0.16, now + 1.2);
    this.musicPanner = this.panner(position);
    master.connect(this.connect(this.musicPanner)!);
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
    this.noiseBurst(now, 1.2, 0.012, 'lowpass', 700, position);
    return true;
  }

  moveLoFi(position: Point) {
    if (this.musicPanner) this.setPannerPosition(this.musicPanner, position);
  }

  stopLoFi() {
    if (!this.context || !this.musicGain) return;
    const now = this.context.currentTime;
    this.musicGain.gain.cancelAndHoldAtTime(now);
    this.musicGain.gain.linearRampToValueAtTime(0.0001, now + 0.35);
    const gain = this.musicGain;
    const panner = this.musicPanner;
    const nodes = this.musicNodes;
    this.musicGain = null;
    this.musicPanner = null;
    this.musicNodes = [];
    window.setTimeout(() => {
      for (const node of nodes) {
        try { (node as OscillatorNode).stop?.(); } catch { /* noop */ }
        try { node.disconnect(); } catch { /* noop */ }
      }
      try { gain.disconnect(); } catch { /* noop */ }
      panner?.disconnect();
    }, 450);
  }

  updateListener(camera: Camera, pose: XRRigidTransform) {
    if (!this.context) return;
    const listener = this.context.listener;
    const { position: head, orientation } = pose;
    const position = this.tmpPosition.set(head.x, head.y, head.z);
    const rotation = this.tmpRotation.set(orientation.x, orientation.y, orientation.z, orientation.w);
    if (camera.parent) {
      camera.parent.localToWorld(position);
      rotation.premultiply(camera.parent.getWorldQuaternion(this.tmpParentRotation));
    }
    const direction = this.tmpDirection.set(0, 0, -1).applyQuaternion(rotation);
    const up = this.tmpUp.set(0, 1, 0).applyQuaternion(rotation);
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
  private tmpParentRotation = new Quaternion();
  private tmpSource = new Vector3();
  private tmpFallback = new Vector3();

  dispose() {
    this.stopLoFi();
    this.stopSpray();
    this.stopRevealSamples();
    this.stopGameplaySamples();
    this.updateAmbience(false, null);
    this.context?.close().catch(() => { /* noop */ });
    this.context = null;
    this.master = null;
    this.exteriorFilter = undefined;
    this.exteriorGain = undefined;
    this.unlocked = false;
    this.sampleLoad = undefined;
    this.samples.clear();
    this.shutterClosed = false;
    this.lastPress = this.lastProp = this.lastPanel = -Infinity;
  }
}

export const revealAudio = new RevealAudio();
