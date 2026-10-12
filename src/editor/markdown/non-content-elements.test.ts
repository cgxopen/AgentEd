/**
 * Issue #311 — four elements whose text is not content used to arrive as
 * paragraphs.
 *
 * `<style>`, `<script>`, `<title>` and `<noscript>` are removed by DOMPurify,
 * and Turndown then kept the **text** they had held: a pasted stylesheet came
 * in as a paragraph of CSS, a pasted script as a paragraph of its own source.
 * Nothing ever executed — the source arrived as text, never as a script — so
 * what this is about is the artifact R-C13 forbids in as many words, *no
 * leftover markup*.
 *
 * **Found through Excel, and that is why it was worth fixing before the gate.**
 * Excel wraps its grid in a document whose `<style>` holds the Office
 * stylesheet inside an HTML comment, so **every** paste from a spreadsheet put
 * `mso-displayed-decimal-separator …` above the table. Measured by the owner on
 * Windows on 2026-09-17, against the same clipboard pasted into GitHub, which
 * shows none of it.
 *
 * **Two rows guard the address rather than the behaviour**, because the line
 * that does this sits in `htmlToMarkdown`, which is also the save path:
 *
 *   - a markdown file that holds those blocks raw **already loses them on the
 *     way in**, so the save path has nothing left to take — the row below
 *     measures that, and it is what makes this address cost no file anything;
 *   - a raw HTML table is written back as the file's own bytes (#283) and
 *     REQUIREMENTS says that includes *markup the editor does not show, such as
 *     a `<script>` that DOMPurify removes from the view*. Those bytes ride on an
 *     attribute and are written by the kept-table rule, which never walks the
 *     elements under it — asserted here rather than assumed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type EditorInstance } from '../setup';

vi.mock('../../ui/toast', () => ({ showToast: vi.fn() }));

const editors: EditorInstance[] = [];

function editorWith(markdown: string): EditorInstance {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const instance = createEditor(element);
  if (markdown.length > 0) instance.setMarkdown(markdown);
  editors.push(instance);
  return instance;
}

afterEach(() => {
  for (const instance of editors.splice(0)) instance.destroy();
  document.body.innerHTML = '';
});

/** A paste dispatched as a real `ClipboardEvent`, clipboard and all. */
function paste(instance: EditorInstance, text: string, html: string, forcePlain = false): void {
  if (forcePlain) {
    instance.editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'V',
        code: 'KeyV',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      }),
    );
  }
  const data = new DataTransfer();
  data.setData('text/html', html);
  data.setData('text/plain', text);
  instance.editor.view.dom.dispatchEvent(
    new ClipboardEvent('paste', {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    } as ClipboardEventInit),
  );
}

const saved = (instance: EditorInstance) => instance.getMarkdown().trim();

/** The four, each with the text it used to leave behind. */
const REMOVED = [
  ['style', '<style>.highlight { color: red }</style><p>after</p>', '.highlight'],
  ['script', '<script>alert(1)</script><p>after</p>', 'alert(1)'],
  ['title', '<title>Book One</title><p>after</p>', 'Book One'],
  ['noscript', '<noscript>No script here</noscript><p>after</p>', 'No script here'],
] as const;

/** Two that were already clean, so the removal is not widened past its reason. */
const ALREADY_CLEAN = [
  ['a template', '<template>hidden</template><p>after</p>', 'hidden'],
  ['an HTML comment', '<!-- a note --><p>after</p>', 'a note'],
] as const;

describe('an element whose text is not content leaves nothing behind (#311)', () => {
  it.each(REMOVED)('a pasted %s', (_name, html, leftover) => {
    const instance = editorWith('');
    paste(instance, 'after', html);

    expect(saved(instance)).toBe('after');
    expect(saved(instance)).not.toContain(leftover);
  });

  it.each(ALREADY_CLEAN)('%s was already clean and stays so', (_name, html, leftover) => {
    const instance = editorWith('');
    paste(instance, 'after', html);

    expect(saved(instance)).toBe('after');
    expect(saved(instance)).not.toContain(leftover);
  });
});

/**
 * The clipboard Excel puts down, as Excel writes it: a `<style>` holding the
 * Office stylesheet inside an HTML comment, then the grid.
 */
const EXCEL_HTML = [
  '<style>',
  '<!--table',
  '\t{mso-displayed-decimal-separator:"\\.";}',
  'td',
  '\t{padding-top:1px; color:black; font-size:11.0pt; mso-rotate:0;}',
  '-->',
  '</style>',
  '<table border=0 cellpadding=0 cellspacing=0>',
  ' <tr><td>Rezultate</td><td></td></tr>',
  ' <tr><td align=right>10</td><td align=right>20</td></tr>',
  ' <tr><td align=right>30</td><td align=right>40</td></tr>',
  '</table>',
].join('\n');
const EXCEL_TEXT = 'Rezultate\t\n10\t20\n30\t40';

