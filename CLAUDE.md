# CLAUDE.md — Working instructions for AI dev sessions

This file is read by Claude Code (DEV) sessions working on AgentEd. It is intentionally short; the product truth lives in [REQUIREMENTS.md](REQUIREMENTS.md).

## Before you start — read these, in this order

1. **[REQUIREMENTS.md](REQUIREMENTS.md)** — what the product is and what it must never do.
2. **[docs/internal/STATUS.md](docs/internal/STATUS.md)** — where the project *currently* is: phase, ordered agenda, decisions taken, what merged last.
3. This file, in full.

Then **verify the live state against the repository before planning or reporting anything**: which pull requests are open, what is on `main`, which branches exist. Your session context goes stale — a branch you remember may already be merged and deleted, an issue you remember as next may already be closed. The repository is the state; your memory of an earlier session is not. Never report project status from context alone.

## What this project is

AgentEd is an **easy-to-use WYSIWYG markdown editor** (Tauri 2 + TypeScript + TipTap), with light AI-era instrumentation (token count, context-file awareness) as a secondary layer. Priority order on any trade-off: **(1) ease of use → (2) speed & lightness → (3) AI instrumentation.**

Read REQUIREMENTS.md before changing anything — it is the single source of product truth. The repository was reset in August 2026 ([ADR-001](docs/ADR/ADR-001-reset-and-simplification.md)); pre-reset history and ADR-001..034 live in the private `agented-archive` repo. Do not reintroduce removed machinery (profiles, validation panel, frontmatter injection) — that is a deliberate post-public phase, not a refactor opportunity.

## Non-negotiable invariants

- **R-C2 Clean round-trip**: open→save with no edits must not alter the file. Never emit non-standard markdown syntax.
- **R-C3 No silent writes**: the editor never writes to disk without an explicit user save decision; every destructive path — including window close and app quit — goes through the unsaved-changes gate.
- **R-C14 No silent overwrite**: before every save, compare on-disk state (mtime/hash); on external change the user chooses reload / overwrite / save-as. Never write lock files next to user documents.
- **Q1 Size budget**: Windows installer stays in the ~3 MB class. **No new runtime dependency without explicit owner approval** — state the size impact in the PR.
- **Q3 Offline**: zero network calls at runtime.

## Design rules

- Machinery stays **silent when not relevant**: no modes, no upfront choices. Statusbar badges are descriptive, never blocking.
- **All file access and OS integration goes through `src/platform`** — never call Tauri APIs directly from UI or editor code. This keeps future targets (PWA, mobile) feasible.
- User-facing wording avoids jargon ("Metadata", not "Frontmatter").
- **English everywhere** in this repository: code, comments, docs, commit messages, PRs, issues.

## Module map (post-conversion)

`src/app` (bootstrap/state) · `src/editor` (TipTap setup, input rules) · `src/formats` (markdown serialization — round-trip critical, test any change) · `src/cluster` (context-file awareness, scan bounded at 5 levels) · `src/platform` (all Tauri/file access) · `src/templates` (4 plain seeds) · `src/ui` (header, statusbar, sidebar, dialogs) · `src/types` · `src-tauri` (Rust shell — keep minimal; `panic = "abort"`, full LTO on release).

## Coding standards (NASA-derived, compact)

- Small, single-purpose functions; modules ≤ ~300 lines as a guideline.
- No unbounded recursion or loops over user input; every scan has an explicit bound (keep existing bounds visible in the code).
- Handle every error path explicitly; no silent catch. User-visible failures get a dialog or statusbar note — never data loss.
- TypeScript strict; `biome` clean; `rustfmt` + `clippy -D warnings` clean.
- Tests colocated (vitest). Serialization changes require round-trip tests.
- A comment may not assert a property the code does not have. Comments explaining a mechanism are wanted and this codebase is built on them; what is forbidden is a load-bearing claim — this is bounded, this is guarded, this branch is unreachable — with nothing at the address it names. Where such a claim cannot be checked, write what is true instead.

## Workflow

- Work only from a GitHub issue; one issue = one branch (`fix/…`, `feat/…`, `conversion/…`) = one PR to `main`. **Never push to `main` directly.**
- Conventional commits: `feat:`, `fix:`, `docs:`, `ci:`, `refactor:`, `chore:`.
- PR description: what changed, why, how it was verified (include Windows verification), and size impact for anything touching dependencies or bundling.
- CI must be green (`pipeline-ok` is the single required check). Do not change workflows unless an issue asks for it.
- Do not fix unrelated things in the same PR — open an issue instead.

## Verification before any PR

```
npm run check && npx tsc --noEmit && npm test && npm run build
cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test
```

Then `npm run tauri dev` on Windows for a manual smoke test: open → edit → save → all close paths (File → Close, window ✕, app quit) behave per R-C3. When no Windows machine is available, say so explicitly in the PR and list what the owner must test by hand — never imply a verification you did not run.
