# Garage Jam — SFX Production Plan

## Comic gameplay pack · 2026-11-17

ElevenLabs Sound Effects v2 generated these 15 shipped clips. They add about 371 KB of 48 kHz Ogg Opus. The one-shots use close, dry comic foley and play alongside the matching Bangers lettering. The inventory below reflects the current gameplay pack.

| Assets | Playback |
|---|---|
| `paper_pickup`, `paper_toss`, `paper_pin` | Paper pickup, fast release, and pinning to Today / Top 3 |
| `paper_crumple_01`, `paper_crumple_02` | Alternating crunches at the paper, alongside the haptic pulse |
| `paper_bin_catch`, `task_done` | Bin contact on arrival and a dry stamp once the app accepts completion |
| `amb_garage_interior`, `amb_dusk_doorway` | Quiet stereo interior and spatial dusk air at the opening. Focus lowers the doorway layer. Both fade out as the garage leaves view. |
| `focus_shutter_close`, `focus_break_start` | The shutter's final roll and latch, then a separate two-note break cue |
| `setup_point_mark`, `setup_lock` | Accepted marks, room and device confirmation, and explicit monitor layout saves |
| `stream_first_picture` | First visible video from a paired sender |
| `ui_action_blocked` | Rejected calibration, failed task write-back, or failed monitor layout save |

The sections below record the initial reveal pack and its original production notes.

Checked against the current code and assets on 2026-11-16.

## Implemented pack

ElevenLabs Sound Effects v2 generated the first **13 clips**. The prompts use close, dry workshop foley with light hand-drawn comic timing. The room-tone and exterior ambience loops were removed from this pass and will be generated again later.

The shipped pack plays from `assets/audio/` as 48 kHz Ogg Opus. The connector supplied MP3 sources, which were trimmed and leveled for runtime. Floor, door, and prop cues play from their world positions. Interface cues play centered.

| Asset | Cue in the app | Runtime length |
|---|---|---|
| `rev_blueprint_draw` | Graphite on blueprint paper as the full reveal begins | 0.87 s |
| `rev_floor_spray_loop` | Soft aerosol hiss follows the floor paint front | 1.82 s loop |
| `rev_wall_wipe_01` | One textured roller pass at the start of the wall wipe | 0.35 s |
| `rev_door_roll` | Muted metal-track roll as the garage door opens | 0.87 s |
| `rev_sunbeam_swell` | Light breath of air as the door clears | 1.13 s |
| `rev_prop_wood_01` | Soft wooden tok for the shelf, crates, and pegboard | 0.24 s |
| `rev_prop_metal_01` | Cushioned clink for cans, the toolbox, and other metal props | 0.25 s |
| `rev_neon_on` | Small switch click and warm buzz at the sign's first flicker when placed | 0.39 s |
| `rev_ready_chime` | Short warm accent on READY! | 0.66 s |
| `ui_press_01` / `ui_press_02` | Two dry clicks alternate across flow, table, and wrist controls | 0.085 / 0.071 s |
| `ui_panel_open` | Shared cardstock slide for setup, table, and wrist panels | 0.29 s |
| `table_yep_stamp` | Rubber stamp on card for YEP! | 0.38 s |

The quick reveal reuses the spray, wipe, prop, and READY! cues. The replacement ambience bed should fade out on XR exit when it lands. The wrist **Sound** setting controls the pack through the existing SFX volume preference. The player starts preloading and decoding on entry and retains existing procedural fallback where available.

The desktop XR emulator decoded every shipped clip and exercised the full and quick reveals, table controls, and ambience cleanup. A separate manual-room fixture verified that the neon cue plays when the sign is placed. Check spatial balance and loudness on a physical headset.

---

## Sound direction

The palette is **analog garage + hand-drawn comic + quiet golden hour**. Use real materials with a slight comic accent on a single clean transient. Keep the evening ambience diffuse and even.

- Tactile clicks, paper, tape, marker, wood, metal, canvas, spray paint.
- Warm electrical hums and neon buzz.
- Soft suburban/golden-hour exterior ambience.
- Short, dry, consistent UI sounds.
- Spatialised world events; non-spatial UI.
- 2–4 variants for repeated sounds; random pitch and gain.
- One continuous low ambience bed; duck it under key moments. (Replacement loops pending.)
- Fewer, better sounds. Do not fill every moment.

### Priority definitions

- **P0** — needed for the current S0–S11 flow, reveal, table panel, wrist menu, manual calibration and core ambience.
- **P1** — next gates: papers/tasks, devices, streaming, plugins and P1 focus tools.
- **P2** — extra diegetic polish, random life and optional layers.

