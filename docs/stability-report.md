# Monitor stability report

Status: code and signaling tests complete on 2026-11-16. Quest 3 device validation is pending. `metavr device list` returned no connected device, and the user will make the headset and Chrome capture available later.

## Diagnosed causes

1. The old sender and viewer closed their `RTCPeerConnection` immediately in the WebSocket `onclose` handler. The old viewer then set `reconnecting` immediately and retried every 3 seconds. This is a direct code path from a signaling-only interruption to a visible monitor flicker and peer recreation. The old viewer also reset its peer on every offer, including an ICE restart offer.
2. The old viewer closed all streams whenever the IWSDK visibility state became `NonImmersive`, so leaving and re-entering XR caused a full reconnect. The new system keeps media alive across this transition and logs visibility changes.
3. The live development server log showed several viewer joins and replacements for the same monitor while more than one Garage Jam browser tab was open. Several joins came from the old page code without a session ID. These duplicates can cause a takeover loop; the server now rejects legacy duplicate joins and tells replaced modern clients to stop reconnecting.

These are confirmed implementation causes. A Quest timeline is still needed to decide which caused the reported headset flicker most often. The development server itself restarted during edits, which also produced signaling socket closes in the log and is not a representative soak condition.

## Changes

- Signaling socket loss no longer closes media on either peer. A session ID survives socket reconnect, and the server holds an unbound room slot for 30 seconds.
- Only the sender creates offers and restarts ICE. A transient `disconnected` state gets a 5-second grace period. A failed restart is the only automatic path to recreating a peer; retries are bounded.
- A replacement message stops the old client from auto-reconnecting. Stale session IDs, offer generations, and ICE candidates are rejected or queued appropriately.
- A data channel carries a 1.5-second heartbeat. Liveness uses heartbeat or packet progress, not decoded frame count. A 3-second status hysteresis suppresses brief `degraded`/`recovering` UI changes.
- Sender and viewer record per-monitor connection events, stats, and probe samples. The server records join, rejoin, replacement, close, and expiration events. The **Download run JSON** and **SAVE RUN** buttons include the server timeline.
- Sender capture `ended` and `mute` are shown as source conditions and do not trigger network recovery.

## Verification so far

| Check | Result |
| --- | --- |
| Server signaling relay and mDNS rewrite | Passed automated tests |
| Same-session WebSocket rejoin | Passed automated test; `resumed: true` |
| Second sender takeover | Passed automated test; old socket gets `replaced` |
| Replaced old session and legacy duplicate rejection | Passed automated test |
| State hysteresis and timecode decoding | Passed automated tests |
| Client TypeScript and production build | Passed |
| 30-minute, three-monitor Quest soak | Pending headset and Chrome sharing |
| 10-second signaling outage with live media | Pending headset and Chrome sharing |
| 3-second Wi-Fi outage, window minimize, tab close, sleep/wake, XR exit/re-entry, static desktop, hot reload | Pending live capture and headset |

## Live test procedure

1. Close old Garage Jam tabs on both devices. Restart `npm run dev` after changing code, then open `/sender` in Chrome and `/?demo=1&probe=1` in Quest Browser on the same Wi-Fi. The headset must accept the local HTTPS certificate. Share the `/sender/timecode` tab as Monitor 1; start two more monitors if testing the three-monitor soak.
2. Record the Chrome and Quest user agent strings and the headset OS version. Use **Download run JSON** on the sender and **SAVE RUN** on the Quest after each test. Keep the JSON files with the test notes.
3. Run a 30-minute three-monitor soak with static and changing content. Pass only if the UI shows zero spurious degraded/recovering flips, the peer-recreation counter stays at zero per monitor after its initial creation, and the logs show no unexplained peer replacement.
4. Inject the listed faults one at a time. Note outage start, recovery time, UI state, `restart-ice` events, peer-create count, selected candidate pair, and any packet loss or RTT spike. A 10-second signaling-only outage should keep video and heartbeat flowing. A three-second Wi-Fi outage should self-recover without peer recreation if ICE reconnects.
5. Check the source states: minimizing a captured window should show `source-paused` if Chrome mutes its track; closing/stopping the shared tab should show `source-stopped`. Chrome may not mute every minimized capture surface, so record actual track events rather than assuming them.

The run JSON records the timing evidence. `transitionsPerMinute`, suppressed flickers, peer creations, and longest unhealthy interval are included in per-second samples. A suspiciously regular period between transitions should be investigated in the event timestamps.

## Browser API checks

The code feature-detects `jitterBufferTarget` in **milliseconds**, falls back to `playoutDelayHint` in **seconds**, and logs when neither exists. `requestVideoFrameCallback` metadata is sampled where supported. The installed Three.js `VideoTexture` already uses `requestVideoFrameCallback` to mark a texture for update when a new frame arrives. Browser documentation describes these APIs, but support and behavior on this particular Quest Browser version remain unverified until the on-device run.

References: [MDN jitterBufferTarget](https://developer.mozilla.org/en-US/docs/Web/API/RTCRtpReceiver/jitterBufferTarget), [Chromium receiver IDL](https://chromium.googlesource.com/chromium/src/third_party/+/refs/heads/main/blink/renderer/modules/peerconnection/rtc_rtp_receiver.idl), [MDN requestVideoFrameCallback](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback), [MDN ICE disconnected state](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/iceConnectionState), [Meta WebXR performance guidance](https://developers.meta.com/vr/documentation/web/webxr-perf-bp).

## Manual network checks

Use the same non-guest LAN with AP/client isolation disabled. Prefer Quest on 5/6 GHz and laptop on Ethernet where available. Compare selected candidate types and RTT while idle and under load. A direct host/UDP pair is expected on a healthy LAN; relay or TCP is highlighted in both panels. The mDNS rewrite remains in the signaling server. If Chrome obscures local host candidates, review `chrome://flags/#enable-webrtc-hide-local-ips-with-mdns` on the laptop and record any change before toggling it.
