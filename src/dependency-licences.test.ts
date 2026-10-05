import { describe, expect, it } from 'vitest';
import packageLock from '../package-lock.json?raw';
import denyToml from '../src-tauri/deny.toml?raw';

/**
 * The npm half of the licence check (#476). cargo-deny reads
 * `src-tauri/deny.toml` for the crates; this reads the same allow list for
 * the production packages of `package-lock.json`, so one list holds for both
 * halves (owner decision of 2026-10-05).
 *
 * A package passes when its declared licence is allowed, or, for an
 * expression, when one alternative of an OR has every term allowed. The
 * shapes understood are the ones a lockfile carries today: one licence, a
 * flat OR or AND, optionally in parentheses. Anything else fails and names
 * itself, to be read by hand, rather than pass unread.
 */
interface LockEntry {
  version?: string;
  license?: string;
  dev?: boolean;
  optional?: boolean;
}

const REVIEW =
  'The allow list in src-tauri/deny.toml changes after a review of that package, never to make this check pass.';

/** The strings of `allow = [ ... ]` in deny.toml, comments left out. */
function allowList(toml: string): Set<string> {
  const block = /^allow = \[([\s\S]*?)^\]/m.exec(toml)?.[1] ?? '';
  const withoutComments = block.replace(/#.*$/gm, '');
  return new Set([...withoutComments.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

/** Whether a declared licence is allowed, or `null` when its shape is not one understood here. */
function isAllowed(expression: string, allowed: Set<string>): boolean | null {
  const bare = expression.trim().replace(/^\((.*)\)$/, '$1');
  if (/[()]/.test(bare)) return null;
  // AND binds tighter than OR in SPDX, so the ORs split first.
  const alternatives = bare.split(/\s+OR\s+/);
  if (alternatives.some((alt) => alt.trim() === '')) return null;
  return alternatives.some((alt) =>
    alt.split(/\s+AND\s+/).every((term) => allowed.has(term.trim())),
  );
}

const ALLOWED = allowList(denyToml);
const PRODUCTION = Object.entries(JSON.parse(packageLock).packages as Record<string, LockEntry>)
  .filter(([path, info]) => path.startsWith('node_modules/') && !info.dev && !info.optional)
  .map(([path, info]) => ({
    name: path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length),
    version: info.version ?? 'unknown',
    licence: info.license ?? 'none declared',
  }));

describe('the licences of the production npm packages (#476)', () => {
  it('reads the allow list out of deny.toml rather than none', () => {
    // The guard on the guard: a reformat that defeated the regex above would
    // leave every package to be judged against an empty list. Not the size of
    // the list itself, which a review may shorten.
    expect(ALLOWED).toContain('MIT');
    expect(ALLOWED.size).toBeGreaterThanOrEqual(2);
    expect(PRODUCTION.length).toBeGreaterThan(50);
  });

  it.each(PRODUCTION)('$name carries an allowed licence', ({ name, version, licence }) => {
    const verdict = isAllowed(licence, ALLOWED);
    expect(
      verdict,
      `${name} ${version}: the licence expression "${licence}" has a shape this test does not read. Read it by hand.`,
    ).not.toBeNull();
    expect(
      verdict,
      `${name} ${version} is licensed ${licence}, which is not allowed. ${REVIEW}`,
    ).toBe(true);
  });
});

describe('how a licence expression is read', () => {
  const allowed = new Set(['MIT', 'Apache-2.0']);

  it.each([
    ['MIT', true],
    ['GPL-3.0', false],
    ['MIT OR GPL-3.0', true],
    ['(MPL-2.0 OR Apache-2.0)', true],
    ['MIT AND Apache-2.0', true],
    ['MIT AND GPL-3.0', false],
    ['GPL-3.0 OR MIT AND Apache-2.0', true],
  ])('%s is %s', (expression, expected) => {
    expect(isAllowed(expression, allowed)).toBe(expected);
  });

  it('declines a nested expression rather than guess at it', () => {
    expect(isAllowed('(MIT OR Apache-2.0) AND BSD-3-Clause', allowed)).toBeNull();
  });
});
