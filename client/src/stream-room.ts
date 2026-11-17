import { senderUrl } from './backend.js';

const roomKey = 'garage-jam-stream-room-v1';
const roomPattern = /^[A-Za-z0-9_-]{4,32}$/;

/** The current viewer room, shared by the headset viewer and its sender link. */
export function getStreamRoom() {
  try {
    const supplied = new URLSearchParams(location.search).get('room');
    if (supplied && roomPattern.test(supplied)) {
      sessionStorage.setItem(roomKey, supplied);
      return supplied;
    }
    const stored = sessionStorage.getItem(roomKey);
    if (stored && roomPattern.test(stored)) return stored;
    const room = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    sessionStorage.setItem(roomKey, room);
    return room;
  } catch {
    return 'local';
  }
}

export function streamChannel(room: string, index: number) {
  return room ? `${room}:monitor${index}` : `monitor${index}`;
}

export function streamSenderUrl(room = getStreamRoom()) {
  return senderUrl(room);
}
