import type { Group } from '@iwsdk/core';

const roots = new Set<Group>();
let visible = true;

export function registerGarageRoot(root: Group) {
  roots.add(root);
}

export function unregisterGarageRoot(root: Group) {
  roots.delete(root);
}

export function setGarageRootsVisible(next: boolean) {
  visible = next;
  roots.forEach(root => { root.visible = next; });
}

export function garageRootsActive() {
  return roots.size > 0;
}

export function garageRootsVisible() {
  return visible;
}
