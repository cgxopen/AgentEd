/**
 * The editor-level round-trip table (#84) — the standing guard.
 *
 * `markdown/roundtrip.test.ts` goes markdown → `marked` → DOMPurify → turndown
 * and never builds an editor. Every R-C2 finding since #42 has lived in the gap
 * that leaves: the link mark dropped inside TipTap (#42), the final newline and
 * the mark re-nesting (#84), and — while this file was being written — the
 * container half of the empty fence (#104). The pair-level suite was clean for
 * all of them.
 *
 * This file runs the same shapes through `createEditor` + `setMarkdown` +
 * `getMarkdown`, and the repository's own documents through the **real save
 * assembly**, which is the only level where "open the file, change nothing,
 * save, and the bytes are the bytes" is actually asserted.
 *
 * ── The form, and the tension in it ──
 *
 * Plain byte equality does not work, and saying why is half the design. The
 * documents in this repository still carry recorded R-C2 exceptions: `README.md`
 * grows by 3 bytes from the backtick exception, and the soft-break joins cost
 * nothing but change where the lines end. A test that asserted nothing moves
 * would fail for reasons that are written down and deliberate.
 *
 * So the guard is in two halves, and each answers a different half of the
 * question:
 *
 *  1. **Fixtures** carry an explicit expectation. `identical` is the default and
 *     any drift fails. An exception carries the **exact bytes** it is allowed to
 *     write and the recorded exception it belongs to — so a regression fails,
 *     and so does an unannounced *fix*: whoever repairs one of these has to move
 *     the table and say so, which is the point.
 *  2. **Documents** are living text and cannot carry expected bytes. What holds
 *     for every one of them with no list at all is the property from #96: the
 *     **second save moves nothing**. What the *first* save may change is decided
 *     by a small set of named normalisers, each erasing exactly one recorded
 *     exception's signature from both sides of a difference. The set is driven
 *     by what the documents below exercise, not by the list of exceptions: most
 *     exceptions R-C2 records meet no document here and have no normaliser, so
 *     a document that comes to hold one fails until one is written. A
 *     difference no normaliser can erase **fails**, and prints itself. That is
 *     the half that must not rot: a list of expected strings stops being read,
 *     a normaliser that cannot claim a new difference cannot stay quiet about
 *     it.
 *
 * Two floors are asserted for every document independently of the normalisers,
 * because a normaliser is a statement about spelling and these are statements
 * about content: the **visible text** of the document is unchanged, and so is
 * the **list of link destinations**. Between them, no normaliser can hide a lost
 * word or a lost href however broadly it is written.
 *
 * ── What used to be deliberately not here ──
 *
 * A list item whose entire body is a block lost its bullet at this level
 * (`- ## 1. x` → `## 1. x`) while being byte-identical at the pair level, and
 * the family was left out of this table on purpose: pinning the bytes would
 * have enshrined the defect. **#110 fixed it** — `listItem` takes `block+`
 * rather than `paragraph block*` — so the shapes are in the table now, as
 * bytes, and the row further down that asserted no list survived asserts the
 * bullet surviving instead.
 *
 * Two things that were true when that paragraph was written have since been
 * fixed by **#157**, and the order they were fixed in is the part worth
 * keeping. `taskItem` carried the same `paragraph block*` restriction, and
 * widening it the way #110 widened `listItem` did not repair the shape but
 * lost content — measured on #110, `- [ ] 1. a` saved as `- [ ] a` and
 * `- [ ] > q` as `- [ ] q`, because `taskListItemReplacement` in
 * `serialize.ts` could not write a block into a task item at all. The same
 * function is why **a nested list under a task item was dropped entirely** —
 * `- [ ] a\n  - b` saved as `- [ ] a`, on `7d6cb13` and after — which was
 * older than #110 and untouched by it. So #157 fixed the serializer first,
 * proved it against the nested list under the *unwidened* schema, and widened
 * the node last; both families are in the table below, as bytes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import claudeMd from '../../CLAUDE.md?raw';
import contributingMd from '../../CONTRIBUTING.md?raw';
import adrMd from '../../docs/ADR/ADR-001-reset-and-simplification.md?raw';
import readmeMd from '../../README.md?raw';
import requirementsMd from '../../REQUIREMENTS.md?raw';
import securityMd from '../../SECURITY.md?raw';
import { buildDocument } from '../app/editor-document';
import { AppState } from '../app/state';
import { loadMarkdown, saveMarkdown } from '../formats/plain';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import blankFrontmatterMd from '../templates/blank-frontmatter.md?raw';
import {
  RETIRED_MEETING_NOTE_SEED,
  RETIRED_PROJECT_DOCUMENT_SEED,
  RETIRED_README_SEED,
} from '../test-support/retired-seeds';
import { markdownToHtml } from './markdown/parse';
import { htmlToMarkdown } from './markdown/serialize';
import { createEditor, type EditorInstance } from './setup';

// ─────────────────────────────────────────────────────────────────────────────
// Half 1 — the shape table
// ─────────────────────────────────────────────────────────────────────────────

let instance: EditorInstance | null = null;

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance;
}

/** Open `markdown` in an editor, save it unedited, return what it wrote. */
function openAndSave(markdown: string): string {
  const editor = editorWith(markdown);
  const saved = editor.getMarkdown().trim();
  editor.destroy();
  instance = null;
  return saved;
}

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

/**
 * What a shape is allowed to do on its first save. `'identical'` is the
 * default and means exactly that. Anything else must name the recorded R-C2
 * exception it belongs to and the exact bytes it writes — an exception with no
 * `because` is not an exception, it is an unexplained difference.
 */
type Expectation = 'identical' | { readonly writes: string; readonly because: string };

/** A recorded R-C2 exception, named the way REQUIREMENTS names it. */
const BACKTICK_RUNS = 'R-C2: backtick runs are escaped even when nothing can close them';
const REDUNDANT_ESCAPE = 'R-C2: a redundant escape the file already had is not preserved';
const INLINE_ELEMENT_NUMBER =
  'R-C2: a number opening an inline element in a heading or a cell keeps its backslash';
const SINGLE_TILDE = 'R-C2: single-tilde strikethrough is written with two';
const TABLE_SPELLINGS = 'R-C2: five table spellings AgentEd cannot hold';
const MARK_NESTING = 'R-C2: two overlapping marks have one nesting (#84)';
const ORDERED_TASK_MARKER = 'R-C2: a task marker in an ordered list is written escaped';
/** An item holding a table writes its blocks a blank line apart (#281). */
const TASK_ITEM_WITH_A_TABLE = 'R-C2: an item holding a table writes its blocks a blank line apart';
/** All three CommonMark title delimiters parse the same, so one is written (#230). */
const TITLE_DELIMITER = 'R-C2: an image title is written back double-quoted';
/** Two adjacent lists of different kinds, written tight because that is a fixed point (#160). */
const ADJACENT_LISTS = 'R-C2: two adjacent lists of different kinds are written a line apart';
/** A table inside a cell, written as inline HTML in one spelling (#278). */
const INLINE_TABLE = 'R-C2: a table inside a table cell is written as inline HTML';
/** Where a raw HTML table is not one whole block at the top level, it is written as GFM (#283). */
const HTML_TABLE_NOT_KEPT =
  'R-C2: a raw HTML table is kept only as one whole block at the top level';
/** A list the file wrote as raw HTML, written as a markdown list (#283, owner decision). */
const HTML_LIST = 'R-C2: a list the file wrote as raw HTML is written as a markdown list';

/**
 * Every shape `markdown/roundtrip.test.ts` covers, plus the six shapes of #84,
 * plus the code-span shapes the fix for its second half reaches.
 *
 * Read the third column as the answer to "what is this repository willing to
 * write back": `'identical'` everywhere it can, and a named exception with its
 * exact bytes everywhere it cannot.
 */
