# AgentEd — Product Requirements

**Version**: 1.0 — approved by the owner on 2026-08-14. This document defines the simplified AgentEd after the August 2026 reset; any future change goes through a PR on this file.
**Supersedes**: all prior requirement documents, ADR-001..034 (archived in the private `agented-archive` repository).

---

## 1. Product statement

AgentEd is an **easy-to-use WYSIWYG markdown editor**. Open any `.md` file and edit it the way you'd expect in 2026 — no syntax in your face, no vault, no account, no cloud. A small, fast, native binary that respects your files and never claims ownership of your folders.

Quietly, in the background, AgentEd also acknowledges that a growing share of markdown is read by AI models before it is read by people — and offers lightweight instrumentation for that: a live token count and one-click access to the related context files in your project.

**Priority order when requirements conflict**: (1) ease of use → (2) speed & lightness → (3) AI-era instrumentation.

## 2. Core requirements — the editor

- **R-C1 WYSIWYG editing.** Inline formatting with no visible markdown syntax; floating toolbar on selection; markdown input rules (`#`+space → heading, `-`+space → list, ``` → code block, `[ ]` → task list, etc.); tables, task lists, code blocks and images edited visually. Numbered lists must number correctly across the document (see D1 in §10).
- **R-C2 Clean round-trip.** Bidirectional serialization: the file saved is plain, portable markdown; open→save with no edits must not alter the file.
  - **Known exception — loose lists.** A loose list (blank lines between items) is saved as a tight one. TipTap's list nodes carry no loose/tight distinction, so the information is lost before serialization; the difference is visible when rendered, since loose items are wrapped in `<p>`. Documented rather than hidden, pinned by a test, and tracked for a possible fix in issue #28. Any *new* exception to R-C2 must be recorded here in the same PR that introduces it — an undocumented exception is a defect.
- **R-C3 File operations & the no-silent-write invariant.** New, Open, Save, Save As, Close — every destructive path routes through the unsaved-changes safety gate, **explicitly including window close and app quit**. The editor **never writes to disk without an explicit user save decision**: closing with unsaved changes always asks (save / discard / cancel). See D3 in §10 for the currently observed violation.
- **R-C4 Find & Replace.** Inline panel (`Ctrl+F`/`Ctrl+H`), match case / whole word / regex with safe-parse, `F3` navigation, Replace All confirmation above 50 matches. Header 🔍 button and Edit-menu entries stay.
- **R-C5 Images.** Paste / drop / Insert Media → `assets/` folder next to the file, created on first use with confirmation; standard `![alt](path)` references. Relative `assets/` paths are standard portable markdown — GitHub and every mainstream renderer resolve them (e.g. in a repo README) as long as the folder travels with the file; this is a general convention, not an AgentEd-local format. **There is no "image document" mode**: any document can receive images at any time, with no upfront choice at creation. The first insertion triggers the flow above; an already-existing `assets/` folder is simply used — never a warning, never a block. **Naming: human-readable, never hashes.** Files that already have a name (Insert Media, drag & drop) keep it, sanitized for portability (diacritics → ASCII, spaces → hyphens); clipboard images with no name get one derived from the document (`<document-name>-01.png`, `-02`, …); collisions are resolved with a numeric suffix (`diagram-2.png`) — nothing is ever overwritten. AgentEd never creates `assets/` preemptively and never deletes it — not even when the document no longer references images. The «Images» badge (R-C12) is derived from content and appears/disappears by itself.
- **R-C6 Sidebar.** Recursive tree when the document has adjacent structure; markdown files switch focus through the safety gate, other files open with the OS default app.
- **R-C7 Themes.** Light / Dark / Auto mode + curated palettes, persisted across sessions, selected from the kebab (⋮) menu.
- **R-C8 Multi-window.** Multiple isolated instances; each with its own file and edit history. Two windows opening the same file fall under R-C14.
- **R-C9 Spell-check off by default**, session toggle in the statusbar.
- **R-C10 Keyboard shortcuts** as currently shipped (README table carries over).
- **R-C11 OS integration.** File association and CLI open.
- **R-C12 Statusbar contents.** Token count, word count, character count, and the spell toggle. **Document-kind badges appear only when the document warrants them**: a **«Metadata»** badge when a frontmatter block is present, an **«Images»** badge when the document references images/assets — combinable, each with a tooltip explaining in plain words (e.g. *"This document starts with a metadata block (YAML frontmatter)"*). A plain document shows **no badge at all** — the statusbar stays clean for the common case. User-facing wording avoids jargon (**"Metadata"**, not "Frontmatter"). Badges are purely descriptive: no validation attached, nothing ever blocked. Clicking the «Images» badge opens a small informative popover — how many images this document uses and how many other files the shared `assets/` folder holds (e.g. *"3 images used by this document · assets/ holds 9 more files"*). Information on demand, never a permanent warning: a shared `assets/` folder is the normal markdown convention, not a problem state.
- **R-C13 Predictable paste.** Pasting inserts what the user means: plain text is read as markdown, so content copied from another editor or an AI chat arrives formatted rather than as escaped source; `Ctrl+Shift+V` inserts the characters literally instead. URLs are **not** auto-converted into links on paste. Rich HTML from the clipboard converts to clean markdown with no artifacts (no stray `http` fragments, no leftover markup).
- **R-C14 Concurrent & external change safety.** AgentEd never silently overwrites a file that changed on disk since it was opened: before every save, the file's on-disk state is compared (mtime/hash); if it changed externally — another program, a sync service, or a second AgentEd window — the user chooses reload / overwrite / save-as. No lock file is ever written next to the user's documents (see §9, decision 2).
- **R-C15 Code & text block affordances.** Fenced blocks show, on hover, a **Copy** button (top-right) copying the raw contents to the clipboard. Blocks with a language show a **language label** (top-left), clickable to set or change it; the language lives in the standard markdown fence info string (e.g. ```` ```python ````). A fence with **no language** is a **plain text box** — the same bordered block with the same hover Copy button, no language label (the picker offers *Text*), and soft-wrapped lines instead of horizontal scrolling: the "prompt box" pattern familiar from AI chat interfaces, expressed as plain standard markdown. Pure editor chrome — nothing non-standard is ever written into the file.

