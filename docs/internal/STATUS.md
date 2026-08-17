# AgentEd — Project Status

> **Single source of continuity** for AMP/DEV sessions and the owner. Read together with [CLAUDE.md](../../CLAUDE.md) (working rules), [REQUIREMENTS.md](../../REQUIREMENTS.md) (product truth) and [WORKFLOW.md](WORKFLOW.md) (how work moves). Maintained by AMP via PRs; updated after every merge, milestone or decision. When this file and an issue disagree, the issue is authoritative for *scope*, this file for *sequence and narrative*.

**Last updated**: 2026-08-17 — decisions closed, nothing in flight.

## 1. Phase

**Pre-public development, post-reset.** The repository was born clean on 2026-08-14 (ADR-001). Two DEV batches have landed since: the defect batch (#1, #2, #9, #12, #13) and the gap batch (#33, #32, #31, #25, #37). The repo is private; publication is gated on **#20**.

## 2. Current state snapshot

- `main`: editor codebase (Tauri 2 + TypeScript + TipTap), version 0.2.0. R-C3 holds on every exit path; R-C2 holds across ten list shapes with one recorded exception; R-C13 is uniform — a bare URL stays text whether pasted, typed or opened from a file; links are created only through explicit UI, with schemes allow-listed on both creation and following.
- Statusbar shows all three counts (R-C12); **About** reports version and build commit (Q5), matching the artifact it was built from.
- CI: `ci.yml` (Linux checks, Windows build, docs-only path gating, `pipeline-ok`, Windows installer as a 7-day PR artifact), `nightly.yml` (Windows-only, activity guard), `release.yml` (`v*` tags, full matrix incl. macOS). Measured installer size: **2.57 MB**, inside Q1.
- Branch protection: `protect-main` — PR-only, squash-only, restrict deletions, block force pushes, head branches auto-deleted, `Pipeline OK` required.
- Working model: owner (decisions, testing, releases) + AMP (requirements, issues, review, this file) + DEV (Claude Code sessions). No dedicated OPS role — §5, 2026-08-15. English for everything on GitHub.
- History: pre-reset history in the private `agented-archive`; `git bundle` backup taken 2026-08-14.

## 3. Agenda (ordered) — nothing is in flight; this is where the next session starts

1. **DEV batch, ready to hand over**:
   - **#14** — orphaned `assets/`. **DEV must first confirm AMP's reading of `image-handler.ts`** (the image appears not to be written at insert time, leaving only an empty folder); if confirmed, the fix is to defer `ensureAssetsDir()` to the first real save, and the confirmation prompt must not move with it. If the reading is wrong, the three original options stand.
   - **#42** — the link dialog cannot create a relative link (`./notes.md`); rule written in the issue.
   - **#41** — `vite.config.ts` anchored to the file rather than the working directory (chore).
   - **#16** — uneven multi-cell table selection (cosmetic).
   #14 and #42 touch different areas and may run in parallel; #41 is independent of everything.
2. **#27** — mouse resize for images. Touches serialization: only resized images become HTML, everything else keeps `![alt](path)`.
3. Committed pre-public features (AMP opens issues as their turn comes): R-C15 code/text block affordances, multi-tab editing, R-C12 statusbar badges, R-C14 external-change detection.
4. **Pre-public gate: #20** — read its comments as well as its body; both carry checklist items.

## 4. Decision debt / open items

- **#14 approach** — pending DEV's confirmation of the code reading, not the owner's decision.
- **Image naming for files that arrive with a name**: kept as-is (sanitized) by R-C5, because renaming `arhitectura-sistem.png` to `raport-03.png` destroys information the user put there deliberately. The owner may still prefer document-derived names for everything — a one-line change.
- **#4** — unreproducible on the post-reset build; closes at the gate as resolved-by-removal unless it reappears.
- Release numbering at first public release: continue 0.2.x or restart at 1.0.
- `.github/ISSUE_TEMPLATE/` and CODE_OF_CONDUCT — #20 §D.

## 5. Milestone log (newest first)

- **2026-08-17 — Three decisions closed.** **#39** accepted as a known limitation and closed: Windows strips the HTML flavour before the paste event, so the context menu's *Paste as plain text* cannot be distinguished from an ordinary paste; the alternatives cost more than the wart, and #20 brings it back for one last look before publication. **#14** rescoped: the image is not written at insert time, so the residue is an empty folder rather than an orphaned file — DEV confirms before building. **Code signing** decided: the owner funds it personally, and it no longer blocks anything. Two findings settled it — EV certificates stopped granting immediate SmartScreen trust in 2024, so no amount of money removes the first-run warning, and Azure Artifact Signing is about $9.99/month with no hardware token, available to organizations in the EU. Signing early matters more than signing expensively, because reputation accrues from the first signed release. A README note explaining the first-run warning is tracked separately in #20, and lands regardless of when signing happens.
- **2026-08-16 — Second batch merged** (#34, #35, #36, #40): word and character counts restored (#33); `Ctrl+Shift+V` actually forces a plain paste (#32); About shows version and build commit (#31, Q5 added to REQUIREMENTS); explicit link creation with autolink removed (#25 + #37, merged as one trade).
  **What this batch demonstrated is worth more than its features.** Every PR was green — lint, hundreds of tests, both builds — and the manual passes still found a paste behavior no test could see, two click defects and a scheme gap. Three experiments were contaminated in a row (autolink acting *after* the paste; the clipboard payload differing *before* it; a guard branching on the href), each settled by instrumented measurement rather than argument. Several confident hypotheses died, AMP's included. The rule that would have saved all three now lives in WORKFLOW.
- **2026-08-16 — CLAUDE.md points DEV at STATUS.md** (#26), after a session reported a five-hour-old agenda; **WORKFLOW.md written** (#30).
- **2026-08-15 — Operating decisions**: no dedicated OPS role, with the triggers that would change it; Dependabot deferred to launch (#19); pre-public gate written (#20).
- **2026-08-15 — First batch merged** (#17, #18, #21, #23, #24): CI publishes the Windows installer per PR; list numbering, which uncovered turndown rewriting *every* list on save; predictable paste; human-readable image names; feedback when a close is refused mid-save. **R-C13 was revised** — REQUIREMENTS §9.7.
- **2026-08-15 — D3 fixed** (#11): closes #3. Two root causes — the close/quit path never reached the unsaved-changes gate, and `requestSaveAs` truncated the chosen file at pick time.
- **2026-08-14 — Repository bootstrapped and conversion merged** (#7, #10): REQUIREMENTS v1.0 as the first commit, docs skeleton, CI, `protect-main`, then the trimmed codebase.
- **2026-08-14 — Reset decided**: `agented` renamed to `agented-archive` (private, full history); `AgentEd` born clean per ADR-001.

## 6. Session bootstrap (for a new AMP session)

Read, in order: **CLAUDE.md** (full) → **REQUIREMENTS.md** → **this file** → **WORKFLOW.md** → the latest handover brief, if provided. Then confirm in three lines: the *Last updated* date of this file, the top agenda item, and where the working rules live — so the owner knows you read them rather than assumed them.