const TABLE: ReadonlyArray<readonly [string, string, Expectation]> = [
  // ── Blocks and inline basics ──
  ['an H1', '# Title', 'identical'],
  ['an H2', '## Sub', 'identical'],
  ['an H3', '### Deeper', 'identical'],
  ['an H4', '#### Four', 'identical'],
  ['an H5', '##### Five', 'identical'],
  ['an H6', '###### Six', 'identical'],
  ['seven hashes, which is not a heading', '####### Seven', 'identical'],
  ['all six levels in order', '# a\n\n## b\n\n### c\n\n#### d\n\n##### e\n\n###### f', 'identical'],
  ['bold and italic', '**bold** and *italic*', 'identical'],
  ['inline code', 'use `npm test` to run', 'identical'],
  ['a blockquote', '> a quote', 'identical'],
  ['a horizontal rule', '---', 'identical'],
  ['a link', '[link](https://example.com)', 'identical'],
  ['an image', '![alt](img.png)', 'identical'],
  ['an underline', 'plain <u>under</u> text', 'identical'],
  ['a fenced block with a language', '```ts\nconst x = 1;\n```', 'identical'],
  ['an empty fence', '```\n```', 'identical'],
  ['an empty fence with a language', '```js\n```', 'identical'],
  ['a fence holding only spaces', '```\n   \n```', 'identical'],

  // The eight spellings the code-block input rule refused until #237. The
  // file already held every one of them — that is what said the defect was
  // the rule rather than the format — and these rows are what keeps it so
  // now that the rule can also produce them.
  ['a fence whose language is capitalised', '```Python\nx = 1\n```', 'identical'],
  ['a fence whose language is upper case', '```JS\nconst x = 1;\n```', 'identical'],
  ['a fence whose language is a single upper-case letter', '```C\nint x;\n```', 'identical'],
  ['a fence whose language ends in a hash', '```c#\nvar x = 1;\n```', 'identical'],
  ['a fence whose language ends in two pluses', '```c++\nint x;\n```', 'identical'],
  ['a fence whose language holds a hyphen', '```objective-c\nint x;\n```', 'identical'],
  ['a fence whose language ends in a digit', '```py3\nx = 1\n```', 'identical'],
  ['a fence whose language holds a digit after letters', '```html5\n<p>x</p>\n```', 'identical'],
  ['a task list', '- [ ] todo\n- [x] done', 'identical'],

  // ── A fence that is the only content of its container (#104) ──
  //
  // The blockquote half. The list half is below, in its own block, because at
  // this level it meets a TipTap schema fact that has nothing to do with the
  // fence — see the comment there.
  ['an empty fence alone in a blockquote', '> ```\n> ```', 'identical'],
  ['an empty fence alone in a blockquote, with a language', '> ```js\n> ```', 'identical'],
  ['a fence with content alone in a blockquote', '> ```\n> x\n> ```', 'identical'],

  // ── Lists ──
  ['a bullet list', '- one\n- two', 'identical'],
  ['an ordered list', '1. one\n2. two', 'identical'],
  ['a nested bullet list', '- one\n  - nested\n- two', 'identical'],
  ['a nested ordered list', '1. one\n   1. nested\n2. two', 'identical'],
  ['three levels deep', '- a\n  - b\n    - c\n- d', 'identical'],
  ['an ordered list starting past 1', '9. nine\n10. ten\n11. eleven', 'identical'],
  [
    'a list interrupted by a paragraph',
    '1. one\n2. two\n\nA paragraph.\n\n3. three\n4. four',
    'identical',
  ],
  [
    'two lists that both restart',
    '1. one\n2. two\n\nA paragraph.\n\n1. alpha\n2. beta',
    'identical',
  ],
  ['an item holding two paragraphs', '1. one\n\n   continued\n\n2. two', 'identical'],
  ['a bullet list next to an ordered list', '- one\n- two\n\ntext\n\n1. a\n2. b', 'identical'],
  ['numbering read from the ol start attribute', '5. five\n6. six', 'identical'],
  ['a loose list', '- one\n\n- two', 'identical'],

  // ── An item whose whole body is a block (#110) ──
  //
  // Every one of these lost its bullet at this level until `listItem` was
  // widened from `paragraph block*` to `block+`, and every one of them was
  // byte-identical at the pair level while it did — which is what said the
  // cause was the schema rather than `marked` or turndown.
  //
  // The issue names three members. Measuring the family rather than the three
  // found **five**: a blockquote and a nested task list behave identically,
  // for the same reason and with the same cost, and they are pinned here so a
  // narrowing of the content expression cannot quietly drop them. The two
  // fenced members are pinned as bytes in the #104 block below, where the
  // shapes already live, rather than restated here.
  ['an item whose whole body is a heading', '- ## 1. x', 'identical'],
  ['an item whose whole body is an ordered list', '- 1. a', 'identical'],
  ['an item whose whole body is a blockquote', '- > q', 'identical'],
  ['an item whose whole body is a task list', '- - [ ] q', 'identical'],
  ['an item whose whole body is a bullet list', '- - a', 'identical'],
  ['two levels, a block as the whole body of the inner item', '- - ## q', 'identical'],
  ['an item whose body is a heading, then a paragraph', '- ## h\n\n  text', 'identical'],
  ['a heading as the whole body of an ordered item', '1. ## 1. x', 'identical'],

  // ── What a task item holds besides its first paragraph (#157) ──
  //
  // Every one of these left the user's file on save. `taskListItemReplacement`
  // wrote one line — the first paragraph's text — so a task item's second
  // block was dropped whatever it was, and the issue's "a list nested under a
  // task item is dropped entirely" is one member of that family rather than
  // the whole of it: measured on `63568bc`, `- [ ] a` with `  ## h` under it
  // saved as `- [ ] a`, and so did the blockquote and the fence.
  //
  // They are pinned **tight** — one newline between the item's blocks, never a
  // blank line — because that is the spelling a saved file settles on. A blank
  // line inside a task item puts the `<input>` inside the item's first
  // paragraph, and **until #160 that spelling was not read as a task item at
  // all**, so a loose row here would have traded the block this fixed for the
  // checkbox. It is read as one now and written back tight, under the
  // loose-list exception; the tight rows are still what a save produces, which
  // is what they assert.
  ['a list nested under a task item', '- [ ] a\n  - b', 'identical'],
  ['an ordered list nested under a task item', '- [ ] a\n  1. b', 'identical'],
  ['a task list nested under a task item', '- [ ] a\n  - [x] b', 'identical'],
  ['three levels under a task item', '- [ ] a\n  - b\n    - c', 'identical'],
  ['a heading after a task item paragraph', '- [ ] a\n  ## h', 'identical'],
  ['a blockquote after a task item paragraph', '- [ ] a\n  > q', 'identical'],
  ['a fence after a task item paragraph', '- [ ] a\n  ```\n  code\n  ```', 'identical'],
  ['an empty fence after a task item paragraph', '- [ ] a\n  ```\n  ```', 'identical'],
  ['a nested list under the second task item', '- [ ] a\n- [x] c\n  - d', 'identical'],
  ['a task item with a nested list, then another item', '- [ ] a\n  - b\n- [x] c', 'identical'],

  // ── A block after a table inside an item (#281) ──
  //
  // The blocks of an item are written one newline apart, which after a table
  // is where GFM expects another row: `after` came back as a third row of the
  // table, and a second table turned two rows into five. An item that holds a
  // table now writes its blocks a blank line apart, which is what these rows
  // are. The six blocks that survived on their own spelling are the four rows
  // above this comment and the two below them, and they are still written
  // tight, because those items hold no table.
  [
    'a paragraph after a table in a task item',
    '- [ ] x\n\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |\n\n  after',
    'identical',
  ],
  [
    'a paragraph after a table in a ticked item',
    '- [x] x\n\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |\n\n  after',
    'identical',
  ],
  [
    'a second table after a table in a task item',
    '- [ ] x\n\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |\n\n  | c | d |\n  | --- | --- |\n  | 3 | 4 |',
    'identical',
  ],
  [
    'a table after a task item paragraph, spelled tight',
    '- [ ] x\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |',
    {
      writes: '- [ ] x\n\n  | a | b |\n  | --- | --- |\n  | 1 | 2 |',
      because: TASK_ITEM_WITH_A_TABLE,
    },
  ],
  ['a task list nested under a bullet', '- a\n  - [ ] b', 'identical'],

  // ── Two adjacent lists of different kinds (#160, member 2) ──
  //
  // A mixed list is **two** lists in the document model, because a `taskList`
  // takes `taskItem+` and nothing else, and two adjacent blocks used to be
  // written a line apart. That blank line made the two runs one *loose* list
  // on the way back in, where no task marker is read at all: `- [ ] a`⏎`- b`
  // saved as `- [ ] a`⏎⏎`- b` and then as `- a`⏎`- b`, the checkbox gone on
  // the **second** save and the file settling only on the third. Every one of
  // the fifteen recorded R-C2 exceptions changes a file once and then holds
  // still; this did not, which is why it was not one.
  //
  // The last four have nothing to do with task lists. Two adjacent lists of
  // any two different kinds gained the same blank line, in ordinary markdown,
  // and were found by measuring the family rather than the shape the issue
  // named. They lost nothing and held still, so they were a byte difference
  // rather than a loss — and the same rule repairs them.
  //
  // The refusal half is asserted separately, further down: a rule that joins
  // two lists it should not is worse than one that joins nothing.
  ['a task item and a bullet after it', '- [ ] a\n- b', 'identical'],
  ['a bullet and a task item after it', '- a\n- [ ] b', 'identical'],
  ['task, plain, task in one list', '- [ ] a\n- b\n- [x] c', 'identical'],
  ['plain, task, plain in one list', '- a\n- [ ] b\n- c', 'identical'],
  ['a bullet list and an ordered list', '- a\n1. b', 'identical'],
  ['an ordered list and a bullet list', '1. a\n- b', 'identical'],
  ['an ordered list and a task list', '1. a\n- [ ] b', 'identical'],
  ['a task list and an ordered list', '- [ ] a\n1. b', 'identical'],

  // ── A task marker inside an ordered list (#160, member 3b) ──
  //
  // GFM puts a task marker in an ordered list as readily as in a bullet one,
  // and `marked` writes the same `<input>` for both. AgentEd cannot hold one:
  // a `taskList` renders as a `<ul>`, so marking an `<ol>` would claim a shape
  // the serializer cannot honestly write back. What it used to do instead was
  // worse than admitting that — `1. [ ] a`⏎`2. [ ] b` came back as
  // `1. - [ ] a`⏎`   - [ ] b`: a bullet nobody typed, **the second number
  // gone, and two items collapsed into one**, which is a loss rather than a
  // respelling and is why an exception on it was refused.
  //
  // The marker is now given back as the text it was in the file before
  // `marked` read it, and the escape turndown puts on a bracket is what these
  // rows carry. Both numbers survive, both items survive, and the file holds
  // still after the first save — which is the property that makes this an
  // exception rather than a defect. Two other routes were measured and both
  // lose the marker outright: leaving the `<input>` alone writes `1. a`,
  // because ProseMirror has no node for one.
  //
  // The rows below the exception are the fixed point itself: a file that
  // already spells it escaped is byte-identical, which is what says the first
  // save is the only one that moves.
  [
    'a task marker in an ordered list',
    '1. [ ] a',
    { writes: '1. \\[ \\] a', because: ORDERED_TASK_MARKER },
  ],
  [
    'two task markers in an ordered list',
    '1. [ ] a\n2. [ ] b',
    { writes: '1. \\[ \\] a\n2. \\[ \\] b', because: ORDERED_TASK_MARKER },
  ],
  [
    'a ticked marker in an ordered list',
    '1. [x] a',
    { writes: '1. \\[x\\] a', because: ORDERED_TASK_MARKER },
  ],
  [
    'an ordered list of markers starting past 1',
    '3. [ ] a\n4. [x] b',
    { writes: '3. \\[ \\] a\n4. \\[x\\] b', because: ORDERED_TASK_MARKER },
  ],
  [
    'a task marker in an ordered list nested under a bullet',
    '- a\n  1. [ ] b',
    { writes: '- a\n  1. \\[ \\] b', because: ORDERED_TASK_MARKER },
  ],
  ['an ordered list already spelled with escaped brackets', '1. \\[ \\] a', 'identical'],
  ['a task list nested under an ordered item', '1. a\n   - [ ] b', 'identical'],
  ['an ordered list nested inside a bullet item', '- a\n  1. b', 'identical'],
  ['a bullet list nested inside an ordered item', '1. a\n   - b', 'identical'],

  // ── A loose task list (#160, member 3a) ──
  //
  // A list written with blank lines between its items — the way people write
  // a to-do list, because it reads better — **lost every marker it had**:
  // `- [ ] a`⏎⏎`- [ ] b`, sixteen bytes, was written `- a`⏎`- b`, seven. The
  // words survived and the checkboxes did not, so a to-do list became a plain
  // list on the first save.
  //
  // The cause was one selector. `marked` puts the checkbox directly in the
  // item for a tight list and inside the item's first `<p>` for a loose one,
  // and the rewrite in `parse.ts` matched only the first spelling; the second
  // reached ProseMirror as an `<input>` no schema node can hold, and was
  // dropped with the marker it stood for. The rewrite matches both now.
  //
  // **What is left is the loose-list exception and nothing else**: the blank
  // line goes, the markers stay. That exception is recorded, and it needed one
  // clause to say plainly that a task list is a list — `taskList` carries no
  // loose/tight distinction any more than `bulletList` does, which is the
  // exception's own stated mechanism.
  //
  // The last row is the shape that made this a gate rather than a footnote:
  // removing the `<input>` is what lets a task item be **blank** for turndown,
  // which is the premise `empty-fence.test.ts` pins from #104. It is amended
  // in the same pull request, and the branch is correct where it is reached —
  // see that file for the rule and for what cannot reach it.
  ['a loose task list', '- [ ] a\n\n- [ ] b', 'identical'],
  ['a loose task list, both ticked', '- [x] a\n\n- [x] b', 'identical'],
  ['a loose task list, one of each', '- [x] a\n\n- [ ] b', 'identical'],
  ['a loose task list of three items', '- [ ] a\n\n- [x] b\n\n- [ ] c', 'identical'],
  [
    'a loose list of a task item and a plain one',
    '- [ ] a\n\n- b',
    { writes: '- [ ] a\n- b', because: ADJACENT_LISTS },
  ],
  [
    'a loose task list with a task list nested in it',
    '- [ ] a\n\n  - [ ] n\n\n- [ ] b',
    'identical',
  ],
  // Was an exception until #199: the blank line came back as a marker and a
  // space where the file had a bare marker. The quote now keeps the spelling
  // its file used, so this is byte-identical and the normaliser it named has
  // left the file.
  ['a loose task list inside a blockquote', '> - [ ] a\n>\n> - [ ] b', 'identical'],
  ['a loose task list with an empty item', '- [ ] \n\n- [ ] b', 'identical'],
  [
    'a loose task item whose whole content is an empty fence',
    '- [ ] \n\n  ```\n  ```\n\n- [ ] b',
    'identical',
  ],
  [
    'a loose task item whose whole content is an empty fence with a language',
    '- [ ] \n\n  ```js\n  ```\n\n- [ ] b',
    'identical',
  ],
  [
    'a loose task item holding a blockquote holding an empty fence',
    '- [ ] \n\n  > ```\n  > ```\n\n- [ ] b',
    'identical',
  ],
  [
    'a loose task item holding a nested list holding an empty fence',
    '- [ ] \n\n  - ```\n    ```\n\n- [ ] b',
    'identical',
  ],

  // ── A loose *ordered* list of markers (#160, members 3a and 3b together) ──
  //
  // The same selector, so the same widening reaches it, and it lands where
  // #165 already put the tight spelling: the marker is given back as text and
  // turndown escapes the brackets. Until this it lost the marker outright —
  // `1. [ ] a`⏎⏎`2. [ ] b` wrote `1. a`⏎`2. b` — which is a loss rather than a
  // respelling, and is why it travels with member 3a rather than waiting.
  //
  // **Two recorded exceptions meet on one document here**, and that is all
  // that happens: the blank line goes by the loose-list one, the brackets are
  // escaped by the ordered-marker one. Neither is new.
  [
    'a loose ordered list of markers',
    '1. [ ] a\n\n2. [ ] b',
    { writes: '1. \\[ \\] a\n\n2. \\[ \\] b', because: ORDERED_TASK_MARKER },
  ],
  [
    'a loose ordered list of markers, one ticked',
    '1. [x] a\n\n2. [ ] b',
    { writes: '1. \\[x\\] a\n\n2. \\[ \\] b', because: ORDERED_TASK_MARKER },
  ],

  // ── A task item whose whole body is a block (#157) ──
  //
  // The `listItem` family above, one node over — and it needed the work in the
  // opposite order. `taskItem` carried the same `paragraph block*` restriction,
  // so every one of these lost its checkbox on open and its block on save; but
  // widening the node *first*, as #110 did, turns that visible lift into
  // silent content loss, because the serializer could not write a block into a
  // task item at all. Measured on `63568bc` with the widening alone and the
  // suite still green: `- [ ] 1. a` saved as `- [ ] a`, `- [ ] > q` as
  // `- [ ] q`, and `- [ ] ```⏎  ``` ` as `- [ ]` — the fence gone entirely.
  //
  // So the rows above landed first, under the unwidened schema, and these
  // followed. The last two are what the widening newly admits and #110 checked
  // in the same way: a table and a horizontal rule as an item's whole body.
  ['a task item whose whole body is a heading', '- [ ] ## 1. x', 'identical'],
  ['a task item whose whole body is an H1', '- [ ] # h1', 'identical'],
  ['a task item whose whole body is an ordered list', '- [ ] 1. a', 'identical'],
  ['a task item whose whole body is a bullet list', '- [ ] - a', 'identical'],
  ['a task item whose whole body is a task list', '- [ ] - [x] a', 'identical'],
  ['a task item whose whole body is a blockquote', '- [ ] > q', 'identical'],
  ['a task item whose whole body is a fence', '- [ ] ```\n  code\n  ```', 'identical'],
  ['a task item whose whole body is an empty fence', '- [ ] ```\n  ```', 'identical'],
  ['an empty fence with a language as a task item body', '- [ ] ```js\n  ```', 'identical'],
  ['a checked item whose whole body is a heading', '- [x] ## h', 'identical'],
  ['a checked item whose whole body is a fence', '- [x] ```\n  code\n  ```', 'identical'],
  ['a task item whose body is a heading, then a paragraph', '- [ ] ## h\n  text', 'identical'],
  ['a block as the whole body of a nested task item', '- [ ] - [ ] ## q', 'identical'],
  [
    'a task item whose whole body is a table',
    '- [ ] | a | b |\n  | --- | --- |\n  | 1 | 2 |',
    'identical',
  ],
  ['a task item whose whole body is a horizontal rule', '- [ ] ---', 'identical'],

  // ── Soft line breaks (#89, #571): the newline the file had ──
  ['a wrapped paragraph', 'first line\nsecond line', 'identical'],
  ['two inline elements that spanned two lines', '**a**\n**b**', 'identical'],

  // ── Escaping (#90, #96) ──
  ['an identifier with one underscore', 'The tokenizer is cl100k_base here.', 'identical'],
  ['snake_case in a sentence', 'Call snake_case now.', 'identical'],
  ['two underscores in one word', 'Try a_b_c please.', 'identical'],
  ['a double underscore inside a word', 'A foo__bar name.', 'identical'],
  ['underscores the file had already escaped', 'a \\_foo\\_ b', 'identical'],
  ['asterisks the file had already escaped', 'a \\*not bold\\* b', 'identical'],
  ['an underscore that could open emphasis', 'see \\_foo here', 'identical'],
  ['an underscore that could close emphasis', 'see foo\\_ here', 'identical'],
  ['an underscore run at both edges of a word', 'a \\_x_y\\_ b', 'identical'],
  ['emphasis spelled with asterisks', 'a *foo* b', 'identical'],
  ['intraword emphasis with asterisks', 'a foo*bar*baz b', 'identical'],
  ['strong', 'a **bold** b', 'identical'],
  ['an underscore inside inline code', 'use `snake_case` here', 'identical'],
  ['an underscore inside a fenced block', '```js\nconst a_b = 1;\n```', 'identical'],
  [
    'a backtick run already escaped on both sides of an element',
    'a \\` b **x** c \\` d',
    'identical',
  ],
  [
    'a bare backtick run in prose',
    'A ``` in running text.',
    { writes: 'A \\`\\`\\` in running text.', because: BACKTICK_RUNS },
  ],
  [
    'a single bare backtick in prose',
    'one ` backtick',
    { writes: 'one \\` backtick', because: BACKTICK_RUNS },
  ],
  [
    'a redundant underscore escape',
    'the foo\\_bar name',
    { writes: 'the foo_bar name', because: REDUNDANT_ESCAPE },
  ],
  [
    'a redundant escape in a numbered heading',
    '## 1\\. Product statement',
    { writes: '## 1. Product statement', because: REDUNDANT_ESCAPE },
  ],

  // ── A number opening a heading or a cell (#97, #99) ──
  ['a numbered H1', '# 1. Intro', 'identical'],
  ['a numbered H2', '## 1. Product statement', 'identical'],
  ['a numbered H3', '### 1. Deeper', 'identical'],
  ['the deepest heading', '#### 1. Deep', 'identical'],
  ['a heading whose number could start a list', '## 1990. A year.', 'identical'],
  ['a heading with an element after the number', '## 1. **Bold** thing', 'identical'],
  ['a numbered table cell', '| 1. x | y |\n| --- | --- |\n| 2. a | b |', 'identical'],
  ['a paragraph opening with a year', '1990\\. It was a good year.', 'identical'],
  ['a paragraph opening with a small number', '1\\. It was a good year.', 'identical'],
  ['a blockquote opening with a year', '> 1990\\. A year.', 'identical'],
  ['a list item whose body opens with a year', '- 1990\\. A year.', 'identical'],
  ['a real ordered list', '1. first\n2. second', 'identical'],
  ['a real ordered list starting past 1', '3. third\n4. fourth', 'identical'],
  ['a heading inside a blockquote', '> ## 1. x', 'identical'],
  ['a literal backslash the user typed', '## 1\\\\. x', 'identical'],
  ['a code span opening a heading', '## `1. x` y', 'identical'],
  [
    'a link opening a heading',
    '## [1. x](https://e.com) y',
    { writes: '## [1\\. x](https://e.com) y', because: INLINE_ELEMENT_NUMBER },
  ],
  [
    'emphasis opening a heading',
    '## *1. x* y',
    { writes: '## *1\\. x* y', because: INLINE_ELEMENT_NUMBER },
  ],
  [
    'strong opening a heading',
    '## **1. x** y',
    { writes: '## **1\\. x** y', because: INLINE_ELEMENT_NUMBER },
  ],
  [
    'a link opening a cell',
    '| [1. x](https://e.com) | y |\n| --- | --- |\n| a | b |',
    {
      writes: '| [1\\. x](https://e.com) | y |\n| --- | --- |\n| a | b |',
      because: INLINE_ELEMENT_NUMBER,
    },
  ],
  [
    'strong opening a cell',
    '| **1. x** | y |\n| --- | --- |\n| a | b |',
    { writes: '| **1\\. x** | y |\n| --- | --- |\n| a | b |', because: INLINE_ELEMENT_NUMBER },
  ],

  // ── Strikethrough (#85, #88) ──
  ['a struck line', '~~gone~~', 'identical'],
  ['a struck word in a sentence', 'a ~~b~~ c', 'identical'],
  ['more than one struck word', '~~two words~~', 'identical'],
  ['strike inside bold', '**~~x~~**', 'identical'],
  ['strike inside italics', '*~~x~~*', 'identical'],
  ['strike over a code span', '~~a `code` b~~', 'identical'],
  ['strike inside a link', '[~~t~~](https://example.com)', 'identical'],
  ['tildes inside inline code', '`~~a~~`', 'identical'],
  ['a single-tilde strike', '~gone~', { writes: '~~gone~~', because: SINGLE_TILDE }],
  [
    'a single-tilde strike in a sentence',
    'a ~b~ c',
    { writes: 'a ~~b~~ c', because: SINGLE_TILDE },
  ],

  // ── Tables (#93, #101) ──
  ['hugged cells', '| a | b |\n| --- | --- |\n| 1 | 2 |', 'identical'],
  [
    'a tight separator with fitted dashes',
    '| Shortcut | Action |\n|----------|--------|\n| `x` | y |',
    'identical',
  ],
  ['columns aligned to their content', '| a   | bb  |\n| --- | --- |\n| ccc | d   |', 'identical'],
  [
    'columns padded wider than the content needs',
    '| a      | b      |\n| ------ | ------ |\n| c      | d      |',
    'identical',
  ],
  ['a separator wider than three dashes', '| a | b |\n| ----- | ------- |\n| 1 | 2 |', 'identical'],
  ['alignment markers', '| a | b |\n| :-- | --: |\n| 1 | 2 |', 'identical'],
  [
    'the shorter spelling of an empty cell',
    '| | Does |\n| --- | --- |\n| **Owner** | Decides |',
    'identical',
  ],
  ['the longer spelling of an empty cell', '| Step | Owner |\n| --- | --- |\n|  |  |', 'identical'],
  ['a one-row table', '| a | b |\n| --- | --- |', 'identical'],
  [
    'two tables spelled differently',
    '| a | b |\n| --- | --- |\n| 1 | 2 |\n\ntext\n\n| c   | d   |\n|-----|-----|\n| eee | fff |',
    'identical',
  ],
  ['a table inside a fenced block', '```\n| a | b |\n| --- | --- |\n```', 'identical'],
  // ── A table inside a table cell (#278) ──
  //
  // GFM has no spelling for one, so it is written as inline HTML on the cell's
  // one line. Every spelling the writer produces reads back as itself; the two
  // a file may use that it does not produce are normalised once, as recorded.
  [
    'a table inside a cell, as inline HTML',
    '| a |\n| --- |\n| <table><tr><td>x</td></tr></table> |',
    'identical',
  ],
  [
    'a table inside a cell with a header row',
    '| a |\n| --- |\n| <table><tr><th>h</th><th>i</th></tr><tr><td>1</td><td>2</td></tr></table> |',
    'identical',
  ],
  [
    'a table inside a cell with empty cells',
    '| a |\n| --- |\n| <table><tr><th></th><th></th></tr><tr><td></td><td></td></tr></table> |',
    'identical',
  ],
  [
    'a table inside a cell holding inline markdown',
    '| a |\n| --- |\n| <table><tr><td>**b** and `c`</td></tr></table> |',
    'identical',
  ],
  [
    'a table inside a cell holding an escaped pipe',
    '| a |\n| --- |\n| <table><tr><td>a \\| b</td></tr></table> |',
    'identical',
  ],
  [
    'a table inside a cell holding a link',
    '| a |\n| --- |\n| <table><tr><td>[l](https://example.com)</td></tr></table> |',
    'identical',
  ],
  [
    'a table inside a cell, with text beside it',
    '| a |\n| --- |\n| before <table><tr><td>x</td></tr></table> after |',
    'identical',
  ],
  // ── A horizontal rule inside a cell (#282) ──
  //
  // Written `---` and flattened, it read back as text and the rule was gone.
  // `<hr>` is what a cell can carry, and it takes no space on either side: a
  // space after a void element stays in the text of the block that follows.
  ['a rule inside a cell', '| a |\n| --- |\n| <hr> |', 'identical'],
  ['text, a rule and text in one cell', '| a |\n| --- |\n| x<hr>y |', 'identical'],
  [
    'a rule inside a table inside a cell',
    '| a |\n| --- |\n| <table><tr><td><hr></td></tr></table> |',
    'identical',
  ],
  [
    'a cell holding a table and then a rule',
    '| a |\n| --- |\n| <table><tr><td>x</td></tr></table><hr> |',
    'identical',
  ],
  [
    'a table inside a table inside a cell',
    '| a |\n| --- |\n| <table><tr><td><table><tr><td>y</td></tr></table></td></tr></table> |',
    'identical',
  ],
  [
    'text and a table in one cell, the shape Insert Table used to build',
    '| a | b |\n| --- | --- |\n| 1 <table><tr><th></th><th></th><th></th></tr><tr><td></td><td></td><td></td></tr><tr><td></td><td></td><td></td></tr></table> | 2 |',
    'identical',
  ],
  [
    'a table inside a cell spelled with thead and tbody',
    '| a |\n| --- |\n| <table><thead><tr><th>h</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table> |',
    {
      writes: '| a |\n| --- |\n| <table><tr><th>h</th></tr><tr><td>1</td></tr></table> |',
      because: INLINE_TABLE,
    },
  ],
  [
    'a table inside a cell carrying an attribute',
    '| a |\n| --- |\n| <table border="1"><tr><td>x</td></tr></table> |',
    { writes: '| a |\n| --- |\n| <table><tr><td>x</td></tr></table> |', because: INLINE_TABLE },
  ],
  // ── A table one level further in than `holdsATable` asks (#283) ──
  //
  // The outer item holds a nested list, and the table is in the nested item.
  // Owed as a measurement since #284, and written here as the rows it came to.
  [
    'a nested checklist item holding a table, then a paragraph in the outer item',
    '- [ ] outer\n  - [ ] inner\n\n    | a |\n    | --- |\n    | c |\n  after',
    'identical',
  ],
  [
    'a nested bullet item holding a table, then a paragraph in the outer item',
    '- [ ] outer\n  - inner\n\n    | a |\n    | --- |\n    | c |\n  after',
    'identical',
  ],
  // ── A table the file wrote as raw HTML (#283) ──
  //
  // Kept as the bytes the file used while it is unedited, owner decision of
  // 2026-09-13. Every construct step zero measured losing something is here,
  // and each of them used to be written as GFM. What an edit does is in
  // `kept-html-table.test.ts`, because this table cannot express one.
  ['a raw HTML table', '<table><tr><td>a</td></tr></table>', 'identical'],
  [
    'a raw HTML table across lines',
    '<table>\n  <tr>\n    <td>a</td>\n  </tr>\n</table>',
    'identical',
  ],
  [
    'a raw HTML table between paragraphs',
    'before\n\n<table><tr><td>a</td></tr></table>\n\nafter',
    'identical',
  ],
  [
    'a raw HTML table with a header row in thead',
    '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>',
    'identical',
  ],
  [
    'a raw HTML table with a colspan',
    '<table><tr><th>a</th><th>b</th></tr><tr><td colspan="2">wide</td></tr></table>',
    'identical',
  ],
  [
    'a raw HTML table with a rowspan',
    '<table><tr><th>a</th><th>b</th></tr><tr><td rowspan="2">tall</td><td>1</td></tr><tr><td>2</td></tr></table>',
    'identical',
  ],
  [
    'a raw HTML table aligned by attribute',
    '<table><tr><th align="right">a</th></tr><tr><td align="right">1</td></tr></table>',
    'identical',
  ],
  [
    'a raw HTML table aligned by style',
    '<table><tr><th style="text-align:center">a</th></tr><tr><td style="text-align:center">1</td></tr></table>',
    'identical',
  ],
  [
    'a raw HTML table with a caption',
    '<table><caption>The caption</caption><tr><td>a</td></tr></table>',
    'identical',
  ],
  [
    'a raw HTML table whose cell holds two paragraphs',
    '<table><tr><td><p>one</p><p>two</p></td></tr></table>',
    'identical',
  ],
  [
    'a raw HTML table whose cell holds a list',
    '<table><tr><td><ul><li>x</li><li>y</li></ul></td></tr></table>',
    'identical',
  ],
  [
    'a raw HTML table with attributes of its own',
    '<table border="1" class="data"><tr><td>a</td></tr></table>',
    'identical',
  ],
  ['a raw HTML table in capitals', '<TABLE><TR><TD>a</TD></TR></TABLE>', 'identical'],
  [
    'two raw HTML tables',
    '<table><tr><td>a</td></tr></table>\n\n<table><tr><td>b</td></tr></table>',
    'identical',
  ],
  [
    'a raw HTML table holding an image with a size',
    '<table><tr><td><img src="a.png" width="10"></td></tr></table>',
    'identical',
  ],
  [
    'a raw HTML table holding markdown characters, which HTML does not read',
    '<table><tr><td>**b** _c_</td></tr></table>',
    'identical',
  ],
  ['a raw HTML table with a blank cell', '<table><tr><td> </td></tr></table>', 'identical'],
  [
    'a raw HTML table holding entities',
    '<table><tr><td>a &amp; b &lt;</td></tr></table>',
    'identical',
  ],
  [
    'a raw HTML table holding a comment',
    '<table><!-- c --><tr><td>a</td></tr></table>',
    'identical',
  ],
  [
    'a raw HTML table with a tfoot',
    '<table><tr><td>a</td></tr><tfoot><tr><td>f</td></tr></tfoot></table>',
    'identical',
  ],
  [
    'a raw HTML table holding a table',
    '<table><tr><td><table><tr><td>in</td></tr></table></td></tr></table>',
    'identical',
  ],
  [
    // The file's own bytes, script and all. DOMPurify still removes the script
    // from what the editor shows; what is written back is what the file held.
    'a raw HTML table holding a script the file had',
    '<table><tr><td><script>x</script>a</td></tr></table>',
    'identical',
  ],
  [
    // The file spells the attribute the bytes ride on, with another table in
    // it. The stamp goes first, so the file's own bytes are what is kept.
    'a raw HTML table spelling the source attribute itself',
    '<table data-table-html-source="%3Ctable%3E%3Ctr%3E%3Ctd%3Eevil%3C%2Ftd%3E%3C%2Ftr%3E%3C%2Ftable%3E"><tr><td>a</td></tr></table>',
    'identical',
  ],
  [
    'a raw HTML table beside a GFM table',
    '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n<table><tr><td>a</td></tr></table>',
    'identical',
  ],
  // Not rectangular, so the table plugin repairs each one straight after the
  // load. The check at save repairs the reread bytes the same way, and without
  // that every row here was written as GFM by a save that changed nothing.
  [
    'a raw HTML table whose caption sits above two columns',
    '<table><caption>T</caption><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>',
    'identical',
  ],
  [
    'a raw HTML table with a caption, alignment and a rowspan, across lines',
    '<table>\n  <caption>Title</caption>\n  <tr><th align="right">name</th><th>value</th></tr>\n  <tr><td rowspan="2">tall</td><td>1</td></tr>\n  <tr><td>2</td></tr>\n</table>',
    'identical',
  ],
  [
    'a raw HTML table whose rows are not the same length',
    '<table><tr><td>a</td><td>b</td><td>c</td></tr><tr><td>d</td></tr></table>',
    'identical',
  ],
  [
    'a raw HTML table whose rowspan reaches past the last row',
    '<table><tr><td rowspan="4">a</td><td>b</td></tr><tr><td>c</td></tr></table>',
    'identical',
  ],
  [
    'a raw HTML table whose colspan is wider than the other rows',
    '<table><tr><td colspan="3">a</td></tr><tr><td>b</td></tr></table>',
    'identical',
  ],
  // Where it is not kept, measured byte-identical to `2bf4f1a`: nothing here
  // moved, and each is recorded rather than left to be found.
  [
    'a raw HTML table with a blank line inside it',
    '<table>\n\n<tr><td>a</td></tr>\n\n</table>',
    { writes: '| a |\n| --- |', because: HTML_TABLE_NOT_KEPT },
  ],
  [
    'a raw HTML table with text on the line after it',
    '<table><tr><td>a</td></tr></table>\nafter',
    { writes: '| a |\n| --- |\n\nafter', because: HTML_TABLE_NOT_KEPT },
  ],
  [
    'a raw HTML table inside a blockquote',
    '> <table><tr><td>a</td></tr></table>',
    { writes: '> | a |\n> | --- |', because: HTML_TABLE_NOT_KEPT },
  ],
  [
    'a raw HTML table inside a list item',
    '- item\n\n  <table><tr><td>a</td></tr></table>',
    { writes: '- item\n\n  | a |\n  | --- |', because: HTML_TABLE_NOT_KEPT },
  ],
  [
    'a raw HTML table inside a task item',
    '- [ ] <table><tr><td>a</td></tr></table>',
    { writes: '- [ ] | a |\n  | --- |', because: HTML_TABLE_NOT_KEPT },
  ],
  [
    'a raw HTML table inside another element',
    '<div><table><tr><td>a</td></tr></table></div>',
    // Kept as its bytes since #572, a wrapper whose content is a block.
    'identical',
  ],
  [
    'a raw HTML table with no rows',
    '<table></table>',
    { writes: '', because: HTML_TABLE_NOT_KEPT },
  ],
  [
    'a raw HTML table whose rows hold no cells',
    '<table><tr></tr></table>',
    { writes: '', because: HTML_TABLE_NOT_KEPT },
  ],
  // ── A list the file wrote as raw HTML (#283, owner decision) ──
  [
    'a raw HTML bullet list',
    '<ul><li>a</li><li>b</li></ul>',
    { writes: '- a\n- b', because: HTML_LIST },
  ],
  [
    'a raw HTML ordered list',
    '<ol><li>a</li><li>b</li></ol>',
    { writes: '1. a\n2. b', because: HTML_LIST },
  ],
  [
    'a table without outer pipes',
    'a | b\n--- | ---\n1 | 2',
    { writes: '| a | b |\n|---|---|\n| 1 | 2 |', because: TABLE_SPELLINGS },
  ],
  [
    'an indented table',
    '  | a | b |\n  | --- | --- |\n  | 1 | 2 |',
    { writes: '| a | b |\n| --- | --- |\n| 1 | 2 |', because: TABLE_SPELLINGS },
  ],
  [
    'cells written with no spaces at all',
    '|a|b|\n|---|---|\n|1|2|',
    { writes: '| a | b |\n|---|---|\n| 1 | 2 |', because: TABLE_SPELLINGS },
  ],
  [
    'a column whose rows disagree',
    '| a   | b   |\n| --- | --- |\n| c | d |',
    { writes: '| a | b |\n| --- | --- |\n| c | d |', because: TABLE_SPELLINGS },
  ],

  // ── The six shapes of #84, and the code-span shapes beside them ──
  //
  // Rows 4 and 6 of the issue's table, and every shape that shares their
  // mechanism, are `identical` since the `Code` mark stopped excluding every
  // other mark. Rows 1, 2 and 3 are the mark-order half, and the exception
  // below is where the measurement that decided it lives.
  ['strong spanning a code span', '**bold `code` more**', 'identical'],
  ['strong beside a code span', '**bold** `code`', 'identical'],
  ['strong inside a link', '[**text**](https://e.com)', 'identical'],
  ['nested emphasis', '**a *b* c**', 'identical'],
  ['strong whose whole extent is a code span', '**`c`**', 'identical'],
  ['strike whose whole extent is a code span', '~~`c`~~', 'identical'],
  ['a link whose whole text is a code span', '[`c`](https://e.com)', 'identical'],
  ['emphasis spanning a code span', '*a `c` b*', 'identical'],
  ['emphasis and strong spanning a code span', '***a `c` b***', 'identical'],
  ['a link and strong spanning a code span', '[**a `c` b**](https://e.com)', 'identical'],
  ['an underline spanning a code span', 'a <u>x `c` y</u> b', 'identical'],
  ['a code span holding a backtick', 'a ``x ` y`` b', 'identical'],
  ['a code span holding asterisks', 'use `a*b*c` here', 'identical'],
  ['a code span holding tildes', 'use `~~x~~` here', 'identical'],
  [
    'strong around a link',
    '**[text](https://e.com)**',
    { writes: '[**text**](https://e.com)', because: MARK_NESTING },
  ],
  [
    'emphasis around a link',
    '*[text](https://e.com)*',
    { writes: '[*text*](https://e.com)', because: MARK_NESTING },
  ],
  [
    'strong spanning a link and a tail',
    '**[t](https://e.com) tail**',
    { writes: '[**t**](https://e.com) **tail**', because: MARK_NESTING },
  ],
  [
    'a link inside strike',
    '~~[t](https://example.com)~~',
    { writes: '[~~t~~](https://example.com)', because: MARK_NESTING },
  ],
  ['bold inside strike', '~~**x**~~', { writes: '**~~x~~**', because: MARK_NESTING }],

  // ── An image keeps the form its file used (#27) ──
  //
  // The acceptance criterion of #27, above every other: **nothing the user did
  // not touch changes bytes.** Not a property of the markdown form alone — the
  // whole reason the node carries the source bytes rather than a width is that
  // a canonical rewrite reproduces only three of the eleven spellings below.
  // The other eight are here for that reason, and each of them is a file a
  // person could have written by hand.
  //
  // What a *resize* writes is not in this table, because these rows open and
  // save with no edit and a resize is an edit. Those fixtures are in
  // `image-resize.test.ts`, where a gesture can be driven.
  ['an image with no alt text', '![](img.png)', 'identical'],
  ['an image with a relative path', '![alt](assets/diagram.png)', 'identical'],
  ['an image inside a sentence', 'before ![alt](img.png) after', 'identical'],
  ['an image inside a list item', '- ![alt](img.png)', 'identical'],
  ['an image inside a blockquote', '> ![alt](img.png)', 'identical'],
  ['an image that is a link', '[![alt](img.png)](https://example.com)', 'identical'],

  ['an html image with a width', '<img src="a.png" alt="x" width="600">', 'identical'],
  [
    'an html image with a width and a height',
    '<img src="a.png" alt="x" width="600" height="300">',
    'identical',
  ],
  ['an html image with no size at all', '<img src="a.png" alt="x">', 'identical'],
  ['an html image with no alt', '<img src="a.png">', 'identical'],
  ['an html image with unquoted attributes', '<img src=a.png alt=x width=600>', 'identical'],
  ['an html image with single quotes', "<img src='a.png' alt='x' width='600'>", 'identical'],
  ['a self-closing html image', '<img src="a.png" alt="x" width="600" />', 'identical'],
  ['an html image whose width comes first', '<img width="600" src="a.png" alt="x">', 'identical'],
  [
    'an html image carrying a style',
    '<img src="a.png" alt="x" width="600" style="border:1px solid red">',
    'identical',
  ],
  [
    'an html image carrying a title',
    '<img src="a.png" alt="x" title="t" width="600">',
    'identical',
  ],
  ['an html image in upper case', '<IMG SRC="a.png" ALT="x" WIDTH="600">', 'identical'],
  [
    'an html image with a percentage width AgentEd cannot express',
    // The width is not a number of pixels, so no node attribute holds it — and
    // it survives anyway, because the bytes do. A carrier of width and height
    // would have dropped it.
    '<img src="a.png" alt="x" width="50%">',
    'identical',
  ],
  [
    'an html image inside a paragraph',
    'text <img src="a.png" alt="x" width="600"> tail',
    'identical',
  ],
  [
    'an html image whose alt text holds a closing bracket',
    // The case a `<img[^>]*>` scan cuts in half. `image-spelling.ts` walks the
    // bytes instead, and this is that walk asserted through the whole pipeline.
    '<img src="a.png" alt="a > b" width="600">',
    'identical',
  ],
  [
    'a document holding both kinds of image',
    '![a](a.png)\n\n<img src="b.png" alt="b" width="400">\n\ntext ![c](c.png) more',
    'identical',
  ],

  // ── An image title (#230) ──
  //
  // `![alt](img.png "the title")` used to be written back as `![alt](img.png)`:
  // the title was on the node all along and the serializer never read it, so
  // text the user wrote left the file on the first save. Not a respelling — a
  // loss — which is why it was an issue rather than debt.
  //
  // The escapes are the half worth reading. Inside a double-quoted title
  // CommonMark reads a backslash escape, so a title holding a `"` or a `\` is
  // written with one and comes back as the character; a `'`, a `(` and a `)`
  // need nothing at all between double quotes. Each of those is a row, because
  // each is a different answer and a writer that escaped too much would be as
  // wrong as one that escaped too little.
  ['an image with a title', '![alt](img.png "the title")', 'identical'],
  ['a title with no alt beside it', '![](img.png "the title")', 'identical'],
  ['a title holding a single quote', '![alt](img.png "it\'s here")', 'identical'],
  ['a title holding parentheses', '![alt](img.png "a (b) c")', 'identical'],
  ['a title holding a closing parenthesis', '![alt](img.png "a ) c")', 'identical'],
  ['a title holding a double quote', '![alt](img.png "say \\" now")', 'identical'],
  ['a title holding a backslash', '![alt](img.png "back \\\\ slash")', 'identical'],
  ['a titled image inside a sentence', 'before ![alt](img.png "t") after', 'identical'],
  ['a titled image inside a list item', '- ![alt](img.png "t")', 'identical'],
  ['a titled image that is a link', '[![alt](img.png "t")](https://example.com)', 'identical'],
  ['an html image with a title', '<img src="a.png" alt="x" title="t">', 'identical'],
  [
    'an html image with a title and a width',
    '<img src="a.png" alt="x" title="t" width="400">',
    'identical',
  ],
  [
    'a document holding a titled image, an untitled one and an html one',
    '![a](a.png "first")\n\n![b](b.png)\n\n<img src="c.png" alt="c" title="third">',
    'identical',
  ],
  [
    'a title the file wrote in single quotes',
    "![alt](img.png 'single')",
    {
      writes: '![alt](img.png "single")',
      because: TITLE_DELIMITER,
    },
  ],
  [
    'a title the file wrote in parentheses',
    '![alt](img.png (parens))',
    {
      writes: '![alt](img.png "parens")',
      because: TITLE_DELIMITER,
    },
  ],

  // ── An image alt text (#232) ──
  //
  // Two defects at opposite ends of one value, and neither was a respelling.
  // **At the parser**, `marked` wrote `title` escaped and `alt` raw, so
  // `![say "hi"](i.png)` was emitted as `alt="say "hi""` and DOMPurify kept
  // `say` — the words were gone before the document existed. **At the
  // serializer**, the alt went into `![…]` unescaped, so a `]` closed the
  // brackets early and the reference stopped being an image; the next save then
  // wrote the whole line as escaped text, which is why the file moved twice.
  //
  // The rows that need *no* escape are here beside the ones that do, because a
  // writer that escaped everything would satisfy the others and put backslashes
  // into every document in this repository.
  ['an alt holding a double quote', '![say "hi"](i.png)', 'identical'],
  ['an alt holding two double quotes', '![a "b" c "d"](i.png)', 'identical'],
  ['an alt holding a single quote', "![it's here](i.png)", 'identical'],
  ['an alt holding an ampersand', '![a & b](i.png)', 'identical'],
  ['an alt holding an angle bracket', '![a < b](i.png)', 'identical'],
  ['an alt holding a closing angle bracket', '![a > b](i.png)', 'identical'],
  ['an alt holding a backslash', '![a \\\\ b](i.png)', 'identical'],
  ['an alt holding an escaped closing bracket', '![a \\] b](i.png)', 'identical'],
  ['an alt holding an escaped opening bracket', '![a \\[ b](i.png)', 'identical'],
  ['an alt holding a pair of escaped brackets', '![a \\[b\\] c](i.png)', 'identical'],
  ['an alt holding parentheses, which need none', '![a (b) c](i.png)', 'identical'],
  ['an alt holding an exclamation mark', '![a ! b](i.png)', 'identical'],
  ['an alt holding a bracket and a quote', '![a \\] "b"](i.png)', 'identical'],
  ['an alt holding a bracket beside a title', '![a \\] b](i.png "the title")', 'identical'],
  ['an alt holding a quote beside a title', '![say "hi"](i.png "and \\" title")', 'identical'],
  [
    'a document holding each of the two alt defects and a plain one',
    '![alpha](a.png)\n\n![say "hi"](b.png)\n\n![a \\] b](c.png)',
    'identical',
  ],

  // ── A table inside a blockquote (#200) ──
  //
  // These three used to lose their alignment, and none of them holds any raw
  // HTML. The spelling was scanned out of the raw lines and paired with the
  // parsed HTML by document order; a quoted table has lines that open with a
  // marker, so the scan found nothing where `marked` found a table, the counts
  // disagreed, and **every** table in the document fell back to the default
  // hugged spelling. Measured before the repair at 97 bytes in and 82 out for
  // the second row. The style is read from the token now, which is the quote
  // body with the markers already stripped.
  [
    'a padded table inside a blockquote',
    '> | head  | second |\n> | ----- | ------ |\n> | a     | b      |',
    'identical',
  ],
  [
    'a padded table beside a padded table in a blockquote',
    '| head  | second |\n| ----- | ------ |\n| a     | b      |\n\n> | head  | second |\n> | ----- | ------ |\n> | a     | b      |',
    'identical',
  ],
  [
    'a padded table beside a hugged table in a blockquote',
    '| head  | second |\n| ----- | ------ |\n| a     | b      |\n\n> | a | b |\n> | --- | --- |\n> | c | d |',
    'identical',
  ],

  // ── An HTML comment (#245) ──
  //
  // Every one of these used to come back as nothing: `marked` keeps a comment
  // and DOMPurify removes it, so the text left the file on the first save with
  // nothing said. One shape in the corpus reached 40 lines and 1145 bytes.
  //
  // The last row is the one that must **not** move: a comment inside a fenced
  // block is code, it was already text before this change, and it stays text.
  ['a comment alone on a line', '<!-- a note -->', 'identical'],
  ['a comment inline mid-sentence', 'one <!-- note --> two', 'identical'],
  ['a comment at the end of a paragraph', 'one two <!-- note -->', 'identical'],
  ['a comment between two paragraphs', 'one\n\n<!-- note -->\n\ntwo', 'identical'],
  ['a multi-line comment', '<!--\nline one\nline two\n-->', 'identical'],
  ['a comment wrapping a block of markdown', '<!--\n## heading\n\n- a\n- b\n-->', 'identical'],
  ['two comments on their own lines', '<!-- a -->\n\n<!-- b -->', 'identical'],
  ['a comment holding a tag', '<!-- <b>bold</b> -->', 'identical'],
  ['a comment holding a quote', '<!-- say "hi" -->', 'identical'],
  ['a comment holding a dash run', '<!-- a - b -- c -->', 'identical'],
  [
    'a comment beside an image and a link',
    '![a](i.png) <!-- n --> [t](https://e.com)',
    'identical',
  ],
  ['a comment in a list item', '- one <!-- note -->\n- two', 'identical'],
  ['a comment in a blockquote', '> one <!-- note -->', 'identical'],
  ['a comment inside a fenced block stays text', '```\n<!-- kept as text -->\n```', 'identical'],
];

