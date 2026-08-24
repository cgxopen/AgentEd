import { describe, expect, it } from 'vitest';
// The workflows are read as text, not parsed: `?raw` is Vite's own way of
// asking for a file's bytes, so the test needs no filesystem access and no
// dependency to reach them.
import CI from './ci.yml?raw';
import NIGHTLY from './nightly.yml?raw';

/**
 * What CI promises, pinned as text.
 *
 * These are not tests of the workflow's behaviour — only a run can prove
 * that. They pin the three invariants this file has broken before, each of
 * which fails silently: a green pipeline that skipped everything, a cache
 * that reports a hit and delivers nothing, and two spellings of the same
 * commit drifting apart.
 *
 * Read as text rather than as parsed YAML, deliberately: adding a YAML parser
 * to lint a workflow is a dependency for a job that four regular expressions
 * do, and the shape being pinned is literally the text somebody would edit.
 * Job keys sit at two spaces and their properties at four; step properties
 * sit at eight. That indentation is what tells the two levels apart below.
 */

/** The `${{ … }}` expression a single-line `key: value` pair carries. */
function expressionAfter(source: string, pattern: RegExp): string {
  const match = source.match(pattern);
  expect(match, `no match for ${pattern}`).not.toBeNull();
  return (match as RegExpMatchArray)[1].trim();
}

/** Job blocks, keyed by job id — everything from `  <id>:` to the next one. */
function jobs(source: string): Map<string, string> {
  const found = new Map<string, string>();
  // Only what is under the top-level `jobs:` key. `on:` has two-space keys of
  // its own, and they are not jobs.
  const section = source.slice(source.search(/^jobs:$/m));
  const starts = [...section.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)];
  starts.forEach((start, index) => {
    const from = start.index as number;
    const to = index + 1 < starts.length ? (starts[index + 1].index as number) : section.length;
    found.set(start[1], section.slice(from, to));
  });
  return found;
}

describe('ci.yml — the artifact and About name the same build (#64)', () => {
  it('feeds one value into the installer name and into the build', () => {
    const artifactName = expressionAfter(CI, /^\s*name: AgentEd-windows-\$\{\{(.+?)\}\}\s*$/m);
    const bakedIn = expressionAfter(CI, /^\s*AGENTED_BUILD_COMMIT: \$\{\{(.+?)\}\}\s*$/m);
    // Not "both look right" — the same string. Two expressions that happen to
    // agree today are what #64 is about: they move apart and nothing fails.
    expect(artifactName).toBe(bakedIn);
    expect(artifactName).toBe('needs.changes.outputs.build_sha');
  });

  it('takes the head of the pull request, not the merge commit it is built on', () => {
    const identity = jobs(CI).get('changes') ?? '';
    expect(identity).toMatch(/PR_HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/);
    expect(identity).toMatch(/RUN_SHA: \$\{\{ github\.sha \}\}/);
    // Seven characters, because About shows seven and the check is a person
    // comparing two strings.
    expect(identity).toMatch(/build_sha=\$\{sha:0:7\}/);
  });
});

describe('ci.yml — a docs-only change skips the build and still reports green (#57)', () => {
  it('gates every heavy job on the filter alone, with no push escape hatch', () => {
    const heavy = ['frontend', 'rust', 'build-windows'];
    for (const job of heavy) {
      const block = jobs(CI).get(job);
      expect(block, `job ${job} is missing`).toBeDefined();
      expect(block).toContain("if: needs.changes.outputs.code == 'true'");
    }
    // The clause that made a documentation merge rebuild everything.
    expect(CI).not.toContain("github.event_name == 'push'");
  });

  it('lets the path filter answer for pushes as well as pull requests', () => {
    const changes = jobs(CI).get('changes') ?? '';
    const filterStep = changes.slice(changes.indexOf('dorny/paths-filter'));
    const beforeTheFilters = filterStep.slice(0, filterStep.indexOf('with:'));
    expect(beforeTheFilters).not.toMatch(/^\s*if:/m);
  });

  it('fails open when the filter cannot answer', () => {
    const changes = jobs(CI).get('changes') ?? '';
    expect(changes).toContain('continue-on-error: true');
    expect(changes).toContain('echo "code=true" >> "$GITHUB_OUTPUT"');
  });

  it('keeps the required check reachable and gated on nothing', () => {
    const verdict = jobs(CI).get('pipeline-ok') ?? '';
    expect(verdict).toContain('needs: [changes, frontend, rust, build-windows]');
    expect(verdict).toContain('if: always()');
    // A skipped job must not be a failure, or a docs-only change becomes
    // unmergeable rather than cheap.
    expect(verdict).toContain('.value.result == "failure" or .value.result == "cancelled"');
  });
});

