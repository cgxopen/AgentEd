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
 *     by a small set of named normalisers, one per recorded exception, each
 *     erasing exactly that exception's signature from both sides of a
 *     difference. A difference no normaliser can erase **fails**, and prints
 *     itself. That is the half that must not rot: a list of expected strings
 *     stops being read, a normaliser that cannot claim a new difference cannot
 *     stay quiet about it.
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
import statusMd from '../../docs/internal/STATUS.md?raw';
import workflowMd from '../../docs/internal/WORKFLOW.md?raw';
import readmeMd from '../../README.md?raw';
import requirementsMd from '../../REQUIREMENTS.md?raw';
import securityMd from '../../SECURITY.md?raw';
import { buildBundle } from '../app/bundle';
import { AppState } from '../app/state';
import { loadMarkdown, saveMarkdown } from '../formats/plain';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import blankFrontmatterMd from '../templates/blank-frontmatter.md?raw';
import meetingNoteMd from '../templates/meeting-note.md?raw';
import projectDocumentMd from '../templates/project-document.md?raw';
import templateReadmeMd from '../templates/readme.md?raw';
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
const LOOSE_LISTS = 'R-C2: loose lists are tightened';
const SOFT_BREAKS = 'R-C2: a soft line break becomes a space';
const BACKTICK_RUNS = 'R-C2: backtick runs are escaped even when nothing can close them';
const REDUNDANT_ESCAPE = 'R-C2: a redundant escape the file already had is not preserved';
const INLINE_ELEMENT_NUMBER =
  'R-C2: a number opening an inline element in a heading or a cell keeps its backslash';
const SINGLE_TILDE = 'R-C2: single-tilde strikethrough is written with two';
const TABLE_SPELLINGS = 'R-C2: five table spellings AgentEd cannot hold';
const MARK_NESTING = 'R-C2: two overlapping marks have one nesting (#84)';

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
  ['a loose list', '- one\n\n- two', { writes: '- one\n- two', because: LOOSE_LISTS }],

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
  // blank line — because that is the only spelling that reads back as the same
  // item. A blank line inside a task item puts the `<input>` inside the first
  // paragraph, which is not a task item any more, so a loose spelling would
  // trade the block this fixed for the checkbox.
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

  // ── Soft line breaks (#89) ──
  [
    'a wrapped paragraph',
    'first line\nsecond line',
    { writes: 'first line second line', because: SOFT_BREAKS },
  ],
  [
    'two inline elements that spanned two lines',
    '**a**\n**b**',
    { writes: '**a** **b**', because: SOFT_BREAKS },
  ],

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
 * What #160 still owns, asserted as the property rather than as bytes.
 *
 * Two members are open, and neither is recorded as an R-C2 exception: an
 * exception is a statement that a difference is accepted, and these are not.
 *
 *  - **A loose task list is not read as one** (member 3a). Widening the
 *    checkbox rewrite in `parse.ts` to the `<li><p><input` shape a loose list
 *    produces is cheap in lines and turns `empty-fence.test.ts` red, because
 *    it removes the `<input>` that #104's reasoning rests on — a task item is
 *    never blank *because* it holds a void element. That premise gets its own
 *    measurement rather than riding along here.
 *  - **An ordered task list gains a bullet** (member 3b). Measured on this
 *    branch: leaving the input alone inside an `<ol>`, which is what would
 *    make `parse.ts` agree with `task-list.ts`, writes `1. a` — the marker
 *    gone rather than kept as text, because ProseMirror has no node for an
 *    `<input>`. Writing it back as literal text cannot be byte-identical
 *    either, since turndown escapes `[` and `]` wherever they appear.
 *
 * So what is pinned is the half of R-C2 that has no exceptions: **whatever
 * these two do, they do it once**. That is the assertion that was missing when
 * both members were met rather than caught, and it now runs against them from
 * here on, whichever way they are eventually decided.
 */