describe('the editor-level round-trip table (#84)', () => {
  it.each(TABLE)('%s', (_label, markdown, expectation) => {
    const saved = openAndSave(markdown);
    if (expectation === 'identical') {
      expect(saved).toBe(markdown);
    } else {
      // Asserted as exact bytes in **both** directions: a regression fails, and
      // so does a fix nobody wrote down. Whoever removes one of these
      // exceptions moves this row and says so in REQUIREMENTS in the same PR.
      expect(`${expectation.because}: ${saved}`).toBe(
        `${expectation.because}: ${expectation.writes}`,
      );
    }
  });

  it.each(TABLE)('%s — and the second save moves nothing', (_label, markdown) => {
    // The property from #96, and the half of R-C2 that needs no exception list
    // at all: a first save may normalise, the next one may not drift.
    const first = openAndSave(markdown);
    expect(openAndSave(first)).toBe(first);
  });
});

describe('a table nested past the depth the writer follows (#278)', () => {
  it('writes the cells of the sixteenth table as their text, and then holds still', () => {
    // Eighteen tables, each in the one cell of the one before, inside a GFM
    // cell. The writer follows sixteen of them as HTML and writes the cells of
    // the sixteenth as their text — the bound that keeps its recursion finite
    // whatever a file holds — so the two innermost lose their structure, the
    // word survives exactly once, and the file holds still afterwards.
    const depth = 18;
    const inner = `${'<table><tr><td>'.repeat(depth)}z${'</td></tr></table>'.repeat(depth)}`;

    const saved = openAndSave(`| a |\n| --- |\n| ${inner} |`);

    expect(saved.match(/<table>/g)?.length).toBe(16);
    expect(saved.match(/z/g)?.length).toBe(1);
    expect(openAndSave(saved)).toBe(saved);
  });
});

