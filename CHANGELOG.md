# Changelog

Notable changes to AgentEd, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Each entry is written for the people who use AgentEd: what changed for you, in plain words. The technical record of a change is the pull request that made it, linked beside the entry.

Changes that have landed but are not yet in a release wait under **Unreleased**. When a release is cut, that heading becomes the version number and the date.

## [Unreleased]

## [1.0.2] - 2026-11-14

Four more candidates of the 1.1 list ([#674](https://github.com/cgxopen/AgentEd/issues/674)) that are done: a metadata block for agent instructions, the licence in About, and a files panel without the files a system leaves behind. 1.1.0 comes with the rest of that list.

### Added

- Insert, Metadata offers Agent instructions beside Document: a block with `name` and `description`, the two fields that agent instruction files and skills require. AgentEd fills nothing in and checks nothing ([#719](https://github.com/cgxopen/AgentEd/pull/719)).
- About says that AgentEd is free and open source, under the MIT License, and calls it a visual Markdown editor ([#718](https://github.com/cgxopen/AgentEd/pull/718)).

### Changed

- The files panel and the Images popover leave out the files a system leaves in a folder, such as `.DS_Store`, `Thumbs.db` and `desktop.ini`, and other files whose names start with a dot. Folders whose names start with a dot are hidden: a line at the bottom of the panel says how many, and Show lists them ([#720](https://github.com/cgxopen/AgentEd/pull/720), [#722](https://github.com/cgxopen/AgentEd/pull/722)).

## [1.0.1] - 2026-11-06

Repairs found after 1.0.0, and four candidates of the 1.1 list ([#674](https://github.com/cgxopen/AgentEd/issues/674)) that are already done: the help, the plain text of a copy, the centred block and a document for closed networks. 1.1.0 comes with the rest of that list.

### Added

- Help, Keyboard Shortcuts and Help, User Guide, each opening in a window of its own, offline ([#703](https://github.com/cgxopen/AgentEd/pull/703)).
- The plain text of a copy is markdown: pasted into a plain text field, a heading, a list, bold or a link arrive as the file would hold them. A very large selection still copies its words alone ([#698](https://github.com/cgxopen/AgentEd/pull/698)).
- A block centred by its HTML, such as a centred image, a row of badges or a heading, is drawn centred while it keeps that HTML ([#700](https://github.com/cgxopen/AgentEd/pull/700)).
- The toolbar tooltips name the keyboard shortcut of every button that has one ([#704](https://github.com/cgxopen/AgentEd/pull/704)).
- Installing AgentEd in restricted and offline networks is described in [docs/INSTALL-RESTRICTED-NETWORKS.md](docs/INSTALL-RESTRICTED-NETWORKS.md) ([#694](https://github.com/cgxopen/AgentEd/pull/694)).

### Fixed

- A list pasted from a web page or from another AgentEd window arrives whole, instead of joining its first and last items to the text around the caret ([#692](https://github.com/cgxopen/AgentEd/pull/692)).
- A task list pasted from a web page keeps its checkboxes ([#691](https://github.com/cgxopen/AgentEd/pull/691)).
- Enter in a code block inside a list item adds a line instead of splitting the item ([#681](https://github.com/cgxopen/AgentEd/pull/681)).
- A blank line typed into an empty code block is saved ([#680](https://github.com/cgxopen/AgentEd/pull/680)).
- A block inside a checklist item uses the full width of its row ([#683](https://github.com/cgxopen/AgentEd/pull/683)), and a checklist item that opens with a block no longer gains an empty paragraph beside its checkbox ([#688](https://github.com/cgxopen/AgentEd/pull/688)).
- The editor leaves space under the last block of a document ([#687](https://github.com/cgxopen/AgentEd/pull/687)).
- A table row holding two backslashes before a pipe no longer loses a cell on a save without edits ([#667](https://github.com/cgxopen/AgentEd/pull/667)).
- A link address holding a backslash is saved so that it reads back as the same address ([#666](https://github.com/cgxopen/AgentEd/pull/666)).

## [1.0.0] - 2026-10-27

First public release.

### Added

- A visual Markdown editor for Windows, with a macOS preview for Apple Silicon and an experimental Linux package. What AgentEd does is described in the [README](README.md), and what it promises in [REQUIREMENTS.md](REQUIREMENTS.md).
- Files are opened and saved as plain, portable markdown, and a file saved without edits is written back as it was, with the exceptions REQUIREMENTS.md records.
- A live token count beside the word and character counts.
- No account, no cloud, no telemetry: AgentEd makes no network calls of its own.

<!--
Sections used below a version, only when they have something in them:
Added, Changed, Fixed, Removed, Security.
One line per change, for example:
- Footnotes can be made from the toolbar, from Insert then Footnote, or with Ctrl+Alt+F (#409).
-->
