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
 * ── What is deliberately not here ──
 *
 * A list item whose entire body is a heading loses its bullet at the editor
 * level (`- ## 1. x` → `## 1. x`), as does one whose body is an ordered list —
 * and, #104 measured, as does one whose body is a fenced block, empty or not.
 * All three are the same TipTap schema fact, reported on #99 and left unpinned
 * by an explicit decision recorded in STATUS §4 — pinning them would enshrine
 * them. They are left out of the table for that reason and no other; they are
 * not fixed here and they are not claimed to be absent. The third one does
 * appear further down, asserted as the property #104 owns rather than as
 * bytes, because two of that issue's four shapes would otherwise be missing
 * from this guard with no reason given.
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
 * That is the third member of the family reported on #99 — an item whose whole
 * body is a heading, or an ordered list — recorded in STATUS §4 as one schema
 * decision and deliberately left unpinned, because pinning the bytes would
 * enshrine them. So these shapes assert what #104 owns: **the fenced blocks of
 * the document, with their languages and their contents, are unchanged.**
 * Before this fix that was false at the pair level, where the whole item left
 * the file; at this level the block already survived, and the rows are here so
 * the four shapes of #104 are all visible in the guard rather than two of them
 * being absent without a reason.
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
  )('loses the bullet of %s whether the fence is empty or not (#99 schema fact)', (_label, empty, full) => {
    // Both, together, are the statement: the item does not survive either
    // way, so what this costs is not about the fence being empty. Asserted
    // as "no list survives" rather than as the bytes, so a schema decision
    // that restored the bullet would move this row without enshrining the
    // spelling it restores it in.
    expect(markdownToHtml(openAndSave(empty))).not.toContain('<li>');
    expect(markdownToHtml(openAndSave(full))).not.toContain('<li>');
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
    exists: async () => false,
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
