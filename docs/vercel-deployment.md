# Deploying Garage Jam with Vercel

Vercel is a great host for the **WebXR client** (`client/`). It is not a drop-in host for the current **Node process** in `server/`, because that process needs long-lived WebSocket signaling, the `/sender` page, `/api` routes, and persistent files in `server/data/`.

The recommended split:

| Piece | Host | URL |
|---|---|---|
| WebXR client (Vite build) | Vercel | `https://<VERCEL_URL>/` |
| API, `/signal` WebSocket, `/sender`, `/connect` | Render / Fly / VPS | `https://<BACKEND_URL>/` |
| Video | Peer-to-peer WebRTC | Stays on your LAN |

The player opens the Vercel URL. The client calls the backend directly for tasks, plugins, and signaling. The sender link shown in the headset points at the backend, so the laptop and headset share the backend's WebSocket endpoint.

> **Why not everything on Vercel?** Vercel Functions now support WebSockets, but this server keeps room state in memory, writes tasks/tokens to `server/data/`, and expects one long-lived process. Moving it to Vercel would mean adding Redis/KV/Blob, refactoring Express into a function, and accepting function-duration limits. For a hackathon demo, the split is faster and more reliable.

---

## 1. Deploy the backend first

Deploy the repository to Render using the included `render.yaml` (or build the `Dockerfile` on Fly.io/Railway/VPS).

1. Push the repository to GitHub.
2. Render Dashboard → **New +** → **Blueprint** → connect the repository.
3. Apply the blueprint. It builds the `Dockerfile`, starts the Node server, and mounts a 1 GB disk at `/app/server/data`.
4. Add the environment variables you need in Render:

```text
NODE_ENV=production
NOTION_TOKEN=...
NOTION_DATABASE_ID=...
TASKS_SEND_TO=notion
PLUGIN_SHARED_PROFILE=<a 20-80 character demo profile id>
PLUGIN_DEMO_LOCK=1
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
SPOTIFY_REDIRECT_URI=https://<BACKEND_URL>/api/plugins/spotify/callback
CALENDAR_CLIENT_ID=...
CALENDAR_CLIENT_SECRET=...
CALENDAR_REDIRECT_URI=https://<BACKEND_URL>/api/plugins/calendar/callback
NOTION_CLIENT_ID=...
NOTION_CLIENT_SECRET=...
NOTION_REDIRECT_URI=https://<BACKEND_URL>/api/plugins/notion/callback
```

5. Open `https://<BACKEND_URL>/health` and confirm `{ "ok": true }`.
6. Open `https://<BACKEND_URL>/sender` and confirm the sender page loads.
7. If you use the free Render plan, the service spins down when idle and `server/data` does not persist. Use the Starter plan (the blueprint already does) for a demo.

The backend serves the sender page and `/stream-shared/*` itself. Do not point the sender link at Vercel.

---

## 2. Deploy the client on Vercel

1. In Vercel, **Add New → Project** and import the same GitHub repository.
2. Set **Root Directory** to the repository root (leave it empty or `./`). Do **not** set it to `client/`, because the Vite build copies the root `assets/` folder into `client/dist/assets/`.
3. Framework Preset: **Vite** (or **Other**). The repo's `vercel.json` already sets:
   - Install Command: `npm --prefix client ci`
   - Build Command: `npm --prefix client run build`
   - Output Directory: `client/dist`
4. Add an Environment Variable:

```text
VITE_BACKEND_ORIGIN=https://<BACKEND_URL>
```

No trailing slash. This is a public URL, not a secret.

5. Deploy. Vercel builds the client and serves `client/dist`.
6. Open `https://<VERCEL_URL>/` on Quest 3/3S. The landing page should show the capability check.

If you change `VITE_BACKEND_ORIGIN`, redeploy. Vite embeds the value at build time.

---

## 3. How the URLs are wired

The new `client/src/backend.ts` helper resolves the backend once:

