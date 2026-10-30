import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = `http://127.0.0.1:${process.env.NORO_PORT ?? 8787}`;

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true, sourcemap: false },
  server: { port: 5173, proxy: { '/api': api, '/m': api } },
});
