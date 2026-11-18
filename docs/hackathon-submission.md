# Garage Jam — hackathon submission kit

> Written for a Devpost-style submission. The story is in first person singular — replace **I** with **we** if this is a team entry. Anything in `<ANGLE_BRACKETS>` is a placeholder you must fill in before submitting.

---

## 1. Elevator pitch

**Recommended short tagline:**

> Your real room, rebuilt as a golden-hour garage you can throw your to-do list into.

**Longer one-liner (if the field allows ~160 characters):**

> Garage Jam turns your actual desk into a mixed-reality garage: tasks are paper you crumple and throw, your laptop stays in the room, and the sun sets when the workday ends.

**Alternates:**

- A WebXR garage built on your real room — throw your to-dos in the bin, stream your laptop into thin air, and work until the sun goes down.
- Your room. Your table. A golden hour that only exists in mixed reality.
- Turn your real desk into a golden-hour garage, then throw your to-do list in the bin.

---

## 2. About the project

### Inspiration

Every VR workspace I tried asked me to leave my room behind.

The room is where the work actually happens. It has the chair that is the right height, the window with the good light, the laptop with the files, and the mug that has been there since morning. A floating panel in a virtual void throws all of that away. I wanted the opposite: software that starts with the room — and then adds something impossible. A golden-hour garage, built on top of the desk, with a bin you can actually throw your to-do list into.

The garage is the most honest room in the house. It is where side projects happen, music plays, things are half-painted, and nobody expects a clean desk. Golden hour makes even a pile of boxes look like a memory. Garage Jam is that feeling, built on a real desk.

The core interaction came from a smaller frustration: checking a task off is invisible. Throwing a crumpled piece of paper into a bin is not. It has aim, arc, sound, haptics, and a little comic **P'LUNK!** — and then the task is actually done. So the to-do list became paper, and the bin became the completion button.

The last piece was time. A workspace should have an end. The garage has a sunset. When the light goes down, the day is over. Focus mode rolls a shutter over the opening, starts a timer, and gives the room permission to be quiet.

### What it does

Garage Jam is a seated WebXR workspace for Meta Quest 3 and 3S. You open a URL in Quest Browser — no install, no account — and the app reads the room, builds a golden-hour garage on top of it, and turns your real table into the workbench.

From there you can throw your to-do list into a bin, keep your real laptop visible through the virtual walls, stream laptop windows into virtual monitors, open a menu by looking at your wrist, start a focus session, and watch the sun set on the workday.

The full onboarding flow: capability check, XR entry, room scan or touch calibration, the Room Build Reveal, table confirmation, mode choice, device marking, streaming setup, live session, and resume.

### Key features

- **A garage built from your actual room.** It finds your floor, walls, table, ceiling, and openings, then fits the garage to them. No fixed virtual room and no “draw your boundary” minigame. If the scan is unreliable, you can mark four floor corners and four table corners by hand.
- **A build you watch happen.** The garage doesn’t pop in. A blueprint appears, paint sprays across the floor, walls wipe in with drips, the door rolls open onto golden-hour light, stickers peel on, the workbench rolls in, props drop, the neon flickers, and **READY!** lands.
- **Your real table is the workbench.** The virtual workbench is fitted to your actual tabletop — including the vise overhang — and stays anchored when you nudge the height by half a centimeter or touch the controller to the real surface. **Table View** hides the virtual top so you can see the real one.
- **Tasks you finish with a throw.** Your Notion or local tasks land as paper on the table. Grab one, crumple it, and throw it into the bin. Only a real shot into the bin counts; a flat sheet doesn’t. The task completes and the stats board updates.
- **Your real devices stay visible.** Mark your laptop, monitor, keyboard, or an extra zone by drawing its corners. The garage opens a hole around it, so your real screen and keyboard stay in the room while the virtual walls occlude everything else.
- **Your laptop becomes a monitor wall.** Open a link on your laptop, join the room code, and stream windows into virtual monitors. Pick sharp text for code or low latency for motion. The video goes straight between your devices over the LAN.
- **A menu on your wrist.** Look at your left wrist or pinch palm-up. A compact panel appears at arm’s length. Poke it with a fingertip or use a controller ray. Pin it, or look away and it disappears.
- **A workday with a sunset.** Focus rolls a shutter over the garage opening, dims the golden-hour light, and starts a countdown. The garage has a 30-minute sunset, so the day has an end instead of an infinite feed. Break nudges flash a neon sign message.
- **A room that notices you.** With Stand Fade on, standing up fades the garage back to passthrough; sitting down brings it back with a quick reveal.
- **Music, weather, and a living room.** Spotify in the headset with an in-headset search keyboard, or a procedural lo-fi fallback from the boombox. The sky can follow the real weather. Over 30 spatial sounds make the room feel inhabited.
- **Boards instead of dashboards.** Stats, today’s calendar, a Top 3 corkboard, and a drawable whiteboard. Your progress becomes objects on the wall.
- **Plugins without leaving VR.** The headset gives you a six-character code; finish sign-in on your phone or laptop. Notion, Spotify, Google Calendar, and Weather connect independently.
- **No install, no account, no locomotion.** It runs from a URL in Quest Browser. You stay seated; the room comes to you. Y/B or the on-screen button toggles passthrough so you can see your real keyboard.