### Status definitions

- **SHIPPED** — ElevenLabs clip is generated and connected to app playback.
- **MISSING** — dedicated audio is pending.
- **PROC** — procedural placeholder exists in `RevealAudio.ts` and should be replaced or layered.
- **HAPTIC ONLY** — associated interaction has haptics but no sound.

---

# P0 — current app

## 1. UI / panel pack (non-spatial)

One shared UI sound family so every panel feels related.

| Asset | When it plays | Spec | Current |
|---|---|---|---|
| `ui_press_01/02` | Flow, table, and wrist button presses | Two dry clicks, 71–85 ms | SHIPPED |
| `ui_back` | Back / close / X | 50–70 ms, lower pitch | MISSING |
| `ui_toggle_on` | Any toggle turned on | 80–100 ms soft latch | MISSING |
| `ui_toggle_off` | Any toggle turned off | 70–90 ms softer release | MISSING |
| `ui_tab` | Home / Room / Settings tab | 40–60 ms paper/marker tick | MISSING |
| `ui_panel_open` | Flow/table/wrist panel opens | 290 ms cardstock slide | SHIPPED |
| `ui_panel_close` | Same panels close | 120–180 ms | MISSING |
| `ui_confirm_stamp` | YEP, mode select, continue | 180–300 ms stamp/splat | MISSING |
| `ui_success` | Room saved, table confirmed, garage ready | 500–800 ms warm chime | MISSING |
| `ui_warning` | Table height warning, scan missing | 180–250 ms low warning | MISSING |
| `ui_error` | XR error, panel error, write failure | 220–300 ms muted knock/buzz | MISSING |
| `ui_progress_tick_up` | +0.5 cm, next scan step | 25–40 ms, 3 pitches | MISSING |
| `ui_progress_tick_down` | −0.5 cm, back step | 25–40 ms, lower pitch | MISSING |
| `ui_reset_crumple` | Reset / forget | 250–350 ms paper crumple/erase | MISSING |
| `ui_mute_on/off` | Sound toggle | 70–90 ms | MISSING |
| `ui_pin_on/off` | Wrist PIN | 40–60 ms | MISSING |
| `ui_hover` | Optional pointer hover | 15–25 ms, very quiet | P2 |

## 2. Flow / scan / calibration

| Asset | When it plays | Spec | Current |
|---|---|---|---|
| `flow_enter_whoosh` | S1 Enter | 0.7–1.0 s soft airy whoosh | PROC |
| `flow_welcome_back` | S11 resume / quick reveal | 0.8–1.2 s warm stinger | MISSING |
| `flow_scan_start` | S2 scan begins | 0.6–0.9 s sonar sweep | MISSING |
| `flow_scan_ping` | Each scan progress tick | 100–160 ms, 3 pitches | MISSING |
| `flow_scan_lock` | 3/3 ROOM LOCKED | 0.4–0.7 s lock/chime | MISSING |
| `flow_scan_missing` | No scan found | 0.35–0.5 s low warning | MISSING |
| `flow_manual_phase` | Floor → table phase | 0.25–0.4 s transition | MISSING |
| `flow_manual_saved` | Manual room saved | 0.5–0.7 s success | MISSING |
| `flow_mode_select` | Passthrough/streaming choice | 0.2–0.35 s confirm | MISSING |
| `flow_ready` | S10 live ready page | 0.5–0.8 s warm chord | MISSING |
| `flow_session_end` | XR session ends | 0.3–0.5 s soft down | P1 |
| `manual_point` | Each calibration point | 25–40 ms tick | PROC |
| `manual_corner_confirm` | Corner accepted | 150–220 ms | MISSING |
| `manual_undo` | UNDO | 120–180 ms | MISSING |
| `manual_error` | Invalid/too-close point | 200–300 ms | MISSING |

## 3. Reveal pack

The first pack replaces the main procedural cues with authored clips and keeps procedural fallbacks. The remaining reveal rows are candidates for a later pass.

