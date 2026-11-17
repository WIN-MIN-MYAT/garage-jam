/// <reference types="vite/client" />
/// <reference types="@iwsdk/vite-plugin-dev/client" />

interface ImportMetaEnv {
  /** Public origin of the Node API/signaling server when the client is hosted separately. */
  readonly VITE_BACKEND_ORIGIN?: string;
}
