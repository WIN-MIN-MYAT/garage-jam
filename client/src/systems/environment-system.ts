import {
  BufferGeometry, CanvasTexture, createSystem, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments,
  Mesh, MeshBasicMaterial, Points, PointsMaterial,
} from '@iwsdk/core';
import { garageEvents } from '../events.js';
import { garageState } from '../garage-state.js';
import { registerGarageRoot, unregisterGarageRoot } from '../garage-visibility.js';
import { paintDriveway, paintGarageSky, skyLooks, type SkyPeriod, type SkyWeather } from '../garage-sky.js';
import type { RevealDoor } from '../reveal/reveal-types.js';
import { GarageBuildSystem } from './garage-build-system.js';

type Weather = { code?: number; isDay?: boolean; localTime?: string; sunrise?: string | null; sunset?: string | null; timezone?: string };

function hours(time?: string | null) {
  if (!time) return NaN;
  const [hour, minute] = (time.split('T')[1] ?? '').split(':').map(Number);
  return hour + minute / 60;
}

function localHour(timezone?: string, fallback?: string) {
  const now = new Date();
  if (timezone) {
    try {
      const time = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
      return hours('T' + time);
    } catch { /* use the reported local time below */ }
  }
  const reported = hours(fallback);
  return Number.isFinite(reported) ? reported : now.getHours() + now.getMinutes() / 60;
}

function liveWeather(code?: number): SkyWeather {
  if (code == null || code <= 1) return 'sunny';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 51) return 'rain';
  return 'cloud';
}

export class EnvironmentSystem extends createSystem({}) {
  private root = new Group();
  private texture?: CanvasTexture;
  private pavement?: CanvasTexture;
  private light?: NonNullable<RevealDoor['atmosphere']>['uniforms'];
  private builder?: GarageBuildSystem;
  private weather: Weather | null = null;
  private weatherLocation = garageState.preferences.weatherLocation;
  private rain?: LineSegments<BufferGeometry, LineBasicMaterial>;
  private snow?: Points<BufferGeometry, PointsMaterial>;
  private painted = '';
  private revealed = false;
  private nextClockCheck = 0;

  init() {
    this.builder = this.world.getSystem(GarageBuildSystem) ?? undefined;
    this.root.name = 'Weather particles';
    this.world.scene.add(this.root);
    registerGarageRoot(this.root);
    const onBuilt = () => this.build();
    const onRevealed = () => { this.revealed = true; this.apply(); };
    const onWeather = (event: Event) => { this.weather = (event as CustomEvent<Weather | null>).detail; this.apply(); };
    const onSky = () => {
      if (this.weatherLocation !== garageState.preferences.weatherLocation) {
        this.weatherLocation = garageState.preferences.weatherLocation;
        this.weather = null;
      }
      this.apply();
    };
    const onReset = () => this.clear();
    garageEvents.addEventListener('garage-built', onBuilt);
    garageEvents.addEventListener('garage-revealed', onRevealed);
    garageEvents.addEventListener('weather-current', onWeather);
    garageEvents.addEventListener('sky-mode-changed', onSky);
    garageEvents.addEventListener('garage-reset', onReset);
    this.cleanupFuncs.push(() => {
      garageEvents.removeEventListener('garage-built', onBuilt);
      garageEvents.removeEventListener('garage-revealed', onRevealed);
      garageEvents.removeEventListener('weather-current', onWeather);
      garageEvents.removeEventListener('sky-mode-changed', onSky);
      garageEvents.removeEventListener('garage-reset', onReset);
      unregisterGarageRoot(this.root);
      this.clear();
      this.root.removeFromParent();
    });
  }

  private build() {
    this.clear();
    const sky = this.world.scene.getObjectByName('Golden hour sky') as Mesh | undefined;
    const texture = (sky?.material as MeshBasicMaterial | undefined)?.map;
    if (texture instanceof CanvasTexture) this.texture = texture;
    const driveway = this.world.scene.getObjectByName('Dusk driveway') as Mesh | undefined;
    const pavement = (driveway?.material as MeshBasicMaterial | undefined)?.map;
    if (pavement instanceof CanvasTexture) this.pavement = pavement;
    this.light = this.builder?.getRevealRuntime()?.door?.atmosphere?.uniforms;
    this.revealed = this.builder?.isRevealed() ?? false;
    const door = garageState.placements.find(placement => placement.slotId === 'door');
    const room = garageState.room;
    const wall = room?.walls.find(item => item.id === door?.wallId);
    if (door && room && wall) {
      this.rain = new LineSegments(this.precipitation(260, true), new LineBasicMaterial({
        color: 0xb9d1ed, transparent: true, opacity: 0.38, depthWrite: false,
      }));
      this.rain.name = 'Rain streaks outside';
      this.snow = new Points(this.precipitation(190, false), new PointsMaterial({
        color: 0xe6f0ff, size: 0.022, transparent: true, opacity: 0.8, depthWrite: false,
      }));
      this.snow.name = 'Snowflakes outside';
      for (const particles of [this.rain, this.snow]) {
        particles.position.set(door.position.x - wall.normal.x * 1.6, room.floor.y + 1.35, door.position.z - wall.normal.z * 1.6);
        particles.rotation.y = Math.atan2(wall.normal.x, wall.normal.z);
        this.root.add(particles);
      }
    }
    this.apply();
  }

