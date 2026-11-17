# Monitor latency results

Status: measurement setup built on 2026-11-16. No Quest 3 or live Chrome capture was available during implementation. **No latency target has been measured or claimed.** Run the stability soak and fault tests in [stability-report.md](stability-report.md) before the A/B matrix.

## Measurement definitions

- **Capture-to-preview**: timecode in the shared tab to the laptop sender's local preview video, sampled at 4 Hz.
- **Timecode-to-video**: timecode in the shared tab to the Quest's decoded `<video>` frame, sampled at 4 Hz. This includes capture, encode, network, jitter buffer, and decode. It does **not** include texture upload, XR rendering, or physical display scanout, so it is not glass-to-glass latency.
- **Glass-to-glass**: use a 120 fps or faster phone camera to film both the laptop timecode tab and the Quest display in one shot. Compare matching visible clock values across frames. Repeat over at least 60 seconds and report median and p95. A camera view through a headset lens is needed for the final display stage.
- `getStats()` gives encode, decode, jitter buffer, bitrate, packet loss, freezes, and candidate pair data. A missing browser field is `n/a`.

Clock sync uses several server ping samples and retains the lowest RTT offset. The timecode probe rejects samples outside 0-10 seconds and can be disabled with `?probe=0`. The strip must be visible at the top of the shared content; a browser window capture that includes the title bar may not decode, so tab capture is the recommended probe baseline. The sender defaults are now **Best quality** (1080p30, 4 Mbps, `maintain-resolution`, sharp text) and **Lowest latency** (720p60, 2.5 Mbps, `maintain-framerate`, high motion), both preferring AV1 with auto quality off. These choices have **not** been validated against readable text, freezes, or Quest latency; a very low bitrate can force resolution loss or dropped frames.

## Baseline and final configuration

| Condition | Monitors | Surface | Preset | Codec | Host/UDP? | Capture-to-preview p50 | Timecode-to-video p50/p95 | Glass-to-glass p50/p95 | Encode / decode / jitter ms | Freezes | XR FPS | Result |
| --- | ---: | --- | --- | --- | --- | ---: | --- | --- | --- | ---: | ---: | --- |
| Baseline before tuning | 1 | Timecode tab | 1080p30 balanced | H.264 preferred | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not run |
| Three-monitor baseline | 3 | Tab/window | 720p30 multi | H.264 preferred | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not run |
| Tuned final | 1–3 | To determine | To determine | To determine | Pending | Pending | Pending | Pending | Pending | Pending | Pending | Not selected |

Target comparison is pending: one monitor median ≤120 ms, two monitors median ≤150 ms, p95 ≤200 ms, first frame <3 seconds, no >1-second freeze in 10 minutes, and XR ≥72 Hz with two monitors. The bottleneck stage cannot be named before measurements.

## Controlled A/B matrix

Only start after the 30-minute two-monitor soak and fault tests pass. Hold all other settings constant. For each row run **three 60-second trials**, save sender and viewer JSON, and record median, p95, FPS, freezes, encode/decode/jitter ms, candidate pair, and state transitions. The current code exposes capture presets, content hint, codec preference, max bitrate, degradation preference, automatic quality, jitter target, stats, probe, and recovery thresholds as controls or query parameters. Bitrate-start SDP hints remain unimplemented pending a stable baseline.

| Variable | Conditions | Results |
| --- | --- | --- |
| Capture surface | tab, window, full screen | Pending |
| Capture preset | 720p60, 900p30, 1080p30, 1440p30; 720p30 and 720p15 for load | Pending |
| Content hint | detail, text, motion | Pending |
| Jitter target | `?jitter=0`, `?jitter=20`, `?jitter=50` ms | Pending |
| Monitor count | 1, 2, 3 | Pending |
| Network | 5 GHz, 6/6E GHz, laptop Wi-Fi versus Ethernet | Pending, when available |
| Hardware encoder | hardware on versus off, if Chrome/laptop permit | Pending, when available |
| Codec, bitrate, degradation preference | H.264/VP8/VP9, max Mbps levels, sender preference | Pending |
| Start bitrate SDP hint | off/on | Not implemented; test only if baseline shows initial bitrate ramp is a bottleneck |

When results exist, choose the default by measured glass-to-glass p95 while keeping readable text, zero false reconnects, and ≥72 Hz XR. If capture-to-preview dominates, reduce capture cost or use hardware encoding. If encode time dominates, lower resolution/FPS and check power mode. If jitter/RTT dominates, fix Wi-Fi or bufferbloat. If video-to-glass dominates, investigate texture upload and XR rendering, then time-box an XR quad-layer spike only if supported on this Quest Browser version. If the browser path still misses targets with measured evidence, consider a separate native-host experiment; do not start one as part of this task.
