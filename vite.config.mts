import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  build: {
    emptyOutDir: false,
    outDir: 'dist/renderer',
    rollupOptions: {
      input: {
        capsule: path.resolve(rootDirectory, 'capsule.html'),
        main: path.resolve(rootDirectory, 'index.html'),
        recorder: path.resolve(rootDirectory, 'recorder.html'),
      },
    },
  },
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
});
