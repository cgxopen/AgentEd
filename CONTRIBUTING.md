# Contributing to AgentEd

Thank you for your interest in AgentEd. This document says how a change reaches this repository: what to agree on first, how a pull request is checked and tested, and how soon you hear back. What the product is lives in [REQUIREMENTS.md](REQUIREMENTS.md); how to build it lives in the [README](README.md).

## Before you start

- **English everywhere**: code, comments, docs, commit messages, pull requests, issues.
- **Discuss first**: for anything larger than a small fix, open an issue before writing code. The issue forms ask for what is needed: a bug report asks for the build shown under Help, then About AgentEd, and an idea is read against what the product deliberately does not do. [REQUIREMENTS.md](REQUIREMENTS.md) is the single source of product truth — a change that contradicts it needs a requirements discussion first, not a pull request.
- **Respect the non-goals** (REQUIREMENTS.md §5). Pull requests adding vaults, plugins, graph views, cloud features or telemetry will be declined regardless of quality.
- **Security issues are not reported in public.** [SECURITY.md](SECURITY.md) says where they go.
- **Be kind.** Everyone taking part is expected to follow the [code of conduct](CODE_OF_CONDUCT.md).

## Understand what you submit

You should be able to explain every change in your pull request and how it keeps the invariants. Writing it with an AI tool is fine; submitting code you cannot explain is not, and such a pull request is closed.

## Making a change

1. Pick or open an issue, and agree on the approach there.
2. Fork the repository and branch from the current `main`: `fix/…`, `feat/…`, `docs/…`.
3. Use conventional commits: `feat:`, `fix:`, `docs:`, `ci:`, `refactor:`, `chore:`.
4. Keep to one issue, one branch, one pull request. An unrelated fix gets its own issue, however small.
5. Open the pull request with the template. Write the issue as `Issue: #123`, without words such as Closes or Fixes before it: the maintainer closes the issue by hand once the change has been tested.
6. If `main` moves on and your branch conflicts, merge `main` into your branch rather than rebasing and force-pushing, so the review stays attached to the commits it was written on.

## Quality bars

- **Invariants** (REQUIREMENTS.md §2): clean round-trip (R-C2), no silent writes (R-C3), no silent overwrite (R-C14). A pull request that breaks one of these will not merge.
- **Requirements move with the code.** A change that alters a requirement updates REQUIREMENTS.md in the same pull request, and a new R-C2 exception is documented there in the same pull request. An undocumented exception is a defect.
- **Size budget**: the Windows installer stays in the ~3 MB class. A new runtime dependency needs agreement in the issue first, with its size impact stated.
- **Style**: TypeScript strict and `biome` clean; Rust `rustfmt` and `clippy -D warnings` clean.
- **Tests**: vitest for TypeScript logic, next to the code it tests; `cargo test` for Rust. A change to how markdown is read or written comes with round-trip tests.
- **Say what you did not verify.** If you could not try the change on Windows, say so in the pull request and list what still needs a look. A check that was not run is never implied.

## Verification checklist before a pull request

```
npm run check && npx tsc --noEmit && npm test && npm run build
cd src-tauri && cargo fmt --check && cargo clippy -- -D warnings && cargo test
```

`npm run build` builds the web bundle only. The Windows installer is built by `npm run tauri build`, which CI runs on every pull request that touches code.

## How a pull request is checked and tested

How deep a review goes follows what the change touches:

- **Documents and text**: reviewed, and CI must pass.
- **Logic the test suite can see**: reviewed with CI green, and a short manual pass or none.
- **The interface, files, saving and closing, the Windows platform, or dependencies**: reviewed with CI green, and a manual pass by the maintainer on the installer built from the pull request.

A few things hold for every pull request:

- **CI on a pull request from a fork may wait for the maintainer to approve the run.** A change that touches `.github/workflows` or the permissions under `src-tauri` is read in full before its run is approved.
- **The manual pass uses the installer built by the pull request itself**, published by its CI run as `AgentEd-windows-<sha>` and kept for seven days — never a build from `main` or from the weekly build. The seven characters in the artifact name, the head commit of the pull request and the build shown under About are the same value; if they disagree, the installer is not the build under review.
- **When a manual result contradicts the tests, the build is checked first**, then the input, and only then the code.

These levels are reviewed after the first ten pull requests from outside the project.

## How soon you hear back

AgentEd has one maintainer. Expect a first reply to a new issue or pull request within a few days. A change that needs a manual pass takes longer, because that pass is done by hand on Windows.

## Licence of contributions

AgentEd is released under the MIT licence in [LICENSE](LICENSE). By opening a pull request you agree that your contribution is released under the same licence.

## Money given to the project

The company that publishes AgentEd receives any money given to the project, through sponsorship or otherwise, and spends it on maintaining and developing AgentEd. Contributions are voluntary and unpaid: making one gives no share of that money and no claim to payment. If a piece of work is ever paid for, that is agreed in writing before the work starts.

## Working with AI agents

The coding rules in [CLAUDE.md](CLAUDE.md) apply to every change, whoever or whatever writes it. Claude Code reads that file on its own. Other agents look for [AGENTS.md](AGENTS.md), which OpenAI Codex, GitHub Copilot and Cursor read by their own documentation; it sends them to [REQUIREMENTS.md](REQUIREMENTS.md) and CLAUDE.md, so the rules have one address.
