import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export const dataDir = join(import.meta.dirname, 'data');
const writeQueues = new Map();
export async function readJson(name, fallback) {
  try { return JSON.parse(await readFile(join(dataDir, name), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export function writeJson(name, value) {
  const previous = writeQueues.get(name) ?? Promise.resolve();
  const next = previous.then(async () => {
    await mkdir(dataDir, { recursive: true });
    const target = join(dataDir, name);
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(value, null, 2));
    await rename(temp, target);
  });
  writeQueues.set(name, next.catch(() => undefined));
  return next;
}
