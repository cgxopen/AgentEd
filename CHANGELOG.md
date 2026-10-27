# Changelog

Notable changes to AgentEd, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Each entry is written for the people who use AgentEd: what changed for you, in plain words. The technical record of a change is the pull request that made it, linked beside the entry.

Changes that have landed but are not yet in a release wait under **Unreleased**. When a release is cut, that heading becomes the version number and the date.

## [Unreleased]

## [1.0.0] - 2026-10-27

First public release.

### Added

- A WYSIWYG markdown editor for Windows, with a macOS preview for Apple Silicon and an experimental Linux package. What AgentEd does is described in the [README](README.md), and what it promises in [REQUIREMENTS.md](REQUIREMENTS.md).
- Files are opened and saved as plain, portable markdown, and a file saved without edits is written back as it was, with the exceptions REQUIREMENTS.md records.
- A live token count beside the word and character counts.
- No account, no cloud, no telemetry: AgentEd makes no network calls of its own.

<!--
Sections used below a version, only when they have something in them:
Added, Changed, Fixed, Removed, Security.
One line per change, for example:
- Footnotes can be made from the toolbar, from Insert then Footnote, or with Ctrl+Alt+F (#409).
-->
