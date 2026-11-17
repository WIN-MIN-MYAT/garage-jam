import { randomUUID } from 'node:crypto';
import { readJson, writeJson } from './store.js';

const file = 'tasks-local.json';
const maxTasks = 100;

export function isLocalTaskId(id) {
  return typeof id === 'string' && id.startsWith('local-');
}

export async function listLocalTasks() {
  return await readJson(file, []);
}

export async function createLocalTask(title, extra = {}) {
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 200) {
    throw new Error('Task title must be 1-200 characters');
  }
  const tasks = await listLocalTasks();
  const task = {
    id: `local-${randomUUID()}`,
    title: title.trim(),
    priority: typeof extra.priority === 'string' ? extra.priority.slice(0, 16) : null,
    due: typeof extra.due === 'string' ? extra.due.slice(0, 32) : null,
    source: 'local',
    createdAt: new Date().toISOString(),
  };
  tasks.push(task);
  await writeJson(file, tasks.slice(-maxTasks));
  return task;
}

export async function completeLocalTask(id) {
  if (!isLocalTaskId(id)) throw new Error('Not a local task');
  const tasks = await listLocalTasks();
  const next = tasks.filter(task => task.id !== id);
  await writeJson(file, next);
  return { synced: true, removed: next.length !== tasks.length };
}

export async function clearLocalTasks() {
  await writeJson(file, []);
}
