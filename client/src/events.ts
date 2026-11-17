export const garageEvents = new EventTarget();
export function emit(type: string, detail?: unknown) { garageEvents.dispatchEvent(new CustomEvent(type, { detail })); }
