import { createSystem, Mesh, MeshBasicMaterial } from '@iwsdk/core';

/**
 * The IWSDK pointer reticle is depth-tested by default, so it disappears
 * behind props and panels. Keep the small ray cursor on top of the scene so
 * the user can always see what they are pointing at.
 */
export class PointerOverlaySystem extends createSystem({}) {
  private seen = new WeakSet<object>();
  private timer = 0;

  update(delta: number) {
    this.timer += delta;
    if (this.timer < 0.75) return;
    this.timer = 0;
    this.world.scene.traverse(object => {
      if (!(object instanceof Mesh)) return;
      if (object.renderOrder !== Infinity || object.userData?.attached !== true) return;
      const material = Array.isArray(object.material) ? object.material[0] : object.material;
      if (!(material instanceof MeshBasicMaterial) || this.seen.has(material)) return;
      this.seen.add(material);
      material.depthTest = false;
      material.depthWrite = false;
      material.transparent = true;
      material.needsUpdate = true;
    });
  }
}