/**
 * The space GFM requires after an empty task marker (#160, member 1).
 *
 * These cannot live in the table above, and the reason is worth naming rather
 * than working around: `openAndSave` **trims**, which erases the one byte
 * every case here is about. That trim is a convenience of the harness and not
 * something the save path does — measured, a file holding `- [ ] ` is written
 * back with the space through the real assembly — so these go through an
 * untrimmed save instead.
 *
 * **Six positions, and only one of them was ever wrong.** The space was lost
 * when the empty item was the last block of the document, and nowhere else,
 * because turndown's `postProcess` trims the finished document once. So five
 * of these rows are a guard on behaviour that was already correct, and they
 * are here because the fix had to leave them alone: a repair that reached
 * further would have reached the end of every document AgentEd saves.
 */
const EMPTY_TASK_ITEM: ReadonlyArray<readonly [string, string]> = [
  ['alone in the document', '- [ ] '],
  ['first, with an item after it', '- [ ] \n- [x] b'],
  ['in the middle of the list', '- [ ] a\n- [ ] \n- [x] b'],
  ['last, after another item', '- [ ] a\n- [ ] '],
  ['ticked, and last', '- [ ] a\n- [x] '],
  ['followed by a paragraph', '- [ ] \n\ntext'],
  ['between two paragraphs', 'text\n\n- [ ] \n\nmore'],
  ['alone inside a blockquote', '> - [ ] '],
];

