import { afterEach, describe, expect, it } from 'vitest';
import { applyLineConventions, detectLineConventions } from '../formats/line-conventions';
import { markdownToHtml } from './markdown/parse';
import { htmlToMarkdown } from './markdown/serialize';
import { cleanPastedHtml } from './paste';
import { createEditor, type EditorInstance } from './setup';

/**
 * An unedited save writes no markup the file held as text (#565, owner
 * decisions D1 to D3 on #565).
 *
 * Measured on `01fdc49` at both levels: the serializer wrote an escaped `<`,
 * `&` and `!` bare, and the closing hashes of a heading as closing hashes, so
 * the next open read a tag, a character, an image, an email link or a shorter
 * heading where the file held text.
 */
const editors: EditorInstance[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = '';
});

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = createEditor(host);
  editor.setMarkdown(markdown);
  editors.push(editor);
  return editor;
}

/** Open `markdown`, change nothing, and return what a save writes. */
function saved(markdown: string): string {
  return applyLineConventions(editorWith(markdown).getMarkdown(), detectLineConventions(markdown));
}

/** What the person reads: the text of each block, joined. */
function text(markdown: string): string {
  const { doc } = editorWith(markdown).editor.state;
  return doc.textBetween(0, doc.content.size, '|');
}

describe('a < or a & that would open markup is written escaped (#565, D1)', () => {
  it.each([
    ['an escaped tag, CommonMark example 14', '\\<br/> not a tag\n'],
    ['an escaped entity', '\\&ouml; not a character entity\n'],
    ['an escaped image tag with a handler', 'x \\<img src=x onerror=alert(1)> y\n'],
    ['an escaped script, one of the nine', 'a \\<script>alert(1)\\</script> b\n'],
    ['an escaped closing tag', 'a \\</em> b\n'],
    ['an escaped comment', '\\<!-- not a comment -->\n'],
    ['an escaped autolink', 'see \\<http://x.y> here\n'],
    ['an escaped email autolink', 'mail \\<a@b.c> here\n'],
    ['a div opening a line', 'one\n\n\\<div\n\ntwo\n'],
    ['a comment opening a line, left open', 'one\n\n\\<!-- not a comment\n\ntwo\n\nthree\n'],
    ['a div after a soft break', 'line one\n\\<div\nline three\n'],
    ['text that opens no markup', 'a < b and c > d, R&D and AT&T\n'],
    ['a name that is no entity', '&MadeUpEntity; and &#87654321;\n'],
    ['a tag in a code span', 'code `<br>` here\n'],
    ['a tag in a table cell', '| a |\n| - |\n| \\<b>x |\n'],
  ])('keeps %s byte for byte', (_label, markdown) => {
    const once = saved(markdown);
    expect(once).toBe(markdown);
    expect(saved(once)).toBe(once);
  });

  it.each([
    // Respelled, the same text: an entity the file wrote becomes a backslash.
    ['Copyright &lt;nathan@tootallnate.net&gt;\n', 'Copyright \\<nathan@tootallnate.net>\n'],
    ['a &amp;copy; b\n', 'a \\&copy; b\n'],
    // A tag of the nine bare in prose gains a backslash once (#461).
    ['Use <title> as a placeholder\n', 'Use \\<title> as a placeholder\n'],
  ])('writes %j as the same text, escaped', (markdown, written) => {
    expect(saved(markdown)).toBe(written);
    expect(text(written)).toBe(text(markdown));
    expect(saved(written)).toBe(written);
  });

  it('reopens text typed with a tag and an entity as typed', () => {
    const typed = 'Fine <b>bold</b> text and &copy; and <title>';
    const editor = editorWith('X\n');
    editor.editor.commands.setContent(
      `<p>${typed.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`,
    );
    const written = editor.getMarkdown();
    expect(text(written)).toBe(typed);
  });

  it('writes a rich paste of a page text spelling a tag as text', () => {
    // The page shows the characters; its HTML holds them as entities.
    const markdown = htmlToMarkdown(cleanPastedHtml('<p>Use &lt;script&gt; as a word</p>'));
    expect(markdown).toBe('Use \\<script> as a word');
    expect(markdownToHtml(markdown)).not.toContain('<script');
  });
});

describe('the closing hashes of a heading, and a ! before a link (#565, D2 and D3)', () => {
  it.each([
    ['escaped closing hashes, example 76 alone', '### foo \\###\n'],
    ['one escaped closing hash', '# foo \\#\n'],
    ['a hash inside a word', '# C#\n'],
    ['an escaped ! before a link', '\\![foo](/url)\n'],
    ['an escaped ! before a kept link', '\\![x](irc://y)\n'],
    ['an escaped ! before a link with no text', 'x \\![](./t.md) y\n'],
    ['an escaped ! before a link in a table cell', '| a |\n| - |\n| \\![b](/c) |\n'],
    ['an escaped backslash before an image', '\\\\![b](/c)\n'],
    ['an image', '![img](/i.png)\n'],
  ])('keeps %s byte for byte', (_label, markdown) => {
    const once = saved(markdown);
    expect(once).toBe(markdown);
    expect(saved(once)).toBe(once);
  });

  it('makes no mark in a document that already holds the mark character', () => {
    // The step aside of #425: the character the person typed is kept, and the
    // ! keeps the loss it had before #565.
    expect(saved('text \uE013 and \\![b](/c)\n')).toBe('text \uE013 and ![b](/c)\n');
  });
});