### The wow moments

1. **The room builds itself around you.** The garage does not fade in. It sprays, rolls, and paints itself onto your actual walls while passthrough keeps the real room visible through the unfinished parts. The first four seconds are the demo.
2. **You finish a task by throwing it away.** The paper has real weight, a satisfying crumple, a comic **P'LUNK!**, and a strict rule: only a real shot into the bin counts. A flat sheet doesn't.
3. **Your laptop stays in the room.** Turn cutouts on and the virtual garage opens a device-shaped hole around your real laptop, monitor, and keyboard. Your hand in the typing volume hides the virtual hand so the real one shows.
4. **Your wrist is the menu.** A glance or a palm-up pinch opens a panel at direct-touch range. It stays put in world space while you poke it. No laser pointer required — but it works with one too.
5. **Your laptop becomes a monitor wall.** A room code and a browser link turn your real laptop windows into virtual monitors over a direct WebRTC path. The pixels stay peer-to-peer on your LAN.
6. **The garage notices you.** Stand up and the garage fades to passthrough. Sit down and it quickly rebuilds. The workspace has a physical relationship with your body.
7. **The workday ends.** Focus rolls the door down; the separate 30-minute sunset takes the light with it. It is the rare productivity tool that tells you to stop.

### How I built it

Garage Jam is a WebXR app built with **IWSDK 1.1.0**, **super-three 0.185.0**, **TypeScript**, **Vite**, **Havok** physics, **@pmndrs/uikit**, a **Node/Express/ws** server, and browser **WebRTC**.

The experience runs as a staged onboarding flow: capability check → XR entry → room scan or touch calibration → room solve → the Room Build Reveal → table confirmation → mode choice → device marking → streaming setup → live garage → resume. The flow is persisted, so returning users get a quick reveal and skip the setup they already finished.

The three hardest pieces were the room fit, the reveal, and the paper throw. The room fit is a tested placement solver that adapts to different room shapes and re-runs when the table changes. The reveal uses a world-space material trick so unfinished parts of the garage discard and passthrough shows through; materials are precompiled and the effect adapts if the frame budget slips. Papers use Havok physics, a release-velocity estimate, and a rim test so a fast throw cannot pass through the bin.

The device cutouts are depth-only volumes, so the virtual garage occludes the room but not the real laptop. Streaming is peer-to-peer WebRTC with room-scoped channels and quick recovery from signaling drops. The server handles Notion caching and write retries, OAuth token refresh, Spotify playback, Calendar, and weather. A test harness of server tests, 12 placement fixtures, device tests, and emulator scripts covers the flow end to end.

### Challenges I ran into

