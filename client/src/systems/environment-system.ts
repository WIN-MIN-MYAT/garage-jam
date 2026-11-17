import { BufferGeometry, createSystem, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Points, PointsMaterial, Color } from '@iwsdk/core';
import { garageEvents } from '../events.js';
import { garageState } from '../garage-state.js';
import { registerGarageRoot, unregisterGarageRoot } from '../garage-visibility.js';

type Weather = { code?: number; isDay?: boolean; sunrise?: string | null; sunset?: string | null; localTime?: string; temperature?: number; unit?: string };

export class EnvironmentSystem extends createSystem({}) {
  private root = new Group();
  private sky?: Mesh;
  private base = new Color(0xffffff);
  private weather: Weather | null = null;
  private rain?: Points;
  private snow?: Points;

  init() {
    this.root.name = 'Weather particles';
    this.world.scene.add(this.root);
    registerGarageRoot(this.root);
    const onRevealed = () => this.build();
    const onWeather = (event: Event) => { this.weather = (event as CustomEvent<Weather>).detail; this.apply(); };
    const onSky = () => this.apply();
    garageEvents.addEventListener('garage-revealed', onRevealed);
    garageEvents.addEventListener('weather-current', onWeather);
    garageEvents.addEventListener('sky-mode-changed', onSky);
    garageEvents.addEventListener('garage-reset', () => this.clear());
    this.cleanupFuncs.push(() => {
      garageEvents.removeEventListener('garage-revealed', onRevealed);
      garageEvents.removeEventListener('weather-current', onWeather);
      garageEvents.removeEventListener('sky-mode-changed', onSky);
      unregisterGarageRoot(this.root);
      this.clear();
      this.root.removeFromParent();
    });
  }

  private build() {
    this.clear();
    this.sky = this.world.scene.getObjectByName('Golden hour sky') as Mesh | undefined;
    if (this.sky) this.base.copy((this.sky.material as MeshBasicMaterial).color);
    const door = garageState.placements.find(placement => placement.slotId === 'door');
    const room = garageState.room;
    if (!door || !room) return;
    this.rain = this.particles(0x8ed8ff, 320, 0.012);
    this.snow = this.particles(0xffffff, 220, 0.018);
    for (const points of [this.rain, this.snow]) {
      const wall = room.walls.find(item => item.id === door.wallId);
      if (!wall) continue;
      points.position.set(door.position.x - wall.normal.x * 1.5, room.floor.y + 1.2, door.position.z - wall.normal.z * 1.5);
      points.visible = false;
      this.root.add(points);
    }
    this.apply();
  }

  private particles(color: number, count: number, size: number) {
    const positions = new Float32Array(count * 3);
    let seed = 731;
    const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (random() - 0.5) * 2.6;
      positions[i * 3 + 1] = random() * 2.4 - 1.2;
      positions[i * 3 + 2] = (random() - 0.5) * 0.8;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const material = new PointsMaterial({ color, size, transparent: true, opacity: 0.7, depthWrite: false });
    return new Points(geometry, material);
  }

  private condition() {
    const code = this.weather?.code ?? 0;
    if (code === 0) return 'clear';
    if (code <= 3) return 'cloud';
    if (code === 45 || code === 48) return 'fog';
    if (code >= 71 && code <= 77) return 'snow';
    if (code >= 95) return 'storm';
    if (code >= 51) return 'rain';
    return 'cloud';
  }

  private apply() {
    const mode = garageState.preferences.skyMode;
    if (!this.sky) return;
    const material = this.sky.material as MeshBasicMaterial;
    material.color.copy(this.base);
    const condition = this.condition();
    if (mode === 'weather' && this.weather) {
      if (condition === 'rain' || condition === 'storm') material.color.set(0x7f8494);
      else if (condition === 'snow') material.color.set(0xc8d8e6);
      else if (condition === 'cloud') material.color.set(0xb6b2b0);
      else if (condition === 'fog') material.color.set(0xb9bcc0);
    } else if (mode === 'time') {
      const hour = new Date().getHours();
      material.color.set(hour >= 19 || hour < 6 ? 0x6e6b8f : hour >= 17 ? 0xd28a67 : 0xffffff);
    }
    if (this.rain) this.rain.visible = mode === 'weather' && (condition === 'rain' || condition === 'storm');
    if (this.snow) this.snow.visible = mode === 'weather' && condition === 'snow';
  }

  private clear() {
    if (this.sky) (this.sky.material as MeshBasicMaterial).color.copy(this.base);
    for (const points of [this.rain, this.snow]) {
      if (!points) continue;
      points.geometry.dispose();
      (points.material as PointsMaterial).dispose();
      points.removeFromParent();
    }
    this.rain = undefined;
    this.snow = undefined;
    this.root.clear();
  }

  update(delta: number) {
    for (const points of [this.rain, this.snow]) {
      if (!points?.visible) continue;
      const position = points.geometry.getAttribute('position') as any;
      const speed = points === this.snow ? 0.35 : 1.3;
      for (let i = 0; i < position.count; i++) {
        let y = position.getY(i) - delta * speed;
        if (y < -1.2) y = 1.2;
        position.setY(i, y);
      }
      position.needsUpdate = true;
    }
  }
}
