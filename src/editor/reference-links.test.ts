import { afterEach, describe, expect, it } from 'vitest';
import shippedPage from '../../index.html?raw';
import { setupLinkDialog } from '../app/link-dialog';
import { applyLineConventions, detectLineConventions } from '../formats/line-conventions';
import { markdownToHtml } from './markdown/parse';
import { htmlToMarkdown } from './markdown/serialize';
import { cleanPastedHtml } from './paste';
import { createEditor, type EditorInstance } from './setup';

/**
 * Reference links and their definitions are kept (#570, owner decisions R1
 * to R4 and E1 to E5 on #570, comment 6124134681).
 *
 * Measured on `1793896` at both levels: every reference link was written
 * inline and every definition removed, an unused one and its address lost, a
 * title respelled, a label case gone. Each is now kept as the file wrote it,
 * and an edit writes what the decisions say.
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

/** Where `text` starts in the document, `skip` occurrences in. */
function positionOf(editor: EditorInstance, text: string, skip = 0): number {
  let at = -1;
  let seen = 0;
  editor.editor.state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text?.includes(text)) {
      if (seen === skip) at = pos + node.text.indexOf(text);
      seen += 1;
    }
    return at === -1;
  });
  expect(at, `no text ${text}`).toBeGreaterThan(-1);
  return at;
}

/** The address each link of the document reads as, after the file is opened again. */
function addressesOnReopen(markdown: string): string[] {
  const addresses: string[] = [];
  editorWith(markdown).editor.state.doc.descendants((node) => {
    const link = node.marks.find((mark) => mark.type.name === 'link');
    if (link) addresses.push(`${node.text} ${link.attrs.href}`);
  });
  return addresses;
}

const DEFINITION = '\n\n[docs]: https://example.com\n';

describe('an unedited save keeps reference links and their definitions (#570)', () => {
  it.each([
    ['a full reference', `See [the docs][docs].${DEFINITION}`],
    ['a collapsed reference', `See [docs][].${DEFINITION}`],
    ['a shortcut reference', `See [docs].${DEFINITION}`],
    ['an image reference, R4', '![logo][img]\n\n[img]: ./logo.png\n'],
    ['an unused definition', 'Text.\n\n[unused]: https://example.com\n'],
    ['two definitions with one label', '[a] and [b].\n\n[a]: /one\n[a]: /two\n[b]: /three\n'],
    ['a definition inside a quote', '> [docs]: https://example.com\n\nSee [docs].\n'],
    ['a label in another case', `See [Docs][DOCS].${DEFINITION}`],
    ['a title in parentheses', 'See [docs].\n\n[docs]: https://example.com (Title)\n'],
    ['a destination in angle brackets holding a space', 'See [docs].\n\n[docs]: <./my file.md>\n'],
    ['a reference to irc, R3', 'See [chat][c].\n\n[c]: irc://foo.bar\n'],
    ['a reference to a rustdoc path, R3', 'See [Cow][cow].\n\n[cow]: alloc::borrow::Cow\n'],
    [
      'a definition indented by one space',
      'Use [`ctor!`][c] here.\n\n [c]: crate::declarative::ctor!\n',
    ],
    [
      'a footnote beside a reference',
      `Note[^1] and [docs].\n\n[^1]: the note\n[docs]: https://example.com\n`,
    ],
  ])('keeps %s byte for byte', (_label, markdown) => {
    const once = saved(markdown);
    expect(once).toBe(markdown);
    expect(saved(once)).toBe(once);
    expect(htmlToMarkdown(markdownToHtml(markdown))).toBe(markdown.trimEnd());
  });
});

describe('what an edit writes (#570, E1 to E5)', () => {
  it('E1: the text of a shortcut or a collapsed link edited is written as a full reference', () => {
    for (const source of [`See [docs].${DEFINITION}`, `See [docs][].${DEFINITION}`]) {
      const editor = editorWith(source);
      editor.editor.view.dispatch(
        editor.editor.state.tr.insertText('X', positionOf(editor, 'docs') + 2),
      );
      expect(editor.getMarkdown()).toBe('See [doXcs][docs].\n\n[docs]: https://example.com');
    }
  });

  it('E3: the last link of a definition deleted, the definition stays', () => {
    const editor = editorWith(`[a][docs] and more.${DEFINITION}`);
    const at = positionOf(editor, 'a');
    editor.editor.view.dispatch(editor.editor.state.tr.delete(at, at + 1));
    expect(editor.getMarkdown()).toBe('and more.\n\n[docs]: https://example.com');
  });

  it('E5: a link made in the editor is inline', () => {
    const editor = editorWith(`Text.${DEFINITION}`);
    const at = positionOf(editor, 'Text');
    editor.editor
      .chain()
      .setTextSelection({ from: at, to: at + 4 })
      .setLink({ href: 'https://example.com' })
      .run();
    expect(editor.getMarkdown()).toBe(`[Text](https://example.com).${DEFINITION.trimEnd()}`);
  });
});

