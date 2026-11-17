import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--ignore-certificate-errors'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const open = async query => {
    await page.goto(`https://localhost:8091/sender${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('.channel').length === 3);
  };
  const card = () => page.evaluate(() => {
    const element = document.querySelector('.channel');
    return {
      format: [...element.querySelectorAll('.format')].find(button => button.getAttribute('aria-pressed') === 'true')?.dataset.format,
      codec: element.querySelector('.codec').value,
      bitrate: element.querySelector('.bitrate').value,
      degradation: element.querySelector('.degradation').value,
      content: element.querySelector('.hint').value,
      auto: element.querySelector('.auto').checked,
      status: element.querySelector('.status').textContent,
      start: element.querySelector('.start').textContent,
    };
  });

  await open('');
  const defaults = await card();
  assert.equal(defaults.format, 'best');
  assert.equal(defaults.codec, 'av1');
  assert.equal(defaults.bitrate, '4');
  assert.equal(defaults.degradation, 'maintain-resolution');
  assert.equal(defaults.content, 'text');
  assert.equal(defaults.auto, false);
  assert.equal(defaults.status, 'Idle');
  assert.equal(defaults.start, 'Start streaming');

  await page.locator('.channel').first().locator('.format[data-format="lowLatency"]').click();
  const lowLatency = await card();
  assert.equal(lowLatency.format, 'lowLatency');
  assert.equal(lowLatency.bitrate, '2.5');
  assert.equal(lowLatency.degradation, 'maintain-framerate');
  assert.equal(lowLatency.content, 'motion');
  assert.equal(lowLatency.auto, false);

  await open('?preset=fast');
  assert.equal((await card()).format, 'lowLatency');
  await open('');
  await page.screenshot({ path: 'scripts/sender-ui.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Sender defaults, Best quality/Lowest latency formats, AV1 default and Auto quality off passed.');
} finally {
  await browser.close();
}