| Asset | Beat | Spec | Current |
|---|---|---|---|
| `rev_blueprint_draw` | Blueprint 0–1 s | 870 ms graphite strokes | SHIPPED |
| `rev_blueprint_ping` | Seat marker | 150–250 ms pulse | MISSING |
| `rev_floor_spray_loop` | Floor spray | 1.82 s aerosol loop | SHIPPED |
| `rev_floor_spray_tail` | End of floor spray | 0.3–0.5 s tail | MISSING |
| `rev_wall_wipe_01/02/03` | Wall wipes | 350 ms roller accent at wipe onset | SHIPPED 01 |
| `rev_wall_drip_01/02/03` | Wall drip edge | 150–450 ms tiny drips | MISSING |
| `rev_ceiling_roll` | Ceiling shutter | 0.7–0.9 s metal roll | PROC door-ish |
| `rev_door_roll` | Garage door opening | 870 ms softened rollers and latch | SHIPPED |
| `rev_sunbeam_swell` | Door clears | 1.13 s airy swell | SHIPPED |
| `rev_dust_motes` | Sun beam | 0.4–0.7 s very quiet shimmer | MISSING |
| `rev_table_roller` | Table skin | 0.8–1.0 s paint roller | MISSING |
| `rev_prop_wood_01/02` | Wood props land | 240 ms muted wooden impact | SHIPPED 01 |
| `rev_prop_metal_01/02` | Metal props land | 250 ms cushioned metal impact | SHIPPED 01 |
| `rev_prop_cardboard` | Boxes/crates | 0.2–0.3 s soft | MISSING |
| `rev_prop_plastic` | Cans/fridge | 0.2–0.3 s | MISSING |
| `rev_prop_paper` | Paper props | 0.15–0.25 s | MISSING |
| `rev_prop_dust` | Dust poof | 0.25–0.4 s | MISSING |
| `rev_neon_on` | Neon flickers on | 390 ms switch and buzz | SHIPPED |
| `rev_lamp_on` | Lamp flickers on | 0.4–0.6 s electrical clunk + hum start | MISSING |
| `rev_ready_chime` | READY! | 660 ms warm chime | SHIPPED |
| `rev_skip` | Skip reveal | 0.2–0.35 s jump whoosh | MISSING |

## 4. Table confirm pack

YEP! uses the shipped `table_yep_stamp`. Panel opening and button presses share the shipped UI clips.

| Asset | When it plays | Spec |
|---|---|---|
| `table_panel_open/close` | Table panel appears/disappears | 0.15–0.25 s paper/panel slide |
| `table_height_tick_up/down` | ±0.5 cm | 25–40 ms ticks, two pitches |
| `table_touch_sonar` | TOUCH TABLE armed | 0.2–0.3 s scan blip |
| `table_touch_lock` | Controller-tip height captured | 0.15–0.25 s lock click |
| `table_yep_stamp` | YEP! | 0.3–0.5 s splat/stamp — hero sound |
| `table_fix` | FIX IT | 0.25–0.4 s softer warning |
| `table_view_swap` | Workbench ↔ Real table | 0.25–0.4 s cloth/whoosh |
| `table_warning` | Height <55 cm or >120 cm | 0.2–0.3 s low warning |

## 5. Wrist menu pack

Wrist opening and button presses share the shipped UI clips.

| Asset | When it plays | Spec |
|---|---|---|
| `wrist_open` | Wrist menu opens | 0.15–0.25 s paper/magnetic slide |
| `wrist_close` | Wrist menu closes | 0.12–0.2 s |
| `wrist_pin_on/off` | PIN | 40–60 ms latch |
| `wrist_tab` | Tab switch | 40–60 ms, can reuse `ui_tab` |
| `wrist_toggle_on/off` | Any wrist toggle | 80–100 ms, reuse UI toggle |
| `wrist_rearrange` | Rearrange props | 0.5–0.8 s whoosh + tiny prop settle |
| `wrist_rescan` | Rescan | 0.4–0.7 s scanner spin-up |
| `wrist_forget` | Forget everything | 0.3–0.5 s crumple/erase |
| `wrist_edit_table` | Edit table | 0.2 s panel open |

## 6. Core ambience

The original room-tone and golden-hour exterior loops were removed from this pass. Generate fresh room tone and a doorway exterior bed later. Revisit the lamp and neon hums after the headset mix pass.

| Asset | When it plays | Spec | Current |
|---|---|---|---|
| *Ambience bed* | Always live | Replacement room tone and exterior pair to be generated | TBD |
| `amb_lamp_hum_loop` | After lamp on | 20–30 s seamless, warm electrical | MISSING |
| `amb_neon_hum_loop` | After neon on | 20–30 s seamless, soft buzz | MISSING |
| `amb_fridge_loop` | If mini-fridge placed | 20–30 s seamless compressor hum | P1 |
| `amb_distant_traffic_loop` | Exterior layer | 30–60 s seamless, very quiet | P1 |
| `amb_creak_01/02/03` | Random, sparse | 0.5–1.5 s room/wood creaks | P2 |
| `amb_metal_settle_01/02/03` | Random, sparse | 0.3–0.8 s metal settle | P2 |
| `amb_paper_rustle_01/02/03` | Random, sparse | 0.3–0.7 s paper shuffle | P2 |
| `amb_boombox_loop` | Optional diegetic music | 60–120 s loop, low volume | P2 |

