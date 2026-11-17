export type CapabilityState = 'pass' | 'warn' | 'fail' | 'info';
export type Capability = { id: string; label: string; state: CapabilityState; detail: string };

type LandingOptions = {
  resume: boolean;
  roomSummary: string;
  entering?: boolean;
};

const rootId = 'gj-landing';
const enteringId = 'gj-entering';
const enterHandlers: Array<() => void> = [];
const recheckHandlers: Array<() => void> = [];
let lastOptions: LandingOptions = { resume: false, roomSummary: '' };

function uaIsQuestBrowser() {
  return /OculusBrowser/i.test(navigator.userAgent);
}

function uaIsQuest2() {
  return /Quest 2/i.test(navigator.userAgent);
}

function uaIsQuest3() {
  return /Quest 3S/i.test(navigator.userAgent) || /Quest 3/i.test(navigator.userAgent);
}

export async function checkCapabilities(): Promise<Capability[]> {
  const items: Capability[] = [];
  const xr = (navigator as any).xr as XRSystem | undefined;
  items.push({ id: 'webxr', label: 'WebXR', state: xr ? 'pass' : 'fail', detail: xr ? 'Available' : 'Open this page in Meta Quest Browser' });
  let arSupported = false;
  if (xr?.isSessionSupported) {
    try { arSupported = await xr.isSessionSupported('immersive-ar'); } catch { arSupported = false; }
  }
  items.push({
    id: 'ar',
    label: 'Immersive AR',
    state: arSupported ? 'pass' : 'fail',
    detail: arSupported ? 'Session supported' : 'Passthrough AR is unavailable in this browser',
  });
  items.push({
    id: 'room',
    label: 'Room data',
    state: arSupported ? 'info' : 'warn',
    detail: arSupported ? 'Plane + anchor access requested at entry' : 'Requires an immersive-ar session',
  });
  items.push({
    id: 'webrtc',
    label: 'Streaming',
    state: typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices?.getUserMedia ? 'pass' : 'warn',
    detail: typeof RTCPeerConnection !== 'undefined' ? 'WebRTC ready' : 'Streaming mode will be unavailable',
  });
  items.push({
    id: 'audio',
    label: 'Spatial audio',
    state: typeof AudioContext !== 'undefined' ? 'pass' : 'warn',
    detail: typeof AudioContext !== 'undefined' ? 'Starts after Enter' : 'Audio is unavailable',
  });
  const questState: CapabilityState = uaIsQuest2() ? 'fail' : uaIsQuestBrowser() && uaIsQuest3() ? 'pass' : 'warn';
  const browserVersion = navigator.userAgent.match(/OculusBrowser\/([\d.]+)/i)?.[1];
  items.push({
    id: 'quest',
    label: 'Headset',
    state: questState,
    detail: uaIsQuest2() ? 'Quest 2 is not supported'
      : uaIsQuest3() ? `Quest 3 / 3S · Browser ${browserVersion ?? 'detected'}`
      : 'Quest 3 or 3S required for the full experience',
  });
  return items;
}

function capabilityMarkup(items: Capability[]) {
  return items.map(item => `
    <li class="gj-cap gj-cap-${item.state}">
      <span class="gj-cap-dot"></span>
      <span class="gj-cap-label">${item.label}</span>
      <span class="gj-cap-detail">${item.detail}</span>
    </li>`).join('');
}

