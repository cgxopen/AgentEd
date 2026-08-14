# Security Policy

AgentEd is a local, offline desktop application: no network calls at runtime, no telemetry, no accounts, no cloud storage. Its main attack surface is parsing and rendering untrusted markdown files and writing to the local filesystem.

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

- Preferred: GitHub **private vulnerability reporting** — *Security* tab → *Report a vulnerability*.
- Alternative: email `vasile.g.catalin@gmail.com` with subject `[AgentEd security]`.

You can expect an initial response within 7 days.

## What counts as a vulnerability here

Examples we want to hear about: any code execution triggered by opening or rendering a markdown file (HTML/script injection through the editor surface); path traversal via links, images or `assets/` handling; any write to disk that happens without an explicit user save decision; corruption of a file on the open→save round-trip.
