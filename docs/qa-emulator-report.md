# Garage Jam — emulator QA report

**Date:** 2026-11-18  
**Build:** `main` through `5420fb9`  
**Environment:** IWSDK Quest 3 emulator (Chrome 152 headless, 1440 × 1000), dev server `https://localhost:8091`, deployed backend `https://garage-jam.onrender.com`  
**Not tested:** physical Quest 3/3S hand tracking, 72 Hz, haptics, persistent anchors, real OAuth consent, real Spotify audio, 30-minute streaming soak.

This is an emulator and backend pass. It is useful for finding logic, UI, and integration bugs, but it is **not** a substitute for the physical-headset checklist in `docs/user-verification.md`.

---

## 1. Result summary

| Area | Result | Notes |
|---|---|---|
| Server unit tests | **Pass** | 12/12, including the new cross-origin plugin test |
| Placement fixtures | **Pass** | 8/8 |
| Device geometry/persistence | **Pass** | 13/13 |
| Manual room calibration | **Pass** | Floor + table via corner points |
| Controller corner marking | **Pass** | Target-ray points and table selection |
| Room-driven build / reveal | **Pass** | 10 props placed, solver 24.2 ms, no violations, no page errors |
| Room scan probe | **Pass*** | 1 floor, 9 walls, 2 tables, 15 planes, 14 meshes. *Dev-only service-worker SSL warning |
| Wrist menu / hand mode / settings | **Pass*** | Wrist glance, panel retention, hand mode, calibration, table edit, rescan, forget. *Spotify EME console error |
| Device marking with hand pinch | **Pass*** | Hand pinch drag, UI ownership, first-hand lock, cutout, monitor fit. *Reload assertion drift |
| Full product flow + papers + focus + boards | **Pass** | `emulator-rest-features.mjs` passes end to end |
| Notion task read/write in VR | **Pass** | Two tasks loaded; completed one; `synced: true` |
| Streaming sender UI | **Pass** | Formats, AV1 default, Auto quality off |
| WebRTC room streaming | **Pass** | Room-scoped sender → viewer, direct UDP |
| Spotify headset setup | **Pass** | Stubbed SDK, explicit transfer, volume |
| Plugin cross-origin pairing | **Fixed** | Was 403 from Vercel; allowlist added and verified |
| Hand paper grab/crumple | **Fail / open** | Paper stays `flat` in the emulator across grip/grasp/target-ray |
| Physical Quest pass | **Pending** | Required before calling the hand loop verified |

---

## 2. Bugs and issues

### P1 — hand pinch does not grab papers in the emulator (open)

**Observed:** After entering the garage with a Notion paper on the table, setting `set_input_mode` to `hand`, connecting both hands, and moving the right hand to the paper with `grip`, `grasp`, or `target-ray` anchors, a full `select` gesture leaves the paper in `state: 'flat'`. It never becomes `held`, so the free-hand pinch crumple path never runs.

**Why it matters:** The product advertises “Squeeze to grab a nearby sheet” and “CRUMPLE: PINCH WITH FREE HAND OR PRESS TRIGGER.” If this is not only an emulator limitation, hand-tracking users cannot complete the core task loop without a controller.

**What already works:** Hand pinch **does** work for UI/device marking (`emulator-device-drawing.mjs`): hand pinch draws corners, owns the UI, locks the first hand, and creates cutouts. So the emulator can produce hand select events; the failure is specific to the paper grab handle/pointer path.

**Likely areas to inspect:**
- `GrabSystem` hand-pinch forwarding (`useHandPinchForGrab`, `multiPointers[handedness].toggleSubPointer('grab', true)`).
- The `OneHandGrabbable` handle radius/position on the paper entity.
- Whether the simulated hand’s **grab sub-pointer** follows `grip`/`grasp` as expected.
- Whether the paper entity’s handle is offset from the visual mesh.

**Recommendation:** Add a physical Quest check first. If it fails there, add a headset-side fallback: while a hand is holding a flat paper, a free-hand pinch within a slightly larger radius crumples it. Also add a debug readout for the paper handle and hand grab pointer so the emulator can prove the pointer overlap.

### P1 — plugin POST requests from Vercel were blocked (fixed)

**Observed:** `POST /api/plugins/:id/pair` from the Vercel/dev client returned **403** because the plugin router required the request `Origin` to equal the backend origin. The wrist CONNECT flow and Spotify controls would fail in the split deployment.

**Fix:** Added `PLUGIN_CLIENT_ORIGINS` allowlist support in `server/plugins.js`; the backend origin and `https://localhost:8091` are always allowed. Added a server regression test. Verified:
- Vercel origin → reaches the provider check (503 for unconfigured Notion OAuth, no longer 403).
- Unknown origin → 403.
- Weather pairing from the Vercel origin → 200 with a code.

**Deployment:** `PLUGIN_CLIENT_ORIGINS=https://garage-jam.vercel.app` is set in `render.yaml`.

### P2 — Spotify SDK emits an EME console error in headless Chrome

**Observed:** `emulator-wrist-calibration.mjs` passes every functional assertion, then fails its final `assert.deepEqual(errors, [])` because the Spotify SDK logs:

```text
EMEError: No supported keysystem was found.
```

**Impact:** Headless Chrome has no Widevine; Quest Browser does. This is likely environment-specific, but the app should fail gracefully.