describe('an empty task item keeps the space GFM needs (#160)', () => {
  /** The save above, without the trim that would hide the byte in question. */
  function saveUntrimmed(markdown: string): string {
    const editor = editorWith(markdown);
    const saved = editor.getMarkdown();
    editor.destroy();
    instance = null;
    return saved;
  }

  it.each(EMPTY_TASK_ITEM)('%s', (_label, markdown) => {
    expect(saveUntrimmed(markdown)).toBe(markdown);
  });

  it.each(EMPTY_TASK_ITEM)('%s — and the next two saves move nothing', (_label, markdown) => {
    // Three saves rather than two, because this shape used to settle only on
    // the third: `- [ ] ` lost its space, and the file that left became
    // `- \[ \]` on the save after that — literal brackets in a plain bullet,
    // the checkbox gone.
    const first = saveUntrimmed(markdown);
    const second = saveUntrimmed(first);
    expect(second).toBe(first);
    expect(saveUntrimmed(second)).toBe(second);
  });

  it('does not put a space after an item that has content', () => {
    // The pattern the fix tests for is `- [ ]` at the very end of the output,
    // and this is the assertion that it cannot match anything else: an item
    // with content has that content after the marker.
    expect(saveUntrimmed('- [ ] a')).toBe('- [ ] a');
    expect(saveUntrimmed('- [x] done')).toBe('- [x] done');
  });

  it('keeps the space when the empty item ends a loose list (#160, member 3a)', () => {
    // The one loose shape the table above cannot carry, for the reason this
    // whole block exists: `openAndSave` trims, and the byte in question is the
    // document's last one. **Byte-identical since #28**: the blank line used
    // to go by the loose-list exception and is now kept, and the space after
    // the marker stays because member 1 put it there. Before member 3a this
    // whole item left the file: `- [ ] a`⏎⏎`- [ ] ` was written `- a`.
    expect(saveUntrimmed('- [ ] a\n\n- [ ] ')).toBe('- [ ] a\n\n- [ ] ');
    expect(saveUntrimmed('- [ ] \n\n- [ ] b')).toBe('- [ ] \n\n- [ ] b');

    const once = saveUntrimmed('- [ ] a\n\n- [ ] ');
    expect(saveUntrimmed(once)).toBe(once);
    expect(saveUntrimmed(saveUntrimmed(once))).toBe(once);
  });

  it('LABELLED GAP: a nested empty task item still loses its marker (#160)', () => {
    // **This asserts the loss, on purpose**, the way #103 left one for #104:
    // whoever repairs it meets a decision here rather than a surprise, and a
    // shape recorded only in a pull request description is a shape nobody
    // finds again.
    //
    // An empty task item at the end of a **nested** list is written
    // `- \[ \]` — literal brackets in a plain bullet, the checkbox gone — in
    // one save, and then holds still. The cause is not the one member 3a
    // repaired: `marked` never reads the nested item as a task item at all, so
    // there is no `<input>` for the rewrite in `parse.ts` to find, whichever
    // spelling it matches. **Measured on this branch, identical before the
    // widening and after it**, which is what says the widening does not reach
    // it.
    //
    // Recorded on #165 and again on #160 rather than opened as its own thread.
    expect(saveUntrimmed('- [ ] a\n  - [ ] ')).toBe('- [ ] a\n  - \\[ \\]');

    const once = saveUntrimmed('- [ ] a\n  - [ ] ');
    expect(saveUntrimmed(once)).toBe(once);
  });

  it('leaves a document that ends in anything else exactly as it was', () => {
    // The other half of the same claim, and the one #160 called a hazard: the
    // repair must not reach the end of every document. It cannot — it fires
    // only on an unescaped empty marker in the final position, and literal
    // brackets in text are escaped wherever they appear.
    expect(saveUntrimmed('text')).toBe('text');
    expect(saveUntrimmed('- a')).toBe('- a');
    expect(saveUntrimmed('x \\[ \\] y')).toBe('x \\[ \\] y');
  });
});

