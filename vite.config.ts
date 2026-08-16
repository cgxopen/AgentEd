/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// https://v2.tauri.app/start/frontend/vite/
const host = process.env.TAURI_DEV_HOST;

// Build identity, baked in at build time so the app can name itself in a bug
// report without a network call (Q3) or a new dependency.
//
// The version is read from package.json — one source of truth, no second place
// to forget to bump. The commit comes from GITHUB_SHA, which GitHub Actions
// sets for every job: the same value the installer artifact is named after
// (`AgentEd-windows-<sha>`), so the build shown inside the app and the build
// downloaded from a run identify each other. Outside CI there is no honest
// commit to show — a local tree can sit on top of any number of uncommitted
// changes — so it says `dev` rather than a sha that would be a guess.
const packageVersion = JSON.parse(readFileSync('./package.json', 'utf8')).version as string;
const buildCommit = (process.env.GITHUB_SHA ?? '').trim().slice(0, 7) || 'dev';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(packageVersion),
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
  },
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