function shellMarkup(options: LandingOptions) {
  const resume = options.resume;
  return `
    <div class="gj-backdrop" aria-hidden="true"></div>
    <main class="gj-shell">
      <section class="gj-hero">
        <div class="gj-hero-copy">
          <div class="gj-kicker">MIXED REALITY WORKSPACE</div>
          <h1 class="gj-title"><span>GARAGE</span><span class="gj-title-jam">JAM</span></h1>
          <p class="gj-lede">Your real table. Your real room. A golden-hour garage built right on top of it.</p>
          <div class="gj-hero-actions">
            <button id="gj-enter" class="gj-enter" type="button">${resume ? 'RESUME THE GARAGE' : 'ENTER THE GARAGE'}</button>
            <button id="gj-recheck" class="gj-recheck" type="button">RECHECK DEVICE</button>
          </div>
          <div id="gj-resume-line" class="gj-resume-line"${resume && options.roomSummary ? '' : ' hidden'}>LAST ROOM · ${options.roomSummary}</div>
          <div class="gj-account">No account needed.</div>
        </div>
        <div class="gj-poster" aria-hidden="true">
          <div class="gj-poster-sun"></div>
          <div class="gj-poster-beam"></div>
          <div class="gj-poster-frame"></div>
          <div class="gj-poster-floor"></div>
          <div class="gj-poster-table">
            <div class="gj-poster-leg left"></div>
            <div class="gj-poster-leg right"></div>
          </div>
          <div class="gj-poster-lamp"></div>
          <div class="gj-poster-tag">BUILD 03</div>
        </div>
      </section>

      <section class="gj-steps" aria-label="Setup tips">
        <div class="gj-step"><span>01</span><strong>Sit at your table</strong><em>The workbench locks to it.</em></div>
        <div class="gj-step"><span>02</span><strong>Clear a little space</strong><em>An arm's reach is enough.</em></div>
        <div class="gj-step"><span>03</span><strong>Bring your laptop</strong><em>Use passthrough or stream it in.</em></div>
      </section>

      <section class="gj-checks">
        <div class="gj-checks-head">
          <div>
            <div class="gj-kicker">PRE-FLIGHT</div>
            <h2>Device check</h2>
          </div>
          <div id="gj-check-state" class="gj-check-state">checking…</div>
        </div>
        <ul id="gj-capabilities" class="gj-cap-list">
          <li class="gj-cap gj-cap-info"><span class="gj-cap-dot"></span><span class="gj-cap-label">Checking</span><span class="gj-cap-detail">Reading browser capabilities…</span></li>
        </ul>
        <div id="gj-landing-error" class="gj-error" hidden></div>
        <div class="gj-foot">
          <span>Quest 3 or 3S required</span>
          <span>72 Hz target · Passthrough first</span>
        </div>
      </section>
    </main>`;
}

