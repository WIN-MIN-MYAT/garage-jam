# Open questions and feature assumptions

These are the decisions I made autonomously while finishing the remaining implementation. None block the current build; the starred items need a product decision before the physical Quest pass.

## Product decisions

- **★ Boombox / music source.** The original prompt wants a retro boombox prop and local lo-fi fallback. The boombox was removed because its placeholder was the black box on the table. I kept the wrist Music page and a procedural lo-fi fallback. Do you want me to rebuild the boombox as a code-built prop (speakers + handle) and restore a table slot, or keep the table clean?
- **★ Streaming pairing flow.** The sender page currently connects directly to `monitor1`–`monitor3` and S9b shows the sender URL plus live states. The full 6-character pairing-code flow from the prompt is not implemented. Do you want a code/session pairing page, or is the direct sender URL acceptable?
- **★ Stand-up fade and persistent anchors.** The preference and device state machine already support stand-up fade, but there is no head-height trigger or visual fade in the room build yet, and devices use the seat-frame/fingerprint fallback rather than a native persistent anchor. Are these must-have for the headset pass, or can they stay documented limitations?
- **★ Monitor manager depth.** The prompt asks for grab/move, corner resize, curve, lock, presets, and saved monitor layouts. The build currently recenters the three-monitor arc and hides monitors in passthrough mode. Which monitor controls are must-have for you?
- **★ Focus door trigger.** Focus currently starts from the wrist menu and animates a procedural shutter. The prompt asks for a grab-the-handle pull-down interaction. Should I add a grabbable handle/physics pull, or is the wrist control enough?
- **★ Top 3 pin interaction.** Releasing a flat paper near the corkboard pins its task into Top 3 and persists the pin. The paper itself stays on the table. Should the paper freeze on the corkboard instead?
- **★ Whiteboard reset.** The whiteboard supports controller/hand drawing, up to 40 strokes, and persists locally. **Forget room** clears it; there is no dedicated wrist “clear board” button yet. Do you want a clear/eraser button on the Room page or a physical eraser prop?
- **Plugin sign-in from the headset.** The wrist CONNECT buttons open `/api/plugins/manage` in the browser, which may leave XR while the user signs in. The prompt wanted a code/URL that the user completes on a phone or laptop while the headset waits. Should I build the polling/pairing-screen flow, or is the browser redirect acceptable for your demo?
- **Calendar provider naming.** The new connector uses `CALENDAR_CLIENT_ID`, `CALENDAR_CLIENT_SECRET`, and `CALENDAR_REDIRECT_URI` at `/api/plugins/calendar/callback`. Tell me if you prefer `GOOGLE_*` names for your existing deployment.
- **Weather configuration.** If Weather is connected from the plugin manager, it uses that location; otherwise it can fall back to `WEATHER_LATITUDE` / `WEATHER_LONGITUDE`. The weather connector is Open-Meteo, not OpenWeatherMap, because the existing server already used Open-Meteo and it needs no key.
- **Local task engine.** Tasks are stored in `server/data/tasks-local.json` and merged with Notion. New voice tasks default to local unless `TASKS_SEND_TO=notion`. Should new tasks default to Notion when it is connected?
- **Starter papers.** If there are no tasks, two local-only starter papers (“Welcome to Garage Jam”, “Try crumpling me”) appear. They are not written to Notion. Is that the desired empty state?

## Assumptions already implemented

- Papers are capped at 25. Starter/demo papers complete locally without a connector.
- Paper spawn, garbage detection, and prop positions follow the solver table/trash placements instead of the old fixed demo coordinates.
- Trash completion requires a crumpled paper crossing the rim volume; flat papers do not complete.
- The mural is painted on the largest visible wall (away from the sunset door when possible), not on a dedicated Tripo mural mesh. Splats persist in localStorage and `/api/state`.
- Stats, calendar, Top 3, and whiteboard content are drawn onto the existing board placeholders only when the solver placed them. Rooms where a board is unplaced simply omit that board.
- Break nudges default to 50 minutes; `?nudgeDemo=1` makes them appear every 45 seconds.
- The local lo-fi fallback is a soft procedural three-note bed, not a licensed music track.
- Focus defaults to 25 minutes, with a 5-minute break; `?focusDemo=1` makes it a 1-minute focus and 20-second break.
- Voice capture uses the Web Speech API when available. If Quest Browser does not expose it, the app shows a message and keeps the existing papers/tasks working.
- The stream diagnostics, hysteresis, sender roles, and UDP-only signaling from the earlier build are unchanged; only room-aware placement and the S9b status UI were added.
- Google Calendar uses the primary calendar and today’s events. A private iCal fallback is not implemented.
- Spotify playback control requires Premium and an active device; the wrist shows a clear message when either is missing.
- All new guide panels are rendered above props with `depthTest=false` and `renderOrder=1000`.

## Questions to answer after the Quest pass

1. Which of the five P1 features (focus door, boombox, mural, boards, whiteboard) should be promoted to P0 for your demo?
2. Is the paper/mural/task visual style close enough, or should the boards use larger type and more contrast?
3. Are the three streaming monitors at a comfortable distance/height, or should the default arc be lower/wider?
4. Do the focus sky dimming and shutter feel like “focus” rather than “broken”?
5. Is the weather tint/rain readable through the garage opening, or too subtle?
6. Should the wrist Music page show album art? The server proxy exists, but the compact panel currently shows text only.
7. Do you want the local lo-fi fallback enabled by default, or only after pressing Play in Music?