/**
 * The narrow rule refuses as reliably as it joins (#160, member 2).
 *
 * The table above pins the joining half. This is the other one, and it is the
 * whole safety argument: two adjacent lists of the **same** kind must keep the
 * blank line between them, because writing them tightly would merge them when
 * the file is read again — two bullet lists become one list, two ordered lists
 * lose the second one's start, two task lists become one.
 *
 * Asserted on the HTML rather than through a document, deliberately. That
 * shape cannot be reached from a file — `- a`⏎⏎`- b` opens as a single list,
 * which is the loose-list exception — and it was not reached by the editing
 * gestures that were tried either. Handing the serializer the DOM directly is
 * what makes the refusal testable at all, and a rule that is only correct
 * because its input is unreachable is not one worth relying on.
 */
describe('two adjacent lists of the same kind keep their blank line (#160)', () => {
  it.each([
    ['two bullet lists', '<ul><li>a</li></ul><ul><li>b</li></ul>', '- a\n\n- b'],
    ['two ordered lists', '<ol><li>a</li></ol><ol><li>b</li></ol>', '1. a\n\n1. b'],
    [
      'two task lists',
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false">a</li></ul>' +
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="true">b</li></ul>',
      '- [ ] a\n\n- [x] b',
    ],
  ])('%s', (_label, html, expected) => {
    expect(htmlToMarkdown(html)).toBe(expected);
  });
});

/**
 * The third save, for the shapes #160 used to leave open (#160).
 *
 * This block asserted a *property* while three members were unbuilt: whatever
 * they did, they had to do it once. All four are built now and every shape is
 * in the table above as bytes — so what is left here is the one assertion the
 * table does not make. It runs **two** saves after the first; two members of
 * this issue used to be correct after the first and wrong after the second,
 * settling only on the third, and a check that stops at two would have passed
 * on both.
 *
 * The loose rows are the ones that carried it furthest. Before member 3a a
 * loose task list went 16 bytes → 9 → 7 at the pair level: the first save
 * wrote two spaces after each marker and only the second settled, with the
 * checkboxes already gone. That is the half of R-C2 which has never carried an
 * exception, and it is the half a single save cannot see.
 */
describe('the shapes #160 owned settle after one save, checked to the third (#160)', () => {
  it.each([
    ['a loose task list', '- [ ] a\n\n- [ ] b'],
    ['a loose task list, both ticked', '- [x] a\n\n- [x] b'],
    ['a loose task list of three items', '- [ ] a\n\n- [x] b\n\n- [ ] c'],
    ['a loose task list with a nested one', '- [ ] a\n\n  - [ ] n\n\n- [ ] b'],
    ['a loose task list inside a blockquote', '> - [ ] a\n>\n> - [ ] b'],
    ['a loose task item holding an empty fence', '- [ ] \n\n  ```\n  ```\n\n- [ ] b'],
    ['a loose list of a task item and a plain one', '- [ ] a\n\n- b'],
    ['a loose ordered list of markers', '1. [ ] a\n\n2. [ ] b'],
    ['an ordered task list', '1. [ ] a'],
    ['an ordered task list of two items', '1. [ ] a\n2. [ ] b'],
    ['a mixed list', '- [ ] a\n- b'],
    ['a tight task list', '- [ ] a\n- [x] b'],
  ])('%s', (_label, markdown) => {
    const first = openAndSave(markdown);
    const second = openAndSave(first);
    expect(second).toBe(first);
    expect(openAndSave(second)).toBe(second);
  });
});

/**
 * #104's other half, asserted as the property the issue owns rather than as
 * bytes — the move #99 made for `- ## 1. x`, and for the same reason.
 *
 * A fence alone in a **list item** cannot round-trip byte-identically at this
 * level, and not because of anything #104 is about. TipTap's `listItem`
 * schema takes `paragraph block*`, so a code block cannot be an item's first
 * child: the editor lifts it out of the list on open and the empty item left
 * behind is dropped on save. The bullet goes, the fence stays — and it goes
 * exactly the same way for a fence that is **full**, which is what says the
 * cause is the schema and not the emptiness.
 *
 * That was the third member of the family reported on #99 — an item whose
 * whole body is a heading, or an ordered list — and it is **fixed by #110**,
 * which widened `listItem` to `block+`. These shapes therefore now assert two
 * things rather than one: what #104 owns, that **the fenced blocks of the
 * document, with their languages and their contents, are unchanged**, and
 * what #110 owns, that the item holding them is still there. The first was
 * false at the pair level before #104, where the whole item left the file;
 * the second was false at this level until #110.
 */
const ALONE_IN_A_LIST_ITEM: ReadonlyArray<readonly [string, string, string]> = [
  ['a bullet item', '- ```\n  ```', '- ```\n  x\n  ```'],
  ['a bullet item with a language', '- ```js\n  ```', '- ```js\n  x\n  ```'],
  ['an ordered item', '1. ```\n   ```', '1. ```\n   x\n   ```'],
  ['an item inside another item', '- - ```\n    ```', '- - ```\n    x\n    ```'],
  ['an item inside a blockquote', '> - ```\n>   ```', '> - ```\n>   x\n>   ```'],
  ['a blockquote inside an item', '- > ```\n  > ```', '- > ```\n  > x\n  > ```'],
];

/**
 * Every fenced block of a document, as the pair `language|content` the file
 * spells it with. Read off the parsed HTML rather than off the markdown so
 * that a block written back in a different container still matches — which is
 * the point: this asserts the block, and says nothing about what holds it.
 */
function fencedBlocks(markdown: string): string[] {
  return Array.from(
    markdownToHtml(markdown).matchAll(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g),
  ).map((m) => `${m[1]}|${m[2]}`);
}

