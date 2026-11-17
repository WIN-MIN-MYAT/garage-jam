import { BoxGeometry, createSystem, DoubleSide, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from '@iwsdk/core';
import { emit } from '../events.js';

// Gate 2 rendering spike: a depth-only 3D laptop volume in front of an opaque panel.
// Enable only with ?cutoutSpike=1; ordinary garage sessions are unaffected.
export class CutoutSpikeSystem extends createSystem({}) {
  init() {
    if (new URLSearchParams(location.search).get('cutoutSpike') !== '1') return;

    const shell = this.world.getSceneObject('garage-shell');
    if (shell) shell.visible = false;
    this.world.renderer.setClearColor(0x000000, 0);

    const root = new Group();
    root.name = 'Cutout spike v2';
    root.position.set(0, 1.35, -1.8);
    const panel = new Mesh(
      new BoxGeometry(1.4, 0.95, 0.035),
      new MeshBasicMaterial({ color: 0xd02bb8, side: DoubleSide, depthWrite: true }),
    );
    panel.name = 'Cutout spike opaque panel';
    panel.position.set(0, 0, 0);
    panel.renderOrder = 0;

    const depthOnly = new MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      depthTest: true,
      side: DoubleSide,
    });
    const screen = new Mesh(new BoxGeometry(0.72, 0.43, 0.055), depthOnly);
    screen.name = 'Cutout spike screen volume';
    screen.position.set(0, 0.13, 0.25);
    screen.renderOrder = -1000;

    const base = new Mesh(new BoxGeometry(0.82, 0.045, 0.43), depthOnly);
    base.name = 'Cutout spike keyboard volume';
    base.position.set(0, -0.12, 0.37);
    base.renderOrder = -1000;

    root.add(panel, screen, base);
    this.world.createTransformEntity(root, { persistent: true });

    // The local-floor origin can face any direction when the user enters XR.
    // Position once using the tracked headset pose, then keep the volume world-locked.
    const cameraPosition = new Vector3();
    const direction = new Vector3(0, 0, -1);
    const orientation = new Quaternion();
    const stop = this.world.onXRFrame(frame => {
      const space = this.world.renderer.xr.getReferenceSpace();
      const pose = space && frame.getViewerPose(space);
      if (!pose) return;
      const { position, orientation: rotation } = pose.transform;
      cameraPosition.set(position.x, position.y, position.z);
      orientation.set(rotation.x, rotation.y, rotation.z, rotation.w);
      direction.set(0, 0, -1).applyQuaternion(orientation);
      direction.y = 0;
      if (direction.lengthSq() < 0.001) return;
      direction.normalize();
      root.position.copy(cameraPosition).addScaledVector(direction, 1.8);
      root.rotation.y = Math.atan2(-direction.x, -direction.z);
      stop();
      emit('status', 'Cutout test v2: pink panel placed ahead; inspect the clear shape from eight angles');
    });
    this.cleanupFuncs.push(stop);
  }
}
