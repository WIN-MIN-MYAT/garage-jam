# Production deployment

Garage Jam is **not a static-only IWSDK app**. The headset viewer, the sender page, the API and the WebSocket signaling socket must all be reachable from one HTTPS origin:

- `https://garagejam.com/` — WebXR client
- `https://garagejam.com/sender?room=...` — laptop sender
- `https://garagejam.com/signal` — WebSocket signaling
- `https://garagejam.com/api/*` — tasks, state and plugins

GitHub Pages and static Vercel deploys can host the client bundle, but they cannot run `/sender`, `/signal` or the API. Use a container host or a VPS.

## Recommended: Render + Docker

The repository includes `Dockerfile` and `render.yaml`.

1. Push the repository to GitHub.
2. Render Dashboard → **New +** → **Blueprint** → connect the repository.
3. Apply the blueprint. Render builds the Dockerfile, serves the app, and mounts a 1 GB disk at `/app/server/data`.
4. Add the production environment variables in Render (Notion, Spotify, Calendar, Weather, etc.). The server reads `server/.env` locally; production values come from the host environment.
5. Custom domain:
   - Render → your service → **Settings** → **Custom Domains** → add `garagejam.com` and `www.garagejam.com`.
   - Create the exact DNS records Render shows. Usually an apex `A` record for `garagejam.com` and a `CNAME` for `www`.
   - Wait for Render's automatic TLS certificate.
6. Open `https://garagejam.com/` in Quest Browser and `https://garagejam.com/sender?room=...` on the laptop. Use the exact sender link shown on the S9b screen.

`render.yaml` uses the `starter` plan because the persistent disk and always-on WebSocket matter for a live garage. For a free test deploy, remove the `disk` block; state will reset when the service restarts.

The server listens on `PORT` (default `8082`) and serves the built client from `client/dist` when it exists. `/health` is available for the platform health check.

## Docker on a VPS

```bash
docker build -t garage-jam .
docker run -d --name garage-jam \
  -p 127.0.0.1:8082:8082 \
  -v garage-jam-data:/app/server/data \
  --restart unless-stopped \
  garage-jam
```

Put Caddy or NGINX in front for HTTPS. Caddy example:

```caddyfile
garagejam.com {
  reverse_proxy 127.0.0.1:8082
}
```

Caddy provisions TLS automatically and passes WebSocket upgrades. Open only `80/443`; keep `8082` private.

## GitHub Pages / static Vercel

The IWSDK guides describe static hosting because a typical IWSDK experience has no backend. Garage Jam has a real-time streaming backend.

- `client/dist` is static, but `/sender`, `/signal`, `/stream-shared/*` and `/api/*` are not.
- If you host the client on GitHub Pages, you must host the Node service elsewhere and change the client to use absolute backend URLs for API and WebSocket traffic. That split is not configured in this repository.
- Do not point `garagejam.com` at GitHub Pages for this build; the sender link would load but never pair.

## Same Wi-Fi streaming through an online host

This is supported:

- `garagejam.com` handles only signaling, the sender page and the API.
- The video is WebRTC peer-to-peer over the local Wi-Fi; it does not need to travel through the host.
- Both devices must be on the same non-isolated LAN/VLAN. Guest Wi-Fi, AP isolation, VPNs and separate VLANs break direct candidates.
- No TURN server is required for the same-LAN case.
- `server/signaling.js` only rewrites `.local` host candidates when the signaling peer is a private LAN address. On a public host, `.local` candidates are left intact for local mDNS resolution. This is what allows a hosted signaling server with local media.

If the sender stays at **Connecting**, check:

1. `https://garagejam.com/health` returns `{ "ok": true }`.
2. The sender URL contains the same `room` code as the headset.
3. Both devices are on the same Wi-Fi and client isolation is off.
4. `https://garagejam.com/sender?room=...&stats=1` diagnostics show a direct UDP candidate path.
5. On the laptop, `chrome://flags/#enable-webrtc-hide-local-ips-with-mdns` is disabled if mDNS candidates are being filtered.

AV1 can run in software (`libaom`) and use significant CPU. If the laptop overheats or drops frames, open **Advanced** on that channel and select H.264 while keeping the same format; the signaling and room behavior are unchanged.

## Room codes

The headset generates an 8-character room code and stores it in `sessionStorage`. S9b displays:

```text
https://garagejam.com/sender?room=8f3a1c2d
```

The sender passes the room into the signaling channel names:

```text
8f3a1c2d:monitor1
8f3a1c2d:monitor2
8f3a1c2d:monitor3
```

Open the **exact** link from the headset. A bare `/sender` shows a warning and uses legacy `monitor1–3` channels, which will not pair with a room-scoped viewer.

The room code is a bearer secret, not user authentication. For a public multi-user service, add accounts and an authorization check before joining a room.

## OAuth callbacks

After the custom domain is live, update provider redirect URIs to the production origin, for example:

```text
https://garagejam.com/api/plugins/notion/callback
https://garagejam.com/api/plugins/spotify/callback
https://garagejam.com/api/plugins/calendar/callback
```

Set the same values in `NOTION_REDIRECT_URI`, `SPOTIFY_REDIRECT_URI` and `CALENDAR_REDIRECT_URI` on the host.

## Data and logs

- `server/data/` stores local tasks, progress, mural/pins and plugin tokens. Mount it on a persistent disk or deploy with a volume.
- `/api/signal-log` exposes recent signaling events for diagnostics.
- The sender and viewer both have **Diagnostics** panels with encoder, candidate path, jitter and latency information.
