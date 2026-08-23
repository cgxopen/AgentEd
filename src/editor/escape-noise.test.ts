import { afterEach, describe, expect, it } from 'vitest';
import readme from '../../README.md?raw';
import requirements from '../../REQUIREMENTS.md?raw';
import { createEditor, type EditorInstance } from './setup';

/**
 * #90 at the level the user meets it: open a document, change nothing, save —
 * and the file should not gain backslashes nobody typed (R-C2).
 *
 * Turndown escapes every `_` in a text node. Measured on `86bc260` through
 * `createEditor` + `setMarkdown` + `getMarkdown`, every case in the first list
 * came back changed: `cl100k_base` → `cl100k\_base`, `snake_case` →
 * `snake\_case`, `a_b_c` → `a\_b\_c`.
 *
 * Backticks are deliberately **not** narrowed and keep turndown's behaviour —
 * a recorded R-C2 exception, pinned below with the case that decided it.
 *
 * The pair-level half is in `markdown/roundtrip.test.ts`; the function itself
 * is in `markdown/escape.test.ts`. This file exists because the blind spot
 * #84 named is real — `roundtrip.test.ts` never builds an editor, and every
 * finding since #42 has come through the level it does not cover.
 */
let instance: EditorInstance | null = null;

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance;
}

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

describe('an untouched save adds no backslash (#90)', () => {
  it.each([
    ['an identifier with one underscore', 'The tokenizer is cl100k_base here.'],
    ['snake_case in a sentence', 'Call snake_case now.'],
    ['two underscores in one word', 'Try a_b_c please.'],
    ['a double underscore inside a word', 'A foo__bar name.'],
    ['a file name in prose', 'Open file_name.md next.'],
    ['an identifier inside bold', '**cl100k_base** matters.'],
    ['an identifier inside a link', '[cl100k_base](https://x) matters.'],
    ['an identifier in a list item', '- uses cl100k_base'],
    ['an identifier in a heading', '## About cl100k_base'],
  ])('leaves %s byte-identical', (_label, markdown) => {
    const editor = editorWith(markdown);
    expect(editor.getMarkdown().trim()).toBe(markdown);
  });
});

describe('the floor — what must still be escaped, still is', () => {
  it.each([
    ['underscores the file had already escaped', 'a \\_foo\\_ b'],
    ['asterisks the file had already escaped', 'a \\*not bold\\* b'],
    ['an underscore that could open emphasis', 'see \\_foo here'],
    ['an underscore that could close emphasis', 'see foo\\_ here'],
    ['an underscore run at both edges of a word', 'a \\_x_y\\_ b'],
    ['emphasis spelled with asterisks', 'a *foo* b'],
    ['intraword emphasis with asterisks', 'a foo*bar*baz b'],
    ['strong', 'a **bold** b'],
    ['inline code holding an underscore', 'use `snake_case` here'],
    ['a fenced block holding an underscore', '```js\nconst a_b = 1;\n```'],
  ])('keeps %s unchanged', (_label, markdown) => {
    const editor = editorWith(markdown);
    expect(editor.getMarkdown().trim()).toBe(markdown);
  });

  it('keeps a backtick run on each side of an element escaped', () => {
    // The case that decided the shape of this PR. A first draft also narrowed
    // backtick runs and withheld both of these, because from inside its own
    // text node each looked unpaired; re-reading the result paired them and
    // swallowed the `<strong>` into a code span — a visible loss where `main`
    // was correct. Pairing is a property of the whole block and `escape` is
    // handed one text node, so backticks keep turndown's behaviour (R-C2).
    const editor = editorWith('a \\` b **x** c \\` d');
    expect(editor.getMarkdown().trim()).toBe('a \\` b **x** c \\` d');
    expect(editor.editor.getHTML()).toContain('<strong>x</strong>');
    expect(editor.editor.getHTML()).not.toContain('<code>');
  });

  it('decides an underscore from one text node, across an element boundary', () => {
    // Why the surviving half is safe where the removed half was not:
    // intraword-ness is settled by the two characters beside the run, so a
    // node boundary makes a run non-intraword — the escaping direction — and
    // nothing here depends on what lies in the next node.
    const editor = editorWith('foo_bar **x** baz_qux');
    expect(editor.getMarkdown().trim()).toBe('foo_bar **x** baz_qux');
    expect(editor.editor.getHTML()).toContain('<strong>x</strong>');
    expect(editor.editor.getHTML()).not.toContain('<em>');
  });

  it('writes a literal _foo_ so that re-reading it does not make italics', () => {
    // The case that proves the narrowing did not over-correct: text typed in
    // the editor as plain characters, never as emphasis. If it came back
    // unescaped, the next open would read it as `<em>` and the document would
    // have changed meaning between two saves nobody edited.
    const editor = editorWith('');
    editor.editor.commands.setContent('<p>a _foo_ b</p>');
    const saved = editor.getMarkdown().trim();
    expect(saved).toBe('a \\_foo\\_ b');

    const reread = editorWith(saved);
    expect(reread.editor.getHTML()).not.toContain('<em>');
    expect(reread.getMarkdown().trim()).toBe(saved);
  });
});

