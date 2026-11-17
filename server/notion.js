import { readJson, writeJson } from './store.js';

const prop = {
  name: process.env.NOTION_NAME_PROPERTY || 'Name',
  status: process.env.NOTION_STATUS_PROPERTY || 'Status',
  priority: process.env.NOTION_PRIORITY_PROPERTY || 'Priority',
  due: process.env.NOTION_DUE_PROPERTY || 'Due',
};
const api = 'https://api.notion.com/v1';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const validId = id => /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i.test(id);

async function request(path, method, body, retry = true) {
  if (!process.env.NOTION_TOKEN || !process.env.NOTION_DATABASE_ID) throw new Error('Notion is not configured');
  const response = await fetch(`${api}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.NOTION_TOKEN}`, 'Notion-Version': process.env.NOTION_VERSION || '2022-06-28', 'Content-Type': 'application/json' },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 429 && retry) {
    const seconds = Number(response.headers.get('retry-after'));
    await delay(Math.min(Number.isFinite(seconds) ? seconds * 1000 : 1000, 10000));
    return request(path, method, body, false);
  }
  if (!response.ok) throw new Error(`Notion ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json();
}

function mapPage(page) {
  const fields = page.properties || {};
  return {
    id: page.id,
    title: (fields[prop.name]?.title || []).map(part => part.plain_text || part.text?.content || '').join('') || '(untitled)',
    priority: fields[prop.priority]?.select?.name || null,
    due: fields[prop.due]?.date?.start || null,
  };
}

export async function listTasks() {
  try {
    const tasks = [];
    let cursor;
    do {
      const page = await request(`/databases/${process.env.NOTION_DATABASE_ID}/query`, 'POST', {
        filter: { property: prop.status, status: { does_not_equal: 'Done' } },
        page_size: 30,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      tasks.push(...page.results.map(mapPage));
      cursor = page.has_more ? page.next_cursor : null;
    } while (cursor && tasks.length < 30);
    const result = tasks.slice(0, 30);
    await writeJson('tasks-cache.json', result);
    return { tasks: result, offline: false };
  } catch (error) {
    return { tasks: await readJson('tasks-cache.json', []), offline: true, message: error.message };
  }
}

async function markDoneRemote(id) {
  if (!validId(id)) throw new Error('Invalid Notion page ID');
  await request(`/pages/${id}`, 'PATCH', { properties: { [prop.status]: { status: { name: 'Done' } } } });
}
export async function markDone(id) {
  if (!validId(id)) throw new Error('Invalid Notion page ID');
  let synced = false, message;
  try {
    try { await markDoneRemote(id); }
    catch { await delay(500); await markDoneRemote(id); }
    synced = true;
  } catch (error) {
    message = error.message;
    const queue = await readJson('done-queue.json', []);
    if (!queue.includes(id)) queue.push(id);
    await writeJson('done-queue.json', queue);
  }
  const cached = await readJson('tasks-cache.json', []);
  await writeJson('tasks-cache.json', cached.filter(task => task.id !== id));
  return { synced, queued: !synced, ...(message ? { message } : {}) };
}
export async function flushDoneQueue() {
  const queue = await readJson('done-queue.json', []);
  const failed = [];
  for (const id of queue) {
    try { await markDoneRemote(id); }
    catch { failed.push(id); }
  }
  await writeJson('done-queue.json', failed);
}
export async function createTask(title) {
  if (typeof title !== 'string' || !title.trim() || title.length > 200) throw new Error('Task title must be 1-200 characters');
  const page = await request('/pages', 'POST', {
    parent: { database_id: process.env.NOTION_DATABASE_ID },
    properties: {
      [prop.name]: { title: [{ text: { content: title.trim() } }] },
      [prop.status]: { status: { name: 'Not started' } },
    },
  });
  return mapPage(page);
}