---

# P1 — next gates

## Papers / tasks

| Asset | When it plays | Spec |
|---|---|---|
| `paper_spawn_01/02` | Papers land on table | 0.15–0.25 s very quiet card flick |
| `paper_grab` | Grab a sheet | 0.1–0.15 s tactile paper pinch |
| `paper_release` | Release a sheet | 0.08–0.12 s |
| `paper_flutter_loop` | Held/moving paper | 0.3–0.8 s loop, volume follows motion |
| `paper_crumple_01/02/03` | Trigger crumple | 0.35–0.6 s, sync with haptic |
| `paper_throw_whoosh` | Thrown paper | 0.2–0.3 s, velocity-scaled |
| `paper_trash_soft` | Paper lands in can | 0.25–0.4 s soft rustle |
| `paper_trash_rim` | Hits rim | 0.2–0.3 s light bin tap |
| `task_complete_stamp` | Task completed | 0.5–0.8 s stamp/success |
| `task_sync_queued` | Notion queued | 0.35–0.5 s soft confirm |
| `task_error` | Write-back failed | 0.3–0.4 s |
| `notion_offline` | Cached/offline | 0.4–0.6 s gentle warning |

## Streaming

| Asset | When it plays |
|---|---|
| `stream_pair_start` | Pairing begins |
| `stream_pair_success` | Sender paired |
| `stream_connected` | First frame/live |
| `stream_disconnected` | Sender left |
| `stream_reconnecting` | ICE recovery |
| `stream_degraded` | No heartbeat/packets |
| `stream_failed` | Signaling/video failure |
| `monitor_on/off` | Monitor channel toggled |

## Devices — Gate 7

| Asset | When it plays |
|---|---|
| `device_mark_point` | Corner marked |
| `device_corner_confirm` | Corner accepted |
| `device_confirm` | Device confirmed |
| `device_found` | Device tracked again |
| `device_lost` | Device uncertain/lost |
| `device_ghost_place` | Ghost model placed |
| `typing_margin_tick` | Typing margin adjusted |

## Plugins / focus / P1

| Asset | When it plays |
|---|---|
| `plugin_connect_success` | Notion/calendar/weather/Spotify connected |
| `plugin_connect_error` | Plugin failure |
| `spotify_connected/disconnected` | Music provider state |
| `calendar_event_soft` | Calendar event appears |
| `weather_rain_loop` | Rain ambience |
| `weather_thunder` | Optional distant thunder |
| `focus_enter` | Focus mode on |
| `focus_exit` | Focus mode off |
| `sunset_start` | Focus door/sunset begins |
| `sunset_complete` | Sunset ends |
| `stand_up_fade_whoosh` | Stand-up fade toggle |
| `passthrough_toggle` | Passthrough on/off |
| `cutouts_toggle` | Cutouts on/off |
| `extra_zone_confirm` | Extra zone marked |

---

# P2 — extra diegetic life

Use sparingly, randomized and very quiet:

- `amb_bird_01/02/03`
- `amb_distant_dog`
- `amb_car_pass`
- `amb_wind_gust`
- `amb_room_creak_01/02/03`
- `amb_tool_clink_01/02/03`
- `amb_paint_can_clink`
- `amb_spray_can_shake`
- `amb_marker_squeak`
- `amb_clock_tick`
- `amb_rain_loop`
- `amb_thunder_distant`
- `chair_creak`
- `table_knock`
- `neon_flicker_short`
- `lamp_switch_click`

Do **not** synthesize keyboard typing or footsteps for the real world. Those should come through passthrough/real surroundings. Only add virtual versions for a fully virtual mode.

---

# Technical targets for future assets

- Master format: **48 kHz / 24-bit WAV**.
- Runtime format: **OGG Opus** for Quest/Chromium.
- Use mono for positioned sounds, including doorway ambience. Use stereo where it adds width to a diffuse bed or music.
- Trim leading silence; use 5–15 ms fades to avoid clicks.
- Loops: 20–50 ms seamless crossfade, no audible seam.
- 2–4 variants for repeated sounds; random pitch ±3–6%, gain ±1.5 dB.
- Loudness targets:
  - UI: −24 to −20 LUFS
  - one-shots: −18 to −16 LUFS
  - ambience: −30 to −26 LUFS
  - music: −20 to −18 LUFS
  - true peak ≤ −1 dBTP
