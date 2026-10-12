import { afterEach, describe, expect, it } from 'vitest';
import { applyLineConventions, detectLineConventions } from '../formats/line-conventions';
import { markdownToHtml } from './markdown/parse';
import { htmlToMarkdown } from './markdown/serialize';
import { cleanPastedHtml } from './paste';
import { createEditor, type EditorInstance } from './setup';

/**
 * A link the editor does not make live is kept as the file wrote it (#564,
 * owner decisions D1 and D2 on #564).
 *
 * Measured on `0ccf572` at both levels: `[](./target.md)` was dropped whole by
 * the editor, `[link]()` and `[link](<>)` came back `link`, and a link or an
 * autolink of a scheme on no list, `irc:` among them, came back as its text,
 * its href gone at DOMPurify. Each is now kept as its bytes, and none of them
 * reaches the page as a link. See `markdown/kept-link.ts`.
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

/** Type `text` with the caret right after `after`. */
function typeAfter(editor: EditorInstance, after: string, text: string): void {
  let at = -1;
  editor.editor.state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text?.includes(after)) {
      at = pos + (node.text?.indexOf(after) ?? 0) + after.length;
    }
    return at === -1;
  });
  expect(at, `no text ${after}`).toBeGreaterThan(-1);
  editor.editor.view.dispatch(editor.editor.state.tr.insertText(text, at));
}

describe('a link the editor does not make live is written back as the file wrote it (#564)', () => {
  it.each([
    ['a link with no text, CommonMark example 484', '[](./target.md)\n'],
    ['a link with no text inside a sentence', 'see [](./target.md) here\n'],
    ['a link with neither, example 487', '[]()\n'],
    ['a link with no destination, example 485', '[link]()\n'],
    ['a link with an empty destination in brackets, example 486', '[link](<>)\n'],
    ['an autolink of irc, example 596', '<irc://foo.bar:2233/baz>\n'],
    ['an autolink of an unknown scheme, example 598', '<a+b+c:d>\n'],
    ['an autolink of a made-up scheme, example 599', '<made-up-scheme://foo,bar>\n'],
    ['an autolink of localhost, example 601', '<localhost:5001/foo>\n'],
    ['an inline link of irc', 'see [chat](irc://foo.bar/baz) here\n'],
    ['an inline link holding emphasis', '[*chat* now](irc://x.y)\n'],
    ['an inline link with an escape', '[a\\_b](irc://x)\n'],
    ['a rustdoc path', '[Cow](alloc::borrow::Cow)\n'],
    ['an autolink of git over https', '<git+https://github.com/a/b.git>\n'],
    ['a link of a scheme the sanitizer keeps and the link mark refuses', '[x](foo1:bar)\n'],
    ['a link in a table cell', '| a |\n| - |\n| [x](irc://y) |\n'],
  ])('keeps %s byte for byte', (_label, markdown) => {
    const once = saved(markdown);
    expect(once).toBe(markdown);
    expect(saved(once)).toBe(once);
  });

  it('writes the same at the pair level', () => {
    for (const markdown of ['[](./target.md)', '[link]()', '<irc://foo.bar>', '[c](irc://f)']) {
      expect(htmlToMarkdown(markdownToHtml(markdown))).toBe(markdown);
    }
  });

  it('puts no link into the page for any of them', () => {
    const html = editorWith(
      '[](./t.md) [l]() <irc://a.b> [c](irc://d) [x](vscode://e)\n',
    ).editor.getHTML();
    expect(html).not.toContain('<a');
    expect(html).not.toContain('href');
  });

  it('leaves a live link as it was', () => {
    expect(editorWith('[x](https://e.com)\n').editor.getHTML()).toContain('href="https://e.com"');
  });
});

