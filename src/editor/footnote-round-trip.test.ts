import { beforeEach, describe, expect, it } from 'vitest';
import { createEditor, type EditorInstance } from './setup';

/**
 * Issue #408 — a document holding footnotes opens and saves byte-identically.
 *
 * **At the editor level, and that is the point of the file.** On the #404
 * spike 16 of 17 cases agreed between the parse-serialize pair and the editor
 * and the seventeenth was lost only at the editor, so a row that passes at the
 * pair level and fails here is a failure. Everything below goes through
 * `createEditor` + `setMarkdown` + `getMarkdown`.
 *
 * **The before for every row was measured on `651bb40`** and is written beside
 * it, because what this repairs is damage rather than an absence: a definition
 * whose body parsed as a destination came back as a working link to a place
 * the file never linked to, and one whose body did not came back escaped.
 */

let host: HTMLElement;
let editor: EditorInstance | null = null;

beforeEach(() => {
  editor?.destroy?.();
  host = document.createElement('div');
  document.body.appendChild(host);
});

function openAndSave(markdown: string): string {
  const instance = createEditor(host);
  editor = instance;
  instance.setMarkdown(markdown);
  return instance.getMarkdown().trim();
}

/** Open, save, and save what came back: the #96 property, for every row. */
function survives(markdown: string): void {
  const once = openAndSave(markdown);
  expect(once).toBe(markdown);
  const twice = openAndSave(once);
  expect(twice).toBe(once);
}

describe('a footnote comes back as the file wrote it (#408)', () => {
  it('a definition whose body is a URL — before: [^a](https://example.com/schema)', () => {
    survives('Text.[^a]\n\n[^a]: https://example.com/schema');
  });

  it('a definition of one word — before: [^a](documentation)', () => {
    survives('Text.[^a]\n\n[^a]: documentation');
  });

  it('a definition of several words — before: both lines escaped', () => {
    survives('Text.[^a]\n\n[^a]: the schema documentation lives here');
  });

  it('a definition continued on an indented line — before: joined into one line', () => {
    survives('Text.[^a]\n\n[^a]: first line\n    second line');
  });

  it('two definitions on consecutive lines stay two lines — before: one line', () => {
    // The class the owner found, on the real OKF shape. It was hiding inside
    // the recorded soft-break exception, which the same pull request narrows:
    // two definitions are not one paragraph of prose.
    survives(
      'Text.[^margin-standard][^revenue-policy]\n\n' +
        '[^margin-standard]: Cost Allocation & Margin Standard (FY2026)\n' +
        '[^revenue-policy]: Revenue Recognition Policy (FY2026)',
    );
  });

  it('the label is kept as written and never renumbered', () => {
    survives('Text.[^margin-standard]\n\n[^margin-standard]: the standard');
  });

  it('the definition stays where the file put it, middle of the document included', () => {
    survives('One.[^a]\n\n[^a]: the note\n\nTwo, after the definition.');
  });

  it('a reference in a list item', () => {
    survives('- Item.[^a]\n\n[^a]: the note');
  });

  it('a reference in a table cell', () => {
    survives('| H |\n| --- |\n| Cell.[^a] |\n\n[^a]: the note');
  });

  it('a reference in a paragraph', () => {
    survives('A paragraph with a reference.[^a]\n\n[^a]: the note');
  });

  it('and all of it after one unrelated edit elsewhere', () => {
    const source = 'One.[^a]\n\n[^a]: the note\n\nTwo.';
    const instance = createEditor(host);
    editor = instance;
    instance.setMarkdown(source);
    instance.setMarkdown(instance.getMarkdown().trim().replace('Two.', 'Two, edited.'));
    expect(instance.getMarkdown().trim()).toBe('One.[^a]\n\n[^a]: the note\n\nTwo, edited.');
  });
});

describe('the shapes GitHub does not render as footnotes survive too (#408)', () => {
  // Measured through `gh api markdown` in gfm mode, and the point of these
  // rows is that the rendering does not decide the bytes: this issue is about
  // the file. Two of the four lose content today, which is more than the #404
  // summary recorded.

  it('a reference with no definition — GitHub draws literal text', () => {
    survives('Text.[^a] and nothing else.');
  });

  it('a definition nobody references — GitHub draws nothing at all', () => {
    survives('Plain text.\n\n[^a]: an orphan definition');
  });

  it('two definitions with the same label — before: the second was lost', () => {
    // Today this saves as `Text.[^a](first)`: the text of the second
    // definition leaves the file altogether. GitHub keeps the first and drops
    // the second when it renders, and the file keeps both either way.
    survives('Text.[^a]\n\n[^a]: first\n[^a]: second');
  });

  it('labels differing only in case — before: the second was lost', () => {
    // GitHub treats these as one footnote, because `marked` and GitHub both
    // lower-case the label. Today `lower` leaves the file.
    survives('Text.[^A] and [^a]\n\n[^A]: upper\n[^a]: lower');
  });
});

