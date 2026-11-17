import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { SceneSystem } from './systems/scene-system.js';
import { PaperSystem } from './systems/paper-system.js';
import { StreamSystem } from './systems/stream-system.js';
import { TaskBoardSystem } from './systems/task-board-system.js';
import { FocusSystem } from './systems/focus-system.js';
import { PluginSystem } from './systems/plugin-system.js';
import { EnvironmentSystem } from './systems/environment-system.js';
import { VoiceSystem } from './systems/voice-system.js';
import { NudgeSystem } from './systems/nudge-system.js';
import { WhiteboardSystem } from './systems/whiteboard-system.js';
import { HudSystem } from './systems/hud-system.js';
import { SunsetSystem } from './systems/sunset-system.js';
import { CutoutSpikeSystem } from './systems/cutout-spike-system.js';
import { RoomSpikeSystem } from './systems/room-spike-system.js';
import { ManualCalibrationSystem } from './systems/manual-calibration-system.js';
import { GarageBuildSystem } from './systems/garage-build-system.js';
import { TableConfirmSystem } from './systems/table-confirm-system.js';
import { WristMenuSystem } from './systems/wrist-menu-system.js';
import { DeviceSystem } from './systems/device-system.js';
import { AppFlowSystem } from './systems/app-flow-system.js';
import { RevealSystem } from './reveal/RevealSystem.js';
import { revealAudio } from './reveal/RevealAudio.js';
import { isProductEntry } from './app-flow/app-flow.js';
import { renderLanding } from './app-flow/landing-page.js';
import { loadLastRoom } from './garage-state.js';
import { describeLastRoom, resumeAvailable } from './app-flow/app-flow.js';

const query = new URLSearchParams(location.search);
const testHub = query.get('test') === '1';
const demo = query.get('demo') === '1';
const cutoutSpike = query.get('cutoutSpike') === '1';
const roomSpike = query.get('roomSpike') === '1';
const roomBuild = query.get('roomBuild') === '1';
const product = isProductEntry && !demo;

function renderTestHub() {
  const container = document.getElementById('scene-container') as HTMLDivElement;
  container.innerHTML = `
    <style>
      .hub { min-height: 100vh; background: #121419; color: #f3ecd9; font-family: ui-sans-serif, system-ui, sans-serif; padding: 42px 24px 64px; box-sizing: border-box; }
      .hub-inner { max-width: 980px; margin: 0 auto; }
      .hub-kicker { color: #ff2d95; font-size: 13px; font-weight: 800; letter-spacing: .18em; }
      .hub h1 { margin: 8px 0 6px; color: #e8ff2a; font-size: clamp(38px, 7vw, 72px); line-height: .92; letter-spacing: .02em; }
      .hub p { color: #b9b3a7; line-height: 1.5; max-width: 720px; }
      .hub-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-top: 28px; }
      .hub-card { text-align: left; background: #20232b; color: #f3ecd9; border: 3px solid #0d0d10; box-shadow: 7px 7px 0 #0d0d10; padding: 18px; cursor: pointer; border-radius: 4px; transition: transform .12s ease, background .12s ease; }
      .hub-card:hover { transform: translate(-2px, -2px); background: #292d37; }
      .hub-card strong { display: block; color: #19e3ff; font-size: 20px; margin-bottom: 8px; }
      .hub-card span { color: #b9b3a7; font-size: 14px; line-height: 1.45; }
      .hub-card em { display: block; margin-top: 12px; color: #ff8a1f; font-style: normal; font-size: 12px; font-weight: 700; letter-spacing: .04em; }
      .hub-note { margin-top: 28px; padding: 14px 16px; border-left: 4px solid #ff2d95; background: #1a1c23; color: #d8d1c4; font-size: 14px; }
    </style>
    <div class="hub">
      <div class="hub-inner">
        <div class="hub-kicker">GARAGE JAM / DEV ENTRY</div>
        <h1>ONE URL.<br>PICK A TEST.</h1>
        <p>The product runs from <strong>/</strong> as S0–S10. This page is the developer hub for probes and isolated gates.</p>
        <div class="hub-grid">
          <button class="hub-card" data-href="/"><strong>PRODUCT ENTRY</strong><span>The real S0 landing page, capability check, single-entry flow and full Room Build Reveal.</span><em>S0–S10</em></button>
          <button class="hub-card" data-href="?roomBuild=1&v=1"><strong>ROOM BUILD</strong><span>Direct room-driven garage: live scan or saved room, hidden-at-build skins, full reveal, table confirm and wrist menu.</span><em>GATE 5–6</em></button>
          <button class="hub-card" data-href="?roomSpike=1&v=1"><strong>ROOM SCAN + CALIBRATION</strong><span>WebXR plane/mesh probe, semantic labels, RUN SCAN and the manual floor/table corner calibration.</span><em>GATE 3</em></button>
          <button class="hub-card" data-href="?cutoutSpike=1"><strong>CUTOUT SPIKE</strong><span>Depth-only occluder volumes against an opaque test panel. Eight-angle silhouette check.</span><em>GATE 2</em></button>
          <button class="hub-card" data-href="?demo=1"><strong>OLD PROTOTYPE</strong><span>Fixed 5 × 5 garage, demo papers, Notion tasks, three WebRTC monitors and the sunset timeline.</span><em>REFERENCE</em></button>
        </div>
        <div class="hub-note">Enter XR after choosing a mode. On Quest Browser, this page is a normal 2D page; the mode page owns the immersive session.</div>
      </div>
    </div>`;
  container.querySelectorAll<HTMLButtonElement>('.hub-card').forEach(button => {
    button.addEventListener('click', () => { location.href = button.dataset.href!; });
  });
}

