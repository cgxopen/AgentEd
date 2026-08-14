# Contributing to AgentEd

Thanks for your interest in AgentEd. This document explains how changes land in this repository.

## Ground rules

- **English everywhere**: code, comments, docs, commit messages, PRs, issues.
- **Discuss first**: for anything larger than a small fix, open an issue before writing code. [REQUIREMENTS.md](REQUIREMENTS.md) is the single source of product truth — changes that contradict it need a requirements discussion first, not a PR.
- **Respect the non-goals** (REQUIREMENTS.md §5). PRs adding vaults, plugins, graph views, cloud features or telemetry will be declined regardless of quality.

## Workflow

1. Pick or open an issue; agree on the approach.
2. Branch from `main`: `fix/…`, `feat/…`, `docs/…`.
3. Use conventional commits: `feat:`, `fix:`, `docs:`, `ci:`, `refactor:`, `chore:`.
4. Open a PR to `main`. Describe what changed, why, and how you verified it. CI (`pipeline-ok`) must be green.
5. Review and merge are done by the maintainer.

## Quality bars

- **Invariants** (REQUIREMENTS.md §2): clean round-trip (R-C2), no silent writes (R-C3), no silent overwrite (R-C14). A PR that violates one of these will not merge.
- **Size budget**: the Windows installer stays in the ~3 MB class. New runtime dependencies need prior discussion in the issue — state the size impact.
- **Style**: TypeScript strict + `biome` clean; Rust `rustfmt` + `clippy -D warnings` clean.
- **Tests**: vitest for TypeScript logic (colocated); `cargo test` for Rust. Serialization changes require round-trip tests.

## Verification checklist before a PR

```
npm run check && npx tsc --noEmit && npm test && npm run build
cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test
```

If your change affects runtime behavior, include a manual smoke test note (open → edit → save → close paths).