  private precipitation(count: number, rain: boolean) {
    const positions = new Float32Array(count * (rain ? 6 : 3));
    let seed = 731;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < positions.length; i += rain ? 6 : 3) {
      positions[i] = (random() - 0.5) * 4.2;
      positions[i + 1] = random() * 2.9 - 1.45;
      positions[i + 2] = (random() - 0.5) * 2;
      if (!rain) continue;
      positions[i + 3] = positions[i] + 0.035;
      positions[i + 4] = positions[i + 1] + 0.13;
      positions[i + 5] = positions[i + 2];
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    return geometry;
  }

  private period(): SkyPeriod {
    const { skyMode } = garageState.preferences;
    if (skyMode !== 'time') return skyMode;
    const hour = localHour(this.weather?.timezone, this.weather?.localTime);
    const sunrise = hours(this.weather?.sunrise);
    const sunset = hours(this.weather?.sunset);
    if (!Number.isFinite(sunrise) && !Number.isFinite(sunset) && this.weather?.isDay === false) return 'night';
    const dawn = Number.isFinite(sunrise) ? sunrise : 6;
    const dusk = Number.isFinite(sunset) ? sunset : 19;
    if (hour < dawn - 0.4 || hour >= dusk + 0.6) return 'night';
    if (hour < Math.min(11, dawn + 3.5)) return 'morning';
    return hour >= dusk - 2.3 ? 'golden' : 'noon';
  }

  private apply() {
    const period = this.period();
    const mode = garageState.preferences.weatherMode;
    const weather = mode === 'live' ? liveWeather(this.weather?.code) : mode;
    if (this.rain) this.rain.visible = this.revealed && weather === 'rain';
    if (this.snow) this.snow.visible = this.revealed && weather === 'snow';
    const key = period + weather;
    if (key === this.painted) return;
    this.painted = key;
    const look = skyLooks[period];
    const ctx = (this.texture?.image as HTMLCanvasElement | undefined)?.getContext('2d');
    if (ctx && this.texture) {
      paintGarageSky(ctx, look, weather);
      this.texture.needsUpdate = true;
    }
    const pavement = (this.pavement?.image as HTMLCanvasElement | undefined)?.getContext('2d');
    if (pavement && this.pavement) {
      paintDriveway(pavement, period, weather);
      this.pavement.needsUpdate = true;
    }
    if (this.light) {
      const strength = weather === 'sunny' ? 1 : weather === 'snow' ? 0.53 : weather === 'rain' ? 0.23 : 0.46;
      this.light.uLightStrength.value = look.strength * strength;
      const color = this.light.uLightColor.value;
      if (weather !== 'sunny') color.setHex(weather === 'rain' ? 0xaac9ef : 0xd4e2f0);
      else if (period === 'golden') color.setRGB(1, 0.76, 0.43);
      else color.setHex(look.light);
    }
  }

  private clear() {
    for (const particles of [this.rain, this.snow]) {
      if (!particles) continue;
      particles.geometry.dispose();
      particles.material.dispose();
      particles.removeFromParent();
    }
    this.rain = this.snow = undefined;
    this.texture = this.pavement = this.light = undefined;
    this.painted = '';
    this.revealed = false;
  }

  update(delta: number) {
    const now = performance.now();
    if (this.texture && now >= this.nextClockCheck) {
      this.nextClockCheck = now + 30000;
      this.apply();
    }
    if (!this.root.visible || garageState.preferences.reducedMotion) return;
    for (const particles of [this.rain, this.snow]) {
      if (!particles?.visible) continue;
      const position = particles.geometry.getAttribute('position');
      const rain = particles === this.rain;
      const fall = Math.min(delta, 0.05) * (rain ? 3.6 : 0.31);
      for (let i = 0; i < position.count; i += rain ? 2 : 1) {
        let y = position.getY(i) - fall;
        if (y < -1.45) y += 2.9;
        position.setY(i, y);
        if (rain) position.setY(i + 1, y + 0.13);
        else position.setX(i, position.getX(i) + Math.min(delta, 0.05) * 0.12 * Math.sin(now / 900 + i));
      }
      position.needsUpdate = true;
    }
  }
}