function startApp() {
  if (cutoutSpike || roomSpike || roomBuild) {
    const badge = document.createElement('div');
    badge.id = 'garage-test-badge';
    badge.textContent = cutoutSpike ? 'CUTOUT TEST v2 — enter XR, then face forward'
      : roomBuild ? 'GARAGE BUILD — enter XR to reveal the room-driven garage'
      : 'GARAGE JAM TEST — enter XR, then view the HUD';
    badge.style.cssText = 'position:fixed;top:8px;left:8px;z-index:10000;padding:8px 12px;background:#d02bb8;color:white;font:700 16px sans-serif';
    document.body.append(badge);
  }

  if (product) {
    renderLanding({ resume: resumeAvailable(), roomSummary: describeLastRoom(loadLastRoom()) });
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').then(async () => {
    const registration = await navigator.serviceWorker.ready;
    window.setTimeout(() => {
      const urls = performance.getEntriesByType('resource').map(entry => entry.name).filter(url => url.startsWith(location.origin) && !new URL(url).pathname.startsWith('/api/'));
      registration.active?.postMessage({ type: 'CACHE_VISITED', urls });
    }, 5000);
  }).catch(console.warn);

  const xrOptions = projectOptions.xr as Exclude<typeof projectOptions.xr, false | undefined>;
  const roomFeatures = roomSpike || roomBuild || product;
  const options = roomFeatures ? {
    ...projectOptions,
    xr: { ...xrOptions, features: { ...xrOptions.features, planeDetection: true, anchors: true, ...(roomSpike ? { meshDetection: true } : {}) } },
    features: { ...projectOptions.features, sceneUnderstanding: { showWireFrame: roomSpike } },
  } : projectOptions;
  World.create(document.getElementById('scene-container') as HTMLDivElement, options).then(world => {
    if (cutoutSpike || roomSpike || roomBuild) document.getElementById('garage-test-badge')?.addEventListener('click', () => {
      if (roomBuild) void revealAudio.unlock().catch(() => { /* audio is optional */ });
      world.launchXR();
    });
    if (location.hostname === 'localhost') (window as any).garageEmulatorWorld = world;
    const hud = world.getSceneObject('garage-hud');
    if (product && query.get('hud') !== '1' && hud) hud.visible = false;
    if (demo) {
      world.registerSystem(SceneSystem);
      world.registerSystem(PaperSystem);
      world.registerSystem(StreamSystem);
      world.registerSystem(SunsetSystem);
      world.registerSystem(HudSystem);
      world.registerSystem(PluginSystem);
      world.registerSystem(VoiceSystem);
    } else if (cutoutSpike) {
      world.registerSystem(HudSystem);
      world.registerSystem(CutoutSpikeSystem);
    } else if (roomSpike) {
      world.registerSystem(HudSystem);
      world.registerSystem(RoomSpikeSystem);
      world.registerSystem(ManualCalibrationSystem);
    } else if (roomBuild || product) {
      world.registerSystem(HudSystem);
      world.registerSystem(GarageBuildSystem);
      world.registerSystem(RevealSystem);
      if (product) world.registerSystem(AppFlowSystem);
      world.registerSystem(TableConfirmSystem);
      world.registerSystem(WristMenuSystem);
      world.registerSystem(DeviceSystem);
      world.registerSystem(ManualCalibrationSystem);
      world.registerSystem(PaperSystem);
      world.registerSystem(StreamSystem);
      world.registerSystem(TaskBoardSystem);
      world.registerSystem(FocusSystem);
      world.registerSystem(PluginSystem);
      world.registerSystem(EnvironmentSystem);
      world.registerSystem(VoiceSystem);
      world.registerSystem(NudgeSystem);
      world.registerSystem(WhiteboardSystem);
    } else {
      world.registerSystem(HudSystem);
    }
  }).catch(error => {
    console.error(error);
    document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;top:0;left:0;background:#300;color:white;padding:1rem">Garage Jam could not start: ${String(error)}</pre>`);
  });
}

if (testHub) renderTestHub();
else startApp();
