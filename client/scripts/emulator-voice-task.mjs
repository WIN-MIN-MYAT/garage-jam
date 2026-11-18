import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.GARAGE_TEST_URL ?? 'https://localhost:8091';
const browser = await chromium.launch({
  headless: true,
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  args: ['--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required'],
});

const fakeSpeech = transcript => {
  window.SpeechRecognition = class {
    start() {
      this.onstart?.();
      window.setTimeout(() => {
        this.onresult?.({ results: [[{ transcript }]] });
        this.onend?.();
      }, 180);
    }
  };
  window.webkitSpeechRecognition = window.SpeechRecognition;
};

const enterDemo = async page => {
  await page.waitForFunction(() => window.IWER_DEVICE && window.garageVoiceDebug && window.garageBuildDebug, null, { timeout: 30000 });
  const badge = page.locator('#garage-test-badge');
  if (await badge.count()) await badge.click();
  await page.waitForFunction(() => window.garageBuildDebug?.ready, null, { timeout: 30000 });
  await page.waitForFunction(() => window.garageDebug?.papers, null, { timeout: 20000 });
  await page.waitForTimeout(700);
};

try {
  // 1. In-browser voice path (desktop Chrome) creates a paper.
  const supported = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  supported.setDefaultTimeout(30000);
  await supported.addInitScript(fakeSpeech, 'add task Voice QA task');
  const posts = [];
  const serverTasks = [{ id: 'voice-base-1', title: 'Base task', priority: null, due: null, source: 'local', starter: true }];
  await supported.route('**/api/tasks', async route => {
    if (route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'voice-qa-1', title: posts.at(-1).title, target: 'local' }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ tasks: serverTasks, offline: false, notion: { configured: true } }),
    });
  });
  await supported.goto(`${base}/?roomBuild=1&roomSource=demo&revealOff=1`, { waitUntil: 'domcontentloaded' });
  await enterDemo(supported);
  const before = await supported.evaluate(() => window.garageDebug.papers().length);
  await supported.evaluate(() => window.garageVoiceDebug.start());
  await supported.waitForFunction(previous => window.garageDebug.papers().length > previous, before, { timeout: 15000 });
  const afterVoice = await supported.evaluate(() => window.garageDebug.papers());
  console.log(JSON.stringify({ browserVoice: { before, afterVoice, posts } }, null, 2));
  assert.equal(posts.length, 1, 'voice path did not POST a task');
  assert.equal(posts[0].title, 'Voice QA task');
  assert.equal(afterVoice.length, before + 1, 'voice task did not become a paper');

  // 2. A phone-created task is picked up by the garage polling loop.
  serverTasks.push({ id: 'phone-remote-1', title: 'Phone remote task', priority: null, due: null, source: 'local', starter: true });
  await supported.waitForFunction(previous => window.garageDebug.papers().length > previous, afterVoice.length, { timeout: 20000 });
  const afterPhone = await supported.evaluate(() => window.garageDebug.papers());
  console.log(JSON.stringify({ phonePolling: { afterPhone } }, null, 2));
  assert.ok(afterPhone.some(paper => paper.id === 'phone-remote-1'), 'phone task did not sync into the garage');

  // 3. The phone page itself: speech starts the capture and posts a task.
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  phone.setDefaultTimeout(30000);
  await phone.addInitScript(fakeSpeech, 'add task Phone QA task');
  const phonePosts = [];
  await phone.route('**/api/tasks', async route => {
    if (route.request().method() === 'POST') {
      phonePosts.push(route.request().postDataJSON());
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'phone-qa-1', title: phonePosts.at(-1).title, target: 'notion' }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [], offline: false }) });
  });
  await phone.goto(`${base}/voice`, { waitUntil: 'domcontentloaded' });
  await phone.waitForSelector('#mic:not([hidden])');
  await phone.click('#mic');
  await phone.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('Added'), null, { timeout: 10000 });
  const phoneState = await phone.evaluate(() => ({
    status: document.querySelector('#status').textContent,
    input: document.querySelector('#title').value,
    mic: document.querySelector('#mic').textContent,
  }));
  console.log(JSON.stringify({ phone: { posts: phonePosts, state: phoneState } }, null, 2));
  assert.equal(phonePosts.length, 1, 'phone voice path did not POST');
  assert.equal(phonePosts[0].title, 'Phone QA task');
  assert.equal(phonePosts[0].target, undefined, 'phone voice must let the server choose Notion/local');
  assert.match(phoneState.status, /Added/);
  assert.equal(phoneState.input, '');
  await phone.screenshot({ path: 'screenshots/qa/51-voice-task-phone.png' });
  await phone.close();

  // 4. The phone page also works as a plain typed form when speech is absent.
  const typed = await browser.newPage({ viewport: { width: 390, height: 844 } });
  typed.setDefaultTimeout(30000);
  await typed.addInitScript(() => {
    window.SpeechRecognition = undefined;
    window.webkitSpeechRecognition = undefined;
  });
  const typedPosts = [];
  await typed.route('**/api/tasks', async route => {
    if (route.request().method() === 'POST') {
      typedPosts.push(route.request().postDataJSON());
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'typed-qa-1', title: typedPosts.at(-1).title, target: 'local' }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: [], offline: false }) });
  });
  await typed.goto(`${base}/voice`, { waitUntil: 'domcontentloaded' });
  await typed.waitForFunction(() => document.querySelector('#mic')?.hidden === true);
  await typed.fill('#title', 'Typed QA task');
  await typed.click('.add');
  await typed.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('Added'), null, { timeout: 10000 });
  assert.equal(typedPosts.length, 1, 'typed phone path did not POST');
  assert.equal(typedPosts[0].title, 'Typed QA task');
  await typed.close();

  // 5. Without SpeechRecognition (Quest Browser), the headset does not silently fail.
  const unsupported = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  unsupported.setDefaultTimeout(30000);
  await unsupported.addInitScript(() => {
    window.SpeechRecognition = undefined;
    window.webkitSpeechRecognition = undefined;
  });
  let unsupportedPosts = 0;
  await unsupported.route('**/api/tasks', async route => {
    if (route.request().method() === 'POST') { unsupportedPosts++; await route.continue(); return; }
    await route.continue();
  });
  await unsupported.goto(`${base}/?roomBuild=1&roomSource=demo&revealOff=1`, { waitUntil: 'domcontentloaded' });
  await enterDemo(unsupported);
  const unsupportedBefore = await unsupported.evaluate(() => window.garageDebug.papers().length);
  await unsupported.evaluate(() => window.garageVoiceDebug.start());
  await unsupported.waitForTimeout(1200);
  const unsupportedAfter = await unsupported.evaluate(() => ({
    papers: window.garageDebug.papers().length,
    listening: window.garageVoiceDebug.listening,
  }));
  console.log(JSON.stringify({ unsupported: { before: unsupportedBefore, after: unsupportedAfter, posts: unsupportedPosts } }, null, 2));
  assert.equal(unsupportedPosts, 0, 'unsupported browser still posted a task');
  assert.equal(unsupportedAfter.papers, unsupportedBefore, 'unsupported browser created a paper');
  assert.equal(unsupportedAfter.listening, false);
  await unsupported.close();
} finally {
  await browser.close();
}
