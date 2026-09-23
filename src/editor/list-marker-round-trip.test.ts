import { afterEach, describe, expect, it } from 'vitest';
import { markerFor, markerOf } from './markdown/list-marker';
import { createEditor, type EditorInstance } from './setup';

/**
 * Issue #431 — a list keeps the marker the file wrote it with.
 *
 * ── The defect this repairs, measured on `6b5c2e4` ──
 *
 * Every list was written back with `-`, or with `.` for an ordered one, from a
 * single turndown option. For a list on its own that quietly rewrote the file:
 * `* one` came back `- one`, `+ one` came back `- one`, `1) one` came back
 * `1. one`, and a nested `*` under a `-` came back `-`. **None of those was a
 * recorded R-C2 exception**, which by WORKFLOW makes each one a defect rather
 * than a difference.
 *
 * For two lists side by side it lost a document and then kept moving. A marker
 * change is the one thing in markdown that keeps two adjacent lists of the
 * same kind apart, so writing both with `-` made them **one** list -
 * `- one`⏎`- two`⏎⏎`* three`⏎`* four` came back as one - and reading that back
 * the blank line made it one **loose** list, so the **second** save wrote four
 * items a blank line apart. The file settled only on the third. R-C2 allows a
 * difference that happens once and then holds still; this did not.
 *
 * ── Why the marker and nothing else ──
 *
 * `serialize.ts` already says, above `adjacentListsOfDifferentKinds`, that a
 * same-kind pair cannot be written tightly because the two would merge. What
 * it did not say is that the blank line it falls back to merges them too, one
 * save later. Tight merges, blank-line merges, and nothing can be put between
 * them that the file did not have - so the marker is the only spelling left.
 *
 * The distinction is never lost at parse: `marked` hands over two list tokens,
 * each carrying its marker at the head of its first item's raw. It is lost at
 * serialization, so it travels as an attribute on the list, the address #28
 * already uses for the same list's spacing.
 */

let instance: EditorInstance | null = null;

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

function save(markdown: string): string {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance?.destroy();
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return `${instance.getMarkdown().trim()}\n`;
}

/** Open, save, and save what came back: the #96 property, for every row. */
function survives(markdown: string): void {
  const once = save(markdown);
  expect(once, 'the first save').toBe(markdown);
  expect(save(once), 'the second save').toBe(once);
}

describe('two adjacent lists keep the markers that separate them (#431)', () => {
  // Each of these was one list after the first save on `6b5c2e4`, and four
  // items a blank line apart after the second.
  it('a hyphen list then a star list', () => {
    survives('- one\n- two\n\n* three\n* four\n');
  });

  it('a star list then a hyphen list', () => {
    survives('* one\n* two\n\n- three\n- four\n');
  });

  it('a hyphen list then a plus list', () => {
    survives('- one\n- two\n\n+ three\n+ four\n');
  });

  it('a full-stop list then a bracket list, numbering included', () => {
    // The ordered case also renumbered: `1)` and `2)` came back `3.` and `4.`.
    survives('1. one\n2. two\n\n1) three\n2) four\n');
  });
});

describe('a list on its own keeps its marker too (#431)', () => {
  // Not the defect this was filed for, and repaired by the same attribute:
  // each of these was rewritten on every save, with nothing recorded.
  it('a star list', () => {
    survives('* one\n* two\n');
  });

  it('a plus list', () => {
    survives('+ one\n+ two\n');
  });

  it('an ordered list written with brackets', () => {
    survives('1) one\n2) two\n');
  });

  it('a star list nested under a hyphen list', () => {
    survives('- one\n  * nested\n- two\n');
  });
});

describe('what this must not move (#431)', () => {
  it('a hyphen list is written as it always was', () => {
    survives('- one\n- two\n');
  });

  it('an ordered list keeps its start and its full stop', () => {
    survives('3. one\n4. two\n');
  });

  it('a task list is untouched', () => {
    survives('- [ ] one\n- [x] two\n');
  });

  it('the loose-list exception still reads as it did', () => {
    // Two hyphen lists a blank line apart are **one loose list** to begin
    // with, so this is the recorded #28 exception rather than this issue.
    expect(save('- one\n- two\n\n- three\n- four\n')).toBe('- one\n\n- two\n\n- three\n\n- four\n');
  });

  it('the exception for two lists of different kinds still reads as it did', () => {
    // #160 writes these tightly, and they are a fixed point. The marker
    // attribute must not reintroduce the blank line that rule took away.
    const once = save('- one\n- two\n\n1. three\n2. four\n');
    expect(once).toBe('- one\n- two\n1. three\n2. four\n');
    expect(save(once)).toBe(once);
  });

  it('a list the editor makes is written with the markers it always used', () => {
    // No attribute is stamped for `-` or `.`, so a list nobody parsed from a
    // file is written exactly as it was before this change.
    const host = document.createElement('div');
    document.body.appendChild(host);
    instance = createEditor(host);
    instance.setMarkdown('one\n');
    instance.editor.commands.selectAll();
    instance.editor.commands.toggleBulletList();
    expect(instance.getMarkdown().trim()).toBe('- one');
  });
});

describe('the reading itself (#431)', () => {
  it('reads the marker off an item, and answers nothing for a shape it does not know', () => {
    expect(markerOf('* one\n', false)).toBe('*');
    expect(markerOf('  + one\n', false)).toBe('+');
    expect(markerOf('1) one\n', true)).toBe(')');
    expect(markerOf('12. one\n', true)).toBe('.');
    // A body that is not a list item at all - what a list built by an edit
    // hands over - answers nothing rather than guessing.
    expect(markerOf('one\n', false)).toBeNull();
    expect(markerOf('one\n', true)).toBeNull();
  });

  it('a value this pipeline did not stamp falls back to the default', () => {
    // The `decodeIndents` rule: this answers for an attribute a user document
    // wrote by hand, and a marker of its choosing must not reach the file.
    expect(markerFor('x', false)).toBe('-');
    expect(markerFor('<script>', false)).toBe('-');
    expect(markerFor(null, true)).toBe('.');
    expect(markerFor(')', true)).toBe(')');
  });
});
