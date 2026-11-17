# Garage Jam

Garage Jam is a seated WebXR garage for Quest Browser, built with IWSDK 1.1.0, its matching `super-three@0.185.0`, Havok physics, a small Node server, and browser WebRTC. It starts with procedural placeholder props. No Tripo models are needed to run it.

## Status

The P0 code path is present: garage and sunset, slot placeholders and GLB swap, local/Notion tasks, physics papers, three WebRTC monitor channels, passthrough toggle, spatial HUD, and service-worker cache. It typechecks and builds. The desktop IWER emulator enters XR, spawns starter/local papers on the measured table, completes a crushed-paper task into the solver trash can, shows the focus door and countdown, draws the stats/calendar/Top 3/whiteboard boards, switches to streaming monitors, and exercises local task creation. **Quest 3 performance, controller throwing, real Notion write-back, live laptop streaming, real OAuth/Spotify/Calendar/Weather connections, and headset hand/controller feel have not been validated.** P2 stretch items remain deferred. The `SUNSET` button exercises the standalone P0 sunset timeline.

The new product entry `/` runs S0–S11: capability-check landing, room scan or touch calibration, the Room Build Reveal, table confirm, mode choice, a ready screen and resume. `/?test=1` is the developer hub for isolated gate probes. The `?demo=1` query keeps the older prototype with three local sample papers when Notion is unconfigured. Demo papers do not write to Notion. `?debug=1` prints slot validation to the console and enables `S` to start the sunset. `?style=plain` disables the toon material for performance comparison. Additional probes: `?focusDemo=1` shortens focus to one minute, `?nudgeDemo=1` shortens break nudges, and `?hud=1` shows the debug HUD in the product flow.

## Install and run

Use Node.js 20.19+ (Node 24 also works). From the repository root:

```powershell
npm install
npm --prefix client install
npm --prefix server install
Copy-Item server/.env.example server/.env
npm run dev
```

The command starts the API on port **8082** and the secure viewer on **8091**, prints LAN addresses, and prints a QR code. Open `https://<laptop-LAN-IP>:8091/` in Quest Browser. Accept the local development certificate warning. On the laptop, open `https://localhost:8091/sender` in Chrome and accept the warning there too. Use the laptop's Wi-Fi IP from the printed list, not a virtual adapter IP. The HTTPS Vite server proxies `/api`, `/signal`, and `/sender` to the Node process, so browser API and WebSocket traffic share one secure origin.

Windows may ask to allow Node through the firewall. Allow private-network access for TCP **8091**; port 8082 is reached only through the Vite proxy. If the prompt was missed, add a private-network inbound TCP rule for 8091 in Windows Defender Firewall. The laptop and Quest must be on the same 5 GHz or 6 GHz network, with client isolation disabled.

USB alternative: first confirm the device with `adb devices`. In PowerShell, set `$env:GARAGE_HTTP='1'`, run `npm run dev`, and run `adb reverse tcp:8091 tcp:8091` for that connected Quest. Then open `http://localhost:8091/` in Quest Browser. This works because localhost is a secure context for WebXR. Use `http://localhost:8091/sender` on the laptop in this mode. Remove the environment variable with `Remove-Item Env:GARAGE_HTTP` when returning to LAN HTTPS. No Quest was connected during development, so this USB path is documented but untested here.

## Notion setup

Create a Notion database with these exact properties:

| Property | Type | Values |
| --- | --- | --- |
| Name | Title | Task title |
| Status | Status | Not started, In progress, Done |
| Priority | Select (optional) | High, Medium, Low |
| Due | Date (optional) | Any date |

Create a Notion integration, grant it access to that database, and put its token and database ID in `server/.env`. The token stays on the Node server. The proxy pins Notion API version `2022-06-28` because the requested database query route uses that version. Property names can be changed in `.env`. Task reads query up to 30 pending rows and cache the last good response in `server/data/tasks-cache.json`. Failed Done updates retry once, then enter `server/data/done-queue.json` for retry on the next server start. Queued status is shown in the HUD. Without Notion, tasks are stored locally in `server/data/tasks-local.json`; new tasks default to local and can be sent to Notion with `TASKS_SEND_TO=notion`. These data files and `.env` are gitignored.

## Plugin connections

