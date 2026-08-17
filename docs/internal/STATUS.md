# AgentEd — Project Status

> **Single source of continuity** for AMP/DEV sessions and the owner. Read together with [CLAUDE.md](../../CLAUDE.md) (working rules), [REQUIREMENTS.md](../../REQUIREMENTS.md) (product truth) and [WORKFLOW.md](WORKFLOW.md) (how work moves). Maintained by AMP via PRs; updated after every merge, milestone or decision. When this file and an issue disagree, the issue is authoritative for *scope*, this file for *sequence and narrative*.

**Last updated**: 2026-08-16 — after the second DEV batch merged.

## 1. Phase

**Pre-public development, post-reset.** The repository was born clean on 2026-08-14 (ADR-001). Two DEV batches have landed since: the defect batch (#1, #2, #9, #12, #13) and the gap batch (#33, #32, #31, #25, #37). The repo is private; publication is gated on **#20**.

## 2. Current state snapshot

- `main`: editor codebase (Tauri 2 + TypeScript + TipTap), version 0.2.0. R-C3 holds on every exit path; R-C2 holds across ten list shapes with one recorded exception; R-C13 is uniform — a bare URL stays text whether pasted, typed or opened from a file; links are created only through explicit UI.
- Statusbar shows all three counts (R-C12); **About** reports version and build commit (Q5), matching the artifact name it was built from.
- CI: `ci.yml` (Linux checks, Windows build, docs-only path gating, `pipeline-ok`, Windows installer as a 7-day PR artifact), `nightly.yml` (Windows-only, activity guard), `release.yml` (`v*` tags, full matrix incl. macOS). Measured installer size: **2.57 MB**, inside Q1.
- Branch protection: `protect-main` — PR-only, squash-only, restrict deletions, block force pushes, head branches auto-deleted, `Pipeline OK` required.
- Working model: owner (decisions, testing, releases) + AMP (requirements, issues, review, this file) + DEV (Claude Code sessions). No dedicated OPS role — §5, 2026-08-15. English for everything on GitHub.
- History: pre-reset history in the private `agented-archive`; `git bundle` backup taken 2026-08-14.

## 3. Agenda (ordered)

1. **Owner decisions, neither urgent**: **#39** (context-menu "Paste as plain text" — AMP recommends accept-and-document) and **#14** (orphaned `assets/` — AMP wants DEV's proposal between three options before code).
2. **#42** — the link dialog cannot create a relative link (`./notes.md`). Found while testing #40; a real authoring gap, since markdown documents link to their neighbours constantly.
3. **#16** uneven multi-cell table selection · **#27** mouse resize for images (touches serialization: only resized images become HTML) · **#41** `vite.config.ts` working-directory assumption (chore).
4. Committed pre-public features: R-C15 code/text block affordances, multi-tab editing, R-C12 statusbar badges, R-C14 external-change detection.
5. **Pre-public gate: #20**, including #8 (Linux build), #19 (Dependabot) and the code-signing decision.
6. Post-public (parked, REQUIREMENTS §8): skills/OKF reintroduction, PWA, Agent View, visual frontmatter editor, sealed archive export.

## 4. Decision debt / open items

- **Code signing** — unsigned installers trigger "Windows protected your PC"; macOS needs an Apple Developer account plus notarization. Money and lead time, so it needs an early answer even if that answer is "not for the first release". #20 §E.
- **#39** and **#14** — see agenda item 1.
- **Image naming for files that arrive with a name**: kept as-is (sanitized) by R-C5, because renaming `arhitectura-sistem.png` to `raport-03.png` destroys information the user put there deliberately. Owner may still prefer document-derived names for everything — a one-line change.
- **#4** — unreproducible on the post-reset build; closes at the gate as resolved-by-removal unless it reappears.
- Release numbering at first public release: continue 0.2.x or restart at 1.0.
- `.github/ISSUE_TEMPLATE/` and CODE_OF_CONDUCT — #20 §D.

## 5. Milestone log (newest first)

- **2026-08-16 — Second batch merged** (#34, #35, #36, #40): word and character counts restored (#33 — they were computed and written only into a tooltip); `Ctrl+Shift+V` actually forces a plain paste (#32); About shows version and build commit (#31, with Q5 added to REQUIREMENTS); explicit link creation with autolink removed (#25 + #37, merged as one trade).
  **What this batch demonstrated is worth more than its features.** Every PR was green — lint, hundreds of tests, both builds — and the manual passes still found: a paste behavior nobody could see from a test, two click defects, and a scheme gap. Three experiments were contaminated in a row (autolink acting *after* the paste; the clipboard payload differing *before* it; a guard branching on the href), and each was settled by instrumented measurement rather than argument. Several confident hypotheses died, AMP's included.
- **2026-08-16 — CLAUDE.md points DEV at STATUS.md** (#26), after a session reported a five-hour-old agenda; **WORKFLOW.md written** (#30).
- **2026-08-15 — Operating decisions**: no dedicated OPS role, with the triggers that would change it; Dependabot deferred to launch (#19); pre-public gate written (#20).
- **2026-08-15 — First batch merged** (#17, #18, #21, #23, #24): CI publishes the Windows installer per PR; list numbering, which uncovered turndown rewriting *every* list on save; predictable paste, including a second source of stray `http` fragments; human-readable image names; feedback when a close is refused mid-save. **R-C13 was revised** — REQUIREMENTS §9.7.
- **2026-08-15 — D3 fixed** (#11): closes #3. Two root causes — the close/quit path never reached the unsaved-changes gate, and `requestSaveAs` truncated the chosen file at pick time.
- **2026-08-14 — Repository bootstrapped and conversion merged** (#7, #10): REQUIREMENTS v1.0 as the first commit, docs skeleton, CI, `protect-main`, then the trimmed codebase.
- **2026-08-14 — Reset decided**: `agented` renamed to `agented-archive` (private, full history); `AgentEd` born clean per ADR-001.

## 6. Session bootstrap (for a new AMP session)

Read, in order: **CLAUDE.md** (full) → **REQUIREMENTS.md** → **this file** → **WORKFLOW.md** → the latest handover brief, if provided. Then confirm in three lines: the *Last updated* date of this file, the top agenda item, and where the working rules live — so the owner knows you read them rather than assumed them.
