# AgentEd — Project Status

> **Single source of continuity** for AMP/DEV sessions and the owner. Read together with [CLAUDE.md](../../CLAUDE.md) (working rules) and [REQUIREMENTS.md](../../REQUIREMENTS.md) (product truth). Maintained by AMP via PRs; updated after every merge, milestone or decision. When this file and an issue disagree, the issue is authoritative for *scope*, this file for *sequence and narrative*.

**Last updated**: 2026-08-16 — after the first DEV batch merged.

## 1. Phase

**Pre-public development, post-reset.** The repository was born clean on 2026-08-14 (ADR-001); the conversion (#7) landed the trimmed editor codebase, #3 fixed the critical data-loss defect, and the first five-PR DEV batch merged on 2026-08-16. The repo is private; publication is gated on **#20**, the checklist that has to be green before it flips.

## 2. Current state snapshot

- `main`: full editor codebase (Tauri 2 + TypeScript + TipTap), version 0.2.0, trimmed per REQUIREMENTS §4. R-C3 holds on every exit path; R-C2 holds across ten list shapes, with the loose-list exception recorded under R-C2 and tracked in #28.
- CI in `.github/workflows/`: `ci.yml` (Linux checks, Windows build, docs-only path gating, `pipeline-ok`, and **the Windows installer uploaded as a 7-day artifact on every code PR** — #17), `nightly.yml` (Windows-only, activity guard), `release.yml` (`v*` tags, full matrix incl. macOS).
- Installer size measured on a real CI artifact: **2.57 MB** — inside the Q1 budget and below the pre-reset 2.8 MB.
- Branch protection: ruleset `protect-main` — PR-only, squash-only, restrict deletions, block force pushes, head branches auto-deleted, **`Pipeline OK` required**.
- Working model: owner (decisions, merges, releases) + AMP (requirements, issues, briefs, product review) + DEV (Claude Code sessions). No dedicated OPS role — see §5, 2026-08-15. English for everything on GitHub.
- History: complete pre-reset history in the private `agented-archive`; `git bundle` backup taken 2026-08-14.

## 3. Agenda (ordered)

1. **Owner smoke tests on `main`** for the merged batch. The interaction worth pressing on: **paste into a numbered list** — #18 and #21 met in `src/editor/setup.ts`, each is tested alone, their combination is not.
2. **#14** — orphaned `assets/` after discarding a never-saved document. Needs a design decision between three options before code (see §4).
3. **#25** — link button + `Ctrl+K` dialog. The README documents the shortcut today and the build does not honor it, so this closes a gap between promise and product.
4. **#16** — uneven multi-cell table selection (cosmetic); **#27** — mouse resize for images (touches serialization: only resized images become HTML, everything else keeps `![alt](path)`).
5. Committed pre-public features: R-C15 code/text block affordances, multi-tab editing, R-C12 statusbar badges, R-C14 external-change detection.
6. **Pre-public gate: #20** — the full checklist, including #8 (Linux build), #19 (Dependabot) and the code-signing decision.
7. Post-public (parked, REQUIREMENTS §8): skills/OKF reintroduction, PWA, Agent View, visual frontmatter editor, sealed archive export.

## 4. Decision debt / open items

- **Code signing** — unsigned installers trigger "Windows protected your PC"; macOS needs an Apple Developer account plus notarization. Money and lead time, so it needs an early answer even if that answer is "not for the first release". Tracked in #20 §E.
- **#14 approach** — defer the image write until first save, offer cleanup on discard, or require a saved document before image insert. AMP wants DEV's proposal before implementation.
- **Image naming for files that arrive with a name**: kept as-is (sanitized) by R-C5, on the grounds that renaming `arhitectura-sistem.png` to `raport-03.png` destroys information the user put there deliberately. Owner may still prefer document-derived names for everything — a one-line change if so.
- **#4** — unreproducible on the post-reset build; closes at the gate as resolved-by-removal unless it reappears.
- Release numbering at first public release: continue 0.2.x or restart at 1.0.
- `.github/ISSUE_TEMPLATE/` and CODE_OF_CONDUCT decisions — both in #20 §D.

## 5. Milestone log (newest first)

- **2026-08-16 — First DEV batch merged**: **#17** CI publishes the Windows installer per PR (closes #12); **#18** list numbering, which uncovered a much wider R-C2 breach — turndown was rewriting *every* list on save, so open→save silently altered any document containing one (closes #1); **#21** predictable paste (closes #2), including a second source of the stray `http` fragments: GFM autolinking wrote `[https://x](https://x)` into any file that merely mentioned a URL; **#23** human-readable image names (closes #9); **#24** feedback when a close is refused mid-save (closes #13). **R-C13 was revised** in the process — see REQUIREMENTS §9.7. New requests recorded: **#25** link UI, **#27** image resize, **#28** loose-list preservation.
- **2026-08-16 — CLAUDE.md now points DEV at STATUS.md** (#26). A DEV session had reported a five-hour-old agenda and asked for a build on an already-deleted branch; the cause was documentation, not the session — STATUS.md was created after CLAUDE.md and never linked from it. DEV sessions are now told to read it and to verify live state against the repository before reporting.
- **2026-08-15 — Operating decisions recorded.** *No dedicated OPS role for now*: the ops surface is three stable workflow files, no infrastructure, and an already-automated release; a fourth actor would mainly add coordination overhead and an ownership conflict with DEV over `.github/workflows/`. Revisit at code signing, an auto-updater, or hosted infrastructure. *Dependabot deferred to launch* (#19): free itself, but its PRs trigger CI — and standard runners are free on public repositories, so the reason to hold back expires on publication day. *Pre-public gate written* (#20).
- **2026-08-15 — D3 fixed** (#11, squash `7be5feb`): closes #3. Two root causes — the close/quit path never reached the unsaved-changes gate, and `requestSaveAs` truncated the chosen file at pick time, so Save As over an existing document destroyed it without any close involved.
- **2026-08-14 — Status file added** (#10): this document.
- **2026-08-14 — Conversion merged** (#7, squash `a8c770c`): trimmed codebase on `main`; CI live including docs-only path gating.
- **2026-08-14 — Repository bootstrapped**: REQUIREMENTS v1.0 as the first commit; docs skeleton; CI workflows; issues #1–#5; `protect-main` ruleset.
- **2026-08-14 — Reset decided**: `agented` renamed to `agented-archive` (private, full history); `AgentEd` born clean per ADR-001.

## 6. Session bootstrap (for a new AMP session)

Read, in order: **CLAUDE.md** (full) → **REQUIREMENTS.md** → **this file** → the latest handover brief, if provided. Then confirm in three lines: the *Last updated* date of this file, the top agenda item, and where the working rules live — so the owner knows you read them rather than assumed them.