Open the wrist menu's **Plugins** tab or visit `/api/plugins/manage` on the Garage Jam site. Sign-in takes place in the browser. Connections are saved for that browser. **Verify** checks the connected account or fetches a fresh weather reading. **Disconnect** removes the saved connection from Garage Jam. To revoke consent with the provider as well, use its account settings.

- **Notion** — Create an OAuth integration in the [Notion developer portal](https://developers.notion.com/guides/authorization/overview). Set `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`, and `NOTION_REDIRECT_URI` in `server/.env`. Register the exact HTTPS callback, such as `https://your-garage-host/api/plugins/notion/callback`. The task board has its own configuration above.
- **Spotify** — Create an app in the [Spotify developer dashboard](https://developer.spotify.com/dashboard). Set `SPOTIFY_CLIENT_ID` and `SPOTIFY_REDIRECT_URI` in `server/.env`. Register the exact callback, such as `https://your-garage-host/api/plugins/spotify/callback`. For local HTTP development Spotify requires a loopback IP address such as `127.0.0.1`. Development mode requires a Premium app owner and allowlisted testers. [Redirect URI rules](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri) · [Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
- **Google Calendar** — Enable the Calendar API in Google Cloud, create an OAuth web client, and set `CALENDAR_CLIENT_ID`, `CALENDAR_CLIENT_SECRET`, and `CALENDAR_REDIRECT_URI` (callback `/api/plugins/calendar/callback`). The connector requests read-only today events for the primary calendar.
- **Weather** — Search for a city or postal code and pick a location. [Open-Meteo](https://open-meteo.com/) supplies current conditions through its free non-commercial API. The server can also use `WEATHER_LATITUDE` / `WEATHER_LONGITUDE` as a default location.

Restart the API after changing `server/.env`. Open the plugin manager on the same origin as the registered callback.

## Stream laptop windows

On the laptop sender page, click **Start** separately for Monitor 1, 2, and 3. Chrome opens its window or tab picker for each click and requires a fresh choice each session. Choose a specific app window or tab: the sender requests these surfaces and rejects a whole-screen selection. Use `?allowScreen=1` on `/sender` only if full-screen capture is needed. The default preset is 720p at 30 fps with a 2 Mbps maximum, prefers H.264 when available, and asks WebRTC to preserve frame rate under congestion. The 1080p and 1440p presets remain available, but their quality may be limited by the same 2 Mbps ceiling. The Quest viewer makes one connection per channel when the page loads and keeps it across XR entry and exit. Mouse and keyboard input stay on the laptop. Click **Stop** to end a channel.

S9b shows the sender URL and live state for each of the three monitors. The room-driven build places the monitor arc in front of the seat (about 1.75 m, eye height above the table) and hides it in passthrough mode. The wrist Room page has **Recenter monitors**; `stream-forget`/the S9b **FORGET** button returns the channels to pairing.

For a streaming stability run, close stale Garage Jam tabs first and open `/sender` in Chrome and `/?demo=1&probe=1` on the Quest. The sender has capture presets, a content-hint selector, automatic quality stepping, live encoder/network stats, and a **Download run JSON** button. The Quest HUD has **STATS** to toggle per-monitor diagnostics and **SAVE RUN** to download the viewer/server event timeline. The monitor state stays live through a brief signaling socket interruption; a replaced tab stops reconnecting. The sender alone restarts ICE after a sustained disconnection. See [stability-report.md](docs/stability-report.md) for the live fault tests still required.

Open `/sender/timecode` in a separate Chrome tab and share that tab for the automatic latency probe. `?probe=1` enables the Quest probe and the sender page can also use `?probe=1` for its local preview probe. The automatic number is **timecode-to-decoded-video**, not physical glass-to-glass latency; [latency-results.md](docs/latency-results.md) explains the camera method needed to include the Quest display. `?stats=0&probe=0&log=0` disables client collectors and diagnostic logging; set `GARAGE_SIGNAL_LOG=0` before starting the server to disable server event logging. Query options include `?preset=fast|balanced|weak|sharp|multi|low`, `?jitter=0|20|50` (milliseconds), `?adaptiveJitter=1` to enable buffering on freezes, `?iceGrace=5000`, `?hysteresis=3000`, and `?monitors=1|2|3` on the Quest viewer.

If a connection fails while both devices are on the same LAN, check Chrome's `chrome://flags/#enable-webrtc-hide-local-ips-with-mdns` setting and relaunch Chrome after disabling host-candidate hiding for the demo. The signaling server also replaces `.local` host candidates with the sender's WebSocket IP when Vite passes the original peer address. No STUN/TURN servers are configured, and signaling exchanges only UDP candidates. If the LAN blocks direct UDP, the stream fails instead of falling back to relay or TCP. The selected candidate pair is shown in diagnostics and must be verified on the actual devices. The receiver requests a 0 ms jitter target by default and does not adapt it upward unless `?adaptiveJitter=1` is set; this is a browser hint, not a guarantee of zero buffering. The under-200 ms latency target remains a device measurement, not a guarantee.

## Single-entry product flow

`/` is the product entry. `/?test=1` opens the developer probes. **Enter the Garage** requests an XR session and checks the room planes. If Quest Browser exposes several tables, look at the tabletop you want and choose **Use outlined table** when the outline turns yellow. Use **Mark table corners** to keep the scanned room and measure the tabletop by touch. Full touch setup measures the floor and table. The reveal leads into table confirmation, mode selection, optional device marking, and the live garage.

**Resume the Garage** keeps your setup progress and preferences. It reads the current room after opening a new XR session, then runs the quick reveal and asks you to check the table. A tracking-origin reset also starts a live scan. If the room has no live scan, use full touch setup. The saved room is used for the landing summary.

## Room Build Reveal

The reveal is a data-driven timeline in `client/src/reveal/`. It uses a world-space alpha-clip shader: unrevealed skin fragments discard, so the real room remains visible through passthrough. Beats: blueprint floor-plan, floor spray, staggered wall wipes with drips, ceiling roll, door/sun beam/dust, table roller, prop drops with squash and comic pops, lamp/neon flicker, and `READY!`. All skins and props are precreated and precompiled; the timeline scales with the room diagonal to 4–8 s, the resume version is 2.2–3 s, and reduced motion is a 0.6 s dissolve. Skip (right B/A long-press or the panel button), reveal-off and reduced motion produce the same final state. The adaptive fallback halves particles, then removes drips/noise, then switches to the 0.6 s dissolve under load. `revealMode`, `revealSpeed`, `revealParticles`, `revealPops`, `revealAdaptive` and `revealStress` are available as query overrides.

## Room-driven garage build (developer probe)

Use the dev hub `/?test=1` and pick **ROOM BUILD**, or open `/?roomBuild=1` directly. The probe builds from live floor and table planes and uses the demo room if the scan times out. Force a source with `?roomSource=scan`, `?roomSource=manual`, or `?roomSource=demo`. The HUD reports `[SCAN]`, `[MANUAL]`, or `[DEMO]` with the room size and table height. The desktop emulator script is:

```powershell
npm --prefix client run dev
node client/scripts/emulator-garage-build.mjs
```

The script writes `client/scripts/garage-build-emulator.png`. Emulator FPS is not a Quest performance claim; the 72 Hz headset gate remains open.

### Table confirm and wrist menu

After the garage reveal, `THIS YOUR TABLE?` appears beside the table. Use `-0.5 cm` / `+0.5 cm` or `TOUCH TABLE` to adjust the height, then press `YEP!` to save. Use `MARK 4 CORNERS` to replace the outline and height together. Full touch setup guides you through the floor first, then the table. Touch each corner in perimeter order, review the numbered outline, and choose whether to use it or undo a point.

Look at your left wrist for 140 ms, or pinch thumb and index with your palm up for 180 ms, to open the compact menu at direct-touch range (~43 cm). It stays static in world space; poke a button with your fingertip, use a controller ray, or keep using the wrist. **PIN** keeps it open, **X** or the left X/right A button dismisses it, and looking away closes it after 1.5 s unless pinned or touched. **Center panel** brings it back in front of you. The Home page has passthrough, table view, cutouts, mark-devices and center; Room has table corners, table height, rearrange, rescan and debug; Settings has units, dominant hand, motion, reveal, sound and outlines, plus reset and forget.

The reveal, flow, scan overlay, compact wrist pages, device marking, papers, focus, boards and streaming integration are implementation-tested in the IWSDK emulator; Quest 72 Hz, physical controller/hand input, haptics, persistent anchors/fingerprint resume and the physical Gate 8+ checks remain unverified.

### Device marking and passthrough cutouts

Choose **Mark devices** in setup or from the wrist menu. The panel opens in passthrough. Point your fingertip or controller at one corner and pinch or press to plant it. Keep pinching and drag the same hand to the diagonally opposite corner; the outline follows live and releasing completes it. A second pinch also works when you prefer two taps. Once the first corner is placed, only the hand or controller that drew it can continue, so the other hand cannot swap corners mid-outline. Check the outline and its dimensions before saving. You can undo either corner. Marking, table, calibration, flow and wrist panels draw above the garage props so labels stay readable when a panel overlaps the workbench or a shelf.

- **Laptop** measures the tilted display and offers the same two-corner flow for the base. **Use fitted base** estimates it from the hinge.
- **Monitor only** saves the display. **Desktop setup** can add a keyboard with two more corner marks.
- **Extra zone** draws a rectangle for a mouse, notebook, phone, or other item.

Displays start with 5 mm depth. Saved outlines remain visible in passthrough. The virtual garage draws a thin bezel around displays, with depth-only cutouts for real devices when **Cutouts** is enabled. **Done** restores the view you had before opening device setup.

Saved placements are relative to the measured tabletop or floor. On resume, Garage Jam matches that surface against the current room outline and openings before showing the saved devices. Older seat-relative records and ambiguous matches stay available under **Re-mark device**. **Settings / Forget room** clears the saved placements.

## Wall stickers and garage dressing

The supplied `sticker_pack_1_41_stickers.glb` is optimized from 77 MB to **2.16 MB** at `assets/models/optimized/stickers.glb`: metal-rough materials, pruned/deduped data, and 512 px textures. The build instantiates **42 sticker patches** from the 30 usable photo patches, so duplicates are allowed; they are scattered across walls with length-based quotas rather than clustered in one spot.

Each sticker gets a mixed height between roughly 0.85–1.9 m, a size between roughly 0.12–0.38 m, and a layered wall offset of 6–13 mm so overlapping patches do not z-fight. Most are tilted a little, some are strongly angled or upside-down, and about 13% are peeled slightly off the wall. Openings, wall props, the pegboard and the shelf area are kept clear.

The reveal adds a sticker beat after the wall wipe. Each patch peels in from a small normal offset, settles into place with a slight twist and scale pop, and a few drop a tiny dust poof. Quick reveal inserts the same beat before the props finish.

Garage dressing is anchored rather than random:

- **Storage shelf** - against the wall behind the seat, tucked into a corner and turned to face the room. It is no longer placed in the center.
- **Trash can** - about 0.6 m beside the seat on the dominant-hand side, with an exit-corridor check.
- **Paint/spray cans** - a P1 workbench prop at 0.32 x 0.26 m so they appear on the table instead of being skipped as optional floor clutter.
- **Pegboard/tool board** - reduced to 0.8 x 0.55 m and promoted to P1.

Evidence: `scripts/stickers-wall.png`, `scripts/stickers-scatter.png`, `scripts/garage-shelf-corner.png`, `scripts/garage-paint-cans.png`, `scripts/garage-trash-seat.png`. The added sticker draw calls and 512 px textures still need a Quest 72 Hz check; the current screenshots are from the desktop emulator.

## Quest controls and demo

Press **ENTER GARAGE** or complete the product flow. Pending tasks and two starter papers drop onto the measured paper zone once per XR session. Squeeze to grab a nearby sheet; while holding it, press the trigger to crumple it. Release toward the trash can. Only a crumpled sheet crossing the trash rim volume completes the task. The physics system supplies release velocity; the paper system estimates it from five pose samples if the body has near-zero release velocity. Completed tasks update the local task list, the Notion connector when configured, the stats board, and the mural. Releasing a flat paper near the corkboard pins its task into Today / Top 3.

The wrist **MUSIC** page controls Spotify (play/pause, previous/next, volume, device and playlist cycling) and falls back to a procedural lo-fi bed when Spotify is not connected. **Voice task** uses the Web Speech API when available. The wrist **CONNECT** page opens the provider manager for Notion, Spotify, Google Calendar, and Weather. The room also shows a stats board, today's calendar board, Top 3 corkboard, focus whiteboard, and a persistent paint-splat mural when those slots are placed.

Use Y on the left controller or B on the right, or the spatial **PASSTHROUGH** button, to hide the garage shell and reveal the real keyboard. The viewer must be in `immersive-ar` mode for this toggle.

Start a sunset with the **SUNSET** button. The default timeline is 30 minutes; `?demo=1` makes it 60 seconds. In `?debug=1`, press `S` on the keyboard to start it. The event bus also accepts `sunset-start`, `sunset-pause`, and `sunset-reset` events.

**Focus** starts from the wrist Home page. A procedural shutter rolls over the garage opening, a countdown sign appears, the sky dims, and music starts if enabled. The default session is 25 minutes with a 5-minute break; `?focusDemo=1` uses 1 minute/20 seconds. Focus minutes and completed-task streaks feed the stats board. Break nudges default to 50 minutes (`?nudgeDemo=1` for 45 seconds) and flash a neon sign message.

For an immersive VR session instead of the default immersive AR session, change `client/iwsdk.config.json` → `world.xr.mode` from `ar` to `vr` and restart the client. The app hides the passthrough button in that mode and points to the Quest system shortcut.

## Replacing a placeholder

Put an untouched Tripo GLB in `assets/models/raw/`. Optimize it from the root, for example:

```powershell
npm run model:optimize -- assets/models/raw/trash-can.glb assets/models/optimized/trash-can.glb --compress meshopt --texture-compress webp --texture-size 1024
```

Then set `SLOT_TrashCan.model` to `/assets/models/optimized/trash-can.glb` in `assets/assets.config.json` and refresh. The new room-driven build loads `model` for every placed prop and falls back to the placeholder if the GLB fails; the old fixed prototype loads it through `SlotManager`. See [model-slots.md](docs/model-slots.md) for the ready and not-ready slot list. The loader scales and repivots to the slot target, replaces expensive source materials with the shared comic material, and keeps a separate primitive collider in the old prototype. Keep small props around 500–3,000 triangles and hero props below 8,000; `?demo=1&debug=1` reports per-slot triangles, outline cost, and textures above 1024 px. For hero textures use `--texture-size 2048` selectively. Inspect albedo textures for baked shadows before import. Consistent Tripo prompt terms: *stylized, hand-painted, low poly, grungy, game asset, garage*.

`assets/models/optimized/test-panel-meshopt.glb` is a two-triangle sample used to verify the optimized swap path. Set `SLOT_PegboardTools.model` to `/assets/models/optimized/test-panel-meshopt.glb` to try it, then return the field to `null`.

## Checks

```powershell
npm run typecheck
npm run build
npm test
node client/scripts/emulator-rest-features.mjs
node client/scripts/emulator-device-drawing.mjs
```

`npm test` runs the server tests, the placement fixture suite and the device-model suite. The server tests cover local task storage, Notion cache fallback, rate-limit retry, signaling relay, mDNS rewriting, plugin OAuth/refresh, Spotify controls, Google Calendar today events and weather. The placement suite covers twelve room fixtures, deterministic re-solves, independent validation, P0 placement logging, snapshots, and the 50 ms solver budget. The device suite covers laptop/monitor/extra-zone geometry, typing margins, seat-frame persistence and solver obstacles. The desktop IWER emulator has been used to enter the garage and show demo papers. `node client/scripts/emulator-rest-features.mjs` now checks room-driven papers, native task completion, mural/stat updates, the focus door and countdown, board content, streaming pairing and plugin status. A final Quest 3 pass should check the acceptance criteria, especially 10 minutes at 72 Hz, controller release velocity, Notion write-back, three readable live windows, passthrough, and GLB replacement. Quest 2 should be checked after Quest 3. The full physical checklist is in [docs/user-verification.md](docs/user-verification.md); open product decisions are in [docs/user-questions.md](docs/user-questions.md).

## Fonts and licenses

`assets/fonts/Anton.woff2` is Anton (SIL Open Font License 1.1, `OFL-Anton.txt`). `assets/fonts/NotoSansCJKsc-Regular.otf` is Noto Sans CJK SC (SIL Open Font License 1.1, `OFL-NotoCJK.txt`). The CJK font covers common Han, kana, and hangul glyphs. The fonts are served locally so paper titles remain available offline.

## Assumptions

The Notion database uses a Status property, not a Select property, for task state. The garage is seated at the IWSDK origin with a 1.2 m eye level. One Quest viewer uses each stream channel at a time. The laptop runs Chrome and Node on the same LAN as Quest. Model paths in the slot manifest point to files under `/assets/models/optimized/`. Local tasks and progress are server/local-storage data, not a synced multi-headset profile. The whiteboard stores up to 40 strokes locally. The Spotify connector is a remote control only and requires Premium plus an active device. Google Calendar reads the primary calendar only. The weather connector uses Open-Meteo.