**Every room is a different level.** L-shaped rooms, missing tables, low ceilings, windows in the wrong place, sofas in the only usable corner. A fixed scene could not work. The solver had to be testable enough to trust, cautious enough to admit when it could not place a required slot, and fast enough to re-run while the user edits the table height.

**Making the reveal hitch-free.** The reveal is the first impression, so a single shader compile hitch ruins it. I precreated the props, precompiled the materials, and added a fallback that simplifies the effect if the frame budget slips.

**Making a throw feel fair.** Physics release velocity is sometimes near zero, especially with hand tracking. A fallback estimate helps, but fast throws can pass through the rim. A rim test catches them. The rule is deliberately strict: a flat sheet never completes a task; only a crumpled sheet crossing the rim counts. That one rule makes the interaction feel honest.

**Hiding the virtual world around real devices.** I did not want a stencil or a custom render pass. Depth-only occluders gave the right silhouette: the garage writes depth but not color, so passthrough shows the real device. The hard parts were ordering, hand masking, and keeping panels and cursors visible above the props.

**Keeping a stream alive when signaling is not.** The original sender and viewer closed the peer connection on every WebSocket close, so a two-second signaling blip became a visible monitor flicker. I decoupled media from signaling and made recovery quiet instead of showing a reconnect animation.

**Input ambiguity and panel depth.** Hand versus controller, poke versus ray, and a wrist panel that must stay readable over a workbench. Marking a device locks to the hand that placed the first corner so the other hand cannot swap corners mid-outline. Panels and pointers render above props. The wrist menu is static in world space so it does not swim while you poke it.

**Testing without a headset in the loop.** A lot of the build was verified in the IWSDK Quest 3 emulator, with Quest 3 entry and passthrough confirmed on device. That forced a discipline of gates, fixtures, emulator probes, and screenshots rather than "it compiled, ship it." The remaining physical checks are documented instead of hand-waved.

### Accomplishments I'm proud of

- A complete end-to-end flow, not a single-scene tech demo: capability check → room → build → work → resume.
- A reveal that uses passthrough as a material, not just a background.
- A task interaction that is physical, funny, and strict enough to feel fair.
- Selective device cutouts that make real hardware part of the virtual room.
- A LAN streaming path with real diagnostics, not a fake "connected" badge.
- A solver and test suite that let the room change without the app falling apart.
- One URL, one Node process, no install, no account.

### What I learned

- **Mixed reality is set design.** You cannot place props without reading the room. The room is the stage, and the app is the lighting.
- **Physicality is interaction design.** A wrist menu at direct-touch range and a paper you can crumple do more for presence than another floating panel.
- **Performance is a design constraint, not a post-pass.** The reveal, the stickers, the particles, and the cutouts all had to be designed around the Quest's budget from the start.
- **Reliability is invisible.** A good reconnect is one the user never sees. Heartbeats and hysteresis matter as much as the video codec.
- **Constraints create style.** The comic outlines, golden-hour palette, and diegetic panels came from the room, the hardware, and the things that were hard to render.
- **Test harnesses are a superpower.** Fixtures, emulator scripts, and gate documents let me iterate without waiting for a headset every time.

### What's next

- A full physical Quest 3 pass: 10 minutes at 72 Hz with papers, one stream, stickers, devices, and focus; controller release velocity; hand crumple feel; persistent anchors; typing-volume hand masking.
- Live provider validation: real Notion write-back, Spotify Premium in the headset, Google Calendar, and weather visuals.
- A 30-minute two-monitor soak and the measured latency matrix (timecode-to-video and glass-to-glass).
- A shared multi-user garage, more diegetic props, and store/PWA packaging.
- Accessibility: complete reduced-motion coverage, seated-only presets, and captions for spatial audio cues.

### Where it is now

Quest 3 entry and passthrough are confirmed on device. The full product flow, reveal, solver, paper loop, device marking, streaming path, plugins, boards, focus, and sunset are implemented and exercised in the IWSDK Quest 3 emulator. The repo includes gate evidence and a physical verification checklist for the remaining headset passes in `docs/implementation-gates.md` and `docs/user-verification.md`.

