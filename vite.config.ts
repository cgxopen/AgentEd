/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// https://v2.tauri.app/start/frontend/vite/
const host = process.env.TAURI_DEV_HOST;

// Build identity, baked in at build time so the app can name itself in a bug
// report without a network call (Q3) or a new dependency.
//
// ── The version, and why the path is not relative (#41) ──
//
// One source of truth, no second place to forget to bump. Resolved against
// **this file** rather than against the working directory: `./package.json`
// is resolved by `process.cwd()`, and the tool that finds this config does
// not necessarily change it. `vitest` walks up the tree until it finds this
// file, loads it, and leaves the working directory where it was — so running
// the suite from `src-tauri` failed with `ENOENT ./package.json`, which is
// how this was met. Every route through npm is immune, because npm moves to
// the package root before running a script, so no build path meets it; the
// route that does is a direct `vite` or `vitest` invocation from a
// subdirectory.
//
// `import.meta.url` is the config file's own location even though Vite
// bundles this file into `node_modules/.vite-temp/` before loading it.
// Measured rather than assumed, on both routes: the path resolves to the
// repository root under `npm run build` from the root and under
// `npx vitest run` from `src-tauri`.
//
// ── The commit, and why there is only one variable (#41) ──
//
// AGENTED_BUILD_COMMIT, or `dev`. **There is deliberately no fallback to
// `GITHUB_SHA`.** It used to be the middle rung, on the reasoning that a CI
// build without the variable may as well name the commit it is running on.
// That is true of a push, of a scheduled build and of a release, and false on a
// `pull_request` event, where `GITHUB_SHA` is the ephemeral merge commit and
// not the head the pull request page shows: a consumer that lost its `env:`
// line did not fall through to an honest `dev` but baked seven characters
// that look like a commit and match nothing anyone can see.
//
// The rung was removed rather than made event-aware. Skipping it for
// `pull_request` alone would be an answer about the one event somebody
// thought of — `merge_group` and `pull_request_target` were named and never
// measured — where removing it is an answer about the space. And it puts the
// knowledge where it can exist: *which commit this event means* is a fact the
// workflow has and this file cannot have by construction.
//
// So every workflow that builds the application passes the value it means:
// `ci.yml` passes the pull-request head its `changes` job computes, and
// `scheduled.yml` and `release.yml` pass `github.sha`, which on their events is
// the commit anyone means. The contract is asserted across all three in
// `.github/workflows/ci.test.ts` — a workflow that forgets the line is a red
// test rather than a wrong build.
//
// Outside CI there is no honest commit to show — a local tree can sit on top
// of any number of uncommitted changes — so it says `dev` rather than a sha
// that would be a guess. That is now also what a **CI** build with no
// variable says, which is the failure mode this whole change is for: a build
// that cannot name its commit says so.
const packageVersion = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
).version as string;
const buildCommit = (process.env.AGENTED_BUILD_COMMIT ?? '').trim().slice(0, 7) || 'dev';

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
    // gpt-tokenizer 4.1.0 cl100k_base is a chunk of 1025153 bytes,
    // measured at #652; the limit leaves headroom above it.
    chunkSizeWarningLimit: 3000,
  },
  test: {
    environment: 'happy-dom',
    globals: false,
    // Stylesheets are processed rather than stubbed, so a test can read one.
    // Vitest leaves CSS out by default and hands `?raw` and `?inline` an empty
    // string, which a test asking what a selector reaches would silently pass
    // on (#164). One test needs it; nothing else imports a stylesheet.
    css: true,
    setupFiles: ['./vitest.setup.ts'],
    // The workflow contract test lives beside the workflow it pins.
    include: ['src/**/*.test.ts', '.github/workflows/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/main.ts', 'src/types/**'],
    },
  },
});