**Recommendation:** Check `navigator.requestMediaKeySystemAccess` / the Spotify SDK readiness before creating the player, catch the error, and show “Spotify playback needs Quest Browser or a Widevine-capable browser” instead of an unhandled console error.

### P2 — test drift after resume changes

**`emulator-device-drawing.mjs`** fails after reload at:

```text
window.garageTableDebug.panel.requireElementById('yep-button')
```

`garageTableDebug.panel` is undefined after reload. The saved table height matches within the resume tolerance, so the app intentionally skips table confirmation and goes to the quick resume/live path. The test still assumes the table panel exists.

**Recommendation:** Update the test to handle the quick-resume path: after reload, wait for S10 (or the table panel only when `needsTableConfirm` is true). This is a test fix; confirm the UX is intentional.

**`emulator-room-alignment.mjs`** expects:

```text
window.garageBuildDebug.root.getObjectByName('Workbench top')
```

The current room build uses `wooden-workbench.glb`; the procedural “Workbench top” fallback is not present. The test needs to inspect the GLB workbench or the build’s measured table data instead.

### P3 — dev-only service-worker certificate warning

**Observed:** `emulator-room-probe.mjs` records:

```text
An SSL certificate error occurred when fetching the script.
```

The Vite dev server uses a self-signed certificate and the browser ignores it for navigation, but service-worker registration still reports the certificate error. Production HTTPS is unaffected.

**Recommendation:** Ignore this in dev-specific error collection, or run the probe with `GARAGE_HTTP=1` for service-worker tests.

---

## 3. Hand-tracking coverage

| Interaction | Emulator result | Notes |
|---|---|---|
| Hand input mode | **Pass** | Two hand sources present |
| Left-wrist glance opens menu | **Pass** | `emulator-wrist-calibration.mjs` |
| Hand mode + menu retention/pin/close | **Pass** | Wrist script |
| Hand pinch device marking | **Pass** | Drag, first-hand lock, cutout |
| Hand pinch over UI stays with UI | **Pass** | Device drawing script |
| Hand pinch grab paper | **Fail** | Paper stays flat |
| Free-hand pinch crumple | **Blocked** | Requires a held paper |
| Hand whiteboard drawing | **Not automated** | Needs a target-ray/pinch test |
| Palm-up pinch menu gesture | **Not automated** | Wrist glance path is verified |
| Hand poke UI buttons | **Not automated** | Menu actions exercised through debug clicks |

**Important:** These are emulator results. The physical Quest hand-tracking pose, pinch thresholds, and grab volume can differ. The paper issue should be checked on device before it is treated as a product bug.

---

## 4. What passed in the full product flow

`emulator-rest-features.mjs` passed after the plugin-origin fix:

- S0 landing → S1 XR → S2 scan → S3 manual floor/table calibration.
- S6 reveal → S7 table confirm → S8 streaming choice → S9b sender panel → S10 live.
- Two Notion tasks spawned as papers.
- Controller grab → trigger crumple → trash completion.
- Notion write-back and task completion.
- Mural splat, stats board, Top 3 board, calendar board.
- Focus shutter, countdown, dimmed sky, cancel.
- Monitor manager: presets, symmetry, resize/curve controls, saved layout.
- Streaming sender state and plugin status.
- Stand-fade: save seat, stand → passthrough, sit → quick reveal.
- Wrist pages and settings toggles.
- No page errors at the end of the script.

`emulator-notion-test.mjs` (temporary focused probe) additionally verified:

```json
{
  "tasksBefore": ["Second paper test", "Notion paper test"],
  "completed": { "synced": true, "queued": false },
  "tasksAfter": ["Second paper test"]
}
```

Screenshots: `scripts/notion-papers.png`, `scripts/notion-crumple.png`, `scripts/notion-boards.png`.

---

## 5. Recommended next steps

1. **Physical Quest hand pass.** Test hand pinch grab/crumple, wrist palm-up pinch, hand poke, whiteboard, and table touch. If paper grab fails, add a larger free-hand crumple radius and a grab debug probe.
2. **Spotify EME guard.** Catch the no-Widevine path and show a friendly message.
3. **Update the two stale emulator scripts** for the GLB workbench and quick-resume behavior.
4. **Add the hand paper repro** to the hand-tracking test suite once the expected behavior is fixed.
5. **Rotate the Notion token** that was pasted into chat, then update `NOTION_TOKEN` on Render and redeploy.
6. **Use the Starter backend** for the demo; the free duplicate `garage-jam-api` has no Notion configuration and spins down.
7. **Keep the plugin origin allowlist** in deployment docs and verify any Vercel preview origin separately.
8. **Physical performance gate:** 10 minutes at 72 Hz with papers, one stream, stickers, devices, and focus; 30-minute two-monitor soak; real Notion write-back; real Spotify audio.

---

## 6. Useful commands

```powershell
# Start the emulator against the deployed backend
$env:VITE_BACKEND_ORIGIN='https://garage-jam.onrender.com'
npm --prefix client run dev

# Full rest-feature flow
$env:GARAGE_TEST_URL='https://localhost:8091'
node client/scripts/emulator-rest-features.mjs

# Wrist/hand/settings
node client/scripts/emulator-wrist-calibration.mjs

# Hand pinch device marking
node client/scripts/emulator-device-drawing.mjs

# Deployed-backend WebRTC check
$env:GARAGE_BACKEND_ORIGIN='https://garage-jam.onrender.com'
node client/scripts/emulator-stream-room.mjs
```
