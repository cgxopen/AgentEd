import { describe, expect, it } from 'vitest';
// The guard is read as text for the same reason the workflows are: what is
// being pinned is the relationship between two lists that live in different
// files and different languages, and reading one of them is the only way to
// check it against the other.
import ROUNDTRIP_GUARD from '../../src/editor/roundtrip.test.ts?raw';
// The floor the Linux packages declare (#550), held against the floor the
// build checks the binary for.
import TAURI_LINUX_CONF from '../../src-tauri/tauri.linux.conf.json?raw';
// The other side of the build-identity contract (#41): the workflows pass the
// value and this file is what receives it, so the assertion that there is no
// second source for it belongs beside the assertions about the senders.
import VITE_CONFIG from '../../vite.config.ts?raw';
// The workflows are read as text, not parsed: `?raw` is Vite's own way of
// asking for a file's bytes, so the test needs no filesystem access and no
// dependency to reach them.
import CI from './ci.yml?raw';
import { toReport } from './npm-advisories.mjs';
import RELEASE from './release.yml?raw';
import SCHEDULED from './scheduled.yml?raw';

/**
 * Every workflow file of this folder, read as text (#668). The rows that hold
 * for every workflow read this list rather than a list written by hand, so a
 * new file is checked without anyone adding it here: `import.meta.glob` is
 * Vite's own way of asking for the files a pattern matches, so no filesystem
 * access and no dependency are needed. A workflow file ends in `.yml` here; a
 * `.yaml` one would be met by neither this list nor the convention.
 *
 * Measured on #668: the module cache of Vitest in `node_modules/.vitest-cache`
 * keeps the list a run found, and a file added afterwards does not refresh it,
 * so a local run with a warm cache can miss a new workflow until that folder
 * is cleared. CI installs `node_modules` afresh on every run and reads the
 * folder as it is.
 */
