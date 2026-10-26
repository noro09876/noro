import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: false,
    assetsInlineLimit: 2048,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('pdfjs-dist')) return 'pdfjs';
          if (id.includes('read-excel-file') || id.includes('fflate') || id.includes('unzipper')) return 'xlsx';
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react';
          return undefined;
        },
      },
    },
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
