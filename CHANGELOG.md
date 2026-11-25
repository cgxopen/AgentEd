# Changelog

Notable changes to AgentEd, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Each entry is written for the people who use AgentEd: what changed for you, in plain words. The technical record of a change is the pull request that made it, linked beside the entry.

Changes that have landed but are not yet in a release wait under **Unreleased**. When a release is cut, that heading becomes the version number and the date.

## [Unreleased]

## [1.1.0] - 2026-11-25

The rest of the 1.1 list ([#674](https://github.com/cgxopen/AgentEd/issues/674)): links between your documents, a files panel that shows the markdown around a document, printing and PDF, renaming, and repairs to how a file is written.

### Added

- File, Export to PDF saves the document as a PDF, and File, Print (`Ctrl+P`) prints it ([#726](https://github.com/cgxopen/AgentEd/pull/726)).
- `Ctrl`+click on a relative link to a markdown file opens that file in AgentEd; with `Shift` held too, it opens in a window of its own. A link to a file of another kind, such as an image or a PDF, opens in the application the system gives it ([#728](https://github.com/cgxopen/AgentEd/pull/728), [#736](https://github.com/cgxopen/AgentEd/pull/736)).
- A Links badge in the header lists the relative links of the open document that point to a file that is not there. AgentEd reports them and never repairs them; web addresses are not checked ([#730](https://github.com/cgxopen/AgentEd/pull/730)).
- The files panel lists the markdown files around the document and the folders that hold them, as a tree, with the `assets` folders and what they hold ([#747](https://github.com/cgxopen/AgentEd/pull/747), [#749](https://github.com/cgxopen/AgentEd/pull/749), [#751](https://github.com/cgxopen/AgentEd/pull/751)).
- Check links in this folder, in the files panel, checks the links of every markdown file of the folder, when you ask for it. Nothing is written and no web address is looked at ([#778](https://github.com/cgxopen/AgentEd/pull/778)).
- Show links, in the files panel, lists the files the open document links to and the markdown files of the folder that link to it; a click opens one ([#798](https://github.com/cgxopen/AgentEd/pull/798)).
- File, Rename gives the open document another name in its own folder, without closing it ([#753](https://github.com/cgxopen/AgentEd/pull/753)).
- New from Template offers Agent Instructions, between Blank Document and Document with Metadata ([#755](https://github.com/cgxopen/AgentEd/pull/755)).
- The File changed on disk dialog offers Cancel: nothing is written and the document stays as you left it ([#738](https://github.com/cgxopen/AgentEd/pull/738)).

### Changed

- The files panel can be made wider by dragging its edge, and keeps that width ([#787](https://github.com/cgxopen/AgentEd/pull/787)).
- A files panel you opened by hand stays open: at the next start and for every document that has a file, until you shut it ([#789](https://github.com/cgxopen/AgentEd/pull/789), [#793](https://github.com/cgxopen/AgentEd/pull/793)).
- AgentEd opens at the size you left its window, and maximized when it was. The position is not kept ([#794](https://github.com/cgxopen/AgentEd/pull/794)).
- A short message at the bottom of the window stays longer when it has more words, and a press anywhere ends it ([#780](https://github.com/cgxopen/AgentEd/pull/780), [#785](https://github.com/cgxopen/AgentEd/pull/785)).
- The lists of links say more plainly what they found: Could not be checked for a link AgentEd could not answer for, No links to check when a folder holds none, and how to write a link that starts with a slash or a web address written without `https://` ([#780](https://github.com/cgxopen/AgentEd/pull/780), [#783](https://github.com/cgxopen/AgentEd/pull/783), [#795](https://github.com/cgxopen/AgentEd/pull/795)).

### Fixed

Saving a file you did not edit:

- A table column padded before its text keeps that padding ([#743](https://github.com/cgxopen/AgentEd/pull/743)).
- A strikethrough written with one tilde and a horizontal rule spelled otherwise than `---` keep their spelling ([#745](https://github.com/cgxopen/AgentEd/pull/745)).
- The text of an HTML block such as `aside` or `section` no longer gains a backslash before a bracket at each save ([#763](https://github.com/cgxopen/AgentEd/pull/763)).
- A continuation line in a list item after a nested list no longer gains four spaces at each save, and one in a task item no longer loses four ([#764](https://github.com/cgxopen/AgentEd/pull/764), [#770](https://github.com/cgxopen/AgentEd/pull/770)).
- A link shown inside the text of another link is no longer written as two links at the second save ([#768](https://github.com/cgxopen/AgentEd/pull/768)).
- A link whose address holds a space is kept as a link, where the second save wrote it as text ([#769](https://github.com/cgxopen/AgentEd/pull/769)).
- In a list item, a line at the margin after a blank line stays in the item, as CommonMark reads it; before, the rest of the list could leave the list ([#774](https://github.com/cgxopen/AgentEd/pull/774)).

Elsewhere:

- A long file name in a dialog wraps inside the dialog instead of running past its edge ([#742](https://github.com/cgxopen/AgentEd/pull/742)).

## [1.0.2] - 2026-11-14

Four more candidates of the 1.1 list ([#674](https://github.com/cgxopen/AgentEd/issues/674)) that are done: a metadata block for agent instructions, the licence in About, and a files panel without the files a system leaves behind. 1.1.0 comes with the rest of that list.

### Added

- Insert, Metadata offers Agent instructions beside Document: a block with `name` and `description`, the two fields that agent instruction files and skills require. AgentEd fills nothing in and checks nothing ([#719](https://github.com/cgxopen/AgentEd/pull/719)).
- About says that AgentEd is free and open source, under the MIT License, and calls it a visual Markdown editor ([#718](https://github.com/cgxopen/AgentEd/pull/718)).

### Changed

- The files panel and the Images popover leave out what a system or Git leaves in a folder, such as `.DS_Store`, `Thumbs.db`, `desktop.ini` and the `.git` folder, and other files whose names start with a dot. Other folders whose names start with a dot are hidden: a line at the bottom of the panel says how many, and Show lists them ([#720](https://github.com/cgxopen/AgentEd/pull/720), [#722](https://github.com/cgxopen/AgentEd/pull/722)).

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
