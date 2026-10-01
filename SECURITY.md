# Security Policy

AgentEd is a local desktop application that makes no network calls of its own: no telemetry, no update check, no accounts, no cloud storage, and every feature works with the machine offline. The embedded web runtime the platform gives it is a separate matter, and what it does has been measured rather than assumed — on Windows it reaches Microsoft at every launch, and it speculatively looks up the hostname of a link in the open document when the pointer enters it. Neither is traffic AgentEd asks for, and neither can be turned off from here; Q3 in REQUIREMENTS.md carries the figures, the builds and the instrument. The main attack surface is parsing and rendering untrusted markdown files and writing to the local filesystem.

The desktop build may read and write any path the account running it can reach: its file-system scope is `**`, on purpose. What stands in front of the webview is DOMPurify on every parse, a Content Security Policy with no `unsafe-inline`, and no remote content; narrowing the scope would protect only the folders AgentEd is never asked to open, since every document, its `assets/` folder and every recent file has to stay reachable.

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

- Preferred: GitHub **private vulnerability reporting** — *Security* tab → *Report a vulnerability*.
- Alternative: email `contact@cgxconsulting.com` with subject `[AgentEd security]`.

You can expect an initial response within 7 days.

## What counts as a vulnerability here

Examples we want to hear about: any code execution triggered by opening or rendering a markdown file (HTML/script injection through the editor surface); path traversal via links, images or `assets/` handling; any write to disk that happens without an explicit user save decision; corruption of a file on the open→save round-trip.
