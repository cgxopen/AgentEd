import { describe, expect, it } from 'vitest';
import { isSingleUrl, normalizeLinkUrl } from './link-url';

describe('normalizeLinkUrl — what the dialog accepts', () => {
  it.each([
    ['https://example.com', 'https://example.com'],
    ['http://example.com/path?q=1#top', 'http://example.com/path?q=1#top'],
    ['mailto:hi@example.com', 'mailto:hi@example.com'],
  ])('keeps %s as written', (input, expected) => {
    expect(normalizeLinkUrl(input)).toBe(expected);
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeLinkUrl('  https://example.com  ')).toBe('https://example.com');
  });

  it.each([
    ['example.com', 'https://example.com'],
    ['sub.example.co.uk/docs', 'https://sub.example.co.uk/docs'],
  ])('gives a bare host the implied https:// (%s)', (input, expected) => {
    expect(normalizeLinkUrl(input)).toBe(expected);
  });

  it.each([
    ['an empty field', ''],
    ['whitespace only', '   '],
    ['a sentence', 'see example.com for details'],
    ['a word that is not a host', 'notahost'],
    ['a path', '/local/file.md'],
  ])('refuses %s', (_label, input) => {
    expect(normalizeLinkUrl(input)).toBeNull();
  });

  // The href reaches the document without passing the parser's sanitizer, so
  // the allow-list is the only thing standing between a typo-shaped paste and
  // a script URL.
  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'file:///etc/passwd',
    'vbscript:msgbox(1)',
  ])('refuses the %s scheme rather than coercing it', (input) => {
    expect(normalizeLinkUrl(input)).toBeNull();
  });
});

describe('isSingleUrl — what turns a selection into a link', () => {
  it.each([
    'https://example.com',
    'http://example.com/a/b',
    'mailto:hi@example.com',
  ])('accepts the lone URL %s', (input) => {
    expect(isSingleUrl(input)).toBe(true);
  });

  it('accepts a URL padded with whitespace, as a clipboard often is', () => {
    expect(isSingleUrl('\n https://example.com \n')).toBe(true);
  });

  // Stricter than the dialog on purpose: this path guesses at intent, and a
  // wrong guess turns an ordinary paste into a mangled link.
  it.each([
    ['a paragraph that merely contains a URL', 'read https://example.com now'],
    ['two URLs', 'https://a.example https://b.example'],
    ['a bare host with no scheme', 'example.com'],
    ['plain prose', 'the docs'],
    ['nothing', ''],
    ['a script URL', 'javascript:alert(1)'],
  ])('refuses %s', (_label, input) => {
    expect(isSingleUrl(input)).toBe(false);
  });
});
