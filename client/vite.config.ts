/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import fs from 'node:fs';
import path from 'node:path';

const assetRoot = path.resolve(import.meta.dirname, '../assets');
const assetMimeTypes: Record<string, string> = { '.json': 'application/json', '.glb': 'model/gltf-binary', '.ogg': 'audio/ogg', '.ttf': 'font/ttf', '.webp': 'image/webp' };
const assetsPlugin = {
  name: 'garage-assets',
  configureServer(server: any) {
    server.middlewares.use('/assets', (req: any, res: any, next: any) => {
      const file = path.resolve(assetRoot, '.' + decodeURIComponent(req.url || '/'));
      if (!file.startsWith(assetRoot + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
      res.setHeader('Content-Type', assetMimeTypes[path.extname(file)] ?? 'application/octet-stream');
      fs.createReadStream(file).pipe(res);
    });
  },
  closeBundle() {
    // Raw models are source assets for the optimization step, not runtime files.
    const rawModels = path.join(assetRoot, 'models', 'raw');
    fs.cpSync(assetRoot, path.resolve(import.meta.dirname, 'dist/assets'), {
      recursive: true,
      filter: source => !source.startsWith(rawModels),
    });
  },
};

const httpMode = process.env.GARAGE_HTTP === '1';

export default defineConfig({
  plugins: [httpMode ? null : basicSsl(), assetsPlugin, iwsdkDev(httpMode ? { https: false } : {})].filter(Boolean),
  server: { host: '0.0.0.0', port: 8091, open: false, proxy: {
    '/api': { target: 'http://localhost:8082', xfwd: true },
    '/signal': { target: 'ws://localhost:8082', ws: true, xfwd: true },
    '/sender': { target: 'http://localhost:8082', xfwd: true },
    '/sender.js': { target: 'http://localhost:8082', xfwd: true },
    '/sender-timecode.js': { target: 'http://localhost:8082', xfwd: true },
    '/voice': { target: 'http://localhost:8082', xfwd: true },
    '/stream-shared': { target: 'http://localhost:8082', xfwd: true },
    '/health': { target: 'http://localhost:8082', xfwd: true },
  } },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (its own three vs the app's super-three alias). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
