import { Box3, Group, Mesh, MeshBasicMaterial, Vector3 } from '@iwsdk/core';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const monitorScreenWidth = 0.64;
export const monitorScreenHeight = monitorScreenWidth * (1.8854 / 3.73393);
// Distance from the authored display center to the bottom of the stand.
export const monitorStandDrop = monitorScreenWidth * (1.63597 / 3.73393);
const modelUrl = '/assets/models/computer-monitor.glb';

type MonitorTemplate = { casing: Group; displayName: string; standParts: string[]; aperture: Box3 };
let template: Promise<MonitorTemplate> | undefined;

function loadTemplate() {
  return template ??= new GLTFLoader().loadAsync(modelUrl).then(({ scene }) => {
    let display: Mesh | undefined;
    const standParts: string[] = [];
    scene.traverse(node => {
      if (!(node instanceof Mesh) || Array.isArray(node.material)) return;
      const source = node.material;
      if (source.name === 'Display') {
        display = node;
        node.material = new MeshBasicMaterial({ color: 0x191721 });
        source.dispose();
      }
      if (source.name === 'Stand' || source.name === 'Main_MAt') standParts.push(node.name);
    });
    if (!display) throw new Error('Monitor model is missing its Display mesh');
    scene.updateMatrixWorld(true);
    return { casing: scene, displayName: display.name, standParts, aperture: new Box3().setFromObject(display, true) };
  }).catch(error => {
    template = undefined;
    throw error;
  });
}

export async function createMonitorModel(width: number, height: number, options: { hideStand?: boolean } = {}) {
  const { casing, displayName, standParts, aperture } = await loadTemplate();
  const model = casing.clone();
  const display = model.getObjectByName(displayName)!;
  if (options.hideStand) standParts.forEach(name => model.getObjectByName(name)?.removeFromParent());
  const center = aperture.getCenter(new Vector3());
  const size = aperture.getSize(new Vector3());
  model.position.sub(center);
  const mount = new Group();
  mount.name = 'Low-poly monitor';
  mount.add(model);
  mount.scale.set(width / size.x, height / size.y, width / size.x);
  return { mount, display };
}
