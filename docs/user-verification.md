# User verification checklist

This list is for the physical Quest 3 / 3S pass. Emulator evidence is already recorded in `docs/implementation-gates.md` and `client/scripts/emulator-rest-features.mjs`.

## Before testing

1. Run `npm install`, `npm --prefix client install`, and `npm --prefix server install`.
2. Copy `server/.env.example` to `server/.env`.
3. Set up only the providers you want to test:
   - Notion: `NOTION_TOKEN`, `NOTION_DATABASE_ID` (and optionally `NOTION_*_CLIENT_*` for the browser connection flow).
   - Spotify: `SPOTIFY_CLIENT_ID`, `SPOTIFY_REDIRECT_URI`. Add the exact callback in the Spotify dashboard. Premium is required for playback control.
   - Google Calendar: `CALENDAR_CLIENT_ID`, `CALENDAR_CLIENT_SECRET`, `CALENDAR_REDIRECT_URI`. Enable the Google Calendar API and add the exact callback.
   - Weather: connect a location from `https://<laptop-ip>:8091/api/plugins/manage`; or set `WEATHER_LATITUDE` / `WEATHER_LONGITUDE`.
4. Run `npm run dev`, open `https://<laptop-ip>:8091/` on Quest, accept the certificate, and enter XR.
5. Keep Chrome on the laptop on the same LAN for streaming tests.

## Gate 1–3: session, cutouts, room

- [ ] Enter XR. Passthrough starts and the HUD is visible.
- [ ] Run Space Setup or choose **Set up by touching**. Complete four floor corners and four table corners.
- [ ] Confirm the garage floor/walls/table sit on the real room and the table height is within about 2 cm.
- [ ] Confirm the workbench wooden top matches the measured table width and depth. The vise and handle may overhang the measured footprint; they must not shorten or narrow the wooden top.
- [ ] Toggle **Cutouts** off/on and confirm the real laptop/monitor silhouette from front, left, right, above, and ±60 degrees.
- [ ] Confirm no real wall or desk shows outside the device-shaped cutout when the garage is opaque.
- [ ] Put a real hand over the marked keyboard. Confirm the virtual hand is masked and the real hand is visible.

## Gate 5–7: build, table, wrist, devices

- [ ] Watch the full reveal (there is no skip prompt or skip button). Confirm it finishes in about 4-8 s and the garage is stable.
- [ ] Change table height with ± and **TOUCH TABLE**. Confirm the workbench, paper zone, props, and device volumes move live.
- [ ] Toggle **Table view**. Confirm the real-table depth slab works and hides the virtual workbench.
- [ ] Open the wrist menu with a left-wrist glance and with a palm-up pinch. Confirm the panel is not clipped, the three-column Settings grid is readable, and all buttons are reachable.
- [ ] Mark a laptop by drag-to-draw and by two separate pinches. Confirm the second hand cannot finish an outline started by the first.
- [ ] Restart the app. Confirm the room, table height, devices, and device cutouts restore.
- [ ] Confirm the black box is no longer on the workbench (the boombox placeholder was removed); the procedural boombox should be on the floor in a corner.
- [ ] Enable **Stand fade** in Settings, sit at your working spot, stand up, and walk away. Confirm the garage reverses to passthrough and the quick reveal returns when you sit.

## Gate 8: papers and tasks

- [ ] With no Notion configured, open S10 and confirm two starter papers land on the paper zone.
- [ ] Grab a paper, press the trigger while holding it, and hear/feel the crumple.
- [ ] Throw the crumpled paper into the trash. Confirm it disappears, the HUD says **DONE!**, a splat/stat is added, and the count changes.
- [ ] Throw a flat paper into the trash. Confirm it does **not** complete.
- [ ] With Notion configured, mark a real Notion task done. Confirm the Notion row changes to **Done** and the paper disappears.
- [ ] Disable the network after loading tasks, complete one task, and confirm the queued-write message appears.
- [ ] Confirm papers stop at 25 and the HUD reports the extra count.

## Gate 9: plugins

