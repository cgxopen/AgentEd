# AgentEd — Project Status

> **Single source of continuity** for AMP/DEV sessions and the owner. Read together with [CLAUDE.md](../../CLAUDE.md) (working rules) and [REQUIREMENTS.md](../../REQUIREMENTS.md) (product truth). Maintained by AMP via PRs; updated after every merge, milestone or decision. When this file and an issue disagree, the issue is authoritative for *scope*, this file for *sequence and narrative*.

**Last updated**: 2026-08-15 — after the D3 fix (#11) and the operating decisions recorded below.

## 1. Phase

**Pre-public development, post-reset.** The repository was born clean on 2026-08-14 (ADR-001); the conversion (#7) landed the trimmed editor codebase the same day, and the critical data-loss defect (#3) was fixed on 2026-08-15. The repo is private; publication is gated on **#20**, which is the checklist that has to be green before it flips.

## 2. Current state snapshot

- `main`: full editor codebase (Tauri 2 + TypeScript + TipTap), version 0.2.0, trimmed per REQUIREMENTS §4 — no profile/validation machinery anywhere. R-C3 now holds on every exit path: the document reaches disk only through an explicit save decision.
- CI active in `.github/workflows/`: `ci.yml` (frontend + Rust checks on Linux, Windows build, docs-only path gating, `pipeline-ok` summary), `nightly.yml` (Windows-only, activity guard, 7-day retention), `release.yml` (`v*` tags, full matrix incl. macOS).
- Branch protection: ruleset `protect-main` — PR-only, squash-only merges, restrict deletions, block force pushes. Head branches auto-delete on merge. `Pipeline OK` as required status check: see §4.
- Working model: owner (decisions, merges, releases) + AMP (requirements, issues, briefs, product review) + DEV (Claude Code implementation sessions). No dedicated OPS role — see §5, 2026-08-15. English for everything on GitHub.
- History: complete pre-reset history in the private `agented-archive`; post-conversion `git bundle` backup taken by the owner on 2026-08-14.

## 3. Agenda (ordered)

1. **DEV batch in flight**, one PR each, in this order: **#12** (CI uploads the Windows installer — first, because it makes every later PR self-service testable), **#1** numbered lists, **#2** paste (R-C13), **#9** image names (R-C5), **#13** feedback when a close is refused mid-save.
2. **#14** — orphaned `assets/` after discarding a never-saved document. Held back deliberately: it needs a design decision between three options before any code is written (see §4).
3. **#16** — uneven multi-cell table selection. Cosmetic; batch it into the polish pass, before README screenshots are taken.
4. Committed pre-public features (AMP opens issues as their turn comes): R-C15 code/text block affordances, multi-tab editing, R-C12 statusbar badges, R-C14 external-change detection.
5. **Pre-public gate: #20** — the full checklist (product, security, legal, presentation, release, settings). Includes #8 (Linux build) and #19 (Dependabot).
6. Post-public (parked, REQUIREMENTS §8): skills/OKF reintroduction, PWA, Agent View, visual frontmatter editor, sealed archive export.

## 4. Decision debt / open items

- **Code signing** — an unsigned installer triggers "Windows protected your PC" on first run; macOS needs an Apple Developer account plus notarization. Both cost money and have lead time, so this needs an answer early even if the answer is "not for the first release". Tracked in #20 §E.
- **#14 approach** — defer the image write until first save, offer cleanup on discard, or require a saved document before image insert. AMP wants DEV's proposal before implementation.
- **#4 reproduction details** from the owner, *if it ever reappears* — otherwise it closes at the gate as resolved-by-removal.
- Confirm `Pipeline OK` is set as the required status check in `protect-main` (owner action; delete this line once confirmed).
- Release numbering at first public release: continue the 0.2.x line or restart at 1.0.
- `.github/ISSUE_TEMPLATE/` and CODE_OF_CONDUCT decisions — both in #20 §D.

## 5. Milestone log (newest first)

- **2026-08-15 — Operating decisions recorded.** *No dedicated OPS role for now*: the ops surface is three stable workflow files, no infrastructure, and an already-automated release; a fourth actor would mainly add coordination overhead and an ownership conflict with DEV over `.github/workflows/`. Revisit when code signing, an auto-updater, or hosted infrastructure appears — those are real, continuous ops. *Dependabot deferred to launch* (#19): it is free, but its PRs trigger CI, and standard runners are free on public repositories — so the reason to hold back expires the day the repo goes public. *Pre-public gate written* (#20).
- **2026-08-15 — D3 fixed** (#11, squash `7be5feb`): closes #3. Two root causes, not one — the window-close/quit path never reached the unsaved-changes gate, and `requestSaveAs` truncated the chosen file at pick time (so Save As over an existing document destroyed it without any close involved). Close guard now lives behind `PlatformIO`; `pickSavePath` writes nothing; 18 new tests. Produced follow-ups #13 and #14.
- **2026-08-14 — Status file added** (#10): this document.
- **2026-08-14 — Conversion merged** (#7, squash `a8c770c`): trimmed codebase on `main`; CI live including docs-only path gating; PR #6 closed as superseded; branches cleaned; bundle backup taken.
- **2026-08-14 — Repository bootstrapped**: REQUIREMENTS v1.0 approved as the first commit; docs skeleton (README, CLAUDE.md, ADR-001, CONTRIBUTING, SECURITY, LICENSE, FUNDING); CI workflows authored; issues #1–#5 filed; `protect-main` ruleset created.
- **2026-08-14 — Reset decided**: `agented` renamed to `agented-archive` (private, full history); `AgentEd` born clean per ADR-001.

## 6. Session bootstrap (for a new AMP session)

Read, in order: **CLAUDE.md** (full) → **REQUIREMENTS.md** → **this file** → the latest handover brief, if provided. Then confirm in three lines: the *Last updated* date of this file, the top agenda item, and where the working rules live — so the owner knows you read them rather than assumed them.