- `apiUrl('/api/tasks')` → `https://<BACKEND_URL>/api/tasks`
- `signalUrl()` → `wss://<BACKEND_URL>/signal`
- `senderUrl(room)` → `https://<BACKEND_URL>/sender?room=...`

When `VITE_BACKEND_ORIGIN` is empty, the helper falls back to `location.origin`, so local development still uses the Vite proxy on port 8091.

The backend already has `cors({ origin: true })`. It now runs **before** the plugin router, so cross-origin `/api/plugins/*` requests also get CORS headers and preflight handling.

The sender page stays on the backend, so its relative `/stream-shared/*` imports and `wss://<BACKEND_HOST>/signal` socket keep working without any Vercel configuration.

---

## 4. Test the split

1. Open the Vercel URL on Quest 3/3S in Quest Browser.
2. Enter the garage. Tasks should load from the backend (check the Network tab if not).
3. Open the wrist **CONNECT** page. The pairing code should open a backend `/connect` URL on your phone/laptop.
4. Choose **STREAM MY LAPTOP** and copy the sender link. It must start with `https://<BACKEND_URL>/sender`, not the Vercel URL.
5. Open that link in Chrome on the laptop, join the room code, and start a monitor.
6. Keep both devices on the same non-isolated Wi-Fi. Video is direct WebRTC; the backend only signals.
7. Check `https://<BACKEND_URL>/api/signal-log?channel=<room>:monitor1` for signaling events.

---

## 5. Custom domains

- Add `garage.example.com` to Vercel → the frontend.
- Add `api.garage.example.com` to Render → the backend.
- Set `VITE_BACKEND_ORIGIN=https://api.garage.example.com` in Vercel and redeploy.
- Update every OAuth redirect URI to the backend domain.
- If you use a custom domain for the frontend, no backend change is needed; CORS reflects the request origin.

---

## 6. Troubleshooting

**`/api/...` returns 404 on Vercel.**
`VITE_BACKEND_ORIGIN` was not set at build time, or the deployment was not rebuilt after adding it. Vercel env changes require a redeploy.

**`Failed to fetch` or a CORS error.**
Confirm `https://<BACKEND_URL>/health` works and that the backend is running the updated `server/index.js` with CORS before `/api/plugins`. On Render, check the deploy logs.

**The sender link points at Vercel.**
Rebuild the client after setting `VITE_BACKEND_ORIGIN`. The link is generated from `senderUrl()` in `client/src/backend.ts`.

**Streaming stays on “Connecting”.**
The sender must be on the backend URL, both devices must be on the same LAN, and the room codes must match. Check `chrome://flags/#enable-webrtc-hide-local-ips-with-mdns` on the laptop if host candidates are being hidden. There is no TURN relay.

**Plugins connect on the backend but not from the headset.**
Open the pairing URL on the phone/laptop, finish OAuth, then return to the headset. For a judge demo, set `PLUGIN_SHARED_PROFILE` and `PLUGIN_DEMO_LOCK=1` on the backend.

**Render is slow on the first request.**
The free plan spins down. Use the Starter plan or keep the service warm.

**Vercel still shows an old build.**
The service worker cache name in `client/public/sw.js` is fixed (`garage-jam-v1`). Clear the site data in Quest Browser/Chrome, or bump the cache name after a major deploy.

---

## 7. If you really want everything on Vercel

You would need to:

1. Refactor `server/index.js` into a Vercel Function that exports the HTTP server and attaches the `ws` server (Vercel supports Node WebSockets).
2. Move `server/data/*` (tasks, state, plugin tokens) to Vercel Blob, KV, or a database.
3. Move signaling room state to Redis or another shared store, because a reconnecting viewer may land on a different function instance.
4. Serve `/sender`, `/connect`, and `/stream-shared/*` from the same function or as static Vercel assets.
5. Set a function `maxDuration` that covers your demo, and accept that connections close at the limit.

That is a different project from the current one-process server. The split above keeps the existing code and gets you a public URL fastest.
