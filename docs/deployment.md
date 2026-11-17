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

## Share the host's Spotify and Notion with judges

For a hackathon demo, judges should not need their own Spotify allowlist slots or Notion OAuth. Use one **demo host account** and server-side tokens. `render.yaml` sets `PLUGIN_SHARED_PROFILE`; remove it if you want each visitor to connect their own providers instead.

### Spotify

The shared-account path uses one Spotify account (ideally a dedicated Premium demo account, not your personal one):

1. Set `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and `SPOTIFY_REDIRECT_URI=https://garagejam.com/api/plugins/spotify/callback` on the host.
2. Add `PLUGIN_SHARED_PROFILE` (20–80 letters/numbers/underscores) to the host environment. `render.yaml` sets a default value.
3. Open `https://garagejam.com/api/plugins/manage` from your browser and connect Spotify once. The token is stored under the shared profile.
4. Keep a Spotify client open and awake on a laptop or phone and select it as the playback device in the wrist Music page.
5. Set `PLUGIN_DEMO_LOCK=1` and redeploy. Visitors can still play/pause/next/volume, but cannot replace or disconnect the shared account.

Judges never log into Spotify and never need to be added to the Spotify app's allowlist. Only the demo account authorizing the app needs to be allowed; as the app owner it normally already is. The refresh token stays on the server; no password or token is exposed to visitors.

Caveats:

- Judges are controlling the host's playback. Use a dedicated account with a neutral display name and a demo playlist.
- Spotify Premium and an active playback device are required.
- Spotify's Development Mode user limit still applies if judges try to connect **their own** accounts. That requires their emails or Extended Quota Mode. The shared-account path avoids it.
- Use music that is available in the host account's market; judges' countries do not change the account's catalog.
- `PLUGIN_SHARED_PROFILE` shares all plugin tokens (Spotify, Notion OAuth, Calendar, Weather). Use demo calendar/weather data or skip those connectors if you do not want visitors to see personal data.

### Notion

Notion does not need judge logins if the server has an internal integration token:

1. Create a **separate demo database**, not your personal notes.
2. Create a Notion internal integration and share the database with it.
3. Set `NOTION_TOKEN` and `NOTION_DATABASE_ID` on the host, plus `TASKS_SEND_TO=notion` (the default).
4. Restart the service. Every visitor now sees the same demo tasks and can add/complete them through the app.
5. Reset the database before judging if needed.

The optional OAuth connector can still be used for a judge's own workspace, but it is not required for the shared demo. The task board uses `NOTION_TOKEN` directly, so the wrist CONNECT badge may remain OPTIONAL/OFF even while tasks work. With `PLUGIN_DEMO_LOCK=1`, visitors cannot replace the shared connection.

Because the demo is public, anyone can control the host Spotify playback or modify the demo Notion database. Use a separate demo account/database and reset them between judging sessions.

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
