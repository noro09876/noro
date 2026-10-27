import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = path.dirname(fileURLToPath(import.meta.url));
const api = `http://127.0.0.1:${process.env.PORT ?? 8787}`;

export default defineConfig({
  root: here,
  plugins: [react()],
  resolve: { alias: { '@shared': path.resolve(here, '../shared') } },
  build: { outDir: path.resolve(here, '../dist/web'), emptyOutDir: true, sourcemap: false, chunkSizeWarningLimit: 900 },
  server: { port: 5173, proxy: { '/api': api, '/media': api } },
});
