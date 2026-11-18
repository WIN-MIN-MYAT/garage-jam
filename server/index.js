import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { listTasks, markDone, createTask, flushDoneQueue } from './notion.js';
import { completeLocalTask, createLocalTask, isLocalTaskId, listLocalTasks } from './tasks.js';
import { readJson, writeJson } from './store.js';
import { attachSignaling, getSignalLog, validChannel } from './signaling.js';
import { createPluginRouter } from './plugins.js';

dotenv.config({ path: join(import.meta.dirname, '.env') });

const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: true }));
app.use(express.json({ limit: '100kb' }));
app.use('/api/plugins', createPluginRouter());
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/signal-log', (req, res) => res.json(getSignalLog(validChannel(req.query.channel) ? req.query.channel : undefined)));
app.get('/api/tasks', async (_req, res) => {
  try {
    const [notion, local] = await Promise.all([listTasks(), listLocalTasks()]);
    res.json({
      tasks: [...local, ...notion.tasks],
      offline: notion.offline,
      notion: { configured: !!process.env.NOTION_TOKEN && !!process.env.NOTION_DATABASE_ID, offline: notion.offline },
      ...(notion.message ? { message: notion.message } : {}),
    });
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.post('/api/tasks/:id/done', async (req, res) => {
  try {
    res.json(isLocalTaskId(req.params.id) ? await completeLocalTask(req.params.id) : await markDone(req.params.id));
  } catch (error) { res.status(400).json({ error: error.message }); }
});
app.post('/api/tasks', async (req, res) => {
  try {
    const title = req.body?.title;
    const notionReady = !!process.env.NOTION_TOKEN && !!process.env.NOTION_DATABASE_ID;
    const target = req.body?.target === 'notion' && notionReady ? 'notion'
      : (process.env.TASKS_SEND_TO ?? 'notion') !== 'local' && notionReady ? 'notion' : 'local';
    const task = target === 'notion' ? await createTask(title) : await createLocalTask(title, req.body);
    res.status(201).json({ ...task, target });
  }
  catch (error) { res.status(400).json({ error: error.message }); }
});
app.get('/api/state', async (_req, res) => {
  try {
    res.json(await readJson('state.json', { completedByDay: {}, focusMinutesByDay: {}, mural: [], pinned: [] }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.put('/api/state', async (req, res) => {
  try { await writeJson('state.json', req.body); res.json({ ok: true }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});
app.get('/sender', (_req, res) => res.sendFile(join(import.meta.dirname, '..', 'sender', 'sender.html')));
app.get('/sender.js', (_req, res) => res.sendFile(join(import.meta.dirname, '..', 'sender', 'sender.js')));
app.get('/sender/timecode', (_req, res) => res.sendFile(join(import.meta.dirname, '..', 'sender', 'timecode.html')));
app.get('/connect', (_req, res) => res.sendFile(join(import.meta.dirname, 'plugin-manager', 'connect.html')));
app.get('/voice', (_req, res) => res.sendFile(join(import.meta.dirname, 'voice', 'index.html')));
app.use('/voice', express.static(join(import.meta.dirname, 'voice'), { index: 'index.html' }));
app.get('/sender-timecode.js', (_req, res) => res.type('application/javascript').sendFile(join(import.meta.dirname, '..', 'sender', 'timecode.js')));
app.use('/stream-shared', express.static(join(import.meta.dirname, '..', 'client', 'src', 'stream-shared')));

// Production: one origin serves the built WebXR client, the sender page, the
// API and the signaling socket. Vite still serves the app on 8091 in development.
const clientDist = join(import.meta.dirname, '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist, {
    index: false,
    maxAge: '1h',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));
  app.get('*', (req, res, next) => {
    if (extname(req.path) || req.path.startsWith('/api/') || req.path.startsWith('/sender') ||
        req.path.startsWith('/connect') || req.path.startsWith('/voice') || req.path === '/signal' || req.path === '/health') return next();
    res.sendFile(join(clientDist, 'index.html'));
  });
}

const server = createServer(app);
attachSignaling(server);
if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT || 8082);
  server.listen(port, '0.0.0.0', () => console.log(`Garage Jam API and signaling on http://localhost:${port}`));
  flushDoneQueue().catch(error => console.warn('Queued Notion writes could not flush:', error.message));
}
export { app, server };
