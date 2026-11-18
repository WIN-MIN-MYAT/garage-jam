import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.GARAGE_TEST_URL ?? 'https://localhost:8091';
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'],
});

const close = (a, b) => Math.abs(a - b) < 1e-5;
const expectedPose = placement => {
  const yaw = placement.yaw ?? 0;
  return {
    x: placement.x + Math.sin(yaw) * 0.12,
    y: placement.y + 0.15,
    z: placement.z + Math.cos(yaw) * 0.12,
  };
};
const assertPose = (audio, label) => {
  const wanted = expectedPose(audio.placement);
  const [x, y, z] = audio.musicPosition;
  assert.ok(close(x, wanted.x), `${label}: x ${x} != ${wanted.x}`);
  assert.ok(close(y, wanted.y), `${label}: y ${y} != ${wanted.y}`);
  assert.ok(close(z, wanted.z), `${label}: z ${z} != ${wanted.z}`);
  const [fx, , fz] = audio.musicFacing;
  assert.ok(close(fx, Math.sin(audio.placement.yaw)), `${label}: facing x ${fx}`);
  assert.ok(close(fz, Math.cos(audio.placement.yaw)), `${label}: facing z ${fz}`);
};

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => {
    if (message.type() !== 'error') return;
    if (message.text().includes('No supported keysystem was found')) return;
    if (message.text().includes('SSL certificate error')) return;
    errors.push(message.text());
  });

  await page.goto(`${base}/?roomBuild=1&roomSource=demo&revealOff=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.IWER_DEVICE && window.garagePluginDebug, null, { timeout: 30000 });
  const badge = page.locator('#garage-test-badge');
  if (await badge.count()) await badge.click();
  await page.waitForFunction(() => window.garageBuildDebug?.ready, null, { timeout: 30000 });
  await page.waitForTimeout(600);

  const first = await page.evaluate(() => window.garagePluginDebug.speakerPose());
  assert.ok(first.placement, 'boombox placement missing');
  assert.ok(first.speakerUuid, 'boombox mesh missing from the scene');
  assertPose(first, 'initial');

  // Move the logical boombox placement and verify the audio pose follows.
  const moved = await page.evaluate(() => {
    const placement = window.garageBuildDebug.placements.find(item => item.slotId === 'boombox');
    placement.position.x += 0.75;
    return window.garagePluginDebug.speakerPose();
  });
  assertPose(moved, 'moved placement');
  assert.ok(Math.abs(moved.musicPosition[0] - first.musicPosition[0]) > 0.5, 'audio did not move with the boombox');

  // A real rearrange rebuilds every prop, including the boombox mesh. The
  // audio pose must resolve the replacement, not keep the disposed object.
  await page.evaluate(() => window.garageBuildDebug.rearrange());
  await page.waitForFunction(previous => window.garagePluginDebug.audio.speakerUuid !== previous, first.speakerUuid, { timeout: 30000 });
  await page.waitForTimeout(500);
  const rebuilt = await page.evaluate(() => window.garagePluginDebug.speakerPose());
  assert.ok(rebuilt.placement, 'boombox placement missing after rearrange');
  assert.ok(rebuilt.speakerUuid && rebuilt.speakerUuid !== first.speakerUuid, 'boombox mesh was not rebuilt');
  assertPose(rebuilt, 'rearranged');

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ first, moved, rebuilt, errors }, null, 2));
} finally {
  await browser.close();
}
