# CI workflows — staging area

These three files are the repository's GitHub Actions workflows, staged here because the AMP API token lacks the `workflow` scope required to write into `.github/workflows/`.

**The conversion PR (issue #5) must move them to `.github/workflows/` unchanged**, then delete this folder.

- `ci.yml` — push/PR: frontend lint+typecheck+test+build (Linux), Rust fmt+clippy+test (Linux), Windows build, and the `pipeline-ok` summary job — the single required check for branch protection.
- `nightly.yml` — scheduled Windows-only build with an activity guard (skips when there are no new commits); Linux/macOS available via manual dispatch inputs only.
- `release.yml` — full matrix (Windows, Linux, macOS both targets) on `v*` tags; drafts the release, curates assets, generates SHA-256 checksums.