describe('the shapes #160 leaves open still settle after one save (#160)', () => {
  it.each([
    ['a loose task list', '- [ ] a\n\n- [ ] b'],
    ['an ordered task list', '1. [ ] a'],
    ['an ordered task list of two items', '1. [ ] a\n2. [ ] b'],
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

  it.each(
    ALONE_IN_A_LIST_ITEM,
  )('keeps a fence that has content alone in %s', (_label, _e, full) => {
    expect(fencedBlocks(openAndSave(full))).toEqual(fencedBlocks(full));
  });

  it.each(
    ALONE_IN_A_LIST_ITEM,
  )('keeps the bullet of %s whether the fence is empty or not (#110)', (_label, empty, full) => {
    // This row asserted the opposite until #110 — that no list survived —
    // and it said so as "no `<li>` in the output" rather than as bytes,
    // deliberately, so that a schema decision restoring the bullet would
    // move it without enshrining the spelling it restored. That decision is
    // `listItem` taking `block+`, and this is the move it was written for:
    // the shapes are now pinned as the bytes they were opened from, which is
    // the stronger statement and the one R-C2 actually promises.
    expect(openAndSave(empty)).toBe(empty);
    expect(openAndSave(full)).toBe(full);
  });

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
    supportsMultiFile: true,
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
    remove: async () => {},
    openWithSystem: async () => {},
  };
}

/**
 * Open `text` as a file, change nothing, save — and return the bytes that
 * reached the disk. This is the whole path the user is on: `loadMarkdown`
 * (which is where the frontmatter is split and the line conventions are read)
 * → the editor → `buildBundle` → `saveMarkdown` (which is where the
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
  editor.setMarkdown(loaded.bundle.markdownBody);

  const state = new AppState();
  state.filePath = DOCUMENT_PATH;
  state.frontmatter = loaded.bundle.frontmatterRaw;
  state.lineConventions = loaded.bundle.lineConventions;

  const result = await saveMarkdown(buildBundle(state, editor.getMarkdown), io);
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
  ['docs/internal/STATUS.md', statusMd],
  ['docs/internal/WORKFLOW.md', workflowMd],
  ['src/templates/blank-frontmatter.md', blankFrontmatterMd],
  ['src/templates/meeting-note.md', meetingNoteMd],
  ['src/templates/project-document.md', projectDocumentMd],
  ['src/templates/readme.md', templateReadmeMd],
];

/**
 * The largest document this guard will diff. `docs/internal/STATUS.md` is the
 * longest at ~150 lines and it grows every merge; the alignment below is
 * quadratic in the line count, so the bound is stated rather than left to grow
 * into a slow test nobody can explain. Exceeding it **fails** — the guard never
 * skips a document quietly.
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

/** A line that opens a list item: `- x`, `* x`, `+ x`, `1. x`, `1) x`. */
const OPENS_LIST_ITEM = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]/;
/** A line that is indented and not blank — the continuation of an item above. */
const CONTINUES_LIST_ITEM = /^[ \t]+\S/;

const NORMALISERS: readonly Normaliser[] = [
  {
    // R-C2, the first exception recorded there: a loose list — blank lines
    // between its items — is written back tight, because TipTap's list nodes
    // carry no loose/tight distinction and the editor has no node for a blank
    // line. Rendering differs (loose items are wrapped in `<p>`), which is why
    // it is tracked as #28 rather than merely accepted; the bytes are what this
    // guard is about, and they are recorded.
    //
    // **It runs before the soft-break normaliser and that is not incidental.**
    // Once soft breaks have become spaces the blank line is no longer a line —
    // it is an extra space in a sentence, and a normaliser that collapsed
    // *those* would erase every doubled space anywhere in any document. Here
    // the structure is still visible, so the claim can be made about the
    // structure: a blank line, between two items of one list.
    //
    // Narrow on **both** sides deliberately. It claims the blank line only
    // when the line after it opens an item and the line before it belongs to
    // one — an item itself, or an indented continuation of one. So the blank
    // line that *separates a paragraph from a list beneath it* is not claimed:
    // that one is preserved on save, and a day it stops being preserved this
    // guard still has to say so.
    //
    // Added on #117, after a blank line in `docs/internal/STATUS.md` turned
    // `main` red for a difference R-C2 already accepts. Removed again, with
    // the shape-table row above it, if #28 is ever fixed.
    name: 'a loose list written back tight',
    apply: (text) => {
      const lines = text.split('\n');
      const kept: string[] = [];
      for (let i = 0; i < lines.length; i++) {
        const previous = kept[kept.length - 1];
        const isBlankBetweenItems =
          lines[i].trim().length === 0 &&
          OPENS_LIST_ITEM.test(lines[i + 1] ?? '') &&
          previous !== undefined &&
          (OPENS_LIST_ITEM.test(previous) || CONTINUES_LIST_ITEM.test(previous));
        if (!isBlankBetweenItems) kept.push(lines[i]);
      }
      return kept.join('\n');
    },
  },
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

describe('the repository, opened and saved unedited (R-C2)', () => {
  it.each(DOCUMENTS)('%s — the second save moves nothing', async (_name, source) => {
    // The half that needs no exception list. Whatever the first save normalises,
    // the next one must not move a byte, or the document drifts every time it is
    // opened — which would be a defect whatever R-C2 said about the first save.
    const first = await openAndSaveUnedited(source);
    expect(await openAndSaveUnedited(first)).toBe(first);
  });

  it.each(DOCUMENTS)('%s — every difference is one that is recorded', async (name, source) => {
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
  });

  it.each(DOCUMENTS)('%s — no word and no destination moves', async (_name, source) => {
    // The two floors, asserted independently of every normaliser above. A
    // normaliser is a claim about spelling; these are claims about content, and
    // they are what stops a normaliser drawn too widely from hiding a real loss.
    const saved = await openAndSaveUnedited(source);
    expect(visibleText(saved)).toBe(visibleText(source));
    expect(destinations(saved)).toEqual(destinations(source));
  });

  it('reports which exceptions each document actually meets', async () => {
    // Not an assertion — a census, so that a reader of a failing run can see at
    // a glance which recorded exceptions this repository still pays for, and so
    // that the normalisers above are visibly in use rather than dead code.
    const census: string[] = [];
    for (const [name, source] of DOCUMENTS) {
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
      census.push(`${name}: ${met.size === 0 ? 'byte-identical' : [...met].join('; ')}`);
    }
    console.info(`R-C2 census\n  ${census.join('\n  ')}`);
    expect(census).toHaveLength(DOCUMENTS.length);
  });
});

/**
 * The loose-list normaliser, held to the property that makes it worth having
 * rather than to the document that occasioned it (#117).
 *
 * A normaliser is only as good as what it still refuses, and that half cannot
 * be read off the repository: every document here is expected to pass, so a
 * normaliser drawn too widely passes too, silently. These drive `isClaimed`
 * on regions built by hand — the difference the exception describes, and the
 * differences it must not be able to swallow.
 */
describe('the loose-list normaliser claims one exception and no more (#117)', () => {
  /** The two sides a difference has, as `differenceRegions` would hand them over. */
  const region = (removed: readonly string[], added: readonly string[]): Region => ({
    removed,
    added,
    at: 1,
  });

  it('claims a loose list written back tight', () => {
    expect(isClaimed(region(['- one', '', '- two'], ['- one', '- two']), [])).toBe(true);
  });

  it('claims it under an item that wraps onto continuation lines', () => {
    // The shape `docs/internal/STATUS.md` actually held: the blank line sits
    // under an indented continuation, not under the item marker itself.
    expect(
      isClaimed(
        region(['- one', '  more about one', '', '- two'], ['- one more about one', '- two']),
        [],
      ),
    ).toBe(true);
  });

  it('claims an ordered list too — the exception is about the blank line', () => {
    expect(isClaimed(region(['1. one', '', '2. two'], ['1. one', '2. two']), [])).toBe(true);
  });

  // ── and now what it must still refuse ──

  it('does NOT claim a list that lost an item', () => {
    // The floor this normaliser could most plausibly have broken. `- one` and
    // `- two` joined is `- one - two`, which a one-item list does not match —
    // and it must keep not matching now that blank lines can be erased.
    expect(isClaimed(region(['- one', '', '- two'], ['- one']), [])).toBe(false);
  });

  it('does NOT claim an item whose text changed while a blank line went', () => {
    expect(isClaimed(region(['- one', '', '- two'], ['- one', '- three']), [])).toBe(false);
  });

  it('does NOT claim the blank line between a paragraph and the list below it', () => {
    // Preserved on save today. The day it stops being preserved, this guard
    // has to report it rather than absorb it into the loose-list exception.
    expect(isClaimed(region(['text', '', '- one'], ['text', '- one']), [])).toBe(false);
  });

  it('does NOT claim a blank line that goes from between two paragraphs', () => {
    expect(isClaimed(region(['one', '', 'two'], ['one', 'two']), [])).toBe(false);
  });

  it('names itself in the census when a document meets it', () => {
    expect(normalisersUsed(sideText(['- one', '', '- two']))).toContain(
      'a loose list written back tight',
    );
    // And stays out of it when nothing loose is there to claim.
    expect(normalisersUsed(sideText(['- one', '- two']))).not.toContain(
      'a loose list written back tight',
    );
  });
});
