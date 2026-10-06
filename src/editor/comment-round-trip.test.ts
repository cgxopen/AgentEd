/**
 * An HTML comment survives the save, and the reader can tell it is there
 * (#245).
 *
 * ── What this harness cannot see, said first ──
 *
 * **Arrow-key caret motion and Backspace are not observable here.** Measured
 * on a control rather than assumed: `keyboardShortcut('Backspace')` moves
 * nothing even on the plain text `abc` under happy-dom, and
 * `selectNodeBackward` answers false, because both need a real editor view.
 * So *can the caret pass the mark without sticking* and *does a Backspace
 * beside it select it before removing it* are **verified in the manual pass**,
 * not here, and the pull request says so.
 *
 * What this file asserts is the halves that are observable, and it joins the
 * two that are only worth anything together: the mark the editor rendered is
 * matched against the selector read out of `styles.css`, rather than against a
 * string restated here. Either half alone asserts nothing — a selector nobody
 * renders, or an element no stylesheet reaches.
 */
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import stylesCss from '../styles.css?raw';
import { markdownToHtml } from './markdown/parse';
import { createEditor, type EditorInstance } from './setup';

let instance: EditorInstance | null = null;

function open(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance;
}

function openAndSave(markdown: string): string {
  const editor = open(markdown);
  const saved = editor.getMarkdown().trim();
  editor.destroy();
  instance = null;
  return saved;
}

function positionOf(editor: EditorInstance, nodeName: string): number {
  let found = -1;
  editor.editor.state.doc.descendants((node, pos) => {
    if (node.type.name === nodeName) found = pos;
    return true;
  });
  return found;
}

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

// ─────────────────────────────────────────────────────────────────────────────
// The bytes: the file gets back what it gave
// ─────────────────────────────────────────────────────────────────────────────

