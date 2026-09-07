/**
 * The bytes half of #245: what is recognised as a comment, what the attribute
 * carries, and what it refuses.
 *
 * The editor-level behaviour — the mark, the caret, what the file gets back —
 * is next door in `../comment-round-trip.test.ts` and in the round-trip table.
 * This file is about the four functions.
 */
import DOMPurify from 'dompurify';
import { describe, expect, it } from 'vitest';
import {
  commentCarrier,
  decodeComment,
  encodeComment,
  isSingleComment,
  MARKDOWN_COMMENT_ATTRIBUTE,
} from './comment-spelling';

describe('isSingleComment', () => {
  it.each([
    ['a plain comment', '<!-- a note -->'],
    ['no inner spaces', '<!--x-->'],
    ['empty', '<!---->'],
    ['multi-line', '<!--\na\nb\n-->'],
    ['holding a tag', '<!-- <b>x</b> -->'],
    ['holding a single dash', '<!-- a - b -->'],
  ])('accepts %s', (_label, text) => {
    expect(isSingleComment(text)).toBe(true);
  });

  it.each([
    ['plain text', 'a note'],
    ['an unclosed comment', '<!-- a note'],
    ['a comment with a tail', '<!-- a --> tail'],
    ['a comment with a head', 'head <!-- a -->'],
    ['two comments', '<!-- a --><!-- b -->'],
    ['an element holding one', '<div><!-- a --></div>'],
    ['a bare element', '<div></div>'],
    ['the delimiters alone', '<!---'],
  ])('refuses %s', (_label, text) => {
    expect(isSingleComment(text)).toBe(false);
  });
});

describe('the bytes travel in a form that cannot carry markup', () => {
  it.each([
    ['a plain note', '<!-- a note -->'],
    ['a note holding a tag', '<!-- <script>alert(1)</script> -->'],
    ['a note holding a quote', '<!-- say "hi" -->'],
    ['a note holding an ampersand', '<!-- a & b -->'],
    ['a note built to end an attribute', '<!-- "><img onerror=alert(1)> -->'],
    ['a multi-line note', '<!--\n## heading\n\n- a\n-->'],
  ])('%s survives the round trip and holds no markup character', (_label, raw) => {
    const encoded = encodeComment(raw);
    // The property, not a list of characters that happen to be absent today:
    // `encodeURIComponent` yields only letters, digits, `-_.!~*'()` and
    // percent escapes, so none of these can appear in the value at all.
    expect(encoded).not.toMatch(/[<>&"]/);
    expect(decodeComment(encoded)).toBe(raw);
  });
});

describe('decodeComment refuses anything it did not write', () => {
  it.each([
    ['nothing', null],
    ['an empty value', ''],
    ['a malformed percent escape', '%E0%A4%A'],
    ['plain text', encodeComment('not a comment')],
    ['an element', encodeComment('<div></div>')],
    ['a comment with a tail', encodeComment('<!-- a --> tail')],
  ])('%s decodes to null', (_label, value) => {
    expect(decodeComment(value)).toBeNull();
  });
});

describe('commentCarrier', () => {
  it('carries a block comment on a div', () => {
    expect(commentCarrier('<!-- a -->', true)).toBe(
      `<div ${MARKDOWN_COMMENT_ATTRIBUTE}="${encodeComment('<!-- a -->')}"></div>`,
    );
  });

  it('carries an inline comment on a void wbr', () => {
    // Void, so no closing tag — and that is the point of the tag choice, not a
    // detail of it: turndown collapses the whitespace around an empty inline
    // element, and a void one it leaves alone. See the module note.
    expect(commentCarrier('<!-- a -->', false)).toBe(
      `<wbr ${MARKDOWN_COMMENT_ATTRIBUTE}="${encodeComment('<!-- a -->')}">`,
    );
  });

  it('drops the blank line a block token carries after the comment', () => {
    // `marked` hands a block comment between two paragraphs its trailing blank
    // line inside `raw`; the bytes of the comment are what rides on the node.
    expect(commentCarrier('<!-- a -->\n\n', true)).toBe(
      `<div ${MARKDOWN_COMMENT_ATTRIBUTE}="${encodeComment('<!-- a -->')}"></div>`,
    );
  });

  it('leaves every other kind of raw HTML alone', () => {
    for (const text of ['<div><!-- a --></div>', '<img src="a.png">', '<!-- a --> tail', '<br>']) {
      expect(commentCarrier(text, true)).toBeNull();
    }
  });

  it('does not trim an inline token, whose whitespace belongs to the sentence', () => {
    // A trailing space beside an inline comment is a space in the paragraph,
    // not part of the token to be tidied, so the token is not one comment and
    // nothing is stamped.
    expect(commentCarrier('<!-- a --> ', false)).toBeNull();
  });
});

describe('the sanitizer default the carrier depends on', () => {
  /**
   * The carrier is only useful because DOMPurify keeps it. It is **not** in
   * the `ADD_ATTR` list in `parse.ts`, and that is measured rather than
   * assumed: `ALLOW_DATA_ATTR` defaults to true, so every `data-*` attribute
   * survives on its own — which also means the five `data-` entries already in
   * that list are inert.
   *
   * Pinned here so a release that changes the default fails in this file,
   * naming its cause, rather than in a user document.
   */
  it('keeps a data attribute with no configuration at all', () => {
    expect(DOMPurify.sanitize('<div data-comment="x"></div>')).toBe('<div data-comment="x"></div>');
  });

  it('and still refuses what it always refused', () => {
    // The other side, so the pair cannot both be satisfied by a sanitizer that
    // keeps everything.
    expect(DOMPurify.sanitize('<div onclick="evil()"></div>')).toBe('<div></div>');
  });

  it('removes a comment node, which is the whole reason the carrier exists', () => {
    expect(DOMPurify.sanitize('<!-- a note -->')).toBe('');
  });
});