function ensureLanding() {
  let root = document.getElementById(rootId) as HTMLDivElement | null;
  if (root) return root;
  root = document.createElement('div');
  root.id = rootId;
  root.dataset.visible = 'true';
  const style = document.createElement('style');
  style.textContent = `
    #${rootId} { position: fixed; inset: 0; z-index: 9000; overflow: auto; background: #101116; color: #f1eadc; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    #${rootId} * { box-sizing: border-box; }
    #${rootId} .gj-backdrop { position: fixed; inset: 0; pointer-events: none; background:
      radial-gradient(circle at 82% 18%, rgba(255, 61, 159, .16), transparent 34%),
      radial-gradient(circle at 12% 78%, rgba(24, 227, 255, .10), transparent 32%),
      repeating-linear-gradient(115deg, rgba(255,255,255,.025) 0 1px, transparent 1px 13px),
      radial-gradient(rgba(255,255,255,.10) .7px, transparent .8px) 0 0 / 7px 7px,
      #101116; }
    #${rootId} .gj-shell { position: relative; width: min(1240px, calc(100% - 32px)); margin: 0 auto; padding: 30px 0 44px; }
    #${rootId} .gj-hero { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(280px, .85fr); gap: 26px; align-items: stretch; min-height: 420px; }
    #${rootId} .gj-hero-copy { display: flex; flex-direction: column; justify-content: center; padding: 26px 8px 20px; }
    #${rootId} .gj-kicker { color: #ff3d9f; font-size: 12px; font-weight: 900; letter-spacing: .22em; }
    #${rootId} .gj-title { display: flex; flex-direction: column; margin: 12px 0 16px; font-family: GarageDisplay, "Arial Black", Impact, sans-serif; font-size: clamp(72px, 11vw, 150px); font-weight: 900; line-height: .78; letter-spacing: -.01em; text-transform: uppercase; color: #e8ff2a; text-shadow: 7px 7px 0 #0b0b0e, -2px -2px 0 #0b0b0e, 2px -2px 0 #0b0b0e, -2px 2px 0 #0b0b0e; }
    #${rootId} .gj-title-jam { color: #ff3d9f; margin-left: clamp(34px, 9vw, 150px); }
    #${rootId} .gj-lede { max-width: 560px; margin: 0; color: #d7d0c1; font-size: clamp(16px, 2vw, 21px); line-height: 1.5; }
    #${rootId} .gj-hero-actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-top: 26px; }
    #${rootId} .gj-enter { border: 3px solid #0b0b0e; border-radius: 5px; background: #e8ff2a; color: #101116; box-shadow: 8px 8px 0 #0b0b0e; padding: 18px 26px; font: 900 20px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .04em; cursor: pointer; transition: transform .14s ease, box-shadow .14s ease, background .14s ease; }
    #${rootId} .gj-enter:hover:not(:disabled) { transform: translate(-2px, -2px); box-shadow: 11px 11px 0 #0b0b0e; background: #f1ff63; }
    #${rootId} .gj-enter:disabled { cursor: wait; background: #5b6044; color: #b9b3a7; box-shadow: 5px 5px 0 #0b0b0e; }
    #${rootId} .gj-recheck { border: 2px solid #353946; border-radius: 5px; background: #1a1c24; color: #d7d0c1; padding: 15px 17px; font: 800 13px/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .08em; cursor: pointer; }
    #${rootId} .gj-recheck:hover { border-color: #19e3ff; color: #19e3ff; }
    #${rootId} .gj-resume-line { margin-top: 14px; color: #19e3ff; font-size: 13px; font-weight: 800; letter-spacing: .10em; }
    #${rootId} .gj-account { margin-top: 14px; color: #8c94a5; font-size: 13px; }
    #${rootId} .gj-poster { position: relative; min-height: 390px; overflow: hidden; border: 3px solid #0b0b0e; border-radius: 6px; background: linear-gradient(180deg, #302244 0%, #a64b4b 54%, #f2a24f 100%); box-shadow: 10px 10px 0 #0b0b0e; }
    #${rootId} .gj-poster::after { content: ""; position: absolute; inset: 0; background: radial-gradient(rgba(16,17,22,.34) .8px, transparent .9px) 0 0 / 6px 6px; mix-blend-mode: multiply; }
    #${rootId} .gj-poster-sun { position: absolute; right: 13%; top: 21%; width: 34%; aspect-ratio: 1; border-radius: 50%; background: #ffe7a8; box-shadow: 0 0 0 18px rgba(255,231,168,.12), 0 0 70px rgba(255,185,94,.62); }
    #${rootId} .gj-poster-frame { position: absolute; left: 8%; top: 7%; width: 74%; height: 76%; border: 18px solid #16131a; border-bottom-width: 10px; background: linear-gradient(180deg, rgba(47,35,68,.05), rgba(42,27,31,.30)); }
    #${rootId} .gj-poster-frame::before, #${rootId} .gj-poster-frame::after { content: ""; position: absolute; top: 0; bottom: 0; width: 8px; background: #23202a; }
    #${rootId} .gj-poster-frame::before { left: 31%; } #${rootId} .gj-poster-frame::after { right: 31%; }
    #${rootId} .gj-poster-beam { position: absolute; left: 12%; bottom: 12%; width: 58%; height: 44%; background: linear-gradient(15deg, rgba(255,196,112,.34), transparent 70%); clip-path: polygon(0 100%, 68% 100%, 100% 0, 28% 0); }
    #${rootId} .gj-poster-floor { position: absolute; inset: auto 0 0; height: 21%; background: #24232a; border-top: 8px solid #0b0b0e; }
    #${rootId} .gj-poster-table { position: absolute; left: 24%; bottom: 21%; width: 48%; height: 11%; border: 6px solid #0b0b0e; background: #84583b; transform: skewY(-2deg); }
    #${rootId} .gj-poster-leg { position: absolute; top: 100%; width: 8%; height: 120%; background: #3c2b22; border: 4px solid #0b0b0e; }
    #${rootId} .gj-poster-leg.left { left: 12%; } #${rootId} .gj-poster-leg.right { right: 12%; }
    #${rootId} .gj-poster-lamp { position: absolute; left: 18%; top: 10%; width: 14%; height: 4%; background: #0b0b0e; box-shadow: 0 10px 26px rgba(255,231,168,.65); }
    #${rootId} .gj-poster-lamp::after { content: ""; position: absolute; left: 38%; top: 100%; width: 24%; height: 38px; background: #ffe7a8; clip-path: polygon(50% 100%, 0 0, 100% 0); }
    #${rootId} .gj-poster-tag { position: absolute; right: 12px; bottom: 12px; z-index: 2; background: #19e3ff; color: #101116; padding: 6px 9px; font-size: 11px; font-weight: 900; letter-spacing: .12em; transform: rotate(-2deg); }
    #${rootId} .gj-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-top: 22px; }
    #${rootId} .gj-step { display: grid; grid-template-columns: 44px minmax(0, 1fr); grid-template-rows: auto auto; gap: 0 12px; align-items: center; padding: 14px 15px; border: 2px solid #2a2d37; border-radius: 5px; background: rgba(26,28,36,.86); }
    #${rootId} .gj-step > span { grid-row: 1 / 3; color: #ff3d9f; font-family: GarageDisplay, Impact, sans-serif; font-size: 32px; line-height: 1; }
    #${rootId} .gj-step strong { font-size: 15px; color: #f1eadc; }
    #${rootId} .gj-step em { font-style: normal; color: #8c94a5; font-size: 12px; margin-top: 3px; }
    #${rootId} .gj-checks { margin-top: 24px; border: 2px solid #2a2d37; border-radius: 6px; background: #16181f; padding: 18px 20px; }
    #${rootId} .gj-checks-head { display: flex; justify-content: space-between; gap: 16px; align-items: flex-end; }
    #${rootId} .gj-checks h2 { margin: 6px 0 0; font-size: 26px; color: #f1eadc; letter-spacing: -.02em; }
    #${rootId} .gj-check-state { color: #8c94a5; font-size: 12px; font-weight: 800; letter-spacing: .10em; text-transform: uppercase; }
    #${rootId} .gj-cap-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 7px 18px; list-style: none; padding: 0; margin: 16px 0 0; }
    #${rootId} .gj-cap { display: grid; grid-template-columns: 10px 110px minmax(0, 1fr); gap: 9px; align-items: center; min-height: 28px; font-size: 13px; }
    #${rootId} .gj-cap-dot { width: 8px; height: 8px; border-radius: 50%; background: #8c94a5; box-shadow: 0 0 0 3px rgba(140,148,165,.12); }
    #${rootId} .gj-cap-pass .gj-cap-dot { background: #69f0ae; box-shadow: 0 0 0 3px rgba(105,240,174,.14); }
    #${rootId} .gj-cap-warn .gj-cap-dot { background: #ffb84d; box-shadow: 0 0 0 3px rgba(255,184,77,.14); }
    #${rootId} .gj-cap-fail .gj-cap-dot { background: #ff3d9f; box-shadow: 0 0 0 3px rgba(255,61,159,.14); }
    #${rootId} .gj-cap-info .gj-cap-dot { background: #19e3ff; box-shadow: 0 0 0 3px rgba(24,227,255,.12); }
    #${rootId} .gj-cap-label { color: #f1eadc; }
    #${rootId} .gj-cap-detail { color: #8c94a5; }
    #${rootId} .gj-error { margin-top: 14px; border-left: 3px solid #ff3d9f; background: rgba(255,61,159,.08); padding: 10px 12px; color: #ffd1e7; font-size: 13px; line-height: 1.45; }
    #${rootId} .gj-foot { display: flex; justify-content: space-between; gap: 12px; margin-top: 16px; padding-top: 13px; border-top: 1px solid #2a2d37; color: #6f7787; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; }
    #${rootId}[data-visible="false"] { display: none; }
    #${enteringId} { position: fixed; inset: 0; z-index: 9500; display: grid; place-items: center; background: #101116; color: #f1eadc; font-family: ui-sans-serif, system-ui, sans-serif; }
    #${enteringId}[hidden] { display: none; }
    #${enteringId} .gj-enter-card { text-align: center; }
    #${enteringId} .gj-enter-word { font-family: GarageDisplay, Impact, sans-serif; font-size: clamp(48px, 10vw, 110px); line-height: .85; color: #e8ff2a; text-shadow: 6px 6px 0 #000; letter-spacing: .02em; }
    #${enteringId} .gj-enter-dots { margin-top: 18px; color: #ff3d9f; font-size: 24px; letter-spacing: .28em; font-weight: 900; }
    #${enteringId} .gj-enter-sub { margin-top: 20px; color: #8c94a5; font-size: 14px; letter-spacing: .08em; text-transform: uppercase; }
    @media (max-width: 860px) { #${rootId} .gj-hero { grid-template-columns: 1fr; } #${rootId} .gj-poster { min-height: 280px; } #${rootId} .gj-steps { grid-template-columns: 1fr; } #${rootId} .gj-foot { flex-direction: column; } }
  `;
  const landing = document.createElement('div');
  landing.innerHTML = shellMarkup(lastOptions);
  root.append(style, landing);
  document.body.append(root);
  root.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    if (target.closest('#gj-enter')) enterHandlers.forEach(handler => handler());
    if (target.closest('#gj-recheck')) recheckHandlers.forEach(handler => handler());
  });
  void refreshCapabilities();
  return root;
}

