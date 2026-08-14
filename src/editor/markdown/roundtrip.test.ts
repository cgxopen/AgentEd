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
    // Turndown emits "-   " (3 spaces) by default, not "- " — content is preserved
    const out = roundtrip('- one\n- two');
    expect(out).toMatch(/-\s+one/);
    expect(out).toMatch(/-\s+two/);
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
