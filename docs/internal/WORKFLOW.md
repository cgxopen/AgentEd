# Working agreement — how a change reaches `main`

> The loop between owner, AMP and DEV. [STATUS.md](STATUS.md) says *where the project is*; this says *how work moves*. Written after a day in which five parallel PRs produced a merge-conflict cascade, a defect "reproduced" on a stale installer, and a testing step that moved between before-merge and after-merge — all avoidable, none of it written down.

## Roles

| | Does | Never does |
| --- | --- | --- |
| **Owner** | Decides product questions, tests on Windows, approves merges, owns releases | — |
| **AMP** | Requirements, issues, briefs, product review on every PR, keeps STATUS current, merges on the owner's go-ahead | Writes production code |
| **DEV** | Implements one issue at a time, with tests and full local verification | Merges, pushes to `main`, or decides product questions |

## The cycle

1. **AMP writes the issue** — what, why, acceptance criteria, and what the owner will have to check by hand.
2. **DEV takes the top item** of the STATUS agenda, or the issue the owner hands it. It reads REQUIREMENTS → STATUS → CLAUDE.md first, and verifies the live repository state before planning.
3. **DEV implements**: a branch cut from *current* `main`, tests alongside the change, then the full verification suite. It opens the PR describing what changed, why, how it was verified, and — plainly — what it could **not** verify. Then it stops.
4. **CI runs.** A PR touching code publishes `AgentEd-windows-<sha>` as an artifact, 7-day retention.
5. **AMP reviews** against REQUIREMENTS and states explicitly which manual checks the owner should run.
6. **The owner tests** — downloading the installer **from that PR's own run**, not from `main` and not from Nightly.
7. **AMP squash-merges** on the owner's word. The branch auto-deletes.
8. **AMP updates STATUS**, and REQUIREMENTS if the change altered a requirement.

## Rules that keep it untangled

- **Test before merge, from the PR artifact.** `main` should always be a state the owner has accepted. (Before the artifact step existed, testing meant a manual Nightly dispatch, which is why it briefly happened after merge instead. That workaround is obsolete.)
- **Check the artifact matches the PR.** The `<sha>` in the artifact name is the commit it was built from; if it does not match the PR head, it is the wrong build. Most "the fix isn't working" reports are a stale installer.
- **Nightly is not a testing tool.** It is a scheduled health check on `main`. Do not dispatch it to test a branch.
- **Parallel PRs only when they touch different files.** Otherwise sequential. Squash-merging rewrites `main`, so sibling branches that share a file will conflict — one at a time costs less than resolving the cascade.
- **A requirement change ships with the code that changes it**, in the same PR — never a PR that leaves REQUIREMENTS disagreeing with the build.
- **Any new R-C2 exception is documented in REQUIREMENTS in the same PR.** An undocumented exception is a defect.
- **DEV states what it did not verify.** No Windows machine means saying so and listing what the owner must cover — never implying a check that was not run.
- **One issue = one branch = one PR.** Unrelated fixes get their own issue, however tempting.

## What "done" means

An issue is done when the PR is merged, the owner has tested it, and STATUS records it. Not before — a merged PR with an untested behavior is work in progress with a green checkmark.

## When something is off

- **A defect that will not reproduce**: confirm the build first (artifact sha), then write down the hypothesis for *why* it disappeared rather than assuming luck. See #4 for the pattern.
- **A DEV session reporting stale state**: point it at STATUS and ask it to verify against the repository. The rule lives in CLAUDE.md.
- **Conflicts after a batch**: DEV resolves them on its branch with a merge (not a rebase with force-push), so approved reviews stay attached.