describe('a fence alone in a list item, at the editor level (#104)', () => {
  it.each(ALONE_IN_A_LIST_ITEM)('keeps the fence alone in %s', (_label, empty) => {
    expect(fencedBlocks(openAndSave(empty))).toEqual(fencedBlocks(empty));
  });

  it.each(ALONE_IN_A_LIST_ITEM)(
    'keeps a fence that has content alone in %s',
    (_label, _e, full) => {
      expect(fencedBlocks(openAndSave(full))).toEqual(fencedBlocks(full));
    },
  );

  it.each(ALONE_IN_A_LIST_ITEM)(
    'keeps the bullet of %s whether the fence is empty or not (#110)',
    (_label, empty, full) => {
      // This row asserted the opposite until #110 — that no list survived —
      // and it said so as "no `<li>` in the output" rather than as bytes,
      // deliberately, so that a schema decision restoring the bullet would
      // move it without enshrining the spelling it restored. That decision is
      // `listItem` taking `block+`, and this is the move it was written for:
      // the shapes are now pinned as the bytes they were opened from, which is
      // the stronger statement and the one R-C2 actually promises.
      expect(openAndSave(empty)).toBe(empty);
      expect(openAndSave(full)).toBe(full);
    },
  );

  it.each(ALONE_IN_A_LIST_ITEM)('%s — and the second save moves nothing', (_label, empty, full) => {
    for (const markdown of [empty, full]) {
      const first = openAndSave(markdown);
      expect(openAndSave(first)).toBe(first);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Half 2 — the repository's own documents, through the real save assembly
// ─────────────────────────────────────────────────────────────────────────────

const DOCUMENT_PATH = '/doc/notes.md';

/** A disk that records exactly what was written to it (the shape #79 uses). */
function recordingIO(disk: Map<string, string>): PlatformIO {
  return {
    // Desktop-shaped: every path carries a directory (#46).
    canWriteCompanions: async () => true,
    openFile: async () => null,
    pickFile: async () => null,
    readText: async (path: string) => {
      const text = disk.get(path);
      if (text === undefined) throw new Error(`no such file: ${path}`);
      return text;
    },
    saveFile: async (path: string, content: string) => {
      disk.set(path, content);
    },
    readSnapshot: async (path: string): Promise<FileSnapshot> => {
      const text = disk.get(path);
      return text === undefined ? { kind: 'absent' } : { kind: 'file', text };
    },
    pickSavePath: async () => null,
    installCloseGuard: async () => {},
    readBinary: async () => new Uint8Array(),
    writeBinary: async () => {},
    entryPresence: async () => 'absent' as const,
    listDir: async (): Promise<FileEntry[]> => [],
    mkdir: async () => {},
    openWithSystem: async () => {},
  };
}

/**
 * Open `text` as a file, change nothing, save — and return the bytes that
 * reached the disk. This is the whole path the user is on: `loadMarkdown`
 * (which is where the frontmatter is split and the line conventions are read)
 * → the editor → `buildDocument` → `saveMarkdown` (which is where the
 * conventions are re-applied). The serializer alone cannot see either end of
 * it, which is why #79 was invisible until it was measured here.
 */
async function openAndSaveUnedited(text: string): Promise<string> {
  const disk = new Map<string, string>([[DOCUMENT_PATH, text]]);
  const io = recordingIO(disk);
  const loaded = await loadMarkdown(DOCUMENT_PATH, io);

  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = createEditor(host);
  editor.setMarkdown(loaded.document.markdownBody);

  const state = new AppState();
  state.filePath = DOCUMENT_PATH;
  state.frontmatter = loaded.document.frontmatterRaw;
  state.lineConventions = loaded.document.lineConventions;

  const result = await saveMarkdown(buildDocument(state, editor.getMarkdown), io);
  editor.destroy();
  host.remove();
  return result.writtenText;
}

const DOCUMENTS: ReadonlyArray<readonly [string, string]> = [
  ['CLAUDE.md', claudeMd],
  ['CONTRIBUTING.md', contributingMd],
  ['README.md', readmeMd],
  ['REQUIREMENTS.md', requirementsMd],
  ['SECURITY.md', securityMd],
  ['docs/ADR/ADR-001-reset-and-simplification.md', adrMd],
  ['src/templates/blank-frontmatter.md', blankFrontmatterMd],
  // The three seeds left the gallery at #403 and their shapes stayed, so this
  // guard runs over the same number of documents it ran over before. They are
  // named for what they are rather than for a path that no longer exists.
  ['a meeting note (shape kept from src/templates/meeting-note.md)', RETIRED_MEETING_NOTE_SEED],
  [
    'a project document (shape kept from src/templates/project-document.md)',
    RETIRED_PROJECT_DOCUMENT_SEED,
  ],
  ['a project README (shape kept from src/templates/readme.md)', RETIRED_README_SEED],
];

/**
 * The largest document this guard will diff. The alignment below is quadratic
 * in the line count, so the bound is stated rather than left to grow into a
 * slow test nobody can explain. Exceeding it **fails** — the guard never skips
 * a document quietly.
 */
const MAX_LINES = 4000;

interface Region {
  readonly removed: readonly string[];
  readonly added: readonly string[];
  /** Where in the source the region begins — what a region rule reads context from. */
  readonly at: number;
}

/**
 * A region's two sides as text. Every line is **prefixed** by its newline
 * rather than joined between them, so that a region which removes one empty
 * line (`['']`) does not read as identical to one that removes nothing
 * (`[]`) — the two both join to the empty string, and a lost blank line would
 * then be claimed by the diff itself rather than by anything that names it.
 */
function sideText(lines: readonly string[]): string {
  return lines.map((line) => `\n${line}`).join('');
}

/**
 * The runs of lines in which `before` and `after` disagree, aligned by their
 * longest common subsequence so that a line the serializer merged into its
 * neighbour does not shift every line after it into the diff.
 */
function differenceRegions(before: string, after: string): Region[] {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    throw new Error(`document exceeds the ${MAX_LINES}-line bound this guard aligns within`);
  }

  // Longest common subsequence lengths, computed backwards so the walk below
  // can read the alignment off the table front to back.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const regions: Region[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  let at = 0;
  const flush = () => {
    if (removed.length > 0 || added.length > 0) regions.push({ removed, added, at });
    removed = [];
    added = [];
  };

  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      flush();
      i++;
      j++;
      at = i;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      removed.push(a[i++]);
    } else {
      added.push(b[j++]);
    }
  }
  while (i < a.length) removed.push(a[i++]);
  while (j < b.length) added.push(b[j++]);
  flush();
  return regions;
}

/**
 * One recorded R-C2 exception, expressed as the transformation that erases its
 * signature. Applied to **both** sides of a difference: a normaliser says
 * "these two spellings are the same document", never "this side is right".
 *
 * Narrowness is the whole property here. Each of these is written to erase one
 * exception and nothing else, and the two floors asserted below — the visible
 * text and the link destinations — hold whatever these do, so no normaliser can
 * hide a lost word or a lost address however widely it is drawn.
 */
interface Normaliser {
  readonly name: string;
  readonly apply: (text: string) => string;
}

const NORMALISERS: readonly Normaliser[] = [
  {
    // R-C2: a soft line break becomes a space. A wrapped paragraph arrives as
    // several lines and leaves as one. Both sides are joined, so a *list* that
    // lost an item still differs — `- a\n- b` joins to `- a - b`, which no
    // one-item list matches.
    name: 'soft line breaks become spaces',
    apply: (text) => text.replace(/\n[ \t]*/g, ' '),
  },
  {
    // R-C2: an escape the file did not have is added at a text-node boundary,
    // and a redundant escape the file already had is not preserved. Both
    // directions are the same fact seen from two sides — turndown's escaping is
    // handed one text node and `marked` consumes every backslash on the way in
    // — so one normaliser covers both by removing every backslash that stands
    // in front of a character the serializer escapes.
    //
    // The exception used to be written for backticks only; #84 measured the
    // same mechanism on a hyphen opening a text node and on an asterisk run
    // `marked` read as literal, and REQUIREMENTS now states it generally.
    name: 'an escape added or dropped by the serializer',
    apply: (text) => text.replace(/\\([`*_[\]\-.])/g, '$1'),
  },
  {
    // A code span's delimiter run is written at the shortest width that still
    // closes it, and its padding spaces go with it: ```` ``` ` ``` ```` in the
    // file comes back as ``` ` ` ```. Rendering is identical — CommonMark pairs
    // runs of equal length — and the file holds still afterwards.
    //
    // Measured in #84, in `REQUIREMENTS.md`, and recorded in R-C2 as its own
    // bullet — same family as the escaping exception above, different
    // mechanism: turndown builds the delimiter from the content it is handed,
    // so the file's width is carried nowhere.
    name: 'a code span delimiter run written at its shortest closing width',
    apply: (text) => text.replace(/`+/g, '`').replace(/ ?` ?/g, '`'),
  },
  {
    // R-C2 (#84): two overlapping marks have exactly one nesting, so the file's
    // two spellings of the same CommonMark collapse to whichever the schema
    // ranks outermost.
    //
    // The run is **moved outside the brackets, not erased** — which matters
    // more than it looks. A normaliser that deleted the delimiters would read
    // `**[t](u)**` and a `[t](u)` that had *lost* its bold as the same text,
    // and neither floor below would catch it: the visible words and the
    // destination are identical either way. Canonicalising instead means the
    // emphasis has to still be there, somewhere, for the two sides to match.
    name: 'emphasis re-nested around a link (#84)',
    apply: (text) => text.replace(/\[(\*{1,2}|~~)([^\]]*)\1\]\(([^)\s]*)\)/g, '$1[$2]($3)$1'),
  },
  {
    // The same exception where the run goes on past the link, on its head side
    // or its tail side (#573, owner decision L): `**head [t](u)**` is written
    // `**head** [**t**](u)` and `**[t](u) tail**` as `[**t**](u) **tail**`.
    // The rule above moves the run out of the brackets, `**head** **[t](u)**`,
    // and this joins the two runs that then meet across one space beside the
    // link, which gives the spelling of the file back.
    //
    // Only a run that closes or opens against a link is joined, so two runs of
    // bold side by side in prose, `**a** **b**`, still differ from `**a b**`.
    name: 'emphasis split at a link it goes on past (#573)',
    apply: (text) =>
      text
        .replace(/(\*{1,2}|~~)(\[[^\]]*\]\([^)\s]*\))\1 \1/g, '$1$2 ')
        .replace(/(\*{1,2}|~~) \1(\[[^\]]*\]\([^)\s]*\))\1/g, ' $2$1'),
  },
];

/** Apply every normaliser, in order. */
function normalise(text: string): string {
  return NORMALISERS.reduce((acc, n) => n.apply(acc), text);
}

/**
 * A difference that a text normaliser cannot describe because it is about
 * *where* it is, not what it says. Kept separate for exactly that reason: a
 * normaliser that claimed "one blank line disappeared" wherever it happened
 * would tolerate a lost blank line anywhere in any document.
 */
interface RegionRule {
  readonly name: string;
  readonly claims: (region: Region, sourceLines: readonly string[]) => boolean;
}

const REGION_RULES: readonly RegionRule[] = [
  {
    // The blank line between the metadata block and the document is not kept:
    // `splitFrontmatter` hands the body its leading newline, the editor has no
    // node for a leading blank line, and `assembleMarkdown` writes the closing
    // `---` with a single newline after it.
    //
    // Measured in #84, in `src/templates/blank-frontmatter.md`, and folded into
    // R-C2's blank-line exception rather than given a bullet of its own: it is
    // the same cause as the trailing run at the other end of the document —
    // the editor has no node for a blank line.
    //
    // Claimed only immediately below the closing `---` of a block that opens
    // the file, so a blank line lost anywhere else still fails.
    name: 'the blank line after the metadata block',
    claims: (region, sourceLines) =>
      region.added.length === 0 &&
      region.removed.length === 1 &&
      region.removed[0] === '' &&
      sourceLines[0] === '---' &&
      sourceLines[region.at - 1] === '---',
  },
  {
    // A run of two or more blank lines between two blocks comes back as one
    // (#424). The editor has no node for a blank line, so the run is gone
    // before the text is assembled — the same cause as the two rules above and
    // as the blank line under a metadata block, recorded in R-C2 beside them.
    //
    // **Positioned, and narrowly.** It claims only a region in which every
    // removed line is empty and **one blank line survived immediately above
    // it**, which is what collapsing a run looks like. A lone blank line lost
    // where the source had exactly one does not match — `sourceLines[at - 1]`
    // is then the last line of a block rather than the empty line the run
    // kept — so it still fails, which is what the exception promises and what
    // the row below pins.
    name: 'a run of blank lines between two blocks',
    claims: (region, sourceLines) =>
      region.added.length === 0 &&
      region.removed.length >= 1 &&
      region.removed.every((line) => line === '') &&
      sourceLines[region.at - 1] === '',
  },
];

/** Whether every difference in this region is one that is written down. */
function isClaimed(region: Region, sourceLines: readonly string[]): boolean {
  if (normalise(sideText(region.removed)) === normalise(sideText(region.added))) return true;
  return REGION_RULES.some((rule) => rule.claims(region, sourceLines));
}

/** Which normalisers actually altered this text — the census a region reports. */
function normalisersUsed(text: string): string[] {
  const used: string[] = [];
  let current = text;
  for (const n of NORMALISERS) {
    const next = n.apply(current);
    if (next !== current) used.push(n.name);
    current = next;
  }
  return used;
}

/** The words a reader sees, with every difference of spelling removed. */
function visibleText(markdown: string): string {
  return markdownToHtml(markdown)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every address the document links or points to, in order. */
function destinations(markdown: string): string[] {
  return Array.from(markdownToHtml(markdown).matchAll(/(?:href|src)="([^"]*)"/g)).map((m) => m[1]);
}

/**
 * The budget for one document case, raised from the vitest default of 5000 ms
 * (#426, owner decision of 2026-09-23).
 *
 * ── What failed, and what it was not ──
 *
 * The push run at `37d4c07` failed twice on `docs/internal/STATUS.md - census`
 * and passed on the third attempt, on the same bytes. It was read as a tenfold
 * jump against a 482 ms figure from 2026-09-07; the run logs say otherwise.
 * That case ran at 4635 ms on `7fd1550`, 4180 and 3793 across #422, and 4732 on
 * the #423 pull request - **already at 93 per cent of the limit four runs
 * before the first failure**, and before either of those merges existed.
 *
 * **It is not a regression.** The same STATUS.md, five runs at each of three
 * builds on one machine: `7fd1550` 809 ms, `297874c` 782 ms, `37d4c07` 795 ms,
 * medians. Nothing between them doubles anything.
 *
 * **It is the runner.** Across the three attempts of the one commit, every case
 * in this file moved by the same factor of about 1.7 - the second save 1792
 * against 1060, the difference census 875 against 511, this case 6663 against
 * 3871 - and so did `one character at a time` in `cell-blocks.test.ts`, which
 * is in another file entirely. A factor that uniform is the machine.
 *
 * ── Why a number this size, and what it buys ──
 *
 * **The cost is linear in the document**, measured on the whole case rather
 * than on the save alone, since the census also diffs: 229 KB at 791 ms,
 * 459 KB at 1457 ms, 919 KB at 2797 ms - 3.52, 3.24 and 3.11 ms per KB, if
 * anything cheaper as it grows. So headroom can be read off the slowest run
 * seen: 6663 ms for 229860 bytes is 29.7 ms per KB, and 30 s covers about
 * 1010 KB. The STATUS.md measured here grew about 6100 bytes a day; it left
 * this repository on 2026-10-01 with the milestone log (#20 section D), and the
 * largest document under the guard is now `REQUIREMENTS.md`, at about 129 KB.
 *
 * ── Why all four cases rather than the one that failed ──
 *
 * `STATUS.md - no word and no destination moves` reached **3349 ms** on the
 * same slow attempt. At the runner factor above it is the next one over the
 * line, so a timeout on the case that failed would only move the failure. The
 * four `it.each(DOCUMENTS)` cases below are every individual case in the suite
 * that reads a repository document through the save assembly: of the cases that
 * passed 1000 ms on CI, the rest belong to `cell-blocks.test.ts`, which carries
 * its own 60 s budget, or are whole-file totals rather than single cases.
 *
 * **What the number costs when it is wrong.** 11 documents times 4 cases is 44
 * cases holding this budget, so a case that hangs rather than merely runs slow
 * now takes 30 s to say so instead of 5. That is the trade, and it is accepted
 * because nothing here loops: every one of these is one document through one
 * open and one save.
 *
 * ── How to check this is still doing something ──
 *
 * **A timeout cannot be reddened by the suite on a machine this fast**: every
 * case above runs in under a second here, so removing this number changes no
 * result and a row asserting it would assert nothing. It was verified by
 * construction instead, and the same move re-verifies it: put
 * `await new Promise((r) => setTimeout(r, 6000));` at the top of one of the
 * four cases below. With this budget the 11 documents pass; with it taken off
 * that one case, all 11 fail with `Test timed out in 5000ms`. The probe is not
 * shipped - it exists only for the minute it takes to run.
 */
const DOCUMENT_CASE_TIMEOUT = { timeout: 30_000 };

/**
 * A run of blank lines between two blocks is kept (#590), where #424 had
 * recorded it as written back as one.
 *
 * `marked` holds the run in a `space` token, or at the end of the raw of the
 * block above for a heading, an indented code block, a table, an HTML block
 * or a definition. The adjacency carrier of #568 reads it from both places
 * and gives the block below its count; the save writes that many blank lines.
 *
 * Three shapes stay recorded, each with a row below: a run at the end of the
 * document, which no block below carries; a run between two items of one
 * list, which the list spacing carries per list (#28); and a run holding a
 * line of spaces, left as before by owner decision E4.
 */
describe('a run of blank lines between two blocks (#424, #590)', () => {
  const KEPT: ReadonlyArray<readonly [string, string]> = [
    ['two paragraphs', 'A.\n\n\nB.'],
    ['three blank lines between paragraphs', 'A.\n\n\n\nB.'],
    ['a heading and a paragraph', '# H\n\n\nB.'],
    ['a paragraph and a fenced block', 'A.\n\n\n```\nc\n```'],
    ['a fenced block and a paragraph', '```\nc\n```\n\n\nA.'],
    ['a paragraph and a table', 'A.\n\n\n| H |\n| --- |\n| c |'],
    ['a table and a paragraph', '| H |\n| --- |\n| c |\n\n\nA.'],
    ['a paragraph and a blockquote', 'A.\n\n\n> q'],
    ['a blockquote and a paragraph', '> q\n\n\nA.'],
    ['inside a blockquote', '> one\n>\n>\n> two'],
  ];

  for (const [name, source] of KEPT) {
    it(`${name} — the run is kept, and holds`, async () => {
      const saved = (await openAndSaveUnedited(source)).trim();
      expect(saved).toBe(source);
      expect((await openAndSaveUnedited(saved)).trim()).toBe(source);
    });
  }

  const RECORDED: ReadonlyArray<readonly [string, string, string]> = [
    ['between two items of one list', '- a\n\n\n- b', '- a\n\n- b'],
    ['holding a line of spaces', 'A.\n\n  \n\nB.', 'A.\n\nB.'],
  ];

  for (const [name, source, expected] of RECORDED) {
    it(`${name} — the run comes back as one blank line, and holds`, async () => {
      const saved = (await openAndSaveUnedited(source)).trim();
      expect(saved).toBe(expected);
      expect((await openAndSaveUnedited(saved)).trim()).toBe(expected);
    });
  }

  it('at the end of the document — the run is not kept', async () => {
    expect(await openAndSaveUnedited('A.\n\nB.\n\n\n\n')).toBe('A.\n\nB.\n');
  });
});

/**
 * **The guard does see this shape, which the step zero measured rather than
 * assumed.** Feeding it a document with a run turned the positioned guard red
 * with *unrecorded difference*, so the sentence in R-C2 - a blank line lost
 * anywhere else still fails the suite - was true all along. What had never
 * happened is the guard meeting one: no document it runs over holds a run.
 *
 * So the rule below is what the widened exception owes the guard, and these
 * two rows are the halves that matter. Without the second, the rule would be
 * the over-broad normaliser the comment above `RegionRule` warns against.
 */
describe('the rule for that run is positioned (#424)', () => {
  it('claims a run collapsing to one blank line', () => {
    const source = 'A.\n\n\nB.';
    const saved = 'A.\n\nB.';
    const regions = differenceRegions(source, saved);
    expect(regions).toHaveLength(1);
    expect(isClaimed(regions[0], source.split('\n'))).toBe(true);
  });

  it('does not claim a lone blank line lost where the source had one', () => {
    // The shape the exception does not name, built rather than found: the
    // editor produces no such loss today, and this row is what stops the rule
    // from tolerating one if something ever does.
    const source = 'A.\n\nB.';
    const saved = 'A.\nB.';
    const regions = differenceRegions(source, saved);
    expect(regions).toHaveLength(1);
    expect(isClaimed(regions[0], source.split('\n'))).toBe(false);
  });
});

/**
 * The two shapes the overlapping-marks exception names beside the whole-link
 * one (#573, owner decision L). No document above holds either outside a code
 * span, so the rows build them: with the normaliser for them removed, both
 * fail the guard, which is what a document holding one would do.
 */
describe('emphasis split at a link it goes on past is claimed (#573)', () => {
  it.each([
    ['the head side', '**head [t](https://e.com)**\n', '**head** [**t**](https://e.com)\n'],
    ['the tail side', '**[t](https://e.com) tail**\n', '[**t**](https://e.com) **tail**\n'],
  ])('%s', async (_name, source, written) => {
    const saved = await openAndSaveUnedited(source);
    expect(saved).toBe(written);
    const regions = differenceRegions(source, saved);
    expect(regions).toHaveLength(1);
    expect(isClaimed(regions[0], source.split('\n'))).toBe(true);
  });

  it('does not claim a link that lost its emphasis beside the split', () => {
    const region = {
      removed: ['**head [t](https://e.com)**'],
      added: ['**head** [t](https://e.com)'],
      at: 0,
    };
    expect(isClaimed(region, [])).toBe(false);
  });

  it('does not claim two runs of bold in prose written as one', () => {
    expect(isClaimed({ removed: ['**a** **b**'], added: ['**a b**'], at: 0 }, [])).toBe(false);
  });
});

describe('the repository, opened and saved unedited (R-C2)', () => {
  it.each(DOCUMENTS)(
    '%s — the second save moves nothing',
    DOCUMENT_CASE_TIMEOUT,
    async (_name, source) => {
      // The half that needs no exception list. Whatever the first save normalises,
      // the next one must not move a byte, or the document drifts every time it is
      // opened — which would be a defect whatever R-C2 said about the first save.
      const first = await openAndSaveUnedited(source);
      expect(await openAndSaveUnedited(first)).toBe(first);
    },
  );

  it.each(DOCUMENTS)(
    '%s — every difference is one that is recorded',
    DOCUMENT_CASE_TIMEOUT,
    async (name, source) => {
      const saved = await openAndSaveUnedited(source);
      const sourceLines = source.split('\n');
      const unclaimed = differenceRegions(source, saved).filter(
        (region) => !isClaimed(region, sourceLines),
      );

      // A difference no normaliser can erase is a difference nobody has written
      // down. It fails, and it prints itself — the list of recorded exceptions
      // grows by a decision in REQUIREMENTS, never by a test quietly widening.
      expect(
        unclaimed.map(
          (r) =>
            `\n  ${name} — unrecorded difference:\n    - ${r.removed.join('\n    - ')}\n    + ${r.added.join('\n    + ')}`,
        ),
      ).toEqual([]);
    },
  );

  it.each(DOCUMENTS)(
    '%s — no word and no destination moves',
    DOCUMENT_CASE_TIMEOUT,
    async (_name, source) => {
      // The two floors, asserted independently of every normaliser above. A
      // normaliser is a claim about spelling; these are claims about content, and
      // they are what stops a normaliser drawn too widely from hiding a real loss.
      const saved = await openAndSaveUnedited(source);
      expect(visibleText(saved)).toBe(visibleText(source));
      expect(destinations(saved)).toEqual(destinations(source));
    },
  );

  /**
   * The census, one case per document (#241).
   *
   * **It was one `it` that opened every document, and that is what put main
   * red.** Every other case here costs one document against the 5000 ms
   * budget; this one cost the sum of all of them against the same budget, so
   * its headroom shrank every time a guarded document grew. It crossed on the
   * push run of `80cbfe5` while the pull request run of the same content had
   * passed — the failure a slow runner produces and a fast one hides.
   *
   * Measured before the split, on the clock the test has: the sum was 1435.8
   * ms locally, 28.7 percent of the budget, and the slowest single document
   * through this path was `docs/internal/MILESTONE-LOG.md` at 448.2 ms. The
   * split therefore puts the worst census case **below the worst case this
   * file already lives with** — `MILESTONE-LOG.md — no word and no destination
   * moves` at 974.1 ms — rather than introducing a new one. That is the whole
   * argument: the budget is per case, so a case has to be one document.
   *
   * ── What it is, unchanged ──
   *
   * Still a census rather than an assertion about round-tripping: it says
   * which recorded exceptions each document actually meets, so a reader of a
   * failing run sees at a glance what this repository still pays for, and so
   * the normalisers above are visibly in use rather than dead code. The
   * per-document line and the one printed table are exactly what they were.
   */
  const census = new Map<string, string>();

  it.each(DOCUMENTS)(
    '%s — census: which recorded exceptions it meets',
    DOCUMENT_CASE_TIMEOUT,
    async (name, source) => {
      const saved = await openAndSaveUnedited(source);
      const sourceLines = source.split('\n');
      const met = new Set<string>();
      for (const region of differenceRegions(source, saved)) {
        for (const used of normalisersUsed(sideText(region.removed))) met.add(used);
        for (const used of normalisersUsed(sideText(region.added))) met.add(used);
        for (const rule of REGION_RULES) {
          if (rule.claims(region, sourceLines)) met.add(rule.name);
        }
      }
      census.set(name, `${name}: ${met.size === 0 ? 'byte-identical' : [...met].join('; ')}`);
    },
  );

  it('census — the whole table, computed by the cases above', () => {
    // Opens no document and saves none: every row was already computed by the
    // case for that document, so this costs the string work and nothing else.
    // It exists because eleven separate lines scattered through the reporter
    // output are not the one table the census is for.
    console.info(`R-C2 census\n  ${[...census.values()].join('\n  ')}`);

    // The same count the single test asserted, and it has stopped being a
    // tautology. It used to compare a list against the loop that had just
    // filled it, which could not fail; now the rows come from other cases, so
    // a document whose case did not run is a named missing row here.
    //
    // The consequence, since it is a real one: under `vitest -t` this case
    // needs the per-document cases in the same filtered run. Both titles carry
    // the word census for that reason, so the pattern that selects one selects
    // all of them; a filter narrow enough to take this case alone reports the
    // rows it did not get rather than printing a short table quietly.
    const missing = DOCUMENTS.map(([name]) => name).filter((name) => !census.has(name));
    expect(missing, `census rows no case produced: ${missing.join(', ')}`).toEqual([]);
  });
});

/**
 * Nothing claims a loose list any more, and that is the pin that says #28 is
 * fixed rather than re-described.
 *
 * A normaliser for this used to live here (#117): a loose list written back
 * tight was a recorded exception, so the document half had to be able to erase
 * that difference before comparing. Now that the file's own spacing survives
 * the round trip there is nothing to erase, and the strongest statement this
 * guard can make is the inverse of the one it used to make — if the serializer
 * ever tightens a list again, **no normaliser will absorb it** and the document
 * half fails loudly.
 *
 * The refusals below outlived the normaliser they were written against. They
 * were the floor it could most plausibly have broken through, and they are
 * still the floor: whatever is added here later has to keep failing them.
 */
describe('a loose list written back tight is claimed by nothing (#28)', () => {
  /** The two sides a difference has, as `differenceRegions` would hand them over. */
  const region = (removed: readonly string[], added: readonly string[]): Region => ({
    removed,
    added,
    at: 1,
  });

  it('does not claim a loose bullet list written back tight', () => {
    expect(isClaimed(region(['- one', '', '- two'], ['- one', '- two']), [])).toBe(false);
  });

  it('does not claim a loose ordered list written back tight', () => {
    expect(isClaimed(region(['1. one', '', '2. two'], ['1. one', '2. two']), [])).toBe(false);
  });

  it('does not claim it under an item that wraps onto continuation lines', () => {
    // The shape the project status file held while it was guarded here, and
    // the one that occasioned the normaliser in the first place.
    expect(
      isClaimed(
        region(['- one', '  more about one', '', '- two'], ['- one more about one', '- two']),
        [],
      ),
    ).toBe(false);
  });

  // ── the floor the removed normaliser was held to, kept ──

  it('does not claim a list that lost an item', () => {
    expect(isClaimed(region(['- one', '', '- two'], ['- one']), [])).toBe(false);
  });

  it('does not claim an item whose text changed while a blank line went', () => {
    expect(isClaimed(region(['- one', '', '- two'], ['- one', '- three']), [])).toBe(false);
  });

  it('does not claim the blank line between a paragraph and the list below it', () => {
    expect(isClaimed(region(['text', '', '- one'], ['text', '- one']), [])).toBe(false);
  });

  it('does not claim a blank line that goes from between two paragraphs', () => {
    expect(isClaimed(region(['one', '', 'two'], ['one', 'two']), [])).toBe(false);
  });

  it('names no loose-list normaliser in the census', () => {
    // The soft-break normaliser still names itself, because joining the lines
    // is what it does to every side it is handed. What must not come back is
    // a normaliser that claims the blank line as an exception.
    expect(normalisersUsed(sideText(['- one', '', '- two']))).not.toContain(
      'a loose list written back tight',
    );
  });
});
