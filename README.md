<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/banner-dark.png">
    <img src="docs/images/banner-light.png" alt="AgentEd — A comfortable visual Markdown editor">
  </picture>
</p>

Turn notes, project briefs, and AI instructions into clear Markdown files. Edit visually, keep your files, and see a live token estimate as you write.

<div align="center">

**Free · Open source · Local files · No account · No telemetry · Windows installer under 3 MB**

</div>

<div align="center">

[![Ko-fi](https://img.shields.io/badge/Support_on-Ko--fi-F16061?logo=ko-fi&logoColor=white)](https://ko-fi.com/cgxone) [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE) [![Tauri](https://img.shields.io/badge/Tauri-2.0-FFC131?logo=tauri)](https://tauri.app/)

</div>

<div align="center">

[Website](https://agentedapp.com/) · [Windows preview](https://github.com/cgxopen/AgentEd/releases/tag/v0.2.0-preview.6) · [Quick start](https://agentedapp.com/quick-start.html) · [Feedback](https://github.com/cgxopen/AgentEd/issues)

</div>

<p align="center">
  <img src="docs/images/project-brief.gif" alt="AgentEd editing project-brief.md: a line becomes a heading from the floating toolbar, checklist items are ticked, the YAML metadata panel opens, and the menu shows Insert.">
</p>

[**See AgentEd in action · 1 minute**](https://agentedapp.com/#demo)

## Why AgentEd?

Markdown is a plain-text format for headings, lists, links, and more. You may have encountered it while working with AI assistants. AgentEd lets you edit these files visually, without memorising the formatting syntax.

- **Focus on your words.** Format documents with visual controls and see the result as you write.
- **Private by design.** No account, no telemetry, no built-in cloud service. Your documents stay on your computer, and AgentEd makes no network calls of its own, which matters when your instructions carry project or client details. On Windows, the web runtime underneath connects on its own; [SECURITY.md](SECURITY.md) says when.
- **Prepare clearer AI instructions.** Keep project context, goals, preferences, and boundaries in reusable Markdown files.
- **Keep your files.** Open and save ordinary `.md` files in folders you choose, without setting up a vault or creating an account.
- **Read as well as write.** Open a `.md` file and it reads like a finished document; start typing when you want to change it.

AgentEd helps you prepare documents for use with AI tools; it does not include an AI chat or run agents.

## Download and get started

The current test build is **v0.2.0-preview.6, for Windows x64, for macOS on Apple Silicon and, experimentally, for 64-bit x86 Linux**, prepared before the public launch. It is a pre-release and may be replaced.

[**Download the Windows preview**](https://github.com/cgxopen/AgentEd/releases/download/v0.2.0-preview.6/AgentEd_0.2.0_x64-setup.exe) · [**Download the macOS preview**](https://github.com/cgxopen/AgentEd/releases/download/v0.2.0-preview.6/AgentEd_0.2.0_aarch64.dmg) · [**Download the Linux preview**](https://github.com/cgxopen/AgentEd/releases/download/v0.2.0-preview.6/AgentEd_0.2.0_amd64.deb) · [Release notes and SHA-256 checksums](https://github.com/cgxopen/AgentEd/releases/tag/v0.2.0-preview.6)

On macOS, the first launch takes a few extra steps; see [macOS installation](#macos-installation) below.

The Windows installer is in the **~3 MB class**. This refers to the installer download, not the application's total installed footprint or any required runtime.

1. Download the installer from the release page.
2. Install AgentEd. This preview is unsigned; see [Windows installation](#windows-installation) below if Windows displays a warning.
3. Open an existing Markdown file or create a new document.
4. Save it to a folder on your computer.

[Read the full quick start](https://agentedapp.com/quick-start.html).

**Platforms:** Windows is the primary preview platform. Releases contain a Windows installer, from v0.2.0-preview.4 a macOS preview for Apple Silicon as a `.dmg`, and from v0.2.0-preview.6 an experimental Linux package as a `.deb`, tested on Ubuntu 24.04; see [Linux installation](#linux-installation).

## Features

- **Visual formatting:** headings, lists, checklists, links, and tables, with a floating toolbar and Markdown input shortcuts. Add or remove table rows and columns from the menu.
- **Portable Markdown and explicit saving:** work with ordinary `.md` files and choose when to save. If a file changes on disk, choose whether to reload, overwrite, or save elsewhere. Documented format exceptions are listed in [REQUIREMENTS.md](REQUIREMENTS.md).
- **Images:** paste, drop, or insert images into a local `assets/` folder beside your document; add image descriptions for accessibility.
- **Code blocks:** select a language, copy a block with its Copy button, or use a plain-text block with soft wrapping.
- **Footnotes:** insert a reference and its note together, then hover over the reference to read it.
- **Document metadata and templates:** edit YAML front matter in the **Metadata** panel; start with a blank document or one with metadata.
- **Live counts:** tokens, words, and characters in the header. Token counting runs offline using `gpt-tokenizer` with `cl100k_base`; other models, chat formatting, and attachments can produce different totals.
- **Find and replace:** match case, whole words, or regular expressions.
- **Files panel:** browse the document's adjacent file structure in a side panel.
- **Appearance:** light, dark, automatic mode, and curated palettes.
- **Multiple windows:** work with one document in each independent window.
- **Spell check:** optional and off by default.

## For AI instructions and everyday notes

### Keep reusable AI instructions together

Write goals, preferences, and boundaries in Markdown, with YAML metadata alongside the document.

<p align="center">
  <img src="docs/images/assistant.png" alt="AgentEd showing reusable workshop assistant instructions, an expanded YAML metadata panel and the heading formatting toolbar.">
</p>

### Explain with images and tables

Combine written instructions, illustrations, and practical details in one document.

<p align="center">
  <img src="docs/images/guide-frame.png" alt="AgentEd showing a natural-light guide with a camera photograph and a session table.">
</p>

When sharing a document that uses local images, include its referenced `assets/` folder so the images remain available.

## Windows installation

This preview is not digitally signed. Windows may display **Windows protected your PC** or **Unknown publisher** when you open the installer.

Download from the official release linked above and check the filename and version. The release also provides SHA-256 checksums for checking that your download matches the published file.

If you have verified the source and choose to continue, select **More info**, then **Run anyway**, if Windows offers that option. An unknown publisher label does not verify the developer's identity. Managed computers or other Windows settings may prevent installation.

Do not disable antivirus protection or SmartScreen. If your antivirus reports a specific threat, stop and report the exact message and release version.

Signing is planned for a future release. [Read the installation help](https://agentedapp.com/installation-help.html).

## macOS installation

The macOS preview is for Apple Silicon Macs (M1 and later). It is not notarized by Apple, so macOS blocks it the first time it opens. These steps were checked with v0.2.0-preview.4 on macOS 26.6:

1. Open the `.dmg` and drag **AgentEd** onto **Applications**, then start it from **Applications** rather than from the disk image.
2. macOS shows **“AgentEd” Not Opened**. Click **Done**.
3. Open **System Settings**, then **Privacy & Security**, and scroll to **Security**. Next to the line **“AgentEd” was blocked to protect your Mac**, click **Open Anyway**.
4. In the dialog that follows, click **Open Anyway**. The highlighted button in that dialog is **Move to Trash** (**Move to Bin** in British English), which deletes the application.
5. Enter your password. AgentEd opens, and from then on it opens without asking.

macOS asks again each time AgentEd is installed anew: every new installation opens only after steps 2 to 5 are repeated once for it.

The **Open Anyway** button is offered for about an hour after the first attempt. As on Windows, download from the official release and check the SHA-256 checksum before you continue.

On macOS, a document opened from Finder opens in a window of its own, and **File**, **New Window** (Cmd+Shift+N) opens an empty one. The shortcut hints in the menus name Command, as the table below does.

## Linux installation

Linux builds are **experimental**. They were tested on Ubuntu 24.04 (GNOME, Wayland) in a VirtualBox virtual machine, and on no other distribution.

The release contains a `.deb` package for 64-bit x86 systems. It needs **glibc 2.34** or later and **WebKitGTK 4.1**. The package declares both, so the package manager installs WebKitGTK if it is missing and refuses a system whose glibc is older. Download the package from the release page, check its SHA-256 checksum, then install it from the folder you saved it to:

```sh
sudo apt install ./AgentEd_*_amd64.deb
```

AgentEd then appears among your applications. On a stock Ubuntu it also becomes the application that opens Markdown files, since no other installed application declares them; choose another one with **Open With** in the Files app if you prefer. Each file you open gets a window of its own, and a file AgentEd does not open, such as a `.txt` file, says why.

To remove AgentEd, run `sudo apt remove agent-ed`. Your documents are not touched, and the settings AgentEd keeps for itself stay in `~/.local/share/com.agentedapp.editor` and `~/.config/com.agentedapp.editor`; delete those two folders too if you want nothing left behind.

## Keyboard shortcuts

| Windows | macOS | Action |
|---------|-------|--------|
| `Ctrl+B` / `Ctrl+I` / `Ctrl+U` | `Cmd+B` / `Cmd+I` / `Cmd+U` | Bold / Italic / Underline |
| `Ctrl+K` | `Cmd+K` | Insert link (or edit / remove the link at the caret) |
| `Ctrl` + click | `Cmd` + click | Open a link in the system browser |
| `Ctrl+E` | `Cmd+E` | Inline code |
| `Ctrl+Shift+K` | `Cmd+Shift+K` | Code block |
| `Ctrl+Alt+1` … `Ctrl+Alt+6` | `Cmd+Option+1` … `Cmd+Option+6` | Heading level 1–6 |
| `Ctrl+Alt+0` | `Cmd+Option+0` | Body text |
| `Ctrl+Shift+S` | `Cmd+Shift+S` | Strikethrough |
| `Ctrl+Z` / `Ctrl+Y` | `Cmd+Z` / `Cmd+Shift+Z` or `Cmd+Y` | Undo / Redo |
| `Ctrl+A` | `Cmd+A` | Select all |
| `Ctrl+S` | `Cmd+S` | Save (Save As is in the File menu) |
| `Ctrl+O` | `Cmd+O` | Open |
| `Ctrl+V` / `Ctrl+Shift+V` | `Cmd+V` / `Cmd+Shift+V` | Paste (reads markdown) / Paste as plain text |
| `Ctrl+F` / `Ctrl+H` | `Cmd+F` / `Cmd+Option+F` | Find / Replace (on a Mac `Cmd+H` hides AgentEd, as in every Mac app) |
| `Ctrl+Alt+F` | `Cmd+Option+R` | Footnote (Insert → Footnote does the same) |
| `Ctrl+Shift+E` | `Cmd+Shift+E` | Files panel (open / close) |
| `F3` | `Fn+F3` | Find next |
| `Shift+F3` | `Fn+Shift+F3` | Find previous |
| `Shift+Enter` | `Shift+Enter` | Line break inside a paragraph |
| `Tab` / `Shift+Tab` | `Tab` / `Shift+Tab` | Indent / dedent in lists; move between table cells |

---

## Known limitations

Honest edges, documented rather than discovered:

- **Line breaks inside a paragraph** are made with `Shift+Enter` or `Ctrl+Enter`. There is no button or menu entry for one.
- **A file that begins with a line of three hyphens** and has another such line further down opens with everything between them as metadata — the panel at the top — rather than as text. AgentEd never writes a file in this shape itself, so this concerns files written by hand or by another tool. Where the second line of hyphens sits inside a code block, the file opens without that block and the text after it shows as code; saving loses no bytes, but the file keeps opening this way.
- **Paste as plain text** in the right-click menu behaves like an ordinary paste — Windows hands the page the same content either way, so AgentEd cannot tell them apart. For a literal paste, use `Ctrl+Shift+V`.
- **Spell check works in one language at a time**, and on Windows that language is the first one in the Windows preferred-languages list (Settings, Language) when the checker has a dictionary for it, and the Windows display language otherwise; the list is read when AgentEd starts, so a change there applies once every AgentEd window has been closed and AgentEd opened again.
- **Linux was tested in one place only**: Ubuntu 24.04 with GNOME on Wayland, in a virtual machine with 3D acceleration off. Other desktops such as KDE or Xfce, an X11 session and a machine with 3D acceleration on were not tried, and no `.rpm` package is published.
- **Insert → Metadata** is not part of undo: `Ctrl+Z` does not remove the block it adds. Deleting every field in the panel removes the block as if it had never been there.

---

## Project status

AgentEd is in active development. The preview focuses on visual editing of local Markdown files, with Windows as the primary platform.

The product definition and documented exceptions live in [REQUIREMENTS.md](REQUIREMENTS.md).

## Building from source

You need Node.js 22.12 or later in the 22 line, 24, or 26 and later, as the `engines` field in `package.json` states (CI runs Node.js 24); the odd-numbered lines are not supported. You also need the Rust toolchain (via [rustup](https://rustup.rs/)) and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
git clone https://github.com/cgxopen/AgentEd.git
cd AgentEd
npm install
npm run tauri dev
```

The Tauri CLI is included in the project's development dependencies.

Production build: `npm run tauri build`

Before opening a pull request, run the [verification checklist](CONTRIBUTING.md#verification-checklist-before-a-pull-request) in CONTRIBUTING.md: the linters, the type check, the tests and the web build.

## Contributing

Contributions are welcome — please read [CONTRIBUTING.md](CONTRIBUTING.md) first. For larger changes, open an issue to discuss direction. Everything in this repository — code, docs, commits, PRs, issues — is in English.

## Support AgentEd

AgentEd is free. If it is useful to you, you can support it on [Ko-fi](https://ko-fi.com/cgxone).

Support goes to CGX Consulting SRL, the company that publishes AgentEd, and is spent on maintaining and developing AgentEd, for example:

- fixing reported bugs;
- testing on Linux;
- a macOS build, which needs an Apple developer certificate paid every year;
- new features, within what [REQUIREMENTS.md](REQUIREMENTS.md) sets out.

How money given to the project is handled is set out in [CONTRIBUTING.md](CONTRIBUTING.md#money-given-to-the-project).

AgentEd itself does not collect, store, or process any payment information. All contributions are handled entirely by Ko-fi under its own [terms and privacy policy](https://more.ko-fi.com/privacy).

## License

MIT — see [LICENSE](LICENSE).

The MIT license covers the code, not the AgentEd name or logo: a fork is welcome, under a name of its own.

## Author and contact

AgentEd is a project by **CGXC —** [**CGX Consulting SRL**](https://cgxconsulting.com/).

Built by [Cătălin Vasile](https://github.com/catge) using Claude Code. For bugs and feature requests, [open an issue](https://github.com/cgxopen/AgentEd/issues). For other enquiries, email [contact@cgxconsulting.com](mailto:contact@cgxconsulting.com) or reach out on [X](https://x.com/CatalinG_Vasile).

## History

AgentEd began on 29 March 2026. This repository opened a new phase in August 2026.