- Keep UI high-frequency energy controlled; Quest speakers can become harsh.
- If the catalog grows, move the settings from `RevealAudio.ts` into an audio manifest with:
  - event ID
  - file path(s)
  - bus (`ui`, `sfx`, `ambience`, `music`)
  - spatial flag
  - volume
  - pitch range
  - cooldown
  - max concurrent voices
- Add buses: **Master → UI / SFX / Ambience / Music**.
- Expose separate SFX and music volume sliders. `sfxVolume` and `musicVolume` preferences already exist, but only the reveal mute is exposed.
- Keep preloading and decoding the shipped clips on entry. Measure first-play timing on the headset.
- Voice-limit paper spawns, prop thuds and scan ticks.

## Proposed manifest shape

```json
{
  "ui_press_01": {
    "files": ["/assets/audio/sfx/ui/ui_press_01.ogg"],
    "bus": "ui",
    "spatial": false,
    "volume": 0.55,
    "pitchRange": [0.97, 1.03],
    "cooldownMs": 40,
    "maxVoices": 2
  },
  "rev_prop_wood_01": {
    "files": ["/assets/audio/sfx/reveal/rev_prop_wood_01.ogg"],
    "bus": "sfx",
    "spatial": true,
    "volume": 0.75,
    "pitchRange": [0.94, 1.04],
    "cooldownMs": 80,
    "maxVoices": 4
  }
}
```

---

# Current code hook points

These are the places where sound triggers should be added or extended:

- `client/src/reveal/RevealTimeline.ts` — beat ids and existing `sfx` labels.
- `client/src/reveal/RevealSystem.ts` — reveal beat timing, prop landing, READY, skip, adaptive fallback.
- `client/src/reveal/RevealAudio.ts` — current procedural audio to replace/layer.
- `client/src/systems/app-flow-system.ts` — S0–S11 panel buttons, scan progress, manual calibration, mode choice, ready, resume.
- `client/src/systems/table-confirm-system.ts` — panel open/close, height ticks, TOUCH TABLE, YEP, FIX IT, table view.
- `client/src/systems/wrist-menu-system.ts` — wrist open/close, pin, tabs, toggles, rescan, rearrange, edit table, forget.
- `client/src/systems/manual-calibration-system.ts` — per-point tick, undo, phase change, saved.
- `client/src/systems/paper-system.ts` — paper spawn, grab, crumple, throw, trash hit, task complete, Notion sync/error.
- `client/src/systems/stream-system.ts` — pairing, live, degraded, reconnecting, failed.
- `client/src/systems/sunset-system.ts` — sunset start/pause/reset/complete.
- `client/src/systems/hud-system.ts` — passthrough toggle, diagnostics, save run.
- `client/src/garage-state.ts` — `sfxVolume`, `musicVolume`, `revealSound`.

---

# Next generation order

1. Generate the replacement room-tone and golden-hour exterior loops, then re-check the ambience mix against speech and real-room sound.
2. Listen to the shipped pack on the target headset and adjust the mix.
3. Generate two `paper_crumple` takes and `paper_trash_rim` for the paper interaction, then align the crumple with its haptic pulse.
4. Add cues for calibration or streaming states where sound helps the user act. Reuse the short UI press and panel cues for routine interactions.
5. Audition lamp and neon hums only if the garage needs more texture after a long session. Keep music and extra background events optional.

---

# Acceptance checklist

- [ ] Every UI button has audible feedback.
- [ ] No first-play hitch when a panel or reveal sound starts.
- [ ] UI sounds are consistent in timbre and loudness.
- [ ] Repeated sounds have variants and no machine-gun effect.
- [ ] Ambience returns once the replacement room-tone and exterior loops are generated.
- [ ] Spatial sounds come from their world positions.
- [ ] Reveal sounds follow the timeline and wipe front.
- [ ] Prop landing sounds match material type.
- [ ] Paper crumple syncs with haptics.
- [ ] Trash-can hit and task complete feel rewarding.
- [x] The table YEP action plays a dedicated stamp without a second button click.
- [ ] The table stamp feels definitive in the headset mix.
- [ ] Neon/lamp hum sits under the mix.
- [ ] Pass-through and real-world sounds are not doubled.
- [ ] SFX and music can be muted independently.
- [ ] IWSDK AudioSource or WebAudio playback is pooled and preloaded.

---

# Not SFX, but needed for premium immersion

- 2–3 music beds/loops (garage lo-fi, focus, sunset/dusk transition), 2–4 minutes seamless stereo.
- A subtle Spotify/plugin state stinger set.
- Optional diegetic boombox loop that ducks when real music is connected.
