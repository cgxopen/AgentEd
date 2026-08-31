import { describe, expect, it } from 'vitest';
import { markdownToHtml } from './parse';
import { htmlToMarkdown } from './serialize';

/** Markdown roundtrip: MD → marked → HTML → DOMPurify → turndown → MD */
function roundtrip(md: string): string {
  return htmlToMarkdown(markdownToHtml(md)).trim();
}

describe('markdown roundtrip', () => {
  it('preserves H1 heading', () => {
    expect(roundtrip('# Title')).toBe('# Title');
  });

  it('preserves H2 and H3 headings', () => {
    expect(roundtrip('## Sub')).toBe('## Sub');
    expect(roundtrip('### Deeper')).toBe('### Deeper');
  });

  it('preserves bold and italic', () => {
    expect(roundtrip('**bold** and *italic*')).toBe('**bold** and *italic*');
  });

  it('preserves inline code', () => {
    expect(roundtrip('use `npm test` to run')).toBe('use `npm test` to run');
  });

  it('preserves blockquote', () => {
    expect(roundtrip('> a quote')).toBe('> a quote');
  });

  it('preserves horizontal rule as ---', () => {
    expect(roundtrip('---')).toBe('---');
  });

  it('preserves link with text', () => {
    expect(roundtrip('[link](https://example.com)')).toBe('[link](https://example.com)');
  });

  it('preserves image with alt text (path unchanged when not in registry)', () => {
    // Image path stays as-is when registry has no matching display URL
    expect(roundtrip('![alt](img.png)')).toBe('![alt](img.png)');
  });

  it('preserves bullet list with two items', () => {
    expect(roundtrip('- one\n- two')).toBe('- one\n- two');
  });

  it('preserves nested bullet list structure', () => {
    const out = roundtrip('- one\n    - nested\n- two');
    expect(out).toMatch(/-\s+one/);
    expect(out).toMatch(/nested/);
    expect(out).toMatch(/-\s+two/);
  });

  it('preserves task list item text content', () => {
    // KNOWN LIMITATION: marked produces <li data-type="taskItem"> but no
    // <ul data-type="taskList"> wrapper, so the turndown 'taskListItem' rule
    // (which requires the parent attr) doesn't match — checkbox markers are
    // dropped on roundtrip. Text content is preserved. Tracked for future fix.
    const out = roundtrip('- [ ] todo\n- [x] done');
    expect(out).toMatch(/todo/);
    expect(out).toMatch(/done/);
  });

  it('preserves underline (<u>) via custom turndown rule', () => {
    // Underline isn't standard MD but our pipeline keeps it as <u> tags
    const out = roundtrip('plain <u>under</u> text');
    expect(out).toContain('<u>under</u>');
  });

  it('preserves fenced code block with language hint', () => {
    const md = '```ts\nconst x = 1;\n```';
    const out = roundtrip(md);
    expect(out).toContain('```');
    expect(out).toContain('const x = 1;');
  });

  // A fenced block with nothing in it is still a block (#94). turndown used
  // to replace it — fence, language and all — before any rule was consulted,
  // because it replaces every blank node first. The cases and the narrowness
  // that keeps every *other* blank node where it was are in
  // `empty-fence.test.ts`; these three are here because this is the suite
  // anyone changing the serializer runs.
  it.each([
    ['no language', '```\n```'],
    ['a language', '```js\n```'],
    ['spaces', '```\n   \n```'],
  ])('preserves an empty fenced block with %s', (_label, md) => {
    expect(roundtrip(md)).toBe(md);
  });

  // ── List markup, byte for byte (R-C2) ──
  //
  // Lists are the markup an editing session touches most, and turndown's
  // built-in rules reformat every marker it serializes. These cases assert
  // exact equality, so any future change to the list rules that widens a
  // marker or leaves whitespace behind fails here.
  describe('list markup is byte-identical', () => {
    const identical: Array<[string, string]> = [
      ['bullet list', '- one\n- two'],
      ['ordered list', '1. one\n2. two'],
      ['nested bullet list', '- one\n  - nested\n- two'],
      ['nested ordered list', '1. one\n   1. nested\n2. two'],
      ['three levels deep', '- a\n  - b\n    - c\n- d'],
      ['ordered list starting past 1', '9. nine\n10. ten\n11. eleven'],
      ['list interrupted by a paragraph', '1. one\n2. two\n\nA paragraph.\n\n3. three\n4. four'],
      ['two lists that both restart', '1. one\n2. two\n\nA paragraph.\n\n1. alpha\n2. beta'],
      ['item holding two paragraphs', '1. one\n\n   continued\n\n2. two'],
      ['bullet list next to an ordered list', '- one\n- two\n\ntext\n\n1. a\n2. b'],
    ];
    for (const [name, md] of identical) {
      it(`preserves a ${name}`, () => {
        expect(roundtrip(md)).toBe(md);
      });
    }

    it('numbers items from the ol start attribute, not from their position', () => {
      // D1: a list continuing after a paragraph keeps the numbering the
      // editor renders, instead of restarting from 1 on the way to disk.
      expect(roundtrip('5. five\n6. six')).toBe('5. five\n6. six');
    });

    it('a loose list keeps its blank lines (#28)', () => {
      // This used to be a KNOWN LIMITATION here and the first R-C2 exception
      // recorded. `marked` does carry the distinction into the HTML — a loose
      // list wraps each item body in `<p>` — but it was lost at the ProseMirror
      // parse, so the pair level was never where it died. What repairs it is
      // the file's own spacing, read from the markdown and pinned to the list
      // (`list-spacing.ts`), and this level sees it because `markdownToHtml`
      // is where it is attached.
      expect(roundtrip('- one\n\n- two')).toBe('- one\n\n- two');
      expect(roundtrip('- one\n- two')).toBe('- one\n- two');
      // The shape that used to gain a byte: spelled tight between its items
      // while each item holds two blocks, which is loose to CommonMark and
      // tight to the file.
      expect(roundtrip('- one\n\n  second para\n- two')).toBe('- one\n\n  second para\n- two');
    });
  });

  // ── Strikethrough (#85) ──
  //
  // Turndown had no rule for `s`/`del`/`strike`, and its default for an
  // unrecognised element keeps the text and drops the element — so every
  // shape below came back with the strike gone, measured on `a9aab02`. It is
  // the one R-C2 exception that lost something the reader can see.
  describe('a soft line break is a space at the pair level too (#89)', () => {
    // The editor-level pins live in `src/editor/soft-break.test.ts`. This is
    // the other half of R-C2's "measured at both levels": the parser and the
    // serializer collapse a wrap on their own, with no editor in the picture,
    // so preserving one would take more than the parse change #89 made.
    it('collapses a wrapped paragraph into one line', () => {
      expect(roundtrip('first line\nsecond line')).toBe('first line second line');
    });

    it('keeps a space between two inline elements that spanned two lines', () => {
      expect(roundtrip('**a**\n**b**')).toBe('**a** **b**');
    });
  });

  describe('escaping is narrowed to what CommonMark needs (#90)', () => {
    // The pair-level half of #90; the editor-level pins and the two whole
    // documents live in `src/editor/escape-noise.test.ts`.
    //
    // Turndown escapes every `_` in a text node, because from one text node it
    // cannot tell syntax from content. Measured on `86bc260`, every case in
    // the first list came back with a backslash the file never had:
    // `cl100k\_base`, `snake\_case`, `a\_b\_c`.
    //
    // Backticks are **not** narrowed — pairing is a block-level property this
    // vantage point cannot see, and the R-C2 exception says so. The second
    // list holds them to turndown's behaviour.
    it.each([
      ['an identifier with one underscore', 'The tokenizer is cl100k_base here.'],
      ['snake_case in a sentence', 'Call snake_case now.'],
      ['two underscores in one word', 'Try a_b_c please.'],
      ['a double underscore inside a word', 'A foo__bar name.'],
    ])('leaves %s alone', (_label, markdown) => {
      expect(roundtrip(markdown)).toBe(markdown);
    });

    // The floor. Each of these was already correct on `86bc260` and must stay
    // correct: a narrowing that took any of them away would trade a
    // bytes-only difference for a visible one, which is the whole risk of this
    // change.
    it.each([
      ['underscores the file had already escaped', 'a \\_foo\\_ b'],
      ['asterisks the file had already escaped', 'a \\*not bold\\* b'],
      ['an underscore that could open emphasis', 'see \\_foo here'],
      ['an underscore that could close emphasis', 'see foo\\_ here'],
      ['an underscore run at both edges of a word', 'a \\_x_y\\_ b'],
      ['emphasis spelled with asterisks', 'a *foo* b'],
      // The trap: CommonMark forbids intraword emphasis with `_` and allows it
      // with `*`, so this escape is load-bearing where the `_` one is noise.
      // `escape.ts` does not treat the two alike, and this says so.
      ['intraword emphasis with asterisks', 'a foo*bar*baz b'],
      ['strong', 'a **bold** b'],
    ])('still escapes %s', (_label, markdown) => {
      expect(roundtrip(markdown)).toBe(markdown);
    });

    it('leaves every backtick escape where turndown put it', () => {
      // The recorded R-C2 exception. A run in running text keeps its backslash
      // even when nothing in the document could close it: `escape` sees one
      // text node, pairing is a property of the block, and a narrowing that
      // guessed here swallowed a `<strong>` between two runs (measured on #96).
      // A bare run in the source gains a backslash, and then holds still.
      expect(roundtrip('A ``` in running text.')).toBe('A \\`\\`\\` in running text.');
      expect(roundtrip('one ` backtick')).toBe('one \\` backtick');
      // A run already escaped stays escaped — including on both sides of an
      // element, which is the case the removed narrowing broke.
      expect(roundtrip('a \\` b **x** c \\` d')).toBe('a \\` b **x** c \\` d');
    });

    it('does not preserve a redundant escape the source already had', () => {
      // Also recorded in R-C2, and unavoidable: `marked` consumes the
      // backslash, so by serialization time nothing knows the source had one.
      // The file changes once and then holds still — the second pass moves
      // nothing further, which is the half that makes it acceptable.
      const once = roundtrip('the foo\\_bar name');
      expect(once).toBe('the foo_bar name');
      expect(roundtrip(once)).toBe(once);
    });

    it('never reaches inline code or a fenced block', () => {
      // Not a special case in `escape.ts`: turndown calls `escape` at exactly
      // one site, `node.isCode ? node.nodeValue : self.escape(...)`, so code
      // never arrives there at all. Pinned rather than left to inference.
      expect(roundtrip('use `snake_case` here')).toBe('use `snake_case` here');
      expect(roundtrip('```js\nconst a_b = 1;\n```')).toBe('```js\nconst a_b = 1;\n```');
    });
  });

  describe('a number that opens a heading or a cell is not escaped (#97)', () => {
    // The pair-level half of #97; the editor-level pins and the two whole
    // documents live in `src/editor/numbered-heading.test.ts`.
    //
    // Turndown escapes a text node that begins with digits and a full stop, so
    // on `0ec52ed` every numbered heading in `REQUIREMENTS.md` came back as
    // `## 1\. Product statement` — a backslash nobody typed, on every save.
    //
    // The escape is withheld in exactly the contexts where a list cannot
    // begin. Measured with `parse.ts`'s options on `marked@15`: `# 1. Intro`
    // and `| 1. x |` parse identically with and without it, while
    // `1990. It was a good year.` does not — see the floor below.
    it.each([
      ['a numbered H1', '# 1. Intro'],
      ['a numbered H2', '## 1. Product statement'],
      ['a numbered H3', '### 1. Deeper'],
      ['the deepest heading', '###### 1. Deep'],
      ['a heading whose number is large enough to be a list start', '## 1990. A year.'],
      ['a heading with an element after the number', '## 1. **Bold** thing'],
    ])('writes %s without a backslash', (_label, markdown) => {
      expect(roundtrip(markdown)).toBe(markdown);
    });

    it('writes a numbered table cell without a backslash', () => {
      // A GFM cell holds inline content only, so nothing in one can open a
      // list. Since #93 the widths are the file's own, so this asserts the
      // cells rather than the geometry.
      const out = roundtrip('| 1. x | y |\n| --- | --- |\n| 2. a | b |');
      expect(out).toContain('| 1. x |');
      expect(out).toContain('| 2. a |');
      expect(out).not.toContain('\\.');
    });

    // The floor. Each of these was already correct on `0ec52ed` and must stay
    // correct: a paragraph, a blockquote body and a list-item body all host
    // block content, so withholding the backslash there would turn a sentence
    // into an ordered list — a visible loss where the heading case is bytes.
    //
    // Each source below is the *escaped* spelling, because that is the only
    // way to write these sentences: `1990. It was a good year.` unescaped is
    // an ordered list starting at 1990, which is the whole point.
    it.each([
      ['a paragraph opening with a year', '1990\\. It was a good year.'],
      ['a paragraph opening with a small number', '1\\. It was a good year.'],
      ['a blockquote opening with a year', '> 1990\\. A year.'],
      ['a list item whose body opens with a year', '- 1990\\. A year.'],
    ])('still escapes %s', (_label, markdown) => {
      expect(roundtrip(markdown)).toBe(markdown);
    });

    it.each([
      ['a paragraph', '1990\\. It was a good year.'],
      ['a blockquote body', '> 1990\\. A year.'],
      ['a list item body', '- 1990\\. A year.'],
    ])('keeps %s out of an ordered list when it is read back', (_label, markdown) => {
      // The half that matters more than the bytes: the escape survives the
      // save, and re-reading what was written gives the same block back
      // instead of `<ol start="1990">`.
      const saved = roundtrip(markdown);
      expect(saved).toBe(markdown);
      expect(markdownToHtml(saved)).not.toContain('<ol');
    });

    it('still writes a real ordered list as an ordered list', () => {
      expect(roundtrip('1. first\n2. second')).toBe('1. first\n2. second');
      expect(roundtrip('3. third\n4. fourth')).toBe('3. third\n4. fourth');
    });

    it('does not preserve a redundant escape a numbered heading had', () => {
      // The same shape as the intraword underscore above, and recorded in R-C2
      // beside it: `marked` consumes the backslash on the way in, so nothing
      // at serialization time knows the source had one. The file changes once
      // and then holds still.
      const once = roundtrip('## 1\\. Product statement');
      expect(once).toBe('## 1. Product statement');
      expect(roundtrip(once)).toBe(once);
    });

    // ── The recorded R-C2 exception: a number that opens an inline element ──
    //
    // Deliberately not covered, and the scope is wider than links: **any**
    // leading inline element, in a heading and in a cell alike. The escape is
    // withheld at the *start* of the content, which is where turndown's rule
    // puts it; a number that opens an inline element sits further in.
    // Reaching it would mean rewriting `N\.` anywhere in the assembled
    // string, which would corrupt the one place those two characters are the
    // user's own — inside a code span. Rendering is identical, and the file
    // holds still after the first save.
    it.each([
      ['a link opening a heading', '## [1. x](https://e.com) y', '## [1\\. x](https://e.com) y'],
      ['emphasis opening a heading', '## *1. x* y', '## *1\\. x* y'],
      ['strong opening a heading', '## **1. x** y', '## **1\\. x** y'],
    ])('KNOWN EXCEPTION: %s keeps its backslash', (_label, md, expected) => {
      const once = roundtrip(md);
      expect(once).toBe(expected);
      expect(roundtrip(once)).toBe(once);
    });

    it.each([
      ['a link opening a cell', '| [1. x](https://e.com) | y |', '| [1\\. x](https://e.com) |'],
      ['strong opening a cell', '| **1. x** | y |', '| **1\\. x** |'],
    ])('KNOWN EXCEPTION: %s keeps its backslash', (_label, cellRow, expectedCell) => {
      const md = `${cellRow}\n| --- | --- |\n| a | b |`;
      const once = roundtrip(md);
      expect(once).toContain(expectedCell);
      expect(roundtrip(once)).toBe(once);
    });

    // ── Anchored to the node, not to the top-level block ──
    //
    // Where a reader fears the fix reached too far. A heading nested inside
    // another block is still a heading, and the two shapes turndown never
    // hands to `escape` are untouched by the helper.
    it.each([
      ['a heading inside a blockquote', '> ## 1. x'],
      ['a heading inside a list item', '- ## 1. x'],
      ['a literal backslash the user typed', '## 1\\\\. x'],
      ['a code span opening a heading', '## `1. x` y'],
    ])('leaves %s exactly as the file had it', (_label, markdown) => {
      const once = roundtrip(markdown);
      expect(once).toBe(markdown);
      expect(roundtrip(once)).toBe(once);
      expect(markdownToHtml(once)).not.toContain('<ol');
    });
  });

  describe('strikethrough is byte-identical', () => {
    const identical: Array<[string, string]> = [
      ['a whole line', '~~gone~~'],
      ['a word inside a sentence', 'a ~~b~~ c'],
      ['more than one word', '~~two words~~'],
      ['strike inside bold', '**~~x~~**'],
      ['strike inside italics', '*~~x~~*'],
      ['bold inside strike', '~~**x**~~'],
      ['inline code inside strike', '~~a `code` b~~'],
      ['a link inside strike', '~~[t](https://example.com)~~'],
      ['strike inside a link', '[~~t~~](https://example.com)'],
    ];
    for (const [name, md] of identical) {
      it(`preserves ${name}`, () => {
        expect(roundtrip(md)).toBe(md);
      });
    }

    it('leaves tildes inside inline code alone', () => {
      expect(roundtrip('`~~a~~`')).toBe('`~~a~~`');
    });

    it('KNOWN EXCEPTION: single-tilde strikethrough is written with two', () => {
      // `marked` (gfm) parses `~gone~` into the same <del> as `~~gone~~`, and
      // the mark carries no memory of which delimiter the file used — so the
      // serializer has nothing to write it back with but the two-tilde
      // spelling. Same rendering everywhere, different bytes. Recorded in
      // REQUIREMENTS under R-C2; keeping the single tilde would mean carrying
      // the delimiter on the mark, which is a larger change than #85.
      expect(roundtrip('~gone~')).toBe('~~gone~~');
      expect(roundtrip('a ~b~ c')).toBe('a ~~b~~ c');
    });

    it('never writes an empty pair of delimiters', () => {
      // Turndown's own blank replacement answers '' for an inline element
      // with no content, so `~~~~` — which markdown reads as a tilde fence,
      // not as an empty strike — can never come out of this rule.
      expect(htmlToMarkdown('<p><s></s></p>').trim()).toBe('');
      expect(htmlToMarkdown('<p>a<s></s>b</p>').trim()).toBe('ab');
      // Whitespace-only content: turndown moves flanking whitespace outside
      // the delimiters, so no `~~ ~~` is written either.
      expect(htmlToMarkdown('<p>a<s> </s>b</p>').trim()).toBe('a b');
    });

    it('serializes every spelling the parser and the editor produce', () => {
      // <del> comes from `marked`, <s> from TipTap's Strike, <strike> is the
      // legacy spelling Strike's own parseHTML also accepts.
      expect(htmlToMarkdown('<p><del>x</del></p>').trim()).toBe('~~x~~');
      expect(htmlToMarkdown('<p><s>x</s></p>').trim()).toBe('~~x~~');
      expect(htmlToMarkdown('<p><strike>x</strike></p>').trim()).toBe('~~x~~');
    });
  });

  it('preserves GFM table with header and rows', () => {
    const md = '| Name | Age |\n| --- | --- |\n| Ada  | 30  |';
    const out = roundtrip(md);
    // Header row
    expect(out).toMatch(/\|\s*Name\s*\|\s*Age\s*\|/);
    // Separator
    expect(out).toMatch(/\|\s*-+\s*\|\s*-+\s*\|/);
    // Data row
    expect(out).toMatch(/\|\s*Ada\s*\|\s*30\s*\|/);
  });

  describe('a table is written the way the file wrote it (#93)', () => {
    // The pair-level half of #93; the editor-level pins and the real
    // documents live in `src/editor/table-style.test.ts`.
    //
    // AgentEd used to pad every cell of every table to a uniform width: 628
    // of the 630 bytes by which an untouched save grew `README.md` on
    // `087e232`, and every one of the 488 by which it grew `WORKFLOW.md`.
    // Minimal cells everywhere would have moved the same exception onto
    // every hand-aligned file, so what is written now is what the file used.
    it.each([
      ['hugged cells', '| a | b |\n| --- | --- |\n| 1 | 2 |'],
      [
        'a tight separator with fitted dashes',
        '| Shortcut | Action |\n|----------|--------|\n| `x` | y |',
      ],
      ['columns aligned to their content', '| a   | bb  |\n| --- | --- |\n| ccc | d   |'],
      [
        'columns padded wider than the content needs',
        '| a      | b      |\n| ------ | ------ |\n| c      | d      |',
      ],
      ['a separator wider than three dashes', '| a | b |\n| ----- | ------- |\n| 1 | 2 |'],
      ['alignment markers', '| a | b |\n| :-- | --: |\n| 1 | 2 |'],
      [
        'the shorter spelling of an empty cell',
        '| | Does |\n| --- | --- |\n| **Owner** | Decides |',
      ],
      ['the longer spelling of an empty cell', '| Step | Owner |\n| --- | --- |\n|  |  |'],
      ['a one-row table', '| a | b |\n| --- | --- |'],
      [
        'two tables spelled differently',
        '| a | b |\n| --- | --- |\n| 1 | 2 |\n\ntext\n\n| c   | d   |\n|-----|-----|\n| eee | fff |',
      ],
    ])('leaves %s byte-identical', (_label, markdown) => {
      expect(roundtrip(markdown)).toBe(markdown);
    });

    it('leaves a table inside a fenced block alone', () => {
      const md = '```\n| a | b |\n| --- | --- |\n```';
      expect(roundtrip(md)).toBe(md);
    });

    it('writes a table that has no spelling of its own with hugged cells', () => {
      // What `htmlToMarkdown` does with a table that never came from
      // markdown — the default, and the one case the owner decided:
      // hugged cells and a spaced three-dash separator (2026-08-24).
      const html =
        '<table><tbody><tr><th>Name</th><th>Age</th></tr><tr><td>Ada</td><td>30</td></tr></tbody></table>';
      expect(htmlToMarkdown(html).trim()).toBe('| Name | Age |\n| --- | --- |\n| Ada | 30 |');
    });

    // The residue, measured rather than predicted, and recorded in R-C2.
    it('KNOWN EXCEPTION: a table without outer pipes gains them', () => {
      // The cells keep their spelling; only the outer pipes are new. 8 of the
      // 772 files with tables in the corpus write a table this way.
      const once = roundtrip('a | b\n--- | ---\n1 | 2');
      expect(once).toBe('| a | b |\n|---|---|\n| 1 | 2 |');
      expect(roundtrip(once)).toBe(once);
    });

    it('KNOWN EXCEPTION: an indented table is written at the margin', () => {
      const once = roundtrip('  | a | b |\n  | --- | --- |\n  | 1 | 2 |');
      expect(once).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |');
      expect(roundtrip(once)).toBe(once);
    });

    it('KNOWN EXCEPTION: cells written with no spaces at all get one', () => {
      const once = roundtrip('|a|b|\n|---|---|\n|1|2|');
      expect(once).toBe('| a | b |\n|---|---|\n| 1 | 2 |');
      expect(roundtrip(once)).toBe(once);
    });

    it('KNOWN EXCEPTION: a column whose rows disagree is hugged', () => {
      // A file aligned by hand and then edited elsewhere without
      // re-aligning. It changes once — and then holds still, which is the
      // half that makes it an exception rather than a defect.
      const once = roundtrip('| a   | b   |\n| --- | --- |\n| c | d |');
      expect(once).toBe('| a | b |\n| --- | --- |\n| c | d |');
      expect(roundtrip(once)).toBe(once);
    });
  });
});