describe('a comment survives the save', () => {
  it.each([
    ['alone on a line', '<!-- a note -->'],
    ['inline mid-sentence', 'one <!-- note --> two'],
    ['at the end of a paragraph', 'one two <!-- note -->'],
    ['between two paragraphs', 'one\n\n<!-- note -->\n\ntwo'],
    ['multi-line', '<!--\nline one\nline two\n-->'],
    ['wrapping a block of markdown', '<!--\n## heading\n\n- a\n- b\n-->'],
    ['two on their own lines', '<!-- a -->\n\n<!-- b -->'],
    ['holding a tag', '<!-- <b>bold</b> -->'],
    ['inside a fenced block, where it is code', '```\n<!-- kept as text -->\n```'],
  ])('%s is byte-identical', (_label, markdown) => {
    // Every one of these came back as nothing before the repair, apart from the
    // fenced one, which was already text and must stay text.
    expect(openAndSave(markdown)).toBe(markdown);
  });

  it('and the second save moves nothing further', () => {
    const markdown = 'one\n\n<!-- note -->\n\ntwo <!-- and another -->';
    const once = openAndSave(markdown);
    expect(openAndSave(once)).toBe(once);
  });

  it('a document with no comment is untouched', () => {
    const markdown =
      '# Title\n\ntext with **emphasis**\n\n- a\n- b\n\n| a | b |\n| --- | --- |\n| c | d |';
    expect(openAndSave(markdown)).toBe(markdown);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The carrier: what reaches the sanitizer, and what a hand-written one buys
// ─────────────────────────────────────────────────────────────────────────────

describe('the carrier', () => {
  it('reaches the document, where the comment node itself could not', () => {
    // The half this repair rests on: DOMPurify removes a comment node, so the
    // bytes have to be somewhere it keeps. Both halves asserted, because
    // either alone would pass on a pipeline that did nothing.
    expect(markdownToHtml('<!-- a note -->')).toContain('data-comment=');
    expect(markdownToHtml('<!-- a note -->')).not.toContain('<!--');
  });

  it('refuses a value a document wrote by hand that is not one comment', () => {
    // The attribute travels through a user file as readily as through this
    // pipeline, and what it holds is written back verbatim. A value that is
    // not one comment carries nothing rather than reaching the file.
    const saved = openAndSave('<div data-comment="not%20a%20comment">x</div>');
    expect(saved).not.toContain('not a comment');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The mark: the observable halves, joined
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The class the stylesheet actually styles the mark with, read from
 * `styles.css` rather than restated here — the precedent is `loose-lists`
 * reading its own selector, and `ci.test.ts` reading `ci.yml`. A test that
 * repeats the string it is checking goes on passing after the file it
 * describes has moved.
 */
function markSelector(): string {
  const rule = stylesCss
    .split('}')
    .find((block) => block.includes('::before') && block.includes('markdown-comment-mark'));
  if (rule === undefined) {
    throw new Error('styles.css has no ::before rule drawing the comment mark (#245)');
  }
  return rule.slice(rule.lastIndexOf('*/') + 2, rule.indexOf('{')).trim();
}

describe('the mark the reader sees', () => {
  it('the stylesheet draws a glyph for it', () => {
    const rule = stylesCss.slice(stylesCss.indexOf(markSelector()));
    expect(rule).toMatch(/content:\s*["']¶["']/);
  });

  it.each([
    ['inside a sentence', 'one <!-- a short note --> two'],
    ['on its own line', 'x\n\n<!-- block note -->\n\ny'],
  ])('%s: the editor renders an element the selector reaches', (_label, markdown) => {
    const editor = open(markdown);
    const host = editor.editor.view.dom.parentElement as HTMLElement;
    // The selector out of the stylesheet, run against what was rendered.
    const marks = host.querySelectorAll(markSelector().replace(/::before$/, ''));
    expect(marks).toHaveLength(1);
    expect(marks[0].nodeName).toBe('SPAN');
  });

  it('carries the note on hover, without its delimiters', () => {
    const editor = open('one <!-- a short note --> two');
    const mark = editor.editor.view.dom.querySelector('.markdown-comment-mark') as HTMLElement;
    expect(mark.title).toBe('a short note');
  });

  it('keeps the lines of a multi-line note', () => {
    const editor = open('<!--\nline A\nline B\n-->');
    const mark = editor.editor.view.dom.querySelector('.markdown-comment-mark') as HTMLElement;
    expect(mark.title).toBe('line A\nline B');
  });

  it('is drawn by the node view alone, so the saved bytes do not know about it', () => {
    // The reason the product decision cost nothing. `getHTML` serializes
    // through `renderHTML`, which is the carrier; the mark exists only in the
    // editing view.
    const editor = open('one <!-- a short note --> two');
    expect(editor.editor.view.dom.innerHTML).toContain('markdown-comment-mark');
    expect(editor.editor.getHTML()).not.toContain('markdown-comment-mark');
    expect(editor.getMarkdown().trim()).toBe('one <!-- a short note --> two');
  });

  it('holds no text of its own, so a selection cannot carry the glyph into the file', () => {
    // The glyph is a CSS `::before`; the element itself is empty.
    const editor = open('one <!-- note --> two');
    const mark = editor.editor.view.dom.querySelector('.markdown-comment-mark') as HTMLElement;
    expect(mark.textContent).toBe('');
    expect(mark.getAttribute('contenteditable')).toBe('false');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The node: what a user can do to it, in the halves this harness can see
// ─────────────────────────────────────────────────────────────────────────────

describe('the node holding a comment', () => {
  it.each([
    ['inline', 'one <!-- note --> two'],
    ['on its own line', 'one\n\n<!-- note -->\n\ntwo'],
  ])('%s: is an atom that no click can select', (_label, markdown) => {
    const editor = open(markdown);
    const node = editor.editor.state.doc.nodeAt(positionOf(editor, 'markdownComment'));
    expect(node?.isAtom).toBe(true);
    expect(node?.isLeaf).toBe(true);
    expect(node?.nodeSize).toBe(1);
    // The half that keeps a click from ever putting a selection on it, and so
    // keeps the next character typed from replacing the note.
    expect(NodeSelection.isSelectable(node as ProseMirrorNode)).toBe(false);
  });

  it.each([
    ['Backspace after it', 'one <!-- note --> two', 'Backspace', 1, 'one two'],
    ['Delete before it', 'one <!-- note --> two', 'Delete', 0, 'one two'],
    ['Backspace on its own line', 'one\n\n<!-- note -->\n\ntwo', 'Backspace', 1, 'one\n\ntwo'],
  ])(
    '%s removes it, and undo brings the bytes back',
    (_label, markdown, key, offset, afterDelete) => {
      // One keystroke, the same a character gets, and written rather than left
      // to whatever the browser does with a `contenteditable="false"` element
      // — which is exactly the part no test here could otherwise reach.
      const editor = open(markdown);
      editor.editor.commands.setTextSelection(positionOf(editor, 'markdownComment') + offset);
      expect(editor.editor.commands.keyboardShortcut(key)).toBe(true);
      expect(editor.getMarkdown().trim()).toBe(afterDelete);

      editor.editor.commands.undo();
      expect(editor.getMarkdown().trim()).toBe(markdown);
    },
  );

  it('and those keys leave ordinary text to whatever handles it', () => {
    // The other side: the handler declines everywhere else, so it cannot be
    // what removes a character the user meant to keep.
    const editor = open('abcd <!-- n --> efgh');
    editor.editor.commands.setTextSelection(3);
    editor.editor.commands.keyboardShortcut('Backspace');
    expect(editor.getMarkdown().trim()).toBe('abcd <!-- n --> efgh');
  });

  it('text typed beside an inline comment lands beside it, not inside it', () => {
    const before = open('one <!-- note --> two');
    const at = positionOf(before, 'markdownComment');
    before.editor.commands.setTextSelection(at + 1);
    before.editor.commands.insertContent('X');
    expect(before.getMarkdown().trim()).toBe('one <!-- note -->X two');
    before.destroy();
    instance = null;

    const after = open('one <!-- note --> two');
    const pos = positionOf(after, 'markdownComment');
    after.editor.commands.setTextSelection(pos);
    after.editor.commands.insertContent('Y');
    expect(after.getMarkdown().trim()).toBe('one Y<!-- note --> two');
  });

  it('a comment wrapping markdown is one node holding bytes, not content', () => {
    // What makes the hidden block safe: the heading and the list inside are in
    // the attribute, so nothing renders them and nothing can edit half of them.
    const editor = open('<!--\n## heading\n\n- a\n- b\n-->');
    const json = editor.editor.getJSON();
    expect(json.content).toHaveLength(1);
    expect(json.content?.[0]).toEqual({
      type: 'paragraph',
      // Every paragraph carries the two attributes of #461, unset here.
      attrs: { htmlBlockSource: null, keptHtmlBlockSource: null },
      content: [
        { type: 'markdownComment', attrs: { comment: '<!--\n## heading\n\n- a\n- b\n-->' } },
      ],
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// What the owner manual pass found, and what it changed
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A comment the file put on its own line used to be a **block** node. The
 * manual pass on `294026a` found what that costs, and no test here could have:
 * a block atom fills its line, so clicking the line selects the whole node and
 * the next character typed **replaces the note**. There was nowhere to put the
 * caret beside it.
 *
 * It is one inline node inside a paragraph now. These pin the difference at
 * the level this harness can reach — a caret placed on either side of the
 * mark, and what the file gets — while the click and the arrow keys stay
 * manual, for the reason at the top of this file.
 */
describe('a comment on its own line has room for a caret beside it', () => {
  it('lives in a paragraph rather than in a block of its own', () => {
    const editor = open('# Title\n\n<!-- a note -->\n\ntext');
    const json = editor.editor.getJSON();
    expect(json.content?.[1]).toEqual({
      type: 'paragraph',
      // Every paragraph carries the two attributes of #461, unset here.
      attrs: { htmlBlockSource: null, keptHtmlBlockSource: null },
      content: [{ type: 'markdownComment', attrs: { comment: '<!-- a note -->' } }],
    });
  });

  it.each([
    ['after it', 1, '# Title\n\n<!-- a note -->X\n\ntext'],
    ['before it', 0, '# Title\n\nX<!-- a note -->\n\ntext'],
  ])('typing %s keeps the note and puts the text beside it', (_label, offset, expected) => {
    const editor = open('# Title\n\n<!-- a note -->\n\ntext');
    const at = positionOf(editor, 'markdownComment');
    editor.editor.commands.setTextSelection(at + offset);
    editor.editor.commands.insertContent('X');
    // The note survives, which is the whole of what the manual pass reported.
    expect(editor.getMarkdown().trim()).toBe(expected);
  });

  it('and it can still be removed on purpose, one keystroke like a character', () => {
    // Without this the pair above could be satisfied by a note nothing can
    // take out, which would be its own defect.
    const editor = open('# Title\n\n<!-- a note -->\n\ntext');
    editor.editor.commands.setTextSelection(positionOf(editor, 'markdownComment') + 1);
    editor.editor.commands.keyboardShortcut('Backspace');
    expect(editor.getMarkdown().trim()).toBe('# Title\n\ntext');
    editor.editor.commands.undo();
    expect(editor.getMarkdown().trim()).toBe('# Title\n\n<!-- a note -->\n\ntext');
  });
});