describe('E2 and E4 on one document (#570, AMP note point 1)', () => {
  it('a link re-addressed stays inline, and the other follows its edited definition', () => {
    const open = shippedPage.indexOf('<div id="link-dialog"');
    const close = shippedPage.indexOf('\n    </div>', open);
    document.body.insertAdjacentHTML('beforeend', shippedPage.slice(open, close + 11));
    const editor = editorWith(`[aaa][docs] and [bbb][docs].${DEFINITION}`);
    const dialog = setupLinkDialog(editor.editor);
    editor.editor.commands.setTextSelection(positionOf(editor, 'aaa') + 1);
    dialog.open();
    (document.getElementById('link-url') as HTMLInputElement).value = 'https://example.org';
    (document.getElementById('link-confirm') as HTMLButtonElement).click();
    // E2: the re-addressed link is inline; the other and the definition untouched.
    expect(editor.getMarkdown()).toBe(
      '[aaa](https://example.org) and [bbb][docs].\n\n[docs]: https://example.com',
    );
    // E4: the address of the definition edited; the reference follows it.
    const at = positionOf(editor, 'example.com');
    editor.editor.view.dispatch(editor.editor.state.tr.insertText('net', at + 8, at + 11));
    const written = editor.getMarkdown();
    expect(written).toBe(
      '[aaa](https://example.org) and [bbb][docs].\n\n[docs]: https://example.net',
    );
    expect(addressesOnReopen(written)).toEqual([
      'aaa https://example.org',
      'bbb https://example.net',
    ]);
  });
});

describe('a definition edited into something else resolves nothing (#570, AMP note point 2)', () => {
  it('its colon deleted: the links are written inline with their address, none lost', () => {
    const editor = editorWith(`See [a][docs] and [b][docs].${DEFINITION}`);
    const at = positionOf(editor, ']:');
    editor.editor.view.dispatch(editor.editor.state.tr.delete(at + 1, at + 2));
    const written = editor.getMarkdown();
    expect(written).toBe(
      'See [a](https://example.com) and [b](https://example.com).\n\n[docs] https://example.com',
    );
    expect(addressesOnReopen(written)).toEqual(['a https://example.com', 'b https://example.com']);
  });

  it('its label changed: the links of the old label are written inline', () => {
    const editor = editorWith(`See [a][docs].${DEFINITION}`);
    const at = positionOf(editor, 'docs]:');
    editor.editor.view.dispatch(editor.editor.state.tr.insertText('new', at, at + 4));
    expect(editor.getMarkdown()).toBe(
      'See [a](https://example.com).\n\n[new]: https://example.com',
    );
  });
});

describe('a definition in a table cell (#570)', () => {
  it('defines nothing there, so its reference is written inline and both hold still', () => {
    // A cell writes its blocks as HTML (#300), where no reader takes a
    // definition, so the definition is written as the text it then is.
    const source =
      '<table><tr><td>\n\nUse [`x!`][c] here.\n\n [c]: crate::x\n\n</td></tr></table>\n';
    const once = saved(source);
    expect(once).toContain('[`x!`](crate::x)');
    expect(once).toContain('\\[c\\]: crate::x');
    expect(saved(once)).toBe(once);
  });
});

describe('paste (#570)', () => {
  it('a plain-text paste of markdown holding a reference and its definition keeps both', () => {
    const html = markdownToHtml(`See [docs].${DEFINITION}`, { breaks: true, keepRawHtml: false });
    expect(htmlToMarkdown(html)).toBe('See [docs].\n\n[docs]: https://example.com');
  });

  it('a rich paste of a page with links writes inline links', () => {
    const html = cleanPastedHtml('<p>See <a href="https://example.com">docs</a>.</p>');
    expect(htmlToMarkdown(html)).toBe('See [docs](https://example.com).');
  });

  it('a reference link copied without its definition is written inline', () => {
    const source = editorWith(`See [a][docs].${DEFINITION}`);
    const target = editorWith('Other text.\n');
    const paragraph = source.editor.getHTML().split('<div')[0];
    target.editor.commands.insertContentAt(target.editor.state.doc.content.size, paragraph);
    expect(target.getMarkdown()).toBe('Other text.\n\nSee [a](https://example.com).');
  });
});