export async function refreshCapabilities() {
  const list = document.getElementById('gj-capabilities');
  if (!list) return;
  const items = await checkCapabilities();
  list.innerHTML = capabilityMarkup(items);
  const ar = items.find(item => item.id === 'ar');
  const quest = items.find(item => item.id === 'quest');
  const enter = document.getElementById('gj-enter') as HTMLButtonElement | null;
  const state = document.getElementById('gj-check-state');
  const supported = ar?.state === 'pass' && quest?.state !== 'fail';
  if (enter) enter.disabled = !supported;
  if (state) state.textContent = supported ? 'ready' : ar?.state === 'fail' ? 'not available' : 'check browser';
}

export function renderLanding(options: LandingOptions) {
  lastOptions = options;
  const root = ensureLanding();
  const landing = root.firstElementChild?.nextElementSibling as HTMLElement | null;
  if (landing) landing.innerHTML = shellMarkup(options);
  root.dataset.visible = 'true';
  document.getElementById(enteringId)?.remove();
  void refreshCapabilities();
}

export function hideLanding() {
  const root = document.getElementById(rootId);
  if (root) root.dataset.visible = 'false';
  document.getElementById(enteringId)?.remove();
}

export function showLanding() {
  const root = document.getElementById(rootId);
  if (root) root.dataset.visible = 'true';
  document.getElementById(enteringId)?.remove();
}

