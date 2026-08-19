# AgentEd — Project Status

> **Single source of continuity** for AMP/DEV sessions and the owner. Read together with [CLAUDE.md](../../CLAUDE.md) (working rules), [REQUIREMENTS.md](../../REQUIREMENTS.md) (product truth) and [WORKFLOW.md](WORKFLOW.md) (how work moves). Maintained by AMP via PRs; updated after every merge, milestone or decision. When this file and an issue disagree, the issue is authoritative for *scope*, this file for *sequence and narrative*.

**Last updated**: 2026-08-19 — #45 merged, agenda reordered, nothing in flight.

## 1. Phase

**Pre-public development, post-reset.** The repository was born clean on 2026-08-14 (ADR-001). Three DEV batches have landed since: the defect batch (#1, #2, #9, #12, #13), the gap batch (#33, #32, #31, #25, #37), and #45 on its own. The repo is private; publication is gated on **#20**.

## 2. Current state snapshot

- `main`: editor codebase (Tauri 2 + TypeScript + TipTap), version 0.2.0. R-C3 holds on every exit path; R-C2 holds across ten list shapes with one recorded exception; R-C13 is uniform — a bare URL stays text whether pasted, typed or opened from a file; links are created only through explicit UI, with schemes allow-listed on both creation and following.
- **`assets/` is created by the save flow, never by an image insert** (#45). Consent is still asked at insert time, remembered per folder, and a document whose images could not be written stays modified so the close gate still asks. Nothing reaches the user's folder until the document exists on disk.
- Statusbar shows all three counts (R-C12); **About** reports version and build commit (Q5), matching the artifact it was built from.
- CI: `ci.yml` (Linux checks, Windows build, docs-only path gating, `pipeline-ok`, Windows installer as a 7-day PR artifact), `nightly.yml` (Windows-only, activity guard), `release.yml` (`v*` tags, full matrix incl. macOS). Measured installer size: **2.57 MB**, inside Q1. No job sets a timeout — #47.
- Branch protection: `protect-main` — PR-only, squash-only, restrict deletions, block force pushes, head branches auto-deleted, `Pipeline OK` required.
- Working model: owner (decisions, testing, releases) + AMP (requirements, issues, review, this file) + DEV (Claude Code sessions). No dedicated OPS role — §5, 2026-08-15. English for everything on GitHub.
- History: pre-reset history in the private `agented-archive`; `git bundle` backup taken 2026-08-14.

## 3. Agenda (ordered) — nothing is in flight; this is where the next session starts

1. **#48** — a document that has just been given a destination shows nothing until an explicit save. **Taken out of turn deliberately**: #45 removed the only visible feedback the insert flow had, since choosing a destination used to produce at least an `assets/` folder. The confusion arrived on `main` with the fix, so it is a debt this project contracted rather than a new idea. Small: a cue at the insert call site, no change to what reaches disk.
2. **#42** — the link dialog cannot create a relative link (`./notes.md`); rule written in the issue.
3. **#41** and **#47** — build-infrastructure chores, good as a pair. `vite.config.ts` anchored to the file rather than the working directory; CI jobs with no `timeout-minutes`, which let a stalled Ubuntu mirror run for 28 minutes against a job that normally takes under two. #47 asks for the ceilings to be **measured** from real runs, not guessed.
4. **#16** — uneven multi-cell table selection (cosmetic).
5. **#27** — mouse resize for images. Touches serialization: only resized images become HTML, everything else keeps `![alt](path)`.
6. Committed pre-public features (AMP opens issues as their turn comes): R-C15 code/text block affordances, multi-tab editing, R-C12 statusbar badges, R-C14 external-change detection.
7. **Pre-public gate: #20** — read its comments as well as its body; both carry checklist items, and there are now four comments.

## 4. Decision debt / open items

- **Image naming for files that arrive with a name**: kept as-is (sanitized) by R-C5, because renaming `arhitectura-sistem.png` to `raport-03.png` destroys information the user put there deliberately. The owner may still prefer document-derived names for everything — a one-line change.
- **#4** — unreproducible on the post-reset build; closes at the gate as resolved-by-removal unless it reappears.
- **#46** — on the web build, an image pasted into a never-saved document is dropped with no message. Pre-existing, unrelated to #14's residue, and not a request to implement web image saving — only to say something when the capability is absent.
- Release numbering at first public release: continue 0.2.x or restart at 1.0.
- `.github/ISSUE_TEMPLATE/` and CODE_OF_CONDUCT — #20 §D.
- **Retry versus fast failure on `apt-get`** — left to DEV's judgement in #47, with the reasoning to be stated rather than both applied.

## 5. Milestone log (newest first)

- **2026-08-19 — `assets/` moves to the save flow (#45, closing #14), after a review round that earned its keep.** Inserting an image into a document that never reaches disk now leaves nothing behind. The rescope held: DEV confirmed it by wiring the real insert and save paths behind a recording `PlatformIO` rather than by tracing the call graph, and the residue was an empty directory rather than a stray file, so the three architectural options in the issue body were moot.
  **The interesting part is what the review found.** Deferring the folder creation had quietly broken the consent — with no folder to make a second insert find `exists: true`, every image pasted before the first save re-opened the dialog, in the most ordinary flow there is. AMP flagged it as a *reading* rather than a measurement, holding its own review to the standard the brief had set for DEV; DEV measured it, then fixed the refusal side the same way, an asymmetry nobody had reported sitting three lines from the one that was. The review also changed the failure outcome: a document whose images could not be written now stays modified, so the unsaved-changes gate still stands in front of a clipboard image that exists only in memory. The requirement and the build disagreed on the first pass, which is what made the first review a request for changes rather than a preference — R-C5 now carries both clauses.
  Cost recorded honestly: the fix removed the insert flow's only visible feedback, and #48 is that debt.
- **2026-08-19 — Internal documentation at publication, decided** (recorded in full on #20). Moving a file does not remove it from history, and issues become public too — #20 is itself an internal planning document. So the question was never how to hide anything, and nothing in there is sensitive; the real problem is that a newcomer meets documents addressed to three internal roles. Decisions: the history is **not** rewritten; internal planning issues **stay**; this file moves to the private `agented-archive` at the gate, keeping its history and its PR-based maintenance; WORKFLOW splits into a public `CONTRIBUTING.md` plus role mechanics that leave the repository; the milestone log is re-expressed publicly as a changelog or release notes. The public status signal stays **thin and derived from things that update themselves** — README, releases, milestones — because a stale public status reads as abandonment, and what nobody has to remember to update cannot go stale.
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
