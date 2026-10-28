import type { Token } from 'marked';
import { afterEach, describe, expect, it } from 'vitest';
import shippedPage from '../../index.html?raw';
import { setupLinkDialog } from '../app/link-dialog';
import { lexMarkdown } from './markdown/parse';
import { createEditor, type EditorInstance } from './setup';

/**
 * A backslash in the address of a link is written so that it is read back as
 * itself (#664). Each row checks the href that the parse the editor uses
 * reads from the saved markdown. The same saved bytes were read with
 * cmark-gfm outside the harness, on #664, and gave the same href.
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

/** The href of every link `marked`, configured as the editor configures it, reads in `markdown`. */
function hrefsRead(markdown: string): string[] {
  const hrefs: string[] = [];
  const walk = (tokens: readonly Token[] | undefined, depth: number): void => {
    if (!tokens || depth > 16) return;
    for (const token of tokens) {
      if (token.type === 'link') hrefs.push(token.href);
      walk('tokens' in token ? (token.tokens as Token[] | undefined) : undefined, depth + 1);
    }
  };
  walk(lexMarkdown(markdown), 0);
  return hrefs;
}

/** Where `text` starts in the document. */
function positionOf(editor: EditorInstance, text: string): number {
  let at = -1;
  editor.editor.state.doc.descendants((node, pos) => {
    if (at === -1 && node.isText && node.text?.includes(text)) at = pos + node.text.indexOf(text);
    return at === -1;
  });
  expect(at, `no text ${text}`).toBeGreaterThan(-1);
  return at;
}

describe('an address set in the link dialog (serialize.ts, #664)', () => {
  function linkFromDialog(address: string): string {
    const open = shippedPage.indexOf('<div id="link-dialog"');
    const close = shippedPage.indexOf('\n    </div>', open);
    document.body.insertAdjacentHTML('beforeend', shippedPage.slice(open, close + 11));
    const editor = editorWith('text');
    editor.editor.commands.setTextSelection({ from: 1, to: 5 });
    setupLinkDialog(editor.editor).open();
    (document.getElementById('link-url') as HTMLInputElement).value = address;
    (document.getElementById('link-confirm') as HTMLButtonElement).click();
    return editor.getMarkdown();
  }

  it('a backslash before an opening parenthesis', () => {
    const saved = linkFromDialog('https://a.com/x\\(y');
    expect(saved).toBe('[text](https://a.com/x\\\\\\(y)');
    expect(hrefsRead(saved)).toEqual(['https://a.com/x\\(y']);
  });

  it('a backslash before a closing parenthesis', () => {
    const saved = linkFromDialog('https://a.com/x\\)y');
    expect(saved).toBe('[text](https://a.com/x\\\\\\)y)');
    expect(hrefsRead(saved)).toEqual(['https://a.com/x\\)y']);
  });
});

describe('an unedited kept autolink inside overlapping marks (kept-link.ts, #664)', () => {
  it('a backslash before an opening parenthesis', () => {
    const saved = editorWith('*a <irc://x\\(y>* b\n').getMarkdown();
    expect(saved).toBe('*a* [*irc://x\\\\(y*](irc://x\\\\\\(y) b');
    expect(hrefsRead(saved)).toEqual(['irc://x\\(y']);
  });

  it('a backslash before a closing parenthesis', () => {
    const saved = editorWith('*a <irc://x\\)y>* b\n').getMarkdown();
    expect(saved).toBe('*a* [*irc://x\\\\)y*](irc://x\\\\\\)y) b');
    expect(hrefsRead(saved)).toEqual(['irc://x\\)y']);
  });
});

describe('a kept reference link whose label stops resolving (kept-link.ts, #664)', () => {
  /** `See [a][r].` over the definition `[r]: destination`, the definition relabelled. */
  function relabelled(destination: string): string {
    const editor = editorWith(`See [a][r].\n\n[r]: ${destination}\n`);
    const at = positionOf(editor, 'r]:');
    editor.editor.view.dispatch(editor.editor.state.tr.insertText('new', at, at + 1));
    return editor.getMarkdown();
  }

  it('a backslash before an opening parenthesis', () => {
    const saved = relabelled('irc://x\\\\(y');
    expect(saved).toBe('See [a](irc://x\\\\\\(y).\n\n[new]: irc://x\\\\(y');
    expect(hrefsRead(saved)).toEqual(['irc://x\\(y']);
  });

  it('a backslash before a closing parenthesis, where the link was written as its text alone', () => {
    const saved = relabelled('irc://x\\\\)y');
    expect(saved).toBe('See [a](irc://x\\\\\\)y).\n\n[new]: irc://x\\\\)y');
    expect(hrefsRead(saved)).toEqual(['irc://x\\)y']);
  });

  it('between angle brackets, a backslash before a parenthesis', () => {
    const saved = relabelled('<irc://x y\\\\(z>');
    expect(saved).toBe('See [a](<irc://x y\\\\(z>).\n\n[new]: <irc://x y\\\\(z>');
    expect(hrefsRead(saved)).toEqual(['irc://x y\\(z']);
  });

  it('between angle brackets, an escaped angle bracket', () => {
    const lt = relabelled('<irc://x y\\<z>');
    expect(lt).toBe('See [a](<irc://x y\\<z>).\n\n[new]: <irc://x y\\<z>');
    expect(hrefsRead(lt)).toEqual(['irc://x y<z']);
    const gt = relabelled('<irc://x\\>z>');
    expect(gt).toBe('See [a](<irc://x\\>z>).\n\n[new]: <irc://x\\>z>');
    expect(hrefsRead(gt)).toEqual(['irc://x>z']);
  });
});