> **Internal note — remove before pasting.** The physical gates still open are sustained 72 Hz, controller/hand feel, persistent anchors, live provider write-back, and a 30-minute stream soak. Keep those in the repo docs and your own checklist; do not claim them as measured in the Devpost story until they are.

### Credits

- Computer Monitor Lowpoly Model by Marco Zakaria, used under CC BY 4.0.
- Anton and Noto Sans CJK SC fonts, used under the SIL Open Font License 1.1.
- Sound effects generated with ElevenLabs; prop models generated with Tripo and optimized with meshopt and glTF-Transform.
- Built with IWSDK 1.1.0 and super-three 0.185.0.

### Short version (about 450 words, if you need a tighter read)

**Inspiration.** Every VR workspace I tried asked me to leave my room behind. The room is where the work actually happens — the right chair, the good window light, the laptop with the files. I wanted software that starts with the room and then adds something impossible: a golden-hour garage built on top of the desk, with a bin you can actually throw your to-do list into. The garage is the most honest room in the house: side projects, music, half-painted things, no expectation of a clean desk. And checking a task off is invisible; throwing a crumpled paper into a bin is not. That became the core loop.

**What it does.** Garage Jam is a seated WebXR workspace for Quest 3/3S. Open a URL in Quest Browser — no install, no account — and the app reads the room, builds a garage on top of it, and turns your real table into the workbench. Tasks are paper: grab, crumple, throw, and only a crumpled sheet crossing the bin rim counts. Completion writes back to Notion and updates the stats board. Your real laptop and keyboard stay visible through the virtual walls. Or stream laptop windows into virtual monitors over your LAN. A glance or palm-up pinch opens a direct-touch wrist menu. Focus rolls the garage door down. A 30-minute sunset ends the workday.

**How I built it.** IWSDK 1.1.0, super-three 0.185.0, TypeScript, Vite, Havok, @pmndrs/uikit, Node/Express/ws, and browser WebRTC. A persisted onboarding flow runs capability check → XR → scan or touch calibration → solve → Room Build Reveal → table confirm → mode → device marking → streaming → live → resume. The reveal paints the garage into the room while passthrough stays visible, with precompiled materials and an adaptive fallback. The room fit is a tested solver that adapts to different room shapes. Papers use real physics, a release-velocity estimate, and a rim test so a fast throw still counts. Your real devices stay visible through the virtual walls. Streaming is peer-to-peer WebRTC with quick recovery from signaling drops.

**Challenges.** Every room is a different level: L-shapes, missing tables, low ceilings, furniture. The reveal had to be hitch-free on its first impression. The throw had to feel fair and never accept a flat sheet. Hiding the virtual world around real devices took ordering and hand-mask work. The original stream closed its peer connection on every signaling blip; the fix was making recovery invisible. And testing without a headset in the loop forced a discipline of gates, fixtures, emulator probes, and screenshots.

**What I learned.** Mixed reality is set design. Physicality is interaction design. Performance is a design constraint, not a post-pass. Reliability is invisible. Constraints create style. And test harnesses are a superpower.

---

## 3. Built with

Devpost allows up to 25 tags. This list is exactly 25 — paste them one at a time.

```text
WebXR
Meta Quest 3
Meta Quest 3S
Meta Horizon OS
Quest Browser
IWSDK
Three.js
TypeScript
Vite
Node.js
WebSockets
WebRTC
Havok
pmndrs/uikit
glTF
meshoptimizer
Notion API
Spotify Web API
Spotify Web Playback SDK
Google Calendar API
Open-Meteo
OAuth 2.0
ElevenLabs
Web Audio API
```

If you need to swap one out, good replacements are **Express**, **Service Worker**, **Render**, or **Docker**.

---

## 4. Try it out links

```markdown
- **Live demo (Quest 3 / 3S):** https://garage-jam.vercel.app/
- **Source code:** https://github.com/WIN-MIN-MYAT/garage-jam
- **Demo video:** `<YOUTUBE_OR_VIMEO_URL>`
- **Laptop sender:** https://garage-jam.onrender.com/sender (desktop Chrome, same Wi-Fi as the headset)
- **Developer hub:** https://garage-jam.vercel.app/?test=1
```

