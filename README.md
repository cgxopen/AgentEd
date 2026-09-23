# AgentEd

**A WYSIWYG markdown editor for the generative-AI era. Easy to use first — renders as you write, plain portable markdown underneath.**

> READ and WRITE markdown the way you'd expect in 2026: visual editing with no syntax in your face, on top of plain, portable `.md` files. A live token count — quietly, when it matters. No vault. No account. No cloud.

[![Ko-fi](https://img.shields.io/badge/Support_on-Ko--fi-F16061?logo=ko-fi&logoColor=white)](https://ko-fi.com/cgxone)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-FFC131?logo=tauri)](https://tauri.app/)

---

## Why AgentEd

In 2026 a growing share of what we write in markdown is read by a model before it is read by a person. The text is the same, but there is a second reader now. Existing editors solve the human half well and tell you nothing about the other half.

AgentEd is, first, a normal, comfortable markdown editor — and, quietly, one that also answers those questions.

- **Against a plain text editor** — WYSIWYG. Inline formatting, no syntax in your face. The document looks like a document.
- **Against Obsidian** — *file-first, not vault-first*. No vault to set up, no wiki-links, no graph view, no plugin ecosystem. Open any `.md` from anywhere; AgentEd never claims ownership of your folders. A native binary in the ~3 MB class, not Electron.
- **Against Typora** — free, open source, and the AI-era instrumentation (a live token count) is native, not bolted on.

What it is **not**: a note-taking or knowledge-management app, a wiki, a word processor, a code editor, or a prompt playground.

---

## Features

- **WYSIWYG editing** — inline formatting, a floating toolbar on selection, and markdown input rules (`#` + space → heading, `-` + space → list, ``` → code block — optionally with a language, `[ ]` → task list). Tables, task lists, code blocks and images are edited visually.
- **Clean round-trip** — the file you save is plain, portable markdown; opening and saving without edits never alters it. The handful of deliberate exceptions are documented, one by one, in [REQUIREMENTS.md](REQUIREMENTS.md).
- **No silent writes, no silent overwrites** — nothing reaches disk without your say-so. If the file changed on disk while you were editing, AgentEd tells you and you choose: reload, overwrite, or save elsewhere. No lock files next to your documents, ever.
- **A quiet header, not a status bar** — the live token count (`gpt-tokenizer`, cl100k_base, fully offline) with word and character counts, and search — all in one row that stays out of the way. On Windows that row is also the title bar: the AgentEd name at the left, the window buttons at the right, one bar instead of two.
- **A real menu** — File, Edit (Find and Replace, Undo, Redo, Select All, Image description, and Spell check — off by default, so technical documents stay free of noisy underlines), Insert (Table, Media, Code Block, Checklist, Footnote, Horizontal Rule, Metadata, Emoji), Table (Add Row Above, Add Row Below, Delete Row, Add Column Before, Add Column After, Delete Column, Delete Table), Help. Everything the editor can do has a visible door — that is a design rule here, not an accident.
- **Code blocks** — click the language label to set the language; a hover **Copy** button on every block; a fence with no language is a plain-text box that soft-wraps — the "prompt box" familiar from AI chat tools, in plain standard markdown.
- **Images** — paste, drop, or Insert → Media; saved to an `assets/` folder next to your file, referenced with standard `![alt](path)` syntax, human-readable names. **Image description** — from the toolbar button on a selected image or from the Edit menu — writes what a screen reader reads out and what a renderer shows when the picture cannot be loaded.
- **Footnotes** — the bracket form GitHub reads, `[^1]` where you refer to a note and `[^1]: the note` where you write it. Make one from the floating-toolbar button, from Insert → Footnote or with `Ctrl+Alt+F`: the reference lands after what you selected and the note at the end of the document, both in one step, so one `Ctrl+Z` takes the pair back. Hover a reference to read its note without leaving your place. A document that already had footnotes opens and saves with its own spelling untouched.
- **Metadata without the jargon** — a document's title, date and other front-matter fields live in a small panel, not in raw YAML in your face. Insert → Metadata adds the block to any document; deleting every field removes it completely.
- **New from Template** — two plain seeds: a blank document, and a document with a metadata block.
- **Find & Replace** — an inline panel, match case / whole word / regex (safe-parse), `F3` navigation.
- **Files panel** — a file tree when your document has an `assets/` folder beside it and uses it. It opens and closes from the panel button at the right end of the header, or with `Ctrl+Shift+E`, and the button shows which of the two the next press will do. It sits on the right, drawn as a card, and takes its own room rather than covering what you were writing.
- **Themes** — Light / Dark / Auto and curated palettes, from the Appearance button (the half-filled circle near the right end of the header, one place in from the panel button). On Windows the whole bar, title bar included, is in the colour of your palette.
- **Multiple windows** — isolated instances, one file each.
- **Offline by design** — AgentEd makes no network calls of its own. No telemetry, no account, no cloud.
- **Lightweight** — an installer in the ~3 MB class, opens in seconds. No Electron.

---

## Installing on Windows

AgentEd is currently unsigned, so the first run of the installer meets Microsoft Defender SmartScreen. The dialog is titled **"Windows protected your PC"** and its first screen has no Run button — that is by design, and here is the way through:

1. Click **More info** (the small link under the text).
2. Check that the app is the installer you downloaded and the publisher reads *Unknown publisher* — that is us, for now.
3. Click **Run anyway**.

This happens **once, at install**. The installed application starts quietly afterwards. Signing is planned once the project can carry it; until then, the two clicks above are the honest price of a small free tool.

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+B` / `Ctrl+I` / `Ctrl+U` | Bold / Italic / Underline |
| `Ctrl+K` | Insert link (or edit / remove the link at the caret) |
| `Ctrl`/`Cmd` + click | Open a link in the system browser |
| `Ctrl+E` | Inline code |
| `Ctrl+Shift+K` | Code block |
| `Ctrl+Alt+1` … `Ctrl+Alt+6` | Heading level 1–6 |
| `Ctrl+Alt+0` | Body text |
| `Ctrl+Shift+S` | Strikethrough |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+A` | Select all |
| `Ctrl+S` | Save (Save As is in the File menu) |
| `Ctrl+O` | Open |
| `Ctrl+V` / `Ctrl+Shift+V` | Paste (reads markdown) / Paste as plain text |
| `Ctrl+F` / `Ctrl+H` | Find / Replace |
| `Ctrl+Alt+F` | Footnote (Insert → Footnote does the same) |
| `Ctrl+Shift+E` | Files panel (open / close) |
| `F3` | Find next (Find Previous is in the Edit menu) |
| `Shift+Enter` | Line break inside a paragraph |
| `Tab` / `Shift+Tab` | Indent / dedent in lists; move between table cells |

---

## Known limitations

Honest edges, documented rather than discovered:

- **Line breaks inside a paragraph** are made with `Shift+Enter` or `Ctrl+Enter`. There is no button or menu entry for one.
- **A file that begins with a line of three hyphens** and has another such line further down opens with everything between them as metadata — the panel at the top — rather than as text. Tools that read front matter, Obsidian among them, read such a file the same way. AgentEd never writes a file in this shape itself, so this concerns files written by hand or by another tool. Where the second line of hyphens sits inside a code block, the file opens without that block and the text after it shows as code; saving loses no bytes, but the file keeps opening this way.
- **Paste as plain text** in the right-click menu behaves like an ordinary paste — Windows hands the page the same content either way, so AgentEd cannot tell them apart. For a literal paste, use `Ctrl+Shift+V`.
- **Spell check works in one language at a time**, and on Windows that language is the first one in the Windows preferred-languages list (Settings, Language), read when AgentEd starts, so a change there applies once every AgentEd window has been closed and AgentEd opened again.
- **Insert → Metadata** is not part of undo: `Ctrl+Z` does not remove the block it adds. Deleting every field in the panel removes the block as if it had never been there.

---

## Project status

AgentEd is in active development, built and tested on **Windows**; the Windows installer is the shipping target. Linux and macOS builds are planned after the first public releases. The product definition lives in [REQUIREMENTS.md](REQUIREMENTS.md) — what it promises, what it deliberately does not do, and every known exception, in one file.

---

## Building from source

**Prerequisites:** Node.js 20+, Rust toolchain (via [rustup](https://rustup.rs/)), Tauri CLI.

```
git clone https://github.com/catge/AgentEd.git
cd AgentEd
npm install
cargo install tauri-cli
npm run tauri dev
```

Production build: `npm run tauri build`

---

## Contributing

Contributions are welcome — please read [CONTRIBUTING.md](CONTRIBUTING.md) first. For larger changes, open an issue to discuss direction. Everything in this repository — code, docs, commits, PRs, issues — is in English.

## Support

If you find this project useful, consider supporting its development on [Ko-fi](https://ko-fi.com/cgxone).

AgentEd itself does not collect, store, or process any payment information. All contributions are handled entirely by Ko-fi under its own [terms and privacy policy](https://more.ko-fi.com/privacy).

## License

MIT — see [LICENSE](LICENSE).

## Author

Built by [Cătălin Vasile](https://github.com/catge) using Claude Code.
Questions or feedback — open an issue or reach out on [X](https://x.com/CatalinG_Vasile).
