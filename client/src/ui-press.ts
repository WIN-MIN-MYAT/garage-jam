import { Matrix4, Ray, Vector3, type UIKitMLAsset } from '@iwsdk/core';

const touchClickWindow = 900;

/**
 * Draw a panel over the room meshes.
 *
 * UIKit elements inherit depthTest/renderOrder from their root, so applying
 * this once keeps every label, button and hit highlight readable even when the
 * panel overlaps a workbench, shelf or monitor.
 */
export function sendPanelToFront(panel: UIKitMLAsset, renderOrder = 1000) {
  panel.document.rootElement.setProperties({ depthTest: false, depthWrite: false, renderOrder });
}

/**
 * Bind a panel button to both ray clicks and hand poke taps.
 *
 * A poke can land on a button's label mesh instead of its background, so the
 * native click target changes between press and release. Track the touch
 * pointer down/up on the button itself and commit the action when the tap
 * stays on the same button.
 */
export function bindPress(panel: UIKitMLAsset, id: string, action: () => void) {
  const element = panel.getElementById(id);
  if (!element) return;
  const touches = new Map<number, number>();
  const target = element as unknown as {
    addEventListener: (type: string, listener: (event: any) => void) => void;
  };
  target.addEventListener('click', (event: any) => {
    if (event?.pointerType === 'touch') return;
    action();
  });
  target.addEventListener('pointerdown', (event: any) => {
    if (event?.pointerType !== 'touch') return;
    touches.set(event.pointerId, performance.now());
  });
  target.addEventListener('pointerup', (event: any) => {
    if (event?.pointerType !== 'touch') return;
    const downAt = touches.get(event.pointerId);
    touches.delete(event.pointerId);
    if (downAt == null) return;
    const elapsed = performance.now() - downAt;
    if (elapsed <= touchClickWindow) action();
  });
  target.addEventListener('pointerleave', (event: any) => {
    touches.delete(event.pointerId);
  });
  target.addEventListener('pointercancel', event => touches.delete(event.pointerId));
}

/** Reserve a press for the panel whenever its ray or direct poke reaches the card. */
export class PanelInput {
  private localRay = new Ray();
  private direct = new Vector3();
  private inverse = new Matrix4();
  private pressAt = -Infinity;

  constructor(private panel: UIKitMLAsset, onPress?: () => void) {
    panel.document.rootElement.addEventListener('pointerdown', () => {
      this.pressAt = performance.now();
      onPress?.();
    });
  }

  owns(ray: Ray, tip?: Vector3) {
    if (!this.panel.visible) return false;
    if (performance.now() - this.pressAt < 130) return true;
    const document = this.panel.document;
    const size = document.computedSize;
    if (!size) return false;
    const pixelSize = document.rootElement.properties.value.pixelSize ?? 0.01;
    document.updateWorldMatrix(true, false);
    this.inverse.copy(document.matrixWorld).invert();
    const width = size.width * pixelSize / 2 + 0.07, height = size.height * pixelSize / 2 + 0.07;
    if (tip) {
      this.direct.copy(tip).applyMatrix4(this.inverse);
      if (Math.abs(this.direct.z) < 0.20 && Math.abs(this.direct.x) < width && Math.abs(this.direct.y) < height) return true;
    }
    this.localRay.copy(ray).applyMatrix4(this.inverse);
    const { origin, direction } = this.localRay;
    if (Math.abs(direction.z) < 1e-5) return false;
    const t = -origin.z / direction.z;
    return t >= 0 && Math.abs(origin.x + t * direction.x) <= width && Math.abs(origin.y + t * direction.y) <= height;
  }
}
