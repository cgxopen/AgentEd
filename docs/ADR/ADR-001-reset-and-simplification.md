# ADR-001: Repository reset and product simplification

**Status**: Accepted
**Date**: 2026-08-14
**Decider**: Cătălin Vasile (owner), advised by AMP

## Context

By mid-2026, AgentEd v0.1.0 had grown a substantial machinery layer around its editor core: a Profile Registry with five auto-detected validation profiles (Claude SKILL, OpenClaw SKILL, AgentSkills v1, llms.txt, plain), frontmatter auto-injection, profile-driven structured-layout detection, and skill-oriented templates — documented across 34 ADRs and a 46 KB architecture document. ADR-034 had already repositioned the product identity toward "markdown editor first", but the machinery remained in the codebase and the documentation still carried its full weight.

The owner decided to go one step further before the public launch: re-center the product on the **easy-to-use WYSIWYG markdown editor**, physically remove the skill/validation machinery, and revisit it (together with newer ideas such as an OKF profile) in a deliberate post-public phase. The owner also wanted the public repository to start with a clean history.

## Decision

1. **A new repository, born clean.** `catge/AgentEd` starts from a fresh root commit. The complete pre-reset history — all commits, the 19 closed PRs, and ADR-001..034 — is preserved in the private `catge/agented-archive` repository. A history rewrite (force-push) on the old repository was rejected: old commits remain reachable through closed-PR references and caches, which is not clean enough for a public debut.
2. **Physical removal** of the profile machinery, as specified in [REQUIREMENTS.md](../../REQUIREMENTS.md) §4. Removal is a real deletion, not feature flags; reintroduction is a deliberate port in a future phase with its own requirements document.
3. **REQUIREMENTS.md v1.0 is the single source of product truth.** ADR numbering restarts at 001 with this document.
4. **English** is the language of everything in this repository: code, comments, docs, commits, PRs, issues.
5. **Working model**: owner (decisions, merges, releases) + AMP (requirements, roadmap, issues, product review) + DEV (implementation via Claude Code sessions). GitHub issues and PRs are the only workflow; `main` is protected once CI exists.

## Consequences

**Positive**: a smaller binary and codebase; a product identity that matches what users see; a clean public history that starts at the reset; the archive preserves everything for the post-public skills/OKF phase, which will be executed as a conscious port rather than a revert.

**Negative / accepted trade-offs**: no public pre-reset history (mitigated by the private archive); contributors cannot see the reasoning of ADR-001..034 (mitigated by this ADR and REQUIREMENTS.md §9, which summarize what matters going forward); the skills machinery, when it returns, must be re-integrated against a changed codebase.

## References

- [REQUIREMENTS.md](../../REQUIREMENTS.md) — product requirements v1.0, including §9 decision log and §10 known defects.
- Private archive: `catge/agented-archive` (full history, PRs #1–#19, ADR-000..034).
