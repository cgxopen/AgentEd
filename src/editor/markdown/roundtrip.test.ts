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

    it('KNOWN LIMITATION: a loose list is tightened', () => {
      // TipTap's schema wraps every list item body in a paragraph, so a
      // blank-line-separated list and an ordinary one reach the serializer
      // as the same HTML. Tight is the far commoner shape, so it wins; the
      // list's content is unaffected either way.
      expect(roundtrip('- one\n\n- two')).toBe('- one\n- two');
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
});
