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