describe('a paste from a spreadsheet arrives as the table alone (#311)', () => {
  it('into an empty document', () => {
    const instance = editorWith('');
    paste(instance, EXCEL_TEXT, EXCEL_HTML);

    const out = saved(instance);
    expect(out).not.toContain('mso-');
    expect(out).not.toContain('padding-top');
    expect(out.split('\n')[0]).toContain('Rezultate');
    expect(out).toContain('| 10 | 20 |');
    expect(out).toContain('| 30 | 40 |');
  });

  it('and Ctrl+Shift+V on the same clipboard still inserts the characters', () => {
    const instance = editorWith('');
    paste(instance, EXCEL_TEXT, EXCEL_HTML, true);

    const out = saved(instance);
    expect(out).not.toContain('mso-');
    expect(out).toContain('Rezultate');
    expect(out).toContain('10');
  });
});

describe('the address this was put at costs a file nothing (#311)', () => {
  /**
   * The measurement that chose `htmlToMarkdown` over the paste path. A file
   * holding the four blocks raw loses all four **on open**, before this
   * function is reached — so the line takes nothing a save would otherwise
   * have written, and adds no R-C2 exception.
   *
   * **The loss is now recorded rather than unapproved** (#343). It was an
   * undocumented exception to R-C2, which REQUIREMENTS calls a defect in its
   * own words; the owner chose on 2026-09-17 to write it down rather than
   * carry the bytes the way #283 carries a raw HTML table. R-C2 now holds the
   * Known exception, and this row is what it points at.
   *
   * **What it guards is the shape of the loss rather than a switch.** There is
   * no one-line reversal to build against it: telling DOMPurify to keep
   * `style`, `title` and `noscript` leaves the figures exactly where they are
   * and turns **no** test red, because the schema has no node for them and the
   * parser drops them a layer below the sanitizer. So this row reddens if the
   * blocks ever stop vanishing cleanly — if one leaves its text behind, as it
   * did before #311, if it takes a neighbouring word with it, or if the file
   * stops holding still — which is every direction the exception could quietly
   * change under.
   */
  /**
   * **Three of the four are text since #461**: `style`, `script` and `title`
   * are names of the GFM tag filter, so a block of each is shown as its text
   * and written back as its own bytes, as GitHub shows it. `noscript` is not
   * one of the nine, and is still lost exactly as #343 recorded.
   */
  it('a file holding the four blocks raw keeps three of them as text, and loses noscript', () => {
    const file = [
      '# Notes',
      '',
      '<style>',
      '.highlight { color: red }',
      '</style>',
      '',
      'Between the blocks.',
      '',
      '<script>',
      'alert(1)',
      '</script>',
      '',
      '<title>Book One</title>',
      '',
      '<noscript>No script here</noscript>',
      '',
      'The end.',
    ].join('\n');

    const instance = editorWith(file);
    const out = saved(instance);

    expect(out).not.toContain('No script here');
    expect(out).toBe(file.replace('<noscript>No script here</noscript>\n\n', ''));
  });

  /**
   * The reach the Known exception claims, which is the whole of it (#343).
   *
   * The bullet under R-C2 says each of the four, inline inside a paragraph, a
   * blockquote, a list item or a table cell, is removed with its text and the
   * words on either side close up. That is sixteen combinations and they are
   * driven here rather than reasoned about, because a sentence in REQUIREMENTS
   * is read as product truth and this one would otherwise rest on a
   * measurement nothing holds.
   */
  it.each([
    ['a paragraph', (block: string) => `before ${block} after`, 'before after'],
    ['a blockquote', (block: string) => `> before ${block} after`, '> before after'],
    ['a list item', (block: string) => `- before ${block} after`, '- before after'],
    [
      'a table cell',
      (block: string) => `| h |\n| --- |\n| before ${block} after |`,
      '| h |\n| --- |\n| before after |',
    ],
  ] as Array<[string, (block: string) => string, string]>)(
    'inline inside %s, noscript is removed and the words close up, and the three of the tag filter stay as text',
    (_host, wrap, expected) => {
      const noscript = editorWith(wrap('<noscript>fallback</noscript>'));
      const out = saved(noscript);
      expect(out).toBe(expected);
      expect(out).not.toContain('fallback');
      // Text since #461, written back with each `<` escaped since #565 (D1),
      // so a renderer with no tag filter reads the text too.
      for (const block of [
        '<style>.x{color:red}</style>',
        '<script>alert(1)</script>',
        '<title>Book One</title>',
      ]) {
        expect(saved(editorWith(wrap(block))), block).toBe(wrap(block.replace(/</g, '\\<')));
      }
    },
  );

  /**
   * The one place REQUIREMENTS says a `<script>` is deliberately carried: the
   * bytes of a raw HTML table (#283). They are written by the kept-table rule
   * from an attribute, so the removal above cannot reach them.
   */
  it('a raw HTML table carrying a script is written back byte for byte', () => {
    const file = [
      '# Kept',
      '',
      '<table>',
      '  <caption>Totals</caption>',
      '  <tr><th colspan="2">Head</th></tr>',
      '  <tr><td>a</td><td>b</td></tr>',
      '  <script>alert(9)</script>',
      '</table>',
      '',
      'After.',
    ].join('\n');

    const instance = editorWith(file);
    expect(saved(instance)).toBe(file);
  });
});