describe('KNOWN EXCEPTION — a redundant escape the source had is not kept', () => {
  it('writes `the foo\\_bar name` as `the foo_bar name`, once', () => {
    // Recorded in REQUIREMENTS under R-C2. Unavoidable given the design:
    // `marked` consumes the backslash, so by serialization time nothing knows
    // the source had one — preserving them would mean carrying "this
    // underscore was escaped" through the editor per character.
    //
    // The trade the owner took (2026-08-23) is that the file changes **once**
    // and then never, instead of gaining noise on every save. The second half
    // of that sentence is the half worth pinning.
    const editor = editorWith('the foo\\_bar name');
    const once = editor.getMarkdown().trim();
    expect(once).toBe('the foo_bar name');

    const again = editorWith(once);
    expect(again.getMarkdown().trim()).toBe(once);
  });
});

describe('two real documents, opened and saved unedited', () => {
  // Neither is byte-identical yet, and this asserts only the share #90 owns.
  // What remains, measured on this branch:
  //   README.md      — the shortcuts table, re-padded (+628 bytes): closed
  //                    by #93; the table is now written as the file wrote it.
  //                    Two badge rows and a two-line sign-off collapse to one
  //                    line each at no byte cost: R-C2's soft-break exception.
  //   REQUIREMENTS.md — `**` re-nested around inline code and links: #84.
  //                    A code span's delimiter run shortened to the minimum
  //                    width that still closes it: pre-existing and stable.
  //                    `## 1.` written as `## 1\.` was the third; it closed
  //                    with #97, at the heading rule rather than here — in a
  //                    heading that escape is noise, in a paragraph it is
  //                    load-bearing, and `escape(text)` is not given the
  //                    parent node. Pinned in `numbered-heading.test.ts`.
  //
  // The backtick count is asserted as **unchanged**, not improved: this PR
  // narrows underscores only.
  const count = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;

  it.each([
    ['README.md', readme],
    ['REQUIREMENTS.md', requirements],
  ])('adds no escaped underscore to %s', (_name, source) => {
    // The claim this PR owns. Equal, not merely smaller: a file may
    // legitimately contain escaped underscores, and the narrowing must neither
    // add them nor take the existing ones away. Both files hold 0 today, and
    // on `86bc260` both came back with 1.
    const editor = editorWith(source);
    expect(count(editor.getMarkdown(), /\\_/g)).toBe(count(source, /\\_/g));
  });

  it.each([
    ['README.md', readme],
    ['REQUIREMENTS.md', requirements],
  ])("leaves %s with turndown's own backtick escaping", (_name, source) => {
    // **Not** a claim of improvement — the recorded R-C2 exception. Asserted
    // as "no fewer than the file had", because a *drop* is the shape the
    // withdrawn backtick narrowing had, and that narrowing is what swallowed a
    // `<strong>` between two runs on #96. An absolute count is deliberately
    // not pinned here: these are living documents, and a test that breaks
    // whenever someone edits `REQUIREMENTS.md` teaches people to edit the test.
    // The precise behaviour is pinned on fixed fixtures above and in
    // `markdown/escape.test.ts`.
    const editor = editorWith(source);
    expect(count(editor.getMarkdown(), /\\`/g)).toBeGreaterThanOrEqual(count(source, /\\`/g));
  });

  it.each([
    ['README.md', readme],
    ['REQUIREMENTS.md', requirements],
  ])('changes %s once and then holds still', (_name, source) => {
    // What the two exceptions promise together: an untouched save may
    // normalise the file, but the *next* untouched save must move nothing.
    // A round trip that kept drifting would be a defect whatever R-C2 said.
    const first = editorWith(source).getMarkdown();
    const second = editorWith(first).getMarkdown();
    expect(second).toBe(first);
  });

  it('keeps the identifiers README names in prose', () => {
    const editor = editorWith(readme);
    const saved = editor.getMarkdown();
    expect(saved).toContain('cl100k_base');
    expect(saved).not.toContain('cl100k\\_base');
  });
});