Use the exact room-scoped sender link shown in S9b on the headset. The sender page lives on the Render backend, not Vercel.

### Important notes before you paste

- **Do not use `garagejam.com`.** That domain currently hosts an unrelated "Launching Soon" site. Deploy to a Render/Fly URL or a domain you actually control.
- **Use a Node host for the backend.** Vercel can host the WebXR client, but `/sender`, `/api`, and the `/signal` WebSocket still need a long-lived Node process on Render/Fly/VPS. Follow [vercel-deployment.md](vercel-deployment.md) for the split. The sender link in the headset will point at the backend automatically.
- **Quest 3 or 3S only.** Quest 2 is detected and marked unsupported on the landing page.
- **The live demo needs a Quest.** A judge on a laptop will see the landing page and capability check, not the garage. The demo video is the primary try-it path for judges without hardware.
- **Streaming needs the same LAN.** The laptop and headset must be on the same non-isolated Wi-Fi; no TURN relay is configured. Say this next to the link, or judges will think streaming is broken.
- **For a public demo, use the shared plugin profile.** Set `PLUGIN_SHARED_PROFILE` and `PLUGIN_DEMO_LOCK=1` so judges can try Spotify/Music without their own OAuth allowlist slots. Use a dedicated demo account and a separate Notion database.
- **Consider renaming the GitHub repo.** The current remote is `big-black-ballz/garage-jam`. If this is going in front of judges or sponsors, move it to a neutral account or organization before submitting, then use that URL for `<SOURCE_REPO_URL>`. GitHub redirects the old URL, so this is low-risk.
- **Add a license if you want judges to reuse it.** There is no `LICENSE` file in the repo right now. MIT is the simplest choice for a hackathon.

### Deployment checklist

1. Deploy the included `Dockerfile` to Render, Fly.io, Railway, or a VPS with a persistent disk for `/app/server/data`.
2. Set the provider environment variables you want to demo. At minimum, set `PLUGIN_SHARED_PROFILE` and `PLUGIN_DEMO_LOCK=1` for a hands-off judge experience.
3. Seed a separate Notion demo database with three or four tasks.
4. Open the live URL on a Quest 3/3S, accept the certificate if needed, and run the full flow once.
5. Open `/sender` on the laptop, join the room code, and verify one monitor reaches **Live**.
6. Leave the demo in a clean state: room saved, table confirmed, no half-finished device outline.

---

## 5. Project media

**Format:** JPG or PNG, 3:2 ratio, 5 MB max per image, up to 15 images. The first image is the thumbnail, so make it the best one.

### Gallery order and captions

| # | Shot | Caption |
|---|---|---|
| 1 | **Hero:** finished golden-hour garage sitting on a real desk, real room visible through the door and around the edges. | Your real room. A golden-hour garage built on top of it. |
| 2 | **Reveal mid-beat:** wall wipe with drips, or the door opening with the sunbeam and dust. | The Room Build Reveal paints the garage into your room through passthrough. |
| 3 | **Scan:** neon plane outlines and FLOOR / WALL / TABLE / DOOR labels in the real room. | Garage Jam reads your floor, walls, table, and openings — or measures them by touch. |
| 4 | **Table fit:** the workbench on the real table with the `THIS YOUR TABLE?` panel. | The workbench is fitted to your actual tabletop, vise and all. |
| 5 | **Throw:** a three-panel sequence — grab, crumple, **P'LUNK!** into the bin. | Tasks are paper. Crumple. Throw. Done. |
| 6 | **Proof:** Notion row changed to Done, stats board updated. | Completion writes back to Notion and updates the stats board. |
| 7 | **Cutouts:** real laptop visible through the virtual garage, with the device outline. | Depth-only cutouts keep your real laptop and keyboard in the room. |
| 8 | **Wrist menu:** the compact panel over the real room, hand or controller in frame. | A glance or a palm-up pinch opens a direct-touch menu at 43 cm. |
| 9 | **Streaming:** two live monitors in the garage, with a small sender-dashboard inset. | Stream laptop windows into virtual monitors over your LAN. |
| 10 | **Focus/sunset:** shutter down, countdown sign, dimmed sky. | Focus rolls the door down; the garage has a sunset, so the day has an end. |
| 11 | **Presence:** standing in passthrough, then sitting with the quick reveal. | Stand up and the garage fades; sit down and it comes back. |

