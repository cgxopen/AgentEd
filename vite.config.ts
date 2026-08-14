/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// https://v2.tauri.app/start/frontend/vite/
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  server: {
    host: host || false,
    port: 1420,
    strictPort: true,
    hmr: host
      ? { protocol: 'ws', host, port: 1421 }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    chunkSizeWarningLimit: 3000, // gpt-tokenizer cl100k_base is ~2 MB; leave headroom
  },
  test: {
    environment: 'happy-dom',
    globals: false,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/main.ts', 'src/types/**'],
    },
  },
});
