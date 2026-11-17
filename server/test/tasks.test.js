import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readJson, writeJson } from '../store.js';
import { completeLocalTask, createLocalTask, isLocalTaskId, listLocalTasks } from '../tasks.js';

const file = 'tasks-local.json';

test('local tasks are created, listed, completed and removed', async t => {
  const previous = await readJson(file, []);
  t.after(() => writeJson(file, previous));
  await writeJson(file, []);
  const first = await createLocalTask('  Ship the garage  ', { priority: 'High', due: '2026-11-20' });
  assert.ok(isLocalTaskId(first.id));
  assert.equal(first.title, 'Ship the garage');
  assert.equal(first.priority, 'High');
  assert.equal((await listLocalTasks()).length, 1);
  const second = await createLocalTask('Second task');
  assert.equal((await listLocalTasks()).length, 2);
  await assert.rejects(() => createLocalTask(''), /1-200/);
  await assert.rejects(() => createLocalTask('x'.repeat(201)), /1-200/);
  assert.deepEqual(await completeLocalTask(first.id), { synced: true, removed: true });
  const tasks = await listLocalTasks();
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, second.id);
  assert.equal((await readJson(file, [])).length, 1);
});

test('local task storage is capped and survives a fresh read', async t => {
  const previous = await readJson(file, []);
  t.after(() => writeJson(file, previous));
  await writeJson(file, []);
  for (let index = 0; index < 104; index++) await createLocalTask(`Task ${index}`);
  const tasks = await listLocalTasks();
  assert.equal(tasks.length, 100);
  assert.equal(tasks[0].title, 'Task 4');
  assert.equal(tasks.at(-1).title, 'Task 103');
});