### Capture notes

- **Recapture for submission.** Most current images in `client/scripts/` are emulator evidence with controller panels, debug HUDs, or the pink test badge. Use them as reference, not as the final gallery.
- Capture at **1920 × 1280** (3:2) or **1440 × 960**. If you capture 16:9, leave headroom and crop deliberately; do not stretch.
- Hide the IWER controller panels, debug HUD, and test badges. The product flow hides the HUD by default; the test probes do not.
- Clean the real room for the passthrough shots: clear the table, warm lamp light, no laundry, no identifying documents.
- Take the hero shot from the seat, slightly above eye level, with the sunset door in frame. The real room should be visible at the edges so the mixed-reality claim is obvious.
- For the throw sequence, shoot a burst or three separate frames from the same angle. The comic word **P'LUNK!** is the money shot.
- For the cutout shot, angle the laptop so the screen and keyboard are both visible through the virtual wall. Show the device outline if it reads clearly.
- For the streaming shot, use real content (a code editor or a document), not a test pattern. Add the sender dashboard as a small inset so judges see both ends.

---

## 6. Demonstration video

**Rules:** under 3 minutes, YouTube or Vimeo, public or unlisted with no password, footage as viewed on a Meta VR device or an equivalent emulator. Only the first 3 minutes are reviewed, so everything that matters must be in the first 3 minutes.

**Recommended length:** 2:45.

**Strategy:** open with the throw, not the landing page. The first 10 seconds must show something only this project can do. Then widen out to the room reveal, the real-device cutouts, the stream, and the sunset. Use Quest 3 capture for authenticity and the IWSDK emulator for stable close-ups. The rules allow emulator footage, so use it where the headset capture is shaky.

### Shot-by-shot script

| Time | Visual | Voiceover / on-screen text |
|---|---|---|
| 0:00–0:08 | **Cold open.** Headset view: a hand grabs a paper task, crumples it, throws it into the bin. **P'LUNK!** Cut to the task completing — the Notion row flipping to Done if it is connected, otherwise the local **DONE!** state and stats board. | **VO:** "This is my actual desk. And this is how I finish a task." **On-screen:** GARAGE JAM |
| 0:08–0:18 | Quick montage: the real room in passthrough, the garage faded in, the sunset door. | **VO:** "Most VR workspaces ask you to leave your room. I wanted one that uses it." |
| 0:18–0:40 | **The reveal.** Start with the scan outlines and `ROOM LOCKED`. Then the full Room Build Reveal: floor spray, wall wipe with drips, door opening with sunbeam and dust, props dropping, stickers, **READY!**. | **VO:** "Garage Jam reads the floor, walls, table, and openings — then paints a golden-hour garage on top of them." **On-screen:** ROOM BUILD REVEAL |
| 0:40–0:55 | **Table + wrist.** The workbench on the real table. The `THIS YOUR TABLE?` panel. Look at the wrist, the panel opens, poke a button. | **VO:** "The workbench fits my real tabletop. The menu lives on my wrist — a glance or a pinch, then poke." **On-screen:** YOUR TABLE / YOUR WRIST |
| 0:55–1:15 | **Cutouts.** Mark the laptop by drawing its corners. Toggle cutouts on. The real laptop and keyboard appear through the virtual garage. The hand in the typing volume shows the real hand. | **VO:** "My laptop doesn't disappear. The garage cuts a hole around it, so the real screen and keyboard stay in the room." **On-screen:** SELECTIVE PASSTHROUGH |
| 1:15–1:40 | **Task loop.** Grab a paper, crumple, throw, **P'LUNK!**, Notion Done, stats board. Then a flat paper is thrown and does **not** count. | **VO:** "Tasks are paper. Crumple. Throw. Done. A flat sheet doesn't count — only a real shot into the bin." **On-screen:** THROW TO DONE |
| 1:40–2:05 | **Streaming.** Laptop sender joins the room. The garage monitors go live. Grab and curve a monitor. Small inset of the sender dashboard. | **VO:** "Or stream your laptop into virtual monitors. WebRTC, peer-to-peer on your LAN, with a room code instead of a cable." **On-screen:** LAPTOP → GARAGE |
| 2:05–2:25 | **Focus/sunset.** The shutter rolls down. Countdown. Sky dims. Music starts. The boombox speakers pulse. | **VO:** "Focus rolls the door down. The garage has a sunset — so the workday has an end." **On-screen:** FOCUS / SUNSET |
| 2:25–2:45 | **Close.** Stand up: the garage fades to passthrough. Sit down: the quick reveal returns. End on the logo, URL, and QR code. | **VO:** "Your room. Your garage. Your golden hour." **On-screen:** GARAGE JAM / `<LIVE_DEMO_URL>` / Quest 3 + 3S |

