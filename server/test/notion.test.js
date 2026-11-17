import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listTasks, markDone } from '../notion.js';
import { readJson, writeJson } from '../store.js';

test('Notion tasks are cached and fall back offline; Done retries a rate limit', async () => {
  const oldFetch = global.fetch;
  const oldToken = process.env.NOTION_TOKEN;
  const oldDatabase = process.env.NOTION_DATABASE_ID;
  const id = '12345678-1234-1234-1234-123456789abc';
  const oldCache = await readJson('tasks-cache.json', []);
  const oldQueue = await readJson('done-queue.json', []);
  process.env.NOTION_TOKEN = 'test'; process.env.NOTION_DATABASE_ID = id;
  let calls = 0;
  try {
    global.fetch = async (_url, options) => {
      calls++;
      if (options.method === 'PATCH' && calls === 2) return new Response('{}', { status: 429, headers: { 'retry-after': '0' } });
      if (options.method === 'PATCH') return new Response('{}', { status: 200 });
      return new Response(JSON.stringify({ results: [{ id, properties: { Name: { title: [{ plain_text: 'Ship demo' }] }, Status: { status: { name: 'Not started' } } } }], has_more: false }), { status: 200 });
    };
    const online = await listTasks();
    assert.equal(online.tasks[0].title, 'Ship demo');
    assert.equal(online.offline, false);
    global.fetch = async () => { throw new Error('unreachable'); };
    const offline = await listTasks();
    assert.equal(offline.offline, true);
    assert.equal(offline.tasks[0].title, 'Ship demo');
    calls = 1;
    global.fetch = async () => { calls++; return new Response('{}', { status: calls === 2 ? 429 : 200, headers: { 'retry-after': '0' } }); };
    const result = await markDone(id);
    assert.equal(result.synced, true);
    assert.equal(calls, 3);
  } finally {
    global.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.NOTION_TOKEN; else process.env.NOTION_TOKEN = oldToken;
    if (oldDatabase === undefined) delete process.env.NOTION_DATABASE_ID; else process.env.NOTION_DATABASE_ID = oldDatabase;
    await writeJson('tasks-cache.json', oldCache);
    await writeJson('done-queue.json', oldQueue);
  }
});
