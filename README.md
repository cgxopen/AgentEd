# AgentEd

**A WYSIWYG markdown editor for the generative-AI era. Easy to use first — renders as you write, plain portable markdown underneath.**

> READ and WRITE markdown the way you'd expect in 2026: visual editing with no syntax in your face, on top of plain, portable `.md` files. A live token count and your project's context files one click away — quietly, when they matter. No vault. No account. No cloud.

[![Ko-fi](https://img.shields.io/badge/Support_on-Ko--fi-F16061?logo=ko-fi&logoColor=white)](https://ko-fi.com/cgxone)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-FFC131?logo=tauri)](https://tauri.app/)

> **Status — August 2026 reset.** This repository was reborn clean on 2026-08-14 around a simplified product definition — see [REQUIREMENTS.md](REQUIREMENTS.md) and [ADR-001](docs/ADR/ADR-001-reset-and-simplification.md). The code conversion from the private archive is tracked in issue #5; releases resume once it lands. Screenshots return with the conversion.

---

## Why AgentEd

In 2026 a growing share of what we write in markdown is read by a model before it is read by a person. The text is the same, but there is a second reader now. Existing editors solve the human half well and tell you nothing about the other half.

AgentEd is, first, a normal, comfortable markdown editor — and, quietly, one that also answers those questions.

- **Against a plain text editor** — WYSIWYG. Inline formatting, no syntax in your face. The document looks like a document.
- **Against Obsidian** — *file-first, not vault-first*. No vault to set up, no wiki-links, no graph view, no plugin ecosystem. Open any `.md` from anywhere; AgentEd never claims ownership of your folders. A ~3 MB native binary, not Electron.
- **Against Typora** — free, open source, and the AI-era instrumentation (live token count, context-file awareness) is native, not bolted on.

What it is **not**: a note-taking or knowledge-management app, a wiki, a word processor, a code editor, or a prompt playground.

---

## Features

- **WYSIWYG editing** — inline formatting, floating toolbar on selection, markdown input rules (`#` + space → heading, `-` + space → list, ``` + space or Enter → code block, optionally with a language between them, `[ ]` + space → task list). Tables, task lists, code blocks and images edited visually.
- **Clean round-trip** — the file you save is plain, portable markdown; opening and saving without edits never alters it.
- **Live token count** — statusbar, `gpt-tokenizer` (cl100k_base), fully offline, alongside word and character count.
- **Context awareness** — open a `CLAUDE.md`, `AGENTS.md`, `.cursorrules` and the 📎 *N related* indicator shows the other context files in your project, one click away.
- **New from Template** — four plain seeds: README, project document, meeting note, blank + frontmatter.
- **Find & Replace** — inline VS Code-style panel, match case / whole word / regex (safe-parse), `F3` navigation.
- **Images** — paste, drop, or Insert Media; saved to an `assets/` folder next to your file (created on first use, with confirmation), referenced with standard `![alt](path)` syntax, human-readable names.
- **Sidebar** — recursive tree when your document has adjacent structure.
- **Themes** — Light / Dark / Auto plus curated palettes, from the kebab (⋮) menu.
- **Multiple windows** — isolated instances, one file each.
- **Spell-check off by default** — technical documents stay free of noisy underlines; session toggle in the statusbar.
- **Unsaved-changes safety** — every destructive action routes through a safety gate.
- **Lightweight** — ~3 MB installer, opens in seconds, works as the smallest serious markdown viewer you'll find. No Electron.

Coming next (see [REQUIREMENTS.md](REQUIREMENTS.md) §8): plain text blocks that soft-wrap instead of scrolling sideways, and a hover **Copy** button on any block.

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+B` / `Ctrl+I` / `Ctrl+U` | Bold / Italic / Underline |
| `Ctrl+K` | Insert link (or edit / remove the link at the caret) |
| `Ctrl`/`Cmd` + click | Open a link in the system browser |
| `Ctrl+E` | Inline code |
| `Ctrl+Shift+K` / `Ctrl+Alt+C` | Code block (also **Edit → Insert Code Block**) |
| `Ctrl+S` / `Ctrl+Shift+S` | Save / Save As |
| `Ctrl+O` | Open |
| `Ctrl+Shift+V` | Paste as plain text |
| `Ctrl+F` / `Ctrl+H` | Find / Replace |
| `F3` / `Shift+F3` | Find next / previous |
| `Tab` / `Shift+Tab` | Indent / dedent (in lists) |

---

## Building from source

**Prerequisites:** Node.js 22+, Rust toolchain (via [rustup](https://rustup.rs/)), Tauri CLI.

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