### Production notes

- **Record 1080p60, 16:9.** Put the 3:2 gallery images in a separate export; do not letterbox the video for them.
- **Use a real Quest 3 for at least the throw, the wrist menu, and the final sit/stand.** Use the IWSDK emulator for the reveal, the device cutout close-up, and any shot that needs a locked-off camera. The rules explicitly allow equivalent emulator footage, and the mix will look more credible than an all-emulator video.
- **Pre-warm the build.** Load the room, complete the reveal, precompile materials, and open the plugins once before recording. The reveal should not stutter on the first take.
- **Use Resume for repeated takes.** The quick reveal is faster and keeps the video under three minutes. Capture the full reveal once, then use Resume for the rest.
- **Reset the demo state.** Seed the Notion demo database with three or four tasks. Clear saved progress, including any old mural art, pins, and the whiteboard, if they are noisy. Keep one or two device outlines saved.
- **Do not show the dev HUD.** No controller panels, no pink `GARAGE BUILD` badge, no console. The product flow hides the HUD by default; the test URLs do not.
- **No copyrighted music.** Use the app's procedural lo-fi fallback or a track you have cleared. If you show Spotify, duck the music under the narration and use a track you have rights to. Do not let a commercial song play for 20 seconds in a judged video.
- **Keep the narration human.** Short sentences. Let the sound effects and the reveal breathe. Do not read the feature list.
- **Add captions.** A large percentage of judges watch muted first. Burn in short captions for the key claims: "YOUR REAL ROOM", "THROW TO DONE", "SELECTIVE PASSTHROUGH", "LAN STREAMING", "SUNSET FOCUS".
- **Show the URL at the end and in the description.** Also put it in the first line of the description, not only the end card.
- **Check the first 10 seconds.** If the video starts with a logo, a loading screen, or a talking head, re-cut it. Start with the throw.
- **If a feature is not live on recording day, use the real fallback — not a fake.** If Notion is not connected, show the local task completion and say "local or Notion" in the voiceover. If streaming is not stable, record the actual sender and viewer in the emulator with the fake-capture path, or show the sender dashboard with a real connection. Do not cut in a pre-recorded video and call it a live stream. Judges can tell, and the project is stronger when the real path is shown.

### Copy-paste video description

```text
Garage Jam is a mixed-reality garage built on your real room. Crumple your to-do list into the bin, keep your real laptop visible through passthrough, stream laptop windows into virtual monitors, and watch the sun set on your workday.

Built with IWSDK, WebXR, Three.js, Havok, WebRTC, and a small Node server. Designed for Meta Quest 3 and 3S in Quest Browser.

Try it: <LIVE_DEMO_URL>
Source: <SOURCE_REPO_URL>

Chapters:
0:00 Throw to done
0:18 The room builds itself
0:40 Your table, your wrist
0:55 Selective passthrough
1:15 The task loop
1:40 Laptop to garage
2:05 Focus and sunset
2:25 Your room, your garage
```

