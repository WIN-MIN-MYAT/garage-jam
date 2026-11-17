import { Color, createSystem, DirectionalLight, Mesh, ShaderMaterial } from '@iwsdk/core';
import { emit, garageEvents } from '../events.js';

export class SunsetSystem extends createSystem({}) {
  private elapsed = 0;
  private duration = new URLSearchParams(location.search).get('demo') === '1' ? 60 : 1800;
  private running = false;
  private sky?: ShaderMaterial;
  private sun?: DirectionalLight;
  private gold = new Color(1, 0.79, 0.59);
  private dusk = new Color(0x8976ad);
  init() {
    const shell = this.world.getSceneObject('garage-shell');
    this.sky = (shell?.getObjectByName('Sunset sky mesh') as Mesh | undefined)?.material as ShaderMaterial | undefined;
    this.world.getSceneObject('sun-light')?.traverse(object => { if (object instanceof DirectionalLight) this.sun = object; });
    const start = () => { this.running = true; emit('status', 'Sunset session started'); };
    const pause = () => { this.running = false; emit('status', 'Sunset paused'); };
    const reset = () => { this.running = false; this.elapsed = 0; this.apply(0); emit('status', 'Sunset reset'); };
    const key = (event: KeyboardEvent) => { if (event.key.toLowerCase() === 's' && new URLSearchParams(location.search).has('debug')) start(); };
    garageEvents.addEventListener('sunset-start', start); garageEvents.addEventListener('sunset-pause', pause); garageEvents.addEventListener('sunset-reset', reset);
    window.addEventListener('keydown', key);
    this.cleanupFuncs.push(() => { garageEvents.removeEventListener('sunset-start', start); garageEvents.removeEventListener('sunset-pause', pause); garageEvents.removeEventListener('sunset-reset', reset); window.removeEventListener('keydown', key); });
  }
  private apply(t: number) {
    if (this.sun) { this.sun.color.lerpColors(this.gold, this.dusk, t); this.sun.intensity = 1.45 - t * 0.75; this.sun.position.y = 2.5 - t * 1.7; }
    if (this.sky) {
      const top = this.sky.uniforms.topColor.value as number[];
      const bottom = this.sky.uniforms.bottomColor.value as number[];
      top[0] = 0.27 - 0.12 * t; top[1] = 0.16 - 0.08 * t; top[2] = 0.4 - 0.1 * t;
      bottom[0] = 1 - 0.55 * t; bottom[1] = 0.45 - 0.22 * t; bottom[2] = 0.19 + 0.1 * t;
    }
  }
  update(delta: number) {
    if (!this.running) return;
    this.elapsed = Math.min(this.duration, this.elapsed + delta);
    this.apply(this.elapsed / this.duration);
    if (this.elapsed >= this.duration) { this.running = false; emit('status', 'Sunset complete'); }
  }
}
