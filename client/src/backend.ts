/**
 * Backend origin for the hosted client.
 *
 * Locally the Vite dev server proxies /api, /signal and /sender to the Node
 * server, so an empty value keeps the app same-origin. On Vercel, set
 * VITE_BACKEND_ORIGIN to the Render/Fly/VPS URL that runs server/index.js.
 */
const configured = (import.meta.env.VITE_BACKEND_ORIGIN ?? '').trim();

function resolveOrigin() {
  if (!configured) return location.origin;
  try {
    return new URL(configured).origin;
  } catch {
    console.warn('[garage] VITE_BACKEND_ORIGIN is not a valid URL:', configured);
    return location.origin;
  }
}

export const backendOrigin = resolveOrigin();

if (import.meta.env.PROD && !configured) {
  console.warn('[garage] VITE_BACKEND_ORIGIN is not set; API, sender and signaling will use this origin.');
}

export function apiUrl(path: string) {
  return `${backendOrigin}${path.startsWith('/') ? path : `/${path}`}`;
}

export function signalUrl() {
  const url = new URL('/signal', backendOrigin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export function senderUrl(room?: string) {
  return `${backendOrigin}/sender${room ? `?room=${encodeURIComponent(room)}` : ''}`;
}

/** Short share link that pre-fills the sender's room code. */
export function senderShareUrl(room?: string) {
  return room ? `${backendOrigin}/s/${encodeURIComponent(room)}` : `${backendOrigin}/sender`;
}

export function connectUrl() {
  return `${backendOrigin}/connect`;
}
