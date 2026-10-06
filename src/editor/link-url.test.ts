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

  // Inverted from #40, which gave a bare host an implied `https://`. A host and
  // a neighbouring file cannot be told apart by shape — `.md` is a real TLD —
  // so that courtesy turned `README.md` into `https://README.md` silently, on
  // the most ordinary link a markdown editor writes. An address with no scheme
  // is now stored exactly as typed; whoever means the web types `https://`
  // (#42).
  it.each(['example.com', 'sub.example.co.uk/docs', 'README.md'])(
    'adds no scheme to %s',
    (input) => {
      expect(normalizeLinkUrl(input)).toBe(input);
    },
  );

  // Also inverted: `notahost` and `/local/file.md` were refused when the only
  // scheme-less address worth having was a host. They are relative paths, and
  // the dialog no longer judges whether a token looks like a file.
  it.each([
    ['an explicitly relative path', './notes.md'],
    ['a bare file name', 'notes.md'],
    ['a path with a directory', 'docs/guide.md'],
    ['a nested path', 'docs/ADR/ADR-001.md'],
    ['a parent path', '../a/b.md'],
    ['a root-relative path', '/local/file.md'],
    ['an anchor', '#section'],
    ['a path with a query', 'images/x.png?raw=1'],
    ['a word that is not a host', 'notahost'],
    ['a colon inside a file name', './notes:draft.md'],
  ])('stores %s exactly as typed', (_label, input) => {
    expect(normalizeLinkUrl(input)).toBe(input);
  });

  it.each([
    ['an empty field', ''],
    ['whitespace only', '   '],
    ['a sentence', 'see example.com for details'],
    ['a file name with a space', 'my notes.md'],
  ])('refuses %s', (_label, input) => {
    expect(normalizeLinkUrl(input)).toBeNull();
  });

  // An address that borrows the page's scheme has a scheme, and a Windows path
  // parses as one (`c:`). Both fall out of the URL classification rather than
  // being enumerated — the colon test they used to need would have refused
  // `./notes:draft.md` above with them.
  it.each([
    ['protocol-relative', '//evil.com'],
    ['a backslash pair, which the URL parser reads the same way', '\\\\evil.com'],
    ['a Windows path', 'C:\\notes\\x.md'],
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
  it.each(['https://example.com', 'http://example.com/a/b', 'mailto:hi@example.com'])(
    'accepts the lone URL %s',
    (input) => {
      expect(isSingleUrl(input)).toBe(true);
    },
  );

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
