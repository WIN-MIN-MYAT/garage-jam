import { createSystem, PhysicsBody, PhysicsShape, PhysicsShapeType, PhysicsState, BoxGeometry, Mesh, MeshBasicMaterial } from '@iwsdk/core';
import { SlotManager } from '../slot-manager.js';
import { roomConfig } from '../room-config.js';
import { emit } from '../events.js';

export const slotManager = new SlotManager();
export class SceneSystem extends createSystem({}) {
  init() {
    if (new URLSearchParams(location.search).has('debug')) (window as any).garageDebug = { slots: () => slotManager.validate() };
    slotManager.create(this.world).then(slots => emit('slots', slots)).catch(error => emit('status', `Slot error: ${error.message}`));
    const staticBody = (name: string, size: [number, number, number], position: [number, number, number]) => {
      const mesh = new Mesh(new BoxGeometry(...size), new MeshBasicMaterial({ visible: false }));
      mesh.name = name; mesh.position.set(...position);
      const entity = this.world.createTransformEntity(mesh);
      entity.addComponent(PhysicsShape, { shape: PhysicsShapeType.Box, dimensions: size, friction: 0.8 });
      entity.addComponent(PhysicsBody, { state: PhysicsState.Static });
    };
    staticBody('Floor collider', [5, 0.12, 5], [0, -0.06, -0.7]);
    staticBody('Workbench collider', [1.6, 0.9, 0.7], [0, 0.45, roomConfig.workbench[2]]);
    const [tx, , tz] = roomConfig.trash;
    staticBody('Trash wall front', [0.42, 0.58, 0.04], [tx, 0.29, tz - 0.2]);
    staticBody('Trash wall rear', [0.42, 0.58, 0.04], [tx, 0.29, tz + 0.2]);
    staticBody('Trash wall left', [0.04, 0.58, 0.36], [tx - 0.2, 0.29, tz]);
    staticBody('Trash wall right', [0.04, 0.58, 0.36], [tx + 0.2, 0.29, tz]);
  }
}