describe('the cargo caches are keyed on what each half depends on (#53)', () => {
  const keys = [...CI.matchAll(/^\s*key: (\$\{\{ runner\.os \}\}-cargo-.+)$/gm)].map((m) => m[1]);
  const registryKeys = keys.filter((key) => key.includes('-cargo-registry-'));
  const targetKeys = keys.filter((key) => key.includes('-cargo-target-'));

  it('splits the two halves, on both runners', () => {
    // One of each per job that compiles Rust: they go stale for different
    // reasons and must not share an entry.
    expect(keys).toHaveLength(4);
    expect(registryKeys).toHaveLength(2);
    expect(targetKeys).toHaveLength(2);
  });

  it('keys the build cache on the toolchain as well as the lockfile', () => {
    for (const key of targetKeys) {
      // Without this, a `stable` release invalidates every fingerprint in
      // `src-tauri/target` while the key stays put — so the stale entry is
      // restored, reported as a hit, and discarded by cargo on every run for
      // the rest of that toolchain's life.
      expect(key).toContain('steps.toolchain.outputs.cachekey');
      expect(key).toContain("hashFiles('src-tauri/Cargo.lock')");
    }
  });

  it('keys the registry cache on the lockfile alone', () => {
    for (const key of registryKeys) {
      // Downloaded sources do not depend on the compiler; making them
      // depend on it would throw away the download on every toolchain move.
      expect(key).not.toContain('steps.toolchain.outputs.cachekey');
      expect(key).toContain("hashFiles('src-tauri/Cargo.lock')");
    }
  });

  it('keeps the build cache fallback inside one toolchain', () => {
    const fallbacks = [...CI.matchAll(/^\s*restore-keys: \|\n((?:\s*\$\{\{.+\n)+)/gm)].map(
      (m) => m[1],
    );
    expect(fallbacks).toHaveLength(4);
    for (const block of fallbacks.filter((b) => b.includes('-cargo-target-'))) {
      // A wider fallback would restore a dead toolchain's artifacts, and
      // `actions/cache` would then save them again — the entry grows by one
      // dead set per rustc release. Measured: 654 MB in, 1275 MB out.
      expect(block).toContain('steps.toolchain.outputs.cachekey');
      expect(block.trim().split('\n')).toHaveLength(1);
    }
  });
});

describe('nothing runs unbounded (#47)', () => {
  for (const [label, source] of [
    ['ci.yml', CI],
    ['nightly.yml', NIGHTLY],
  ] as const) {
    it(`${label}: every job carries a ceiling`, () => {
      for (const [id, block] of jobs(source)) {
        expect(block, `job ${id} has no timeout-minutes`).toMatch(/^ {4}timeout-minutes: \d+$/m);
      }
    });

    it(`${label}: every step that downloads or compiles carries its own`, () => {
      const steps = source.split(/^ {6}- /m).slice(1);
      const needsOne =
        /actions\/checkout|setup-node|rust-toolchain|actions\/cache|upload-artifact|npm ci|npm run tauri build|npm test|npm run build|cargo clippy|cargo test|apt-get|paths-filter/;
      for (const step of steps) {
        if (!needsOne.test(step)) continue;
        const first = step.split('\n')[0];
        expect(step, `step "${first}" has no timeout-minutes`).toMatch(
          /^ {8}timeout-minutes: \d+$/m,
        );
      }
    });
  }

  it('the apt ceiling that matters is per attempt, not per step', () => {
    // A step ceiling alone cannot work: apt has legitimately run for 19m 44s
    // here and succeeded, so any ceiling tight enough to catch a stall would
    // clip a passing run.
    // `sudo timeout`, not `timeout sudo`: the kill has to reach apt-get
    // itself rather than rely on sudo relaying it.
    expect(CI).toMatch(/sudo timeout 120 apt-get update/);
    expect(CI).toMatch(/sudo timeout 300 apt-get install/);
    expect(CI).toMatch(/for attempt in 1 2; do/);
  });
});

describe('nightly.yml runs weekly, and can still be asked for by hand', () => {
  it('is scheduled once a week', () => {
    expect(NIGHTLY).toContain("- cron: '0 3 * * 1'");
  });

  it('keeps workflow_dispatch', () => {
    expect(NIGHTLY).toMatch(/^ {2}workflow_dispatch:$/m);
  });
});
