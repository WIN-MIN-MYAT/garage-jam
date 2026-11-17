# Open questions and feature decisions

The starred decisions were answered on 2026-11-17 and are implemented. A few implementation details still need a physical-headset preference check.

## Resolved decisions

- **Boombox / music source.** The boombox is back as a code-built retro prop (body, speakers, handle, antenna, comic outline). It is placed on the floor in a wall corner, not on the table.
- **Streaming pairing flow.** Implemented a 6-character, single-use, 10-minute pairing code. S9b shows the code and `host/connect`; the laptop opens `/connect`, enters the code, and continues in the provider page. No headset navigation is required.
- **Stand-up fade.** The first seated head pose is stored locally. With **Stand fade** enabled, sitting at that pose runs the quick reveal and shows the garage; standing/walking away reverses the reveal and fades all garage roots to passthrough. The wrist Settings page has the toggle.
- **Monitor manager.** Added grab/move, monitor selection, width/height resize controls, curve, lock, presets (arc, table, stacked, ultrawide, free), saved layout, and recenter. The **table** preset places the monitors above the measured table. The manager is opened from the wrist Room page.
- **Focus door trigger.** Wrist start/pause remains the trigger; the procedural shutter and countdown are unchanged.
- **Top 3 pin interaction.** Releasing a flat paper near the corkboard freezes the paper on the board and pins its task. Pinned tasks spawn on the corkboard next session.
- **Whiteboard reset.** Added **Clear board** as the bottom-right Settings action.
- **Plugin sign-in from the headset.** The headset no longer navigates away. It shows a pairing code and `/connect`; the phone/laptop claims the code, and the OAuth result is stored against the headset profile and polled back into XR.
- **Calendar provider naming.** Kept `CALENDAR_*` with the exact callback `/api/plugins/calendar/callback`.
- **Weather configuration.** Kept Open-Meteo; a plugin connection or `WEATHER_LATITUDE` / `WEATHER_LONGITUDE` supplies the location.
- **Local task engine.** New tasks default to Notion when both `NOTION_TOKEN` and `NOTION_DATABASE_ID` are configured; otherwise they stay local. `TASKS_SEND_TO=local` forces local.
- **Starter papers.** Empty task lists still show the two local-only starter papers.

## Still worth checking on the physical headset

1. Does the monitor resize feel natural from the panel, or do you want draggable corner handles instead?
2. Does the **table** monitor preset put the screens at the height/distance you meant by “on the table”, or should they lie flatter or sit closer to the table edge?
3. Does the stored seated pose travel correctly after a headset restart and a new Space Setup? Devices still use the seat-frame/fingerprint fallback rather than a native persistent anchor.
4. Does the quick reveal on sitting feel like a welcome-back rather than a repeated setup, and does the reverse fade read clearly when you stand?
5. Is the boombox corner visible enough in your real room, or should it be promoted to a specific corner beside the shelf?
6. Are the panel and wrist font sizes readable with the actual headset optics? The emulator screenshots can overstate small-text legibility.
7. Do you want album art in the Music page? The server proxy exists; the compact panel currently uses text only.
8. Should the local lo-fi fallback remain opt-in from the Music page, or start automatically with Focus as it does now?
