import { beforeEach, describe, expect, it } from 'vitest';
import { createEditor, type EditorInstance } from '../setup';
import { resolveDefinitionPositions } from './escape';
import { markdownToHtml } from './parse';
import { htmlToMarkdown } from './serialize';

/**
 * Issue #409, the repair carried from #418 — a reference stays a reference
 * after bold, in a heading and in a table cell.
 *
 * **What it was, measured on `37d4c07`**: `opensADefinition` read offset 0 of
 * a text node as the start of a line, and after an inline element a text node
 * still begins at offset 0. So `**Note**[^1]: see below`, with `[^1]` defined,
 * was written back `**Note**\[^1\]: see below`, and the same for italic, a
 * code span, a heading and a table cell.
 *
 * **It is the construct rather than the bytes**, which is what R-C2 has asked
 * about since #300, and it was measured at the renderer rather than argued:
 * through `gh api markdown` in gfm mode, the unescaped spelling renders as a
 * footnote reference with the footnote section under it, and the escaped one
 * as literal text with **no section at all** — the definition then being
 * referred to by nothing.
 *
 * ── Why the answer is not in the escape ──
 *
 * The two documents hand the escape the identical string. Measured: both
 * `**Note**[^1]: see below` and `[^1]: see below` produce a text node reading
 * `[^1]: see below`, the first inside a `<strong>`'s paragraph and the second
 * alone — so from one text node the question cannot be answered, which is the
 * vantage-point constraint R-C2 already records for this file.
 *
 * So the escape **marks** the candidate and `htmlToMarkdown` answers it where
 * the line is assembled. That is not the pass the `N.` note in `serialize.ts`
 * argues against: this one never scans the document for anything, it visits
 * the positions the escape wrote a mark at, so a `[^a]:` inside a fenced
 * block or inside kept HTML is not even looked at.
 */

let instance: EditorInstance | null = null;

beforeEach(() => {
  instance?.destroy?.();
  instance = null;
});

/** The parse-serialize pair, with no editor between them. */
function atThePair(markdown: string): string {
  return htmlToMarkdown(markdownToHtml(markdown));
}

/** `createEditor` + `setMarkdown` + `getMarkdown`, as a save assembles it. */
function atTheEditor(markdown: string): string {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = createEditor(host);
  instance = editor;
  editor.setMarkdown(markdown);
  return editor.getMarkdown();
}

/** Both levels, since the #404 spike found one case that disagreed. */
function survives(markdown: string): void {
  expect(atThePair(markdown).trim()).toBe(markdown.trim());
  expect(atTheEditor(markdown).trim()).toBe(markdown.trim());
}

describe('a reference that follows something on its line stays a reference (#409)', () => {
  it('after bold — before: **Note**\\[^1\\]: see below', () => {
    survives('**Note**[^1]: see below\n\n[^1]: the note');
  });

  it('after italic', () => {
    survives('*Note*[^1]: see below\n\n[^1]: the note');
  });

  it('after a code span', () => {
    survives('`Note`[^1]: see below\n\n[^1]: the note');
  });

  it('after a link', () => {
    survives('[docs](https://example.com)[^1]: see below\n\n[^1]: the note');
  });

  it('in a heading — a heading cannot hold a definition, so nothing is escaped', () => {
    survives('# [^a]: note\n');
  });

  it('in a table cell — the same, and for the same reason', () => {
    survives('| a |\n| --- |\n| [^a]: note |\n');
  });

  it('and the ordinary case is untouched: plain text before it', () => {
    survives('Note[^1]: see below\n\n[^1]: the note');
  });
});

describe('a line that really would open a definition is still escaped (#418, kept)', () => {
  it('an escaped line under a paragraph stays escaped text', () => {
    survives('Text.\n\n\\[^a\\]: the note');
  });

  it('and reopens as the paragraph it was, not as a definition', () => {
    const html = markdownToHtml(atTheEditor('Text.\n\n\\[^a\\]: the note'));

    expect(html).not.toContain('data-footnote-definition');
  });

  it('text typed into a list item that looks like a definition keeps its backslashes', () => {
    // A definition-looking line **is** read back as a definition inside a list
    // item and inside a blockquote — measured — so the escape is load-bearing
    // there, and the prefix the container writes is what the resolver allows
    // in front of the mark.
    const editor = createEditor(document.body.appendChild(document.createElement('div')));
    instance = editor;
    editor.setMarkdown('- item\n');
    editor.editor.commands.setTextSelection({ from: 1, to: 7 });
    editor.editor.commands.insertContent('[^a]: note');

    expect(editor.getMarkdown()).toBe('- \\[^a\\]: note');
  });
});

describe('the resolver answers only at the marks the escape wrote (#409)', () => {
  it('leaves a document carrying no mark exactly as it is', () => {
    const text = 'One.\n\n[^a]: note\n';

    expect(resolveDefinitionPositions(text)).toBe(text);
  });

  it('never lets a mark travel into a file', () => {
    // The sentinel is this module's own character; whatever the loop does not
    // reach is swept rather than written out.
    const marked = `[^a]: note\ntail  with no reference behind it`;

    expect(resolveDefinitionPositions(marked)).toBe(
      '\\[^a\\]: note\ntail  with no reference behind it',
    );
  });

  it('escapes at a line start and lets the same reference through mid-line', () => {
    expect(resolveDefinitionPositions('[^1]: x')).toBe('\\[^1\\]: x');
    expect(resolveDefinitionPositions('Note[^1]: x')).toBe('Note[^1]: x');
  });

  it('counts a list marker and a quote marker as the start of the line', () => {
    expect(resolveDefinitionPositions('- [^1]: x')).toBe('- \\[^1\\]: x');
    expect(resolveDefinitionPositions('> [^1]: x')).toBe('> \\[^1\\]: x');
    expect(resolveDefinitionPositions('1. [^1]: x')).toBe('1. \\[^1\\]: x');
  });

  it('does not count a heading marker or a table pipe as one', () => {
    expect(resolveDefinitionPositions('# [^1]: x')).toBe('# [^1]: x');
    expect(resolveDefinitionPositions('| [^1]: x |')).toBe('| [^1]: x |');
  });
});