- [ ] Open the wrist **CONNECT** page and tap a provider. Confirm a 6-character code and `/connect` appear without leaving XR.
- [ ] On a phone/laptop open `https://<laptop-ip>:8091/connect`, enter the code, then finish the provider sign-in. Confirm the headset updates to ON and does not drop XR.
- [ ] Connect Notion, Spotify, Calendar, and Weather. Confirm each provider status survives a page reload.
- [ ] Spotify: open **MUSIC**, confirm now playing/title, play/pause, previous/next, volume, device cycling, and playlist cycling.
- [ ] Spotify: test with no active device (open Spotify elsewhere first) and with Premium unavailable. Confirm a clear message appears.
- [ ] Calendar: confirm today's next event appears on Home and the calendar board shows today's events.
- [ ] Weather: connect a location, switch **Settings / Sky** to **LIVE**, and confirm the sky tint and rain/snow particles match the conditions.
- [ ] Disconnect each provider and confirm only that provider fails; the rest keep working.

## Gate 10: streaming

- [ ] Choose **STREAM MY LAPTOP**. Confirm the S9b panel shows the room-scoped `/sender?room=...` link and the three monitor states.
- [ ] Open that exact sender link on the laptop, choose **Best quality** or **Lowest latency**, and start Monitors 1-3. Confirm AV1 is selected and Auto quality is off by default.
- [ ] Confirm all three monitor placeholders turn into live video and remain readable at the chosen distance.
- [ ] Open **Monitor controls** from the wrist Room page. Test grab/move, width/height, curve, lock, arc/table/stacked/ultrawide/free presets, save and recenter.
- [ ] Toggle passthrough and back. Confirm monitors hide/return with the garage.
- [ ] Run for 30 minutes. Confirm no spurious **reconnecting** flips, no black frame after a static screen, and no stale sender reconnect after closing a tab.
- [ ] Check `?stats=1` diagnostics and record p50/p95 latency. Targets are in `docs/latency-results.md`.
- [ ] Press **CHECK STREAMS** / **FORGET** on S9b and confirm the status/connection resets.

## Gate 11: P1 features

- [ ] Start Focus from the wrist Home page. Confirm the shutter rolls down, the sky dims, the countdown appears, and music starts.
- [ ] Pause/resume/cancel. Confirm the shutter and timer behave correctly and the sky restores.
- [ ] Finish a 1-minute demo focus (`?focusDemo=1`) or the configured 25-minute session. Confirm break mode, chime, and focus minutes on the stats board/whiteboard.
- [ ] Confirm each completed task adds a paint splat to the mural and that splats persist after reload.
- [ ] Drop/release a flat paper near the corkboard. Confirm it freezes on the corkboard, pins into Today / Top 3, and persists after reload.
- [ ] Point the dominant controller at the whiteboard and hold the trigger to draw. Confirm strokes persist after reload and **Clear board** in wrist SET clears them.
- [ ] Trigger **Voice task** and say “add task …”. Confirm a new local task and paper appear. If Web Speech is unavailable in Quest Browser, confirm the friendly fallback message.
- [ ] Let the break nudge appear (use `?nudgeDemo=1`), confirm the neon message, sound, and dismissal event.
- [ ] Confirm the local lo-fi fallback plays from the Music page when Spotify is not connected, and stops on pause.

## Gate 12: performance and cleanup

- [ ] Run S10 for 10 minutes with papers, one stream, stickers, devices, and focus. Confirm 72 Hz or report the measured frame time.
- [ ] Check that the wrist menu, panels, and scan labels remain readable over props.
- [ ] Confirm `?style=plain` improves performance if the comic materials are too heavy.
- [ ] Confirm the app still works after a headset sleep/wake and an XR session restart.
- [ ] Confirm **Forget room** on wrist ROOM clears the room, devices, progress, mural, pins, and whiteboard, and returns to S0.

## Evidence to collect

- Screenshots: device cutout from 8 angles, papers on the real table, task Done in Notion, wrist Music page, S9b monitor states, live three-monitor view, focus door, mural/stats/calendar/corkboard, whiteboard drawing.
- Logs: HUD FPS/frame time, stream diagnostics JSON, and any console errors.
- For each failure, record the exact stage, provider, and whether it also fails in the desktop emulator.
