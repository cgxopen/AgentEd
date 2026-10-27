<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/banner-dark.png">
    <img src="docs/images/banner-light.png" alt="AgentEd — A comfortable visual Markdown editor">
  </picture>
</p>

**A visual Markdown editor with YAML frontmatter editing and live token estimates.**

Create and refine notes, AI instructions, project context, and knowledge documents with intuitive visual editing. Open and save ordinary `.md` files in your own folders — no vault to set up, no account required.

<div align="center">

**Free · Open source · Local files · No account · No telemetry · Windows installer under 5 MB**

</div>

<div align="center">

[![Ko-fi](https://img.shields.io/badge/Support_on-Ko--fi-F16061?logo=ko-fi&logoColor=white)](https://ko-fi.com/agentedapp) [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE) [![Tauri](https://img.shields.io/badge/Tauri-2.0-FFC131?logo=tauri)](https://tauri.app/)

</div>

<div align="center">

[Website](https://agentedapp.com/) · [Download](https://github.com/cgxopen/AgentEd/releases/latest) · [Quick start](https://agentedapp.com/quick-start.html) · [Feedback](https://github.com/cgxopen/AgentEd/issues)

</div>

<p align="center">
  <img src="docs/images/project-brief.gif" alt="AgentEd editing a project brief: visual formatting, checklist items, YAML frontmatter, and a live token estimate.">
</p>

[**See AgentEd in action · 1 minute**](https://agentedapp.com/#demo)

[Download](#download-and-get-started) · [Features](#features) · [Installation](#installation) · [Keyboard shortcuts](#keyboard-shortcuts) · [Known limitations](#known-limitations) · [Build from source](#building-from-source) · [Contributing](#contributing)

## Why AgentEd?

Markdown is a plain-text format for headings, lists, links, and more. You may have encountered it while working with AI assistants. AgentEd lets you edit these files visually, without memorising the formatting syntax.

- **Focus on your words.** Format documents with visual controls and see the result as you write.
- **Private by design.** No account, no telemetry, no built-in cloud service. Your documents stay on your computer, and AgentEd makes no network calls of its own. On Windows, the underlying web runtime makes some connections independently; [SECURITY.md](SECURITY.md) explains when.
- **Prepare clearer AI instructions.** Keep project context, goals, preferences, and boundaries in reusable Markdown files, with YAML frontmatter and a live token estimate.
- **Keep your files.** Open and save ordinary `.md` files in folders you choose, without setting up a vault or creating an account.
- **Read as well as write.** Open a Markdown file to read it as a formatted document; start typing when you want to edit it.

AgentEd helps you prepare documents for use with AI tools; it does not include an AI chat or run agents.

## Download and get started

**AgentEd 1.0.0** is available for Windows x64 and macOS on Apple Silicon, with an experimental package for Linux x86-64.

[**Download the latest release**](https://github.com/cgxopen/AgentEd/releases/latest) for installers, release notes, and SHA-256 checksums. Earlier versions are on the [releases page](https://github.com/cgxopen/AgentEd/releases).

| Platform | Installer for 1.0.0 | Status |
|---|---|---|
| Windows x64 | `AgentEd_1.0.0_x64-setup.exe` | Release |
| macOS, Apple Silicon | `AgentEd_1.0.0_aarch64.dmg` | Release |
| Linux x86-64 | `AgentEd_1.0.0_amd64.deb` | Experimental |

Windows is the primary development and testing platform. The macOS build is for Apple Silicon Macs; Intel-based Macs are not supported. The Linux package has been tested on Ubuntu 24.04 with GNOME and Wayland.

The **Windows installer is under 5 MB**. This refers to the installer download, not the total installed footprint or any required runtime.

1. Download the installer for your platform.
2. Install AgentEd using the instructions below.
3. Open an existing Markdown file or create a new document.
4. Save it to a folder on your computer.

**The Windows installer is not digitally signed, and the macOS app is not notarized by Apple. Security warnings may appear during installation or first launch.** See [Installation](#installation) below or the illustrated [installation guide](https://agentedapp.com/installation-help.html).

AgentEd is free and open source, built by one person. If it makes your work easier, [support its development on Ko-fi](https://ko-fi.com/agentedapp) — see [Support AgentEd](#support-agented) below.

[Read the full quick start](https://agentedapp.com/quick-start.html).

## Features

- **Visual formatting:** headings, lists, checklists, links, and tables, with a floating toolbar and Markdown input shortcuts. Add or remove table rows and columns from the menu.
- **Portable Markdown and explicit saving:** work with ordinary `.md` files and choose when to save. If a file changes on disk, choose whether to reload, overwrite, or save elsewhere. Documented format exceptions are listed in [REQUIREMENTS.md](REQUIREMENTS.md).
- **Images:** paste, drop, or insert images into a local `assets/` folder beside your document; add image descriptions for accessibility.
- **Code blocks:** select a language, copy a block with its Copy button, or use a plain-text block with soft wrapping.
- **Footnotes:** insert a reference and its note together, then hover over the reference to read it.
- **YAML frontmatter and templates:** edit document metadata in the **Metadata** panel; start with a blank document or one with metadata.
- **Live estimates and counts:** see a token estimate alongside word and character counts. Token counting runs offline using `gpt-tokenizer` with `cl100k_base`; other models, chat formatting, and attachments can produce different totals.
- **Find and replace:** match case, whole words, or regular expressions.
- **Files panel:** browse the document’s adjacent file structure in a side panel.
- **Appearance:** light, dark, automatic mode, and curated palettes.
- **Multiple windows:** work with one document in each independent window.
- **Spell check:** optional and off by default.

## For AI instructions and everyday notes

### Keep reusable AI instructions together

Write goals, preferences, and boundaries in Markdown, with YAML metadata alongside the document.

<p align="center">
  <img src="docs/images/assistant.png" alt="AgentEd showing reusable workshop assistant instructions, an expanded YAML metadata panel, and the heading formatting toolbar.">
</p>

### Explain with images and tables

Combine written instructions, illustrations, and practical details in one document.

<p align="center">
  <img src="docs/images/guide-frame.png" alt="AgentEd showing an illustrated natural-light photography guide with a photograph and a session table.">
</p>

When sharing a document that uses local images, include its referenced `assets/` folder so the images remain available.

## Installation

Download from the official release linked above and check the filename and version. Each release provides SHA-256 checksums for verifying that your download matches the published file. A matching checksum does not by itself establish that software is safe.

The steps below apply to warnings about an unrecognised or unverified application. If your security software identifies a specific threat, stop and report the exact message and release version.

### Windows installation

<details>
<summary><strong>Show Windows installation steps</strong></summary>

Run `AgentEd_1.0.0_x64-setup.exe`.

The installer is not digitally signed. If Microsoft Defender SmartScreen displays **Windows protected your PC**, and you have verified the source and choose to continue, select **More info → Run anyway**, if that option is available.

**Unknown publisher** may also appear in a separate Windows permission prompt, including User Account Control (UAC). This is not the SmartScreen dialog and does not have the same buttons. It means Windows cannot verify the publisher’s identity.

Managed computers or other Windows security settings may prevent installation. Do not disable antivirus protection or SmartScreen to proceed.

Signing is planned for a future release. See the illustrated [installation guide](https://agentedapp.com/installation-help.html).

</details>

### macOS installation

<details>
<summary><strong>Show macOS installation steps</strong></summary>

The macOS build is for Apple Silicon Macs (M1 and later). It is not notarized by Apple, so macOS blocks it the first time it opens. These steps were checked with AgentEd 1.0.0 on macOS 26.6 and 27.

1. Open `AgentEd_1.0.0_aarch64.dmg` and drag **AgentEd** into **Applications**. Launch it from Applications, not from the disk image.
2. macOS displays **“AgentEd” Not Opened** because it cannot verify the app. Click **Done**.
3. Open **System Settings → Privacy & Security**, then scroll to **Security**. Find the message saying AgentEd was blocked and click **Open Anyway**.
4. In the dialog that follows, click **Open Anyway**. Do not choose **Move to Trash** (**Move to Bin** in British English), the highlighted button, which removes the application.
5. Enter your password. After approval, this copy of AgentEd opens without repeating these steps.

macOS asks again after replacing or reinstalling AgentEd, every time, with the same steps.

The **Open Anyway** option is available for about an hour after the blocked attempt.

These instructions apply to the unverified-app warning, not to a warning that identifies malware or says the app will damage your computer.

On macOS, a document opened from Finder opens in a window of its own. **File → New Window** (`Cmd+Shift+N`) opens an empty window.

See the illustrated [installation guide](https://agentedapp.com/installation-help.html).

</details>

### Linux installation

<details>
<summary><strong>Show Linux installation and removal steps</strong></summary>

Linux builds are **experimental**. They have been tested on Ubuntu 24.04 with GNOME and Wayland in a VirtualBox virtual machine, and on no other distribution.

The `.deb` package is for x86-64 systems. It requires **glibc 2.34 or later** and **WebKitGTK 4.1**. APT checks the declared dependencies and installs missing packages when they are available from your configured repositories.

Download the package, check its SHA-256 checksum, then run this command from the folder containing it:

```sh
sudo apt install ./AgentEd_1.0.0_amd64.deb
```

AgentEd then appears among your applications. On the tested stock Ubuntu setup, it also becomes the application used to open Markdown files. You can choose another application using **Open With** in Files.

Each file you open gets a window of its own. If AgentEd cannot open a file type, such as `.txt`, it explains why.

To remove AgentEd:

```sh
sudo apt remove agent-ed
```

Your documents are not touched. AgentEd’s settings remain in:

- `~/.local/share/com.agentedapp.editor`
- `~/.config/com.agentedapp.editor`

You can remove those folders separately if you also want to delete the application’s saved settings.

</details>

## Keyboard shortcuts

| Windows | macOS | Action |
|---------|-------|--------|
| `Ctrl+B` / `Ctrl+I` / `Ctrl+U` | `Cmd+B` / `Cmd+I` / `Cmd+U` | Bold / Italic / Underline |
| `Ctrl+K` | `Cmd+K` | Insert link, or edit/remove the link at the caret |
| `Ctrl` + click | `Cmd` + click | Open a link in the system browser |
| `Ctrl+E` | `Cmd+E` | Inline code |
| `Ctrl+Shift+K` | `Cmd+Shift+K` | Code block |
| `Ctrl+Alt+1` … `Ctrl+Alt+6` | `Cmd+Option+1` … `Cmd+Option+6` | Heading level 1–6 |
| `Ctrl+Alt+0` | `Cmd+Option+0` | Body text |
| `Ctrl+Shift+S` | `Cmd+Shift+S` | Strikethrough |
| `Ctrl+Z` / `Ctrl+Y` | `Cmd+Z` / `Cmd+Shift+Z` or `Cmd+Y` | Undo / Redo |
| `Ctrl+A` | `Cmd+A` | Select all |
| `Ctrl+S` | `Cmd+S` | Save; Save As is in the File menu |
| `Ctrl+O` | `Cmd+O` | Open |
| `Ctrl+V` / `Ctrl+Shift+V` | `Cmd+V` / `Cmd+Shift+V` | Paste, interpreting Markdown / Paste as plain text |
| `Ctrl+F` / `Ctrl+H` | `Cmd+F` / `Cmd+Option+F` | Find / Replace |
| `Ctrl+Alt+F` | `Cmd+Option+R` | Insert footnote |
| `Ctrl+Shift+E` | `Cmd+Shift+E` | Open/close the Files panel |
| `F3` | `Fn+F3` | Find next |
| `Shift+F3` | `Fn+Shift+F3` | Find previous |
| `Shift+Enter` | `Shift+Enter` | Line break inside a paragraph |
| `Tab` / `Shift+Tab` | `Tab` / `Shift+Tab` | Indent/dedent in lists; move between table cells |

On macOS, `Cmd+H` hides AgentEd rather than opening Replace.

## Known limitations

Known limitations in this release:

- **Line breaks inside a paragraph:** use `Shift+Enter`. There is no toolbar button or menu entry for this action.
- **Opening `---` delimiters:** when a file starts with `---` and contains another such line later, AgentEd interprets the content between them as metadata. Some files created by hand or other tools may therefore display incorrectly, including when the closing delimiter is inside a code block. See [REQUIREMENTS.md](REQUIREMENTS.md) for the documented cases.
- **Windows right-click paste:** **Paste as plain text** in the context menu behaves like an ordinary paste. Use `Ctrl+Shift+V` for a literal plain-text paste.
- **Spell check:** one language at a time. On Windows, it uses the first preferred language for which a dictionary is available, or falls back to the Windows display language. Changes to the preferred language list take effect after all AgentEd windows have been closed and the application restarted.
- **Linux coverage:** testing was limited to Ubuntu 24.04 with GNOME on Wayland in a virtual machine with 3D acceleration off. Other distributions, desktop environments, X11, and configurations with 3D acceleration have not been tested. No `.rpm` package is published.
- **Inserting metadata:** **Insert → Metadata** is not part of undo. Deleting every field in the panel removes the metadata block.

Further format behaviour and exceptions are documented in [REQUIREMENTS.md](REQUIREMENTS.md).

## Project status

AgentEd is in active development. The 1.0 line focuses on visual editing of local Markdown files.

Windows and macOS releases are available, with Windows as the primary development and testing platform. Linux builds remain experimental.

The product definition and documented exceptions live in [REQUIREMENTS.md](REQUIREMENTS.md).

## Building from source

**Node.js 24 is recommended and is used in CI.** See the `engines` field in [package.json](package.json) for the accepted version range.

You also need the Rust toolchain, available through [rustup](https://rustup.rs/), and the [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
git clone https://github.com/cgxopen/AgentEd.git
cd AgentEd
npm install
npm run tauri dev
```

The Tauri CLI is included in the project’s development dependencies.

For a production build:

```sh
npm run tauri build
```

Before opening a pull request, run the [verification checklist](CONTRIBUTING.md#verification-checklist-before-a-pull-request): the linters, type check, tests, and web build.

## Contributing

Contributions are welcome — please read [CONTRIBUTING.md](CONTRIBUTING.md) first. For larger changes, open an issue to discuss the direction before starting work.

Everything in this repository — code, documentation, commits, pull requests, and issues — is in English.

## Support AgentEd

AgentEd is free and open source. If it makes your work easier, you can support its development on [Ko-fi](https://ko-fi.com/agentedapp).

Support goes to the author, who publishes AgentEd in his own name, and **helps fund ongoing development and maintenance**, including:

- fixing bugs and improving the editing experience;
- developing new features while keeping the editor simple;
- testing and maintaining releases across supported platforms, and the signing of installers where a platform offers it;
- writing clearer documentation and practical examples;
- covering hosting, infrastructure, and development tools.

Contributions are optional. How money given to the project is handled is described in [CONTRIBUTING.md](CONTRIBUTING.md#money-given-to-the-project).

The AgentEd application does not collect or process payment information. Contributions are processed through Ko-fi and its payment providers under their applicable policies. See [Ko-fi’s privacy policy](https://more.ko-fi.com/privacy).

## License

MIT — see [LICENSE](LICENSE).

The MIT license covers the code, not the AgentEd name or logo: a fork is welcome, under a name of its own.

## Author and contact

Built by [Cătălin Vasile](https://github.com/catge) using Claude Code.

For bugs and feature requests, [open an issue](https://github.com/cgxopen/AgentEd/issues). For security vulnerabilities, follow [SECURITY.md](SECURITY.md) rather than opening a public issue.

For other enquiries, email [contact@agentedapp.com](mailto:contact@agentedapp.com).

## History

AgentEd began on 29 March 2026. This repository opened a new phase in August 2026.
