import { Matrix4, Ray, Vector3, type UIKitMLAsset } from '@iwsdk/core';

const touchClickWindow = 900;

type UiTargetState = { hover: boolean; press: boolean; touchedAt: number; paint?: () => void };
const uiTargets = new Map<object, UiTargetState>();
const uiStaleMs = 2500;
let uiSuppressUntil = 0;

/**
 * Mark the current moment as UI-owned.
 *
 * Other systems (the whiteboard in particular) can use this to avoid treating
 * the same trigger/pinch that pressed a panel button as a world interaction.
 */
export function markUiInput(ms = 180) {
  uiSuppressUntil = Math.max(uiSuppressUntil, performance.now() + ms);
}

/** Forget hover/press ownership, for example when a panel is closed or hidden. */
export function clearUiInput() {
  for (const state of uiTargets.values()) {
    state.hover = false;
    state.press = false;
    state.touchedAt = 0;
    state.paint?.();
  }
  uiSuppressUntil = Math.max(uiSuppressUntil, performance.now() + 220);
}

/** True while a bound panel target is hovered/pressed or a press just fired. */
export function uiInputActive() {
  const now = performance.now();
  for (const state of uiTargets.values()) {
    if (now - state.touchedAt > uiStaleMs) {
      state.hover = false;
      state.press = false;
    }
    if (state.hover || state.press) return true;
  }
  return now < uiSuppressUntil;
}

function uiStateFor(target: object) {
  let state = uiTargets.get(target);
  if (!state) {
    state = { hover: false, press: false, touchedAt: 0 };
    uiTargets.set(target, state);
  }
  return state;
}

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
 * Bind a panel button to ray clicks and hand poke taps.
 *
 * A poke can land on a button's label mesh instead of its background, so the
 * native click target changes between press and release. Track the touch
 * pointer down/up on the button itself and commit the action when the tap
 * stays on the same button.
 *
 * Hover and press also dim the element and reserve input for the UI, so the
 * same trigger pull cannot start a whiteboard stroke behind the panel.
 */
export function bindPress(panel: UIKitMLAsset, id: string, action: () => void) {
  const element = panel.getElementById(id);
  if (!element) return;
  const touches = new Map<number, number>();
  const target = element as unknown as {
    addEventListener: (type: string, listener: (event: any) => void) => void;
  };
  const ui = uiStateFor(element);
  const touch = () => { ui.touchedAt = performance.now(); };
  const paint = () => {
    try {
      element.setProperties({ opacity: ui.press ? 0.7 : ui.hover ? 0.88 : 1 });
    } catch { /* opacity is cosmetic */ }
  };
  ui.paint = paint;
  const flash = () => {
    ui.press = true;
    touch();
    paint();
    window.setTimeout(() => {
      ui.press = false;
      touch();
      paint();
    }, 90);
  };

  target.addEventListener('pointerenter', () => {
    if (ui.hover) return;
    ui.hover = true;
    touch();
    markUiInput(120);
    paint();
  });
  target.addEventListener('pointermove', () => {
    ui.hover = true;
    touch();
  });
  target.addEventListener('pointerleave', (event: any) => {
    ui.hover = false;
    ui.press = false;
    touch();
    touches.delete(event?.pointerId);
    paint();
  });
  target.addEventListener('click', (event: any) => {
    if (event?.pointerType === 'touch') return;
    markUiInput(200);
    flash();
    action();
  });
  target.addEventListener('pointerdown', (event: any) => {
    ui.press = true;
    touch();
    markUiInput(220);
    paint();
    if (event?.pointerType !== 'touch') return;
    touches.set(event.pointerId, performance.now());
  });
  target.addEventListener('pointerup', (event: any) => {
    ui.press = false;
    touch();
    markUiInput(200);
    paint();
    if (event?.pointerType !== 'touch') return;
    const downAt = touches.get(event.pointerId);
    touches.delete(event.pointerId);
    if (downAt == null) return;
    const elapsed = performance.now() - downAt;
    if (elapsed <= touchClickWindow) action();
  });
  target.addEventListener('pointercancel', (event: any) => {
    ui.press = false;
    touch();
    paint();
    touches.delete(event?.pointerId);
  });
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
      markUiInput(220);
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
    const width = size.width * pixelSize / 2 + 0.025, height = size.height * pixelSize / 2 + 0.025;
    if (tip) {
      this.direct.copy(tip).applyMatrix4(this.inverse);
      if (Math.abs(this.direct.z) < 0.09 && Math.abs(this.direct.x) < width && Math.abs(this.direct.y) < height) return true;
    }
    this.localRay.copy(ray).applyMatrix4(this.inverse);
    const { origin, direction } = this.localRay;
    if (Math.abs(direction.z) < 1e-5) return false;
    const t = -origin.z / direction.z;
    return t >= 0 && Math.abs(origin.x + t * direction.x) <= width && Math.abs(origin.y + t * direction.y) <= height;
  }
}
