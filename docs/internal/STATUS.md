# AgentEd — Project Status

> **Single source of continuity** for AMP/DEV sessions and the owner. Read together with [CLAUDE.md](../../CLAUDE.md) (working rules) and [REQUIREMENTS.md](../../REQUIREMENTS.md) (product truth). Maintained by AMP via PRs; updated after every merge, milestone or decision. When this file and an issue disagree, the issue is authoritative for *scope*, this file for *sequence and narrative*.

**Last updated**: 2026-08-15 — after the critical save-path fix (#11) merged.

## 1. Phase

**Pre-public development, post-reset.** The repository was born clean on 2026-08-14 (ADR-001); the conversion (#7) landed the trimmed editor codebase the same day, and the critical data-loss defect (#3) was fixed on 2026-08-15. The repo is private; publication happens when the owner declares the pre-public gate (§3 item 4) satisfied.

## 2. Current state snapshot

- `main`: full editor codebase (Tauri 2 + TypeScript + TipTap), version 0.2.0, trimmed per REQUIREMENTS §4 — no profile/validation machinery anywhere. R-C3 now holds on every exit path: the document reaches disk only through an explicit save decision.
- CI active in `.github/workflows/`: `ci.yml` (frontend + Rust checks on Linux, Windows build, docs-only path gating, `pipeline-ok` summary), `nightly.yml` (Windows-only, activity guard, 7-day retention), `release.yml` (`v*` tags, full matrix incl. macOS).
- Branch protection: ruleset `protect-main` — PR-only, squash-only merges, restrict deletions, block force pushes. `Pipeline OK` as required status check: see §4.
- Working model: owner (decisions, merges, releases) + AMP (requirements, issues, briefs, product review) + DEV (Claude Code implementation sessions). English for everything on GitHub.
- History: complete pre-reset history in the private `agented-archive`; post-conversion `git bundle` backup taken by the owner on 2026-08-14.

## 3. Agenda (ordered)

1. **Remaining defects**: **#1** numbered lists, **#2** paste artifacts (implements R-C13), **#9** human-readable image names (R-C5), **#4** selection flicker — *blocked on the owner's repro details, see §4*.
2. **#12 — CI uploads the Windows installer as a PR artifact** (7-day retention). Small, unblocks self-service branch testing; worth doing early since it removes a manual step from every later PR.
3. Follow-ups from #11: **#13** silent refusal when closing during a save, **#14** orphaned `assets/` after discarding a never-saved document.
4. Committed pre-public features (AMP opens issues as their turn comes): R-C15 code/text block affordances, multi-tab editing, R-C12 statusbar badges, R-C14 external-change detection.
5. Pre-public gate: **#8** Linux build in CI/nightly, secret scan, README screenshots refresh, repo topics, release-matrix decision (macOS in or out of early releases), issue templates decision (§4).
6. Post-public (parked, REQUIREMENTS §8): skills/OKF reintroduction, PWA, Agent View, visual frontmatter editor, sealed archive export.

## 4. Decision debt / open items

- **#4 needs reproduction details from the owner** before DEV can start: which selection direction misbehaves (L→R or R→L), desktop or web build, and whether the floating toolbar appears during the flicker.
- Confirm `Pipeline OK` is set as the required status check in `protect-main` (owner action; delete this line once confirmed).
- Release numbering at first public release: continue the 0.2.x line or restart at 1.0.
- `.github/ISSUE_TEMPLATE/` was deliberately not imported from the archive — decide whether to add templates before going public.

## 5. Milestone log (newest first)

- **2026-08-15 — D3 fixed** (#11, squash `7be5feb`): closes #3. Two root causes, not one — the window-close/quit path never reached the unsaved-changes gate, and `requestSaveAs` truncated the chosen file at pick time (so Save As over an existing document destroyed it without any close involved). Close guard now lives behind `PlatformIO`; `pickSavePath` writes nothing; 18 new tests. Produced follow-ups #13 and #14.
- **2026-08-14 — Status file added** (#10): this document.
- **2026-08-14 — Conversion merged** (#7, squash `a8c770c`): trimmed codebase on `main`; CI live including docs-only path gating; PR #6 closed as superseded; branches cleaned; bundle backup taken.
- **2026-08-14 — Repository bootstrapped**: REQUIREMENTS v1.0 approved as the first commit; docs skeleton (README, CLAUDE.md, ADR-001, CONTRIBUTING, SECURITY, LICENSE, FUNDING); CI workflows authored; issues #1–#5 filed; `protect-main` ruleset created.
- **2026-08-14 — Reset decided**: `agented` renamed to `agented-archive` (private, full history); `AgentEd` born clean per ADR-001.

## 6. Session bootstrap (for a new AMP session)

Read, in order: **CLAUDE.md** (full) → **REQUIREMENTS.md** → **this file** → the latest handover brief, if provided. Then confirm in three lines: the *Last updated* date of this file, the top agenda item, and where the working rules live — so the owner knows you read them rather than assumed them.