### YouTube metadata

- **Title:** Garage Jam — a mixed-reality garage for your real desk
- **Thumbnail:** the hero garage shot with the text **YOUR ROOM. YOUR GARAGE.**
- **Visibility:** public or unlisted, no password.
- **Category:** Science & Technology.
- **Tags:** WebXR, Meta Quest 3, mixed reality, passthrough, IWSDK, Garage Jam.

---

## 7. Final pre-submission checklist

- [ ] Rename or transfer the GitHub repo to a neutral account/org.
- [ ] Make the repo public (or give judges access) and scan the history for secrets before publishing.
- [ ] Add a `LICENSE` (MIT recommended for a hackathon).
- [ ] Deploy to a Node host with a persistent disk; verify `/health`, `/sender`, `/api`, and `/signal`.
- [ ] Do not use `garagejam.com` — it is an unrelated site.
- [ ] Set `PLUGIN_SHARED_PROFILE` and `PLUGIN_DEMO_LOCK=1` for judges.
- [ ] Seed a separate Notion demo database and reset it before judging.
- [ ] Test the live URL on a fresh Quest 3/3S and a fresh browser profile.
- [ ] Record the 2:45 video with Quest/emulator footage and clear audio.
- [ ] Capture 8–11 fresh 3:2 images; make the first one the hero.
- [ ] Fill in `<LIVE_DEMO_URL>` and `<YOUTUBE_OR_VIMEO_URL>` everywhere.
- [ ] Paste the 25 tags one at a time.
- [ ] Proofread the story for claims you cannot support. Do not claim 72 Hz, glass-to-glass latency, or live provider write-back until measured.
- [ ] Submit early, then use the remaining time for the physical Quest pass.

---

## 8. Bonus question: "What makes you excited about the future of VR?"

### Short version (for a form field)

What excites me is that VR and AR are finally moving from "replace your desk" to "use the desk you already have." For years, productivity in VR meant a virtual monitor in an empty void. Passthrough, room understanding, and hand tracking change that: your real keyboard, notebook, coffee, and chair become part of the interface. The computer stops being a flat rectangle and becomes a layer on the room. I think the next shift is context-aware workspaces — the system knows where your table is, which device you're on, and when you need focus, so it can put information in space instead of another tab. That's the future I want: less friction, more presence, and technology that makes your actual room feel bigger.

### Longer version

I don't think the future of AR productivity is a virtual office in the sky. It's your actual office, with the boring parts removed.

The thing that excites me is the end of the flat rectangle as the only place work happens. Today, a task lives in a tab. In AR, it can live on the table, on the wall, or in your hand. You can put the thing you're avoiding where you'll see it, and put the thing you're focused on in front of you. Spatial memory is real: we remember where we left things. AR can use that instead of fighting it.

The second shift is that the room becomes the computer's context. Passthrough and room understanding mean the system knows your table, your keyboard, your monitor, and your chair. It doesn't have to replace them; it can extend them. That's when AR stops being a novelty and becomes a tool. You get infinite screens without buying monitors, but you also get to keep your real keyboard, your notes, and your coffee. The physical and digital stop competing.

The third shift is access. WebXR means a workspace can be a URL. No install, no account, no platform lock-in. You can share a room the way you share a document. That's how spatial computing becomes ordinary.

I'm also excited about AI in that context — not a chatbot in a panel, but an ambient layer that knows what you're looking at, what's on your desk, and what you're trying to finish. It can quietly move the right thing into view, or get out of the way.

The challenges are real: comfort, text legibility, battery, privacy, and social norms. But they're engineering problems, not fantasy problems. The hardware is finally good enough to solve them.

Garage Jam is my small proof of that direction: a real table, real devices, a virtual garage, tasks you can throw away, and a focus mode that ends with a sunset. It's not about escaping your room. It's about giving your room more possibility.