## 3. Kept AI-era layer (secondary)

- **R-A1 Token counter.** Statusbar, `gpt-tokenizer` (cl100k_base), lazily loaded, offline, length-based fallback — alongside word and character count.
- **R-A2 Context awareness.** The 📎 *N related* indicator when opening known context files (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`, …): scan up to 5 levels up plus immediate subdirectories, preview first line, one-click switch through the safety gate. **No validation attached to any of these files.**
- **R-A3 New from Template.** Gallery of four plain markdown templates: **README**, **project document**, **meeting note**, **blank + frontmatter**. Skill and llms.txt templates leave with their profiles.

## 4. Removed in this reset (archived, not lost)

- Profile Registry as user-facing machinery: skill validation profiles (Claude, OpenClaw, AgentSkills v1), the llms.txt profile, the validation side panel, the statusbar profile indicator/override.
- Frontmatter auto-injection at save.
- Profile-driven structured layout detection (the sidebar keeps its simpler "adjacent structure" trigger).
- Skill/llms.txt templates in the gallery.

Removal is **physical** — the code is deleted from this repository. The archive repo retains everything; reintroduction (skills, OKF profile, Agent View, visual frontmatter editor) is a deliberate, separate phase after the public launch, driven by its own requirements document.

## 5. Non-goals

Not a note-taking or knowledge-management app, not a wiki, not a word processor, not a code editor, not a prompt playground. No vault, no plugin ecosystem, no graph view, no wiki-links, no cloud, no account, no telemetry.

## 6. Quality requirements

- **Q1 Size**: Windows installer stays in the ~3 MB class (expected to shrink after the cut).
- **Q2 Startup**: opens in under ~2 s on typical hardware; usable as a fast viewer.
- **Q3 Offline**: zero network calls at runtime.
- **Q4 Stability**: no data loss — the safety-gate invariant (R-C3) and the no-silent-overwrite invariant (R-C14) are non-negotiable.
- **Q5 Supportability**: the application states its own version and build commit, reachable in at most two clicks and copyable in one, so that any report can be tied to the exact build it came from. A build produced outside CI says so plainly rather than showing a commit it cannot know. This is stated *to* the user, never sent anywhere — Q3 stands.

## 7. Platforms & delivery

- **Repository**: `github.com/catge/AgentEd` (born clean at the reset). Prior history lives in the private `agented-archive`.
- **Primary target: Windows** (`.exe` installer). The web build remains a supported build target and the CI test surface.
- **Platform abstraction**: file access and OS integration stay behind the existing platform layer (`src/platform`), so future targets (PWA, mobile) remain feasible without re-architecture.
- **CI on push/PR**: lint + unit tests on Linux runner (covers the web app) + Windows build.
- **Nightly**: Windows only, skipped when there are no new commits since the last successful run; artifact retention 7 days.
- **Release (`v*` tags)**: full matrix — Windows always; Linux and macOS are built *only* here.

## 8. Roadmap after reset

- **Pre-public, committed**: multi-tab editing; code & text block affordances (R-C15); fixing the known defects listed in §10 (D3 first — it violates Q4).
- **Pre-public, candidates** (owner-prioritized): copy-any-block on hover (copy any paragraph/table/section as markdown or as formatted rich text — pure UI, file untouched); performance/polish pass, first-run experience.
- **Post-public phases (parked)**: **PWA / installable mobile web app** — strategic rationale worth preserving: foldable phones make real document editing on mobile viable for the first time, and a few-MB offline WYSIWYG editor is the right shape for that segment, standing in for heavyweight document formats on text-first documents; kept feasible by the platform-abstraction rule in §7; browser file-access limits (esp. iOS) to be studied then. **Sealed document archive (export)** — a single-file, zip-based container bundling the markdown + its `assets/`, optionally signed: one-file sharing plus PDF-like finality through signing; if ever pursued, strictly an *export* format — the working format stays plain `.md` (naming note: `.mdx` is already taken by MDX = Markdown + JSX). Also parked: skill profiles reintroduction, OKF profile, Agent View, visual frontmatter editor, native mobile.

## 9. Decision log (reset iteration, August 2026)

1. **Discrete document badges.** Statusbar badges («Metadata», «Images») are descriptive, not modes; silent on plain documents; plain-language wording for non-specialists.
2. **Detection over lock file** for concurrent-change safety: a lock file would pollute user folders, contradict the no-ownership promise, and misbehave in synced folders. Owner-approved.
3. **"Reading mode" toggle rejected** — it adds a mode, and modes cost simplicity. The related "sealed archive" idea was parked as an export format instead (§8).
4. **No "image mode"** — images insertable in any document at any time; `assets/` created on first use with confirmation, existing folders used silently; human-readable file names, never hashes.
5. **Text boxes are plain fences** — the "prompt box with Copy" pattern is a language-less code fence, standard markdown; no new syntax invented.
6. **History reset**: new repository born clean; complete prior history, PRs and ADR-001..034 preserved in the private `agented-archive`. License stays MIT; monetization via donations (Ko-fi + GitHub Sponsors).
7. **Paste reads markdown (R-C13, revised).** The original wording required plain text to be inserted literally, which turned pasted markdown source into escaped text (`\*\*foo\*\*`) in the file — syntax appearing because of how content arrived, the same failure class the requirement exists to prevent. `Ctrl+V` now parses; `Ctrl+Shift+V` is the literal escape hatch.

## 10. Known defects carried from the current build (filed as issues at repo creation)

- **D1 — Numbered lists restart at 1** across separated paragraphs instead of numbering continuously. (Bug: list serialization/splitting.)
- **D2 — Paste artifacts**: stray `http` link fragments; paste generally not plain-text-predictable. (Covered by R-C13.)
- **D3 — Closing without saving overwrites the file on disk** — no confirmation dialog. **Severity: critical** — violates R-C3/Q4. First fix after conversion.
- **D4 — Selection flicker + dropped characters** when selecting with the mouse in one direction (L→R or R→L); the other direction works. (Bug: needs reproduction details — direction, desktop vs web.)

These are **not** fixed in the conversion PR (which is pure removal); they are issues #1..#4 and are fixed pre-public per §8.