export function showEntering() {
  hideLanding();
  let overlay = document.getElementById(enteringId);
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = enteringId;
    overlay.innerHTML = `
      <div class="gj-enter-card">
        <div class="gj-enter-word">ENTERING<br>THE GARAGE</div>
        <div class="gj-enter-dots">• • •</div>
        <div class="gj-enter-sub">Allowing passthrough · checking room</div>
      </div>`;
    document.body.append(overlay);
  }
}

export function showLandingError(message: string) {
  const error = document.getElementById('gj-landing-error');
  if (!error) return;
  error.hidden = false;
  error.textContent = message;
}

export function setLandingBusy(busy: boolean) {
  const enter = document.getElementById('gj-enter') as HTMLButtonElement | null;
  if (!enter) return;
  enter.disabled = busy;
  enter.textContent = busy ? 'STARTING…' : lastOptions.resume ? 'RESUME THE GARAGE' : 'ENTER THE GARAGE';
}

export function onEnter(handler: () => void) {
  enterHandlers.push(handler);
}

export function onRecheck(handler: () => void) {
  recheckHandlers.push(handler);
}

export function landingVisible() {
  return document.getElementById(rootId)?.getAttribute('data-visible') !== 'false';
}

export function ensureLandingMounted() {
  return ensureLanding();
}
