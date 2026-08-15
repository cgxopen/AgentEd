import { describe, expect, it } from 'vitest';
import { markdownToHtml } from './parse';
import { htmlToMarkdown } from './serialize';

/**
 * A URL written in running text stays text (R-C13, defect D2). GFM's bare-URL
 * autolinking would hand the serializer a link, which comes back written as
 * "[https://x](https://x)" — syntax the user never typed, added to the file
 * just because a URL was mentioned, and a break of the R-C2 round-trip.
 */
describe('bare URLs are not autolinked', () => {
  it('leaves a bare URL as text', () => {
    expect(markdownToHtml('https://example.com')).not.toContain('<a ');
  });

  it('leaves a URL inside a sentence as text', () => {
    expect(markdownToHtml('see https://example.com for details')).not.toContain('<a ');
  });

  it('leaves an email address as text', () => {
    expect(markdownToHtml('write to hi@example.com')).not.toContain('<a ');
  });

  it('round-trips a bare URL unchanged (R-C2)', () => {
    const md = 'see https://example.com for details';
    expect(htmlToMarkdown(markdownToHtml(md)).trim()).toBe(md);
  });

  it('round-trips a bare URL on its own line unchanged (R-C2)', () => {
    expect(htmlToMarkdown(markdownToHtml('https://example.com')).trim()).toBe(
      'https://example.com',
    );
  });

  it('still parses an explicit markdown link', () => {
    expect(markdownToHtml('[docs](https://example.com)')).toContain('href="https://example.com"');
  });

  it('still round-trips an explicit markdown link (R-C2)', () => {
    const md = '[docs](https://example.com)';
    expect(htmlToMarkdown(markdownToHtml(md)).trim()).toBe(md);
  });

  it('still parses an angle-bracket autolink', () => {
    expect(markdownToHtml('<https://example.com>')).toContain('href="https://example.com"');
  });
});