describe('a kept link in the shapes the review of #587 measured (#564)', () => {
  // Measured on `97ec43f`: each lost its destination on an unedited save.
  it.each([
    ['inside strong', '**[a](irc://x)**\n'],
    ['inside strikethrough', '~~[a](irc://x)~~\n'],
    ['with no destination inside strong', '**[text]()**\n'],
    ['an autolink inside emphasis', '*<irc://foo.bar>*\n'],
    ['inside two marks', '***[a](irc://x)***\n'],
    ['inside an underscore emphasis', '_[a](irc://x)_\n'],
    ['holding emphasis, inside strong', '**[*a* b](irc://x)**\n'],
    ['inside a superscript', '<sup>[a](irc://x)</sup>\n'],
    ['whose text wraps a line', '[a\nb](irc://x)\n'],
    ['whose text wraps a line, inside strong', '**[a\nb](irc://x)**\n'],
    ['twice, touching, with the same bytes', '[a](irc://x)[a](irc://x)\n'],
    ['twice, a space apart', '[a](irc://x) [a](irc://x)\n'],
    ['with no text, inside strong', 'x **[](./t.md)** y\n'],
  ])('keeps it %s byte for byte', (_label, markdown) => {
    const once = saved(markdown);
    expect(once).toBe(markdown);
    expect(saved(once)).toBe(once);
    expect(htmlToMarkdown(markdownToHtml(markdown))).toBe(markdown.trimEnd());
  });

  it('writes an emphasis that goes on past the link inside its brackets, as for a live link', () => {
    // The exception of R-C2 for two overlapping marks, and the review of #587:
    // written around the bytes there, the delimiters met those of the same
    // emphasis after the link, `*[a](irc://x)**b*`, and the second save
    // escaped them. An autolink holds no mark, so it is written inline (#567).
    expect(saved('*[chat](irc://foo.bar/baz) more*\n')).toBe(
      '[*chat*](irc://foo.bar/baz) *more*\n',
    );
    expect(saved('*[chat](https://x) more*\n')).toBe('[*chat*](https://x) *more*\n');
    expect(saved('*[a](irc://x)b*\n')).toBe('[*a*](irc://x)*b*\n');
    expect(saved('*[a](irc://x)[a](irc://x)*\n')).toBe('[*a*](irc://x)[*a*](irc://x)\n');
    expect(saved('*<irc://x>b*\n')).toBe('[*irc://x*](irc://x)*b*\n');
  });

  it('places the bytes as they are, with no replacement pattern read in them', () => {
    for (const markdown of [
      '**[a$$b](irc://x)**\n',
      '**[a](irc://x?q=$&)**\n',
      "**[a](irc://x?q=$')**\n",
    ]) {
      expect(saved(markdown)).toBe(markdown);
    }
  });
});

describe('what is not kept (#564)', () => {
  it.each([
    // The R-C2 exception for unsafe destinations stands: never carried.
    ['javascript', '[x](javascript:alert(1))\n', 'x\n'],
    ['javascript, with no text', 'a [](javascript:alert(1)) b\n', 'a b\n'],
    ['vbscript', '[x](vbscript:msgbox)\n', 'x\n'],
    ['file', '<file:///etc/passwd>\n', 'file:///etc/passwd\n'],
    // A reference link: its definition is not written (#570).
    ['a reference with no destination, example 200', '[foo]: <>\n\n[foo]\n', 'foo\n'],
  ])('%s', (_label, markdown, expected) => {
    expect(saved(markdown)).toBe(expected);
  });

  it('lets the destination go when the text is edited, as before #564', () => {
    const editor = editorWith('[chat](irc://foo.bar)\n');
    typeAfter(editor, 'ch', 'X');
    expect(editor.getMarkdown()).toBe('chXat');
  });

  it('keeps it when text is typed after it, which stays outside', () => {
    const editor = editorWith('[chat](irc://foo.bar)\n');
    typeAfter(editor, 'chat', ' more');
    expect(editor.getMarkdown()).toBe('[chat](irc://foo.bar) more');
  });

  it('keeps nothing from a paste, rich or plain', () => {
    expect(markdownToHtml('[c](irc://d) [l]() [](./t.md)', { keepRawHtml: false })).not.toMatch(
      /data-kept-link|data-raw-html/,
    );
    const pasted = cleanPastedHtml(
      '<p><span data-kept-link="%5Bx%5D(irc%3A%2F%2Fy)" data-kept-link-text="x">x</span></p>',
    );
    expect(pasted).not.toContain('data-kept-link');
  });

  it('does not believe a carrier a file spells', () => {
    // The attributes are stamped (#447), so raw HTML in a file cannot supply them.
    const forged =
      '<span data-kept-link="%5Bx%5D(irc%3A%2F%2Fy)" data-kept-link-text="x">x</span>\n';
    expect(saved(forged)).not.toContain('[x](irc://y)');
    const carrier = '<wbr data-raw-html="%5B%5D(javascript%3Aalert(1))">\n';
    // Kept as the raw tag the file wrote, inert, and never decoded into a link.
    expect(saved(carrier)).not.toContain('[](javascript');
  });
});