/**
 * Issue #418, point j — the gap between two definitions is the file's to
 * spell.
 *
 * **Measured on `297874c`, and what was lost was the distinction rather than a
 * blank line**: two definitions a blank line apart came back one newline
 * apart, three came back consecutive, and a run spelled both ways came back
 * uniform - levelled to the tighter spelling, so a file that used the gap to
 * group its notes lost the grouping entirely. The second save was stable in
 * every case, so this was bytes rather than drift, and `gh api markdown` in
 * gfm mode renders both spellings alike.
 *
 * The repair reads the gap where it is still readable - `marked` hands a
 * definition its own trailing blank line in `raw` - and carries it on the node,
 * the way #408 already carries the continuation indents.
 */
describe('a run of definitions keeps the gaps the file spelled (#418, point j)', () => {
  it('two a blank line apart keep it — before: one newline apart', () => {
    survives('A.[^a] B.[^b]\n\n[^a]: one\n\n[^b]: two');
  });

  it('three a blank line apart keep all of them — before: all three consecutive', () => {
    survives('A.[^a] B.[^b] C.[^c]\n\n[^a]: one\n\n[^b]: two\n\n[^c]: three');
  });

  it('a run spelled both ways keeps both — before: levelled to consecutive', () => {
    // The row the whole point turns on. A file that separates its first note
    // and keeps the other two together said something, and before this the
    // saved file could no longer say it.
    survives('A.[^a] B.[^b] C.[^c]\n\n[^a]: one\n\n[^b]: two\n[^c]: three');
  });

  it('and the other order, so the rule is the gap rather than the position', () => {
    survives('A.[^a] B.[^b] C.[^c]\n\n[^a]: one\n[^b]: two\n\n[^c]: three');
  });

  it('two consecutive stay consecutive, which is the R-C17 row that already exists', () => {
    survives('A.[^a] B.[^b]\n\n[^a]: one\n[^b]: two');
  });

  it('a definition continued on an indented line, then a blank line', () => {
    // The continuation and the gap are two attributes on one node, and this is
    // the row that would fail if the gap were taken off the wrong end of the
    // bytes: the blank line would become an empty continuation line.
    survives('A.[^a] B.[^b]\n\n[^a]: one\n    more\n\n[^b]: two');
  });

  it('a blank line between the last definition and what follows it', () => {
    survives('A.[^a]\n\n[^a]: one\n\nAfter.');
  });
});

/**
 * **What this does not hold, measured rather than left to be discovered.**
 * Two or more blank lines between definitions come back as none, before this
 * change and after it. `marked` gives the definition a single trailing newline
 * in that case and puts the rest in a `space` token the renderer never sees,
 * so the count is not readable where the gap is read. It is an instance of a
 * wider difference this repository has not recorded - `A.`⏎⏎⏎`B.` comes back
 * `A.`⏎⏎`B.` for two ordinary paragraphs too - and it is reported on #418
 * rather than repaired here, because it is not about footnotes.
 */
describe('the run of blank lines is not counted (#418, point j)', () => {
  it('two blank lines between definitions come back as none, as they did before', () => {
    expect(openAndSave('A.[^a] B.[^b]\n\n[^a]: one\n\n\n[^b]: two')).toBe(
      'A.[^a] B.[^b]\n\n[^a]: one\n[^b]: two',
    );
  });
});

describe('what this change must not move (#408)', () => {
  /** What the shipped build wrote on `651bb40`, before any of this. */
  const TODAY: Record<string, [string, string]> = {
    'the inline form in a paragraph': [
      'A note^[inline text] here.',
      'A note^\\[inline text\\] here.',
    ],
    'the inline form in a list item': ['- Item^[inline text]', '- Item^\\[inline text\\]'],
    'the inline form holding a URL': [
      'See^[https://example.com/x] it.',
      'See^\\[https://example.com/x\\] it.',
    ],
    'a reference-style link': [
      'See [docs].\n\n[docs]: https://example.com/d',
      'See [docs](https://example.com/d).',
    ],
    'a reference-style link with a title': [
      'See [docs].\n\n[docs]: https://example.com/d "The docs"',
      'See [docs](https://example.com/d).',
    ],
    'a reference definition nobody uses': ['Plain.\n\n[docs]: https://example.com/d', 'Plain.'],
  };

  for (const [name, [source, today]] of Object.entries(TODAY)) {
    it(`${name} is written exactly as it is today`, () => {
      // Pinned rather than repaired. The owner put reference-style links in a
      // later stage and the inline form out of scope, so this change must not
      // move them in either direction — and the tokenizer sits beside the code
      // path that consumes them, which is why these rows are here at all.
      expect(openAndSave(source)).toBe(today);
    });
  }

  it('the inline form beside a bracket footnote: the inline half is untouched', () => {
    // The one row holding both constructs. The bracket half is repaired, which
    // is this issue; the inline half must read exactly as it does today.
    const saved = openAndSave('Both^[inline] and [^a].\n\n[^a]: bracket');
    expect(saved).toContain('^\\[inline\\]');
    expect(saved).toBe('Both^\\[inline\\] and [^a].\n\n[^a]: bracket');
  });
});