const WORKFLOWS: ReadonlyArray<readonly [string, string]> = Object.entries(
  import.meta.glob<string>('./*.yml', { query: '?raw', import: 'default', eager: true }),
).map(([path, source]) => [path.replace(/^\.\//, ''), source] as const);

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

/**
 * Every `${{ … }}` expression the `key: value` pairs matching `pattern`
 * carry — all of them, never the first.
 *
 * It used to answer with `source.match(pattern)`, which stops at the
 * first hit. That was correct while each of these keys appeared once,
 * and it silently stopped being correct the moment #131 gave
 * `AGENTED_BUILD_COMMIT` a second consumer: the assertion below kept
 * passing over a line it had never looked at. A test that checks one of
 * two things and reports on both is the failure this file exists to
 * prevent, so it now collects every occurrence and the caller says how
 * many it expects.
 */
function expressionsAfter(source: string, pattern: RegExp): string[] {
  const global = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);
  const found = [...source.matchAll(global)].map((match) => match[1].trim());
  expect(found.length, `no match for ${pattern}`).toBeGreaterThan(0);
  return found;
}

/** Every step of a workflow, as text — steps start at six spaces in all three files. */
function steps(source: string): string[] {
  return source.split(/^ {6}- /m).slice(1);
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
  it('feeds one value into every artifact name and every build', () => {
    const artifactNames = expressionsAfter(CI, /^\s*name: AgentEd-\w+-\$\{\{(.+?)\}\}\s*$/m);
    const bakedIn = expressionsAfter(CI, /^\s*AGENTED_BUILD_COMMIT: \$\{\{(.+?)\}\}\s*$/m);

    // Two platforms since #131 — the Windows installer and the web build —
    // and the count is asserted so that losing one of them is a failure
    // rather than a quieter version of this test.
    expect(artifactNames).toHaveLength(2);
    expect(bakedIn).toHaveLength(2);

    // Not "they all look right" — the same string, everywhere. Expressions
    // that happen to agree today are what #64 is about: they move apart and
    // nothing fails.
    for (const expression of [...artifactNames, ...bakedIn]) {
      expect(expression).toBe('needs.changes.outputs.build_sha');
    }
  });

  it('publishes a web build a person can serve, and ships what starts it (#131)', () => {
    const frontend = jobs(CI).get('frontend') ?? '';
    expect(frontend).toMatch(/name: AgentEd-web-\$\{\{ needs\.changes\.outputs\.build_sha \}\}/);
    expect(frontend).toMatch(/path: dist/);
    expect(frontend).toMatch(/retention-days: 7/);
    // The build alone is inert: it is loaded as ES modules and needs a
    // secure context, so a folder opened from the filesystem does nothing.
    // The starter travels inside the artifact, which is also what stops it
    // drifting away from the build it starts.
    expect(frontend).toMatch(/web-artifact\/serve\.ps1/);
    expect(frontend).toMatch(/web-artifact\/HOW-TO-RUN\.txt/);
  });

  it('does not publish a web build for a documentation-only change (#118, #131)', () => {
    const frontend = jobs(CI).get('frontend') ?? '';
    // The job itself runs for `guarded_docs` — the eight documents the
    // round-trip guard reads. The two steps that make the artifact are
    // narrower than the job around them, on `code` alone.
    const artifactSteps = [
      ...frontend.matchAll(/^ {6}- name: (Bundle the starter.*|Upload web build)$/gm),
    ];
    expect(artifactSteps).toHaveLength(2);
    for (const step of artifactSteps) {
      const from = step.index as number;
      const body = frontend.slice(from, from + 400);
      expect(body).toMatch(/if: needs\.changes\.outputs\.code == 'true'/);
    }
    // And the job around them is still the wider one, unchanged by #131.
    expect(frontend).toMatch(
      /if: needs\.changes\.outputs\.code == 'true' \|\| needs\.changes\.outputs\.guarded_docs == 'true'/,
    );
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
  it('reads every workflow file of the folder', () => {
    expect(WORKFLOWS.length).toBeGreaterThanOrEqual(4);
  });

  for (const [label, source] of WORKFLOWS) {
    it(`${label}: every job carries a ceiling`, () => {
      for (const [id, block] of jobs(source)) {
        expect(block, `job ${id} has no timeout-minutes`).toMatch(/^ {4}timeout-minutes: \d+$/m);
      }
    });

    it(`${label}: every step that downloads or compiles carries its own`, () => {
      const needsOne =
        /actions\/checkout|setup-node|rust-toolchain|actions\/cache|upload-artifact|npm ci|npm run tauri build|tauri-action|npm test|npm run build|cargo clippy|cargo test|apt-get|paths-filter|gh release/;
      for (const step of steps(source)) {
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

  it('all three files run the same apt loop, byte for byte', () => {
    // Copied rather than rewritten (#47), which is only true for as long as
    // nothing edits one copy. Three files drifting apart is the quiet kind of
    // failure: each one still works, and only one of them has the fix.
    const loop = (source: string) => {
      const from = source.indexOf('- name: Install Linux system deps');
      const end = source.indexOf('exit 1', from);
      const step = source.slice(from, end + 'exit 1'.length);
      return step.slice(step.indexOf('run: |'));
    };
    expect(loop(SCHEDULED), 'scheduled.yml apt loop differs from ci.yml').toBe(loop(CI));
    expect(loop(RELEASE), 'release.yml apt loop differs from ci.yml').toBe(loop(CI));
  });
});

describe('scheduled.yml runs weekly, and can still be asked for by hand', () => {
  it('is scheduled once a week', () => {
    expect(SCHEDULED).toContain("- cron: '0 3 * * 1'");
  });

  it('keeps workflow_dispatch', () => {
    expect(SCHEDULED).toMatch(/^ {2}workflow_dispatch:$/m);
  });
});

describe('no job runs on a label that moves under it (#591)', () => {
  /**
   * `ubuntu-latest` moves to Ubuntu 26 from 2026-10-19, so a job on it would
   * change image with nothing changed in this repository, and the apt step of
   * the rust job was never run there. Each workflow is read with its comment
   * lines taken out, since the comment that says why the label is pinned names
   * the label; what is left is every `runs-on`, every matrix entry and every
   * JSON matrix a script builds.
   */
  it.each(WORKFLOWS)('%s: no job runs on ubuntu-latest', (_label, source) => {
    const withoutComments = source
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
    expect(withoutComments).not.toContain('ubuntu-latest');
  });
});

describe('the build matrix says which targets exist at all (#8)', () => {
  /**
   * Both of these fail **silently** if they regress, which is why they are
   * here rather than left to a red build.
   *
   * Linux spent weeks in this repository as a `workflow_dispatch` input that
   * nobody set, so both its entries existed and neither had ever run — and
   * nothing reported anything, because a target that is never built produces
   * no failure. Putting it back behind an input would restore exactly that
   * quiet.
   *
   * macOS is in the release since #538, and its line fails the same quiet
   * way in the other direction. It is Apple Silicon alone and ad-hoc signed
   * over the whole bundle, by owner decision of 2026-10-06, because the
   * Macs it is tested on are Apple Silicon and an unsealed bundle is not
   * what was chosen to ship. A `--target` added to the line, or the signing
   * field dropped from it, would still produce a `.dmg` and nothing would go
   * red: an Intel or universal build nobody tested, or a bundle signed by
   * the linker alone. So the line is pinned as decided.
   *
   * Linux is in the release since #550, labelled experimental, as the deb
   * alone, and fails the same quiet way. An rpm added to the line would
   * attach a package nobody has installed on an rpm distribution to a public
   * release (owner decision 4 on #550), and a line moved off ubuntu-22.04
   * would build against a newer glibc than the floor the deb declares. The
   * floor check below would catch the second; nothing would catch the first.
   */
  it('builds Linux on every scheduled build, not on request', () => {
    expect(SCHEDULED).toContain('"platform\\":\\"ubuntu-22.04\\"');
    expect(SCHEDULED).not.toContain('inputs.include_linux');
  });

  it('builds macOS in the release for Apple Silicon alone, ad-hoc signed (#538)', () => {
    const matrixBlock = RELEASE.slice(RELEASE.indexOf('matrix:'), RELEASE.indexOf('runs-on:'));
    expect(matrixBlock.match(/^ +- platform: macos/gm)).toHaveLength(1);
    // The line itself, up to the next line or the end of the block.
    const macos = matrixBlock.match(/^ {10}- platform: macos-latest\n(?: {12}.*\n)*/m)?.[0];
    expect(macos, 'no macos-latest line in the release matrix').toBeDefined();
    // No --target: macos-latest builds aarch64 natively, and only that.
    expect(macos).toContain("            args: ''\n");
    expect(macos).toContain("            target: ''\n");
    expect(macos).toContain("            signing: '-'\n");
    // The field reaches the build: read off the step, not off a comment.
    const build = steps(RELEASE).find((step) => /^uses: tauri-apps\/tauri-action@/m.test(step));
    expect(build).toMatch(/^ {10}APPLE_SIGNING_IDENTITY: \$\{\{ matrix\.signing \}\}$/m);
  });

  it('checks the macOS bundle a user downloads after it is built (#555)', () => {
    // The steps run on the macOS line alone, after the step that builds and
    // uploads the .dmg, each with its own ceiling (#47). Pinned for the same
    // reason as the signing field: a release without them still goes green.
    const all = steps(RELEASE);
    const build = all.findIndex((step) => /^uses: tauri-apps\/tauri-action@/m.test(step));
    const checks = all.filter((step) => step.startsWith("name: 'macOS: "));
    expect(checks.map((step) => step.split('\n')[0])).toHaveLength(3);
    for (const step of checks) {
      expect(all.indexOf(step)).toBeGreaterThan(build);
      expect(step).toMatch(/^ {8}if: matrix\.platform == 'macos-latest'$/m);
      expect(step).toMatch(/^ {8}timeout-minutes: \d+$/m);
    }
    const script = checks.join('\n');
    expect(script).toContain('hdiutil attach -readonly');
    expect(script).toContain('codesign --verify --deep --strict');
    expect(script).toContain("grep -qx 'Signature=adhoc'");
    expect(script).toContain('open -n "$app"');
    expect(script).toMatch(/pgrep -f "\$app\/Contents\/MacOS\/"/);
  });

  it('builds Linux in the release as the deb alone, on ubuntu-22.04 (#550)', () => {
    const matrixBlock = RELEASE.slice(RELEASE.indexOf('matrix:'), RELEASE.indexOf('runs-on:'));
    expect(matrixBlock.match(/^ +- platform: ubuntu/gm)).toHaveLength(1);
    const linux = matrixBlock.match(/^ {10}- platform: ubuntu-22\.04\n(?: {12}.*\n)*/m)?.[0];
    expect(linux, 'no ubuntu-22.04 line in the release matrix').toBeDefined();
    expect(linux).toContain("            args: '--bundles deb'\n");
    expect(linux).toContain("            target: ''\n");
  });

  it('asks the scheduled Linux build for the deb and the rpm', () => {
    // The release asks the deb alone (the row above); the scheduled build keeps the rpm,
    // with the same desktop entry and floor, so a later Fedora test needs
    // no code (#550, owner decision 4).
    //
    // AppImage is out for what it costs, not because it breaks — it builds
    // on the runner. So dropping this flag would leave the scheduled build **green** and
    // quietly restore a 194 MB weekly artifact in place of an 8 MB one,
    // which is the silent-regression shape the rest of this file exists for.
    // The reason is written where the flag is.
    //
    // Read off the matrix entry rather than off the file. A plain search of
    // the source passes on the comment that explains the flag, which is
    // prose: it survives the flag being deleted from the configuration, and
    // this assertion then guards nothing. Measured, not feared — it happened
    // to the first draft of this test.
    const linuxEntry = SCHEDULED.match(/^ *entries=.*ubuntu-22\.04.*$/m)?.[0];
    expect(linuxEntry, 'no Linux entry in the scheduled matrix').toBeDefined();
    expect(linuxEntry).toContain('--bundles deb,rpm');
  });
});

describe('every Linux bundle is checked against the glibc floor it declares (#550)', () => {
  /**
   * The deb declares `libc6 (>= 2.34)` and the rpm
   * `libc.so.6(GLIBC_2.34)(64bit)`, while the binary needs the glibc of the
   * runner that built it. The floor rides on the ubuntu-22.04 image, and a
   * build on a newer one would install on an older system and fail at launch.
   * So every job that builds a Linux bundle reads the highest GLIBC_ symbol
   * of the binary in the deb, and the floor that step holds is the one the
   * packages declare. Shown red once on a measurement run with the floor
   * lowered, as the macOS checks of #555 were.
   */
  const NAME = "name: 'Linux: the binary needs no glibc above the declared floor'";
  // The step up to the blank line that ends it, so the comment of the next
  // step, which the split of `steps` keeps, is not read as part of it.
  const check = (source: string) =>
    steps(source)
      .find((step) => step.startsWith(`${NAME}\n`))
      ?.split('\n\n')[0];

  it.each([
    ['scheduled.yml', SCHEDULED, 'Build the bundles'],
    ['release.yml', RELEASE, 'tauri-apps/tauri-action@'],
  ] as const)(
    '%s: after the build, on the Linux line, with its own ceiling',
    (_f, source, build) => {
      const all = steps(source);
      const step = check(source);
      expect(step, 'no glibc floor step').toBeDefined();
      const built = all.findIndex((s) => s.includes(build));
      expect(built).toBeGreaterThan(-1);
      expect(all.findIndex((s) => s.startsWith(`${NAME}\n`))).toBeGreaterThan(built);
      expect(step).toMatch(/^ {8}if: matrix\.platform == 'ubuntu-22\.04'$/m);
      expect(step).toMatch(/^ {8}timeout-minutes: \d+$/m);
      expect(step).toContain('objdump -T "$RUNNER_TEMP/deb/usr/bin/agented"');
      expect(step).toContain('grep -qF "libc6 (>= $GLIBC_FLOOR)"');
    },
  );

  it('is the same step, byte for byte, in both files', () => {
    expect(check(RELEASE)).toBe(check(SCHEDULED));
  });

  it('holds the floor the deb and the rpm declare', () => {
    const floor = check(SCHEDULED)?.match(/^ {10}GLIBC_FLOOR: '([0-9.]+)'$/m)?.[1];
    expect(floor).toBe('2.34');
    const linux = JSON.parse(TAURI_LINUX_CONF).bundle.linux;
    expect(linux.deb.depends).toContain(`libc6 (>= ${floor})`);
    expect(linux.rpm.depends).toContain(`libc.so.6(GLIBC_${floor})(64bit)`);
  });
});

describe('the documents the round-trip guard reads can start the job that runs it (#118)', () => {
  /**
   * The failure this pins is the one that produced #118: `ci.yml` gates the
   * frontend job on a path filter, `src/editor/roundtrip.test.ts` reads the
   * repository's documents as test input, and the two lists are maintained by
   * hand, in different languages, in different files. When they drifted, a
   * documentation merge skipped the job that would have caught it and
   * `Pipeline OK` reported success over a red suite.
   *
   * They cannot be derived from one another — one is TypeScript imports, the
   * other is YAML read by an action before any of this exists — so the drift
   * is made to **fail** instead.
   */

  /** Every document the guard runs through the real save assembly. */
  function documentsUnderGuard(): string[] {
    const start = ROUNDTRIP_GUARD.search(/^const DOCUMENTS\b/m);
    expect(start, 'DOCUMENTS not found in the round-trip guard').toBeGreaterThan(-1);
    const block = ROUNDTRIP_GUARD.slice(start, ROUNDTRIP_GUARD.indexOf('\n];', start));
    return [...block.matchAll(/\['([^']+\.md)',/g)].map((m) => m[1]);
  }

  /** The path patterns one filter of the `changes` job lists. */
  function filterPaths(name: string): string[] {
    const section = CI.slice(CI.indexOf(`            ${name}:`));
    const body = section.slice(0, section.search(/\n {12}[a-z]/) + 1 || undefined);
    return [...body.matchAll(/^ {14}- '([^']+)'$/gm)].map((m) => m[1]);
  }

  it('reads a plausible list out of the guard rather than silently reading none', () => {
    // The guard on the guard. A rename or a reformat that defeated the regex
    // above would make every assertion below pass over an empty list, which
    // is the same shape of silent green this whole issue is about.
    const documents = documentsUnderGuard();
    expect(documents.length).toBeGreaterThanOrEqual(7);
    expect(documents).toContain('REQUIREMENTS.md');
    expect(filterPaths('code').length).toBeGreaterThanOrEqual(8);
    expect(filterPaths('guarded_docs').length).toBeGreaterThanOrEqual(5);
  });

  it('matches every document under the guard to a filter that starts the frontend job', () => {
    const guardedDocs = filterPaths('guarded_docs');
    // `src/**` in `code:` is the only pattern doing work here — the four
    // template documents live under it. Stated as the one prefix rather than
    // by re-implementing glob matching, which would be a second thing that
    // can disagree with the action.
    expect(filterPaths('code')).toContain('src/**');

    const unmatched = documentsUnderGuard().filter(
      (doc) => !doc.startsWith('src/') && !guardedDocs.includes(doc),
    );
    expect(
      unmatched,
      `documents the round-trip guard reads that no filter matches, so a change to one ` +
        `of them skips the job that runs the guard: ${unmatched.join(', ')}`,
    ).toEqual([]);
  });

  it('lists no document that the guard does not actually read', () => {
    // The other direction, so the list cannot rot into a set of paths nobody
    // tests any more — a filter entry for a document the guard dropped costs
    // a frontend run on every change to it, forever, for nothing.
    const documents = documentsUnderGuard();
    const stale = filterPaths('guarded_docs').filter((p) => !documents.includes(p));
    expect(stale, `filter entries no document under the guard needs: ${stale.join(', ')}`).toEqual(
      [],
    );
  });

  it('lets documents start the frontend job and nothing else', () => {
    // The cost half. Documents cannot reach Rust or Windows, and nothing they
    // change can affect either, so the saving #113 measured stays in place
    // for the two expensive jobs.
    const gate = (job: string) => {
      const block = jobs(CI).get(job) ?? '';
      const match = block.match(/^ {4}if: (.+)$/m);
      expect(match, `job ${job} has no if:`).not.toBeNull();
      return (match as RegExpMatchArray)[1].trim();
    };
    expect(gate('frontend')).toBe(
      "needs.changes.outputs.code == 'true' || needs.changes.outputs.guarded_docs == 'true'",
    );
    expect(gate('rust')).toBe("needs.changes.outputs.code == 'true'");
    expect(gate('build-windows')).toBe("needs.changes.outputs.code == 'true'");
  });

  it('spells the filter one way, in all three places it appears', () => {
    // The filter's name, the expression that reads it, and the job output.
    // A hyphenated output name reads correctly in an expression — measured
    // on this branch, `false` rather than `NaN` — so this is not guarding a
    // bug. It is guarding against two spellings of one name, transliterated
    // by hand between two files, which is the shape that produced #118.
    expect(CI).toMatch(/^ {12}guarded_docs:$/m);
    expect(CI).toMatch(/steps\.filter\.outputs\.guarded_docs/);
    expect(CI).toMatch(/^ {6}guarded_docs: \$\{\{ steps\.decide\.outputs\.guarded_docs \}\}$/m);
    expect(CI).not.toMatch(/guarded-docs/);
  });

  it('fails open on both questions together', () => {
    // A non-answer says nothing about either question, so neither may be read
    // as "no". Skipping on a failure to answer is the silent green #118 is
    // about, and it must not come back through the new output.
    const block = jobs(CI).get('changes') ?? '';
    const fallback = block.slice(block.indexOf('else'));
    expect(fallback).toMatch(/echo "code=true"/);
    expect(fallback).toMatch(/echo "guarded_docs=true"/);
  });
});

/**
 * Every workflow that builds the application names the commit it is building
 * (#41).
 *
 * `vite.config.ts` used to carry a middle rung — `AGENTED_BUILD_COMMIT`, then
 * `GITHUB_SHA`, then `dev` — so a build step that lost its `env:` line still
 * produced seven plausible characters. On a push, in a scheduled build and in a release
 * those characters are right. On a `pull_request` event `GITHUB_SHA` is the
 * ephemeral merge commit, so they matched nothing anyone could see, and the
 * three-places-one-value rule that every manual pass in this project rests on
 * was defeated silently. **That rung is gone**: a build with no variable now
 * reports `dev`, on every event.
 *
 * Which moves the whole question here. The bundler cannot know which commit an
 * event means; the workflow can, and now has to say. So this is the guard, and
 * it is written in two halves that fail for opposite reasons:
 *
 *  - **sound** — every line that is present reads the right expression for its
 *    file. A line that names the wrong value is worse than none, because it
 *    looks correct.
 *  - **complete** — every step that builds the application carries a line.
 *    This is the half that catches what this issue is about, and the half a
 *    hurried version leaves out: **a count of the lines that exist cannot see
 *    a build step that has none.** Measured by mutation on `ffb890c`, deleting
 *    the frontend line from `ci.yml`: exactly one test of 1761 went red, the
 *    count assertion above, and it covered nothing in the other two files.
 *
 * `ci.yml` reads a different expression from the other two **on purpose**, and
 * unifying the three for symmetry would reintroduce this very defect in the
 * file that gets it right: its `changes` job computes the pull-request head,
 * because `github.sha` is the wrong commit on the event `ci.yml` runs on.
 */
describe('every workflow that builds the application names its commit (#41)', () => {
  /**
   * The steps that build the application, and the expression each file's must
   * carry. Written as *which step*, not as *how many lines* — that difference
   * is the whole of the "complete" half.
   */
  const BUILDERS: ReadonlyArray<{
    readonly file: string;
    readonly source: string;
    readonly isBuild: RegExp;
    readonly expression: string;
    readonly count: number;
  }> = [
    {
      file: 'ci.yml',
      source: CI,
      // The web bundle, and the Windows installer, whose step runs the build
      // once more if the first attempt fails (#501).
      isBuild: /^run: npm run build$|^ {10}npm run tauri build$/m,
      expression: 'needs.changes.outputs.build_sha',
      count: 2,
    },
    {
      file: 'scheduled.yml',
      source: SCHEDULED,
      // The tail is optional on purpose. What this pattern is for is
      // *which step*, and the step now carries a per-platform bundle list
      // (#8); asserting the arguments here would make an unrelated change to
      // them read as a missing build step.
      isBuild: /^ {10}npm run tauri build(?: --.*)?$/m,
      expression: 'github.sha',
      count: 1,
    },
    {
      file: 'release.yml',
      source: RELEASE,
      // The action runs the frontend build internally, so the value has to
      // reach it through this step's `env:`. That it does was measured on
      // v0.2.0-preview.3 (run 37479884948): About read the tagged commit.
      // Only a tag runs release.yml, so this assertion guards the wiring
      // between releases.
      isBuild: /^uses: tauri-apps\/tauri-action@/m,
      expression: 'github.sha',
      count: 1,
    },
  ];

  it.each(BUILDERS.map((b) => [b.file, b] as const))(
    '%s: every step that builds carries the line',
    (_file, builder) => {
      const buildSteps = steps(builder.source).filter((step) => builder.isBuild.test(step));
      // The guard on the guard, the shape this file already uses for the
      // round-trip documents: a rename that defeated the pattern would make
      // the loop below pass over an empty list, which is the same silent green
      // the whole file exists to prevent.
      expect(buildSteps, `no build step matched in ${builder.file}`).toHaveLength(builder.count);
      for (const step of buildSteps) {
        expect(step, `a build step in ${builder.file} carries no AGENTED_BUILD_COMMIT`).toMatch(
          /^ {10}AGENTED_BUILD_COMMIT: \$\{\{ .+? \}\}$/m,
        );
      }
    },
  );

  it.each(BUILDERS.map((b) => [b.file, b] as const))(
    '%s: every line present reads the right expression',
    (_file, builder) => {
      const found = [
        ...builder.source.matchAll(/^\s*AGENTED_BUILD_COMMIT: \$\{\{(.+?)\}\}\s*$/gm),
      ].map((match) => match[1].trim());
      // Deliberately **not** a count. Counting here would make this half fail
      // for a missing line as well, and the two halves are only worth having
      // separately if they fail for opposite reasons: a line that is gone is
      // "complete" above, a line that names the wrong value is this one. The
      // lower bound is the guard on the guard — a pattern that matched nothing
      // would otherwise pass over an empty list.
      //
      // Measured: with `ci.yml`'s two lines, deleting one leaves this half
      // green and only "complete" red, which is the separation. With the one
      // line `scheduled.yml` and `release.yml` each carry, deleting it trips
      // this lower bound as well — *no line* and *the pattern found nothing*
      // are the same observation when there is only one, and the guard on the
      // guard is worth more than the separation in that case.
      expect(found.length, `no AGENTED_BUILD_COMMIT in ${builder.file}`).toBeGreaterThan(0);
      for (const expression of found) {
        expect(expression).toBe(builder.expression);
      }
    },
  );

  it('does not let ci.yml drift onto github.sha', () => {
    // The narrow half, and the one a tidy pass unifying the three files would
    // break. `github.sha` on a `pull_request` event is the merge commit — the
    // exact value this issue is about — so in this file it is the wrong
    // answer, however symmetrical it looks beside the other two.
    expect(CI).not.toMatch(/AGENTED_BUILD_COMMIT: \$\{\{ github\.sha \}\}/);
    expect(CI).toMatch(/build_sha=\$\{sha:0:7\}/);
  });

  it('leaves the bundler with one variable and no fallback', () => {
    // The other side of the contract, in the file the workflows are passing
    // to. A returned `GITHUB_SHA` rung here would make every assertion above
    // decorative: a workflow could forget its line and still bake a sha.
    // The *read*, not the name: the comment above the code explains at length
    // why this rung was removed, and a test that forbade the word would forbid
    // the explanation with it.
    expect(VITE_CONFIG).not.toMatch(/process\.env\.GITHUB_SHA/);
    expect(VITE_CONFIG).toMatch(
      /const buildCommit = \(process\.env\.AGENTED_BUILD_COMMIT \?\? ''\)\.trim\(\)\.slice\(0, 7\) \|\| 'dev';/,
    );
  });
});

describe('a build whose tool download fails once is tried once more (#501)', () => {
  // `tauri build` downloads WiX and NSIS from GitHub on every run, and an
  // outage there once turned a build red that had nothing wrong with it.
  // What this pins is the shape that keeps a real failure red: one retry,
  // announced, and a second attempt whose failure is the step's failure.
  it.each([
    ['ci.yml', CI, 'Build the installer'],
    ['scheduled.yml', SCHEDULED, 'Build the bundles'],
  ])('%s: the build step retries once and fails on a second failure', (_file, source, name) => {
    const step = steps(source).find((s) => s.startsWith(`name: ${name}\n`));
    expect(step, `no step named ${name}`).toBeDefined();
    const lines = (step ?? '').split('\n').map((line) => line.trim());
    const first = lines.findIndex((line) =>
      /^if npm run tauri build.*; then exit 0; fi$/.test(line),
    );
    expect(first, 'the first attempt').toBeGreaterThan(-1);
    expect(lines[first + 1]).toMatch(
      /^echo "::warning::npm run tauri build failed; running it once more/,
    );
    // The second attempt runs the same command as the first, as the last
    // line and unguarded: nothing turns its failure into a success.
    expect(lines[first + 2]).toMatch(/^npm run tauri build/);
    expect(lines[first]).toBe(`if ${lines[first + 2]}; then exit 0; fi`);
  });
});

/**
 * The grants of the top-level `permissions` key, one `scope: level` string
 * each, or the scalar written on the key line itself (`read-all`, `{}`).
 * Empty when the file has no top-level key. Top-level keys sit at column
 * zero and their entries at two spaces; comment lines inside are skipped.
 */
function topLevelPermissions(source: string): string[] {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => /^permissions:/.test(line));
  if (start === -1) return [];
  const scalar = lines[start].replace(/^permissions:/, '').trim();
  if (scalar !== '') return [scalar];
  const grants: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*#/.test(line)) continue;
    const entry = line.match(/^ {2}([a-z-]+:\s*\S+)\s*$/);
    if (!entry) break;
    grants.push(entry[1].replace(/:\s+/, ': '));
  }
  return grants;
}

describe('every workflow says what its token may do, at the top (#661)', () => {
  // A job with no `permissions` key of its own runs with the token the file
  // declares at the top, and with the repository default when the file
  // declares none. The default is read-only today, set at the organization
  // level; the top-level key is what keeps a job read-only if it changes.
  it.each(WORKFLOWS)('%s declares top-level permissions', (_file, source) => {
    expect(topLevelPermissions(source).length).toBeGreaterThan(0);
  });

  // Write stays where it is needed, in release.yml, which creates the
  // release. Every other file grants read at most at the top; a job that
  // needs more declares it on itself, as Scorecard does in security.yml.
  it.each(WORKFLOWS.filter(([file]) => file !== 'release.yml'))(
    '%s grants nothing above read at the top',
    (_file, source) => {
      const grants = topLevelPermissions(source);
      expect(grants.length, 'no top-level permissions').toBeGreaterThan(0);
      for (const grant of grants) {
        expect(grant).toMatch(/^(read-all|\{\}|[a-z-]+: (read|none))$/);
      }
    },
  );
});

describe('security.yml reports advisories and never blocks (#668)', () => {
  const SECURITY = WORKFLOWS.find(([file]) => file === 'security.yml')?.[1] ?? '';

  it('runs on its schedule and by hand, never on a pull request or a push', () => {
    expect(SECURITY).toContain("- cron: '0 4 * * 1'");
    expect(SECURITY).toMatch(/^ {2}workflow_dispatch:$/m);
    expect(SECURITY).not.toMatch(/^ {2}(pull_request|push):/m);
  });

  it('gives write scopes to the Scorecard job alone', () => {
    const scoped = [...jobs(SECURITY)].filter(([, block]) => /^ {6}[a-z-]+: write$/m.test(block));
    expect(scoped.map(([id]) => id)).toEqual(['scorecard']);
  });

  /** An `npm audit --json` report naming one advisory against one package. */
  const audit = (id: string, name: string) => ({
    vulnerabilities: {
      [name]: {
        via: [
          { name, title: 't', severity: 'moderate', url: `https://github.com/advisories/${id}` },
        ],
      },
      dependent: { via: [name] },
    },
  });
  const accepted = { accepted: [{ id: 'GHSA-aaaa-bbbb-cccc', reason: 'r' }] };

  it('leaves an accepted npm advisory silent', () => {
    const result = toReport(audit('GHSA-aaaa-bbbb-cccc', 'p'), accepted);
    expect(result.reported).toEqual([]);
    expect(result.accepted).toEqual(['GHSA-aaaa-bbbb-cccc']);
    expect(result.stale).toEqual([]);
  });

  it('reports a new npm advisory, and an accepted one npm no longer reports', () => {
    const result = toReport(audit('GHSA-dddd-eeee-ffff', 'q'), accepted);
    expect(result.reported.map((advisory) => advisory.id)).toEqual(['GHSA-dddd-eeee-ffff']);
    expect(result.stale).toEqual(['GHSA-aaaa-bbbb-cccc']);
  });
});
