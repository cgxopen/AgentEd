/**
 * Undo and redo reach the document only while it has focus (#306).
 *
 * **What these rows drive.** The browser raises `beforeinput` with
 * `historyUndo` or `historyRedo` aimed at the editor while focus is somewhere
 * else, measured on #306 in Chromium and on WebView2; these rows dispatch that
 * same event, aimed where the browser aims it, with focus where the user left
 * it, on a real editor and the real history plugin. Every row asserts what the
 * document became and whether the event was refused.
 *
 * **What they cannot see**, because happy-dom keeps no page undo stack: which
 * target the browser picks, a field spending its own steps natively before
 * anything reaches the editor, and the limit where a field typed in before the
 * body keeps an older step no press reaches. Those were measured in headless
 * Chromium on #306 and are listed in the pull request; the rows here pin the
 * decision the guard takes once the event exists.
 */
import { closeHistory } from '@tiptap/pm/history';
import { afterEach, describe, expect, it } from 'vitest';
import shippedPage from '../../index.html?raw';
import { openLanguagePopover } from '../ui/language-popover';
import { historyMenuCallbacks } from './history-routes';
import { createEditor, type EditorInstance } from './setup';

let instance: EditorInstance | null = null;

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

/** An editor holding `one two` typed as two steps, and nothing loaded. */
function editorWithTwoSteps(): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown('');
  const { editor } = instance;
  editor.chain().focus().insertContent('one').run();
  editor.view.dispatch(closeHistory(editor.state.tr));
  editor.commands.insertContent(' two');
  return instance;
}

const text = (editor: EditorInstance) => editor.editor.state.doc.textContent;

/** The event the browser raises, aimed where it aims it. */
function historyInput(target: EventTarget, inputType: 'historyUndo' | 'historyRedo'): InputEvent {
  const event = new InputEvent('beforeinput', {
    inputType,
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  target.dispatchEvent(event);
  return event;
}

/** A fragment of the shipped page, mounted as markup only. */
function mountShipped(openTag: string, closeTag: string): void {
  const open = shippedPage.indexOf(openTag);
  const close = shippedPage.indexOf(closeTag, open);
  if (open < 0 || close < 0) throw new Error(`index.html no longer holds ${openTag}`);
  const holder = document.createElement('div');
  holder.innerHTML = shippedPage.slice(open, close + closeTag.length);
  document.body.appendChild(holder);
}

/** Focus somewhere outside the editor, and check it landed there. */
function focusOutside(element: HTMLElement): void {
  element.focus();
  expect(document.activeElement).toBe(element);
}

describe('undo aimed at the document while focus is outside it is refused (#306)', () => {
  it('two steps typed, the undo refused from a field: the document keeps both', () => {
    const editor = editorWithTwoSteps();
    expect(text(editor)).toBe('one two');
    const field = document.createElement('textarea');
    document.body.appendChild(field);
    focusOutside(field);

    for (let press = 0; press < 3; press++) {
      const event = historyInput(editor.editor.view.dom, 'historyUndo');
      expect(event.defaultPrevented).toBe(true);
      expect(text(editor)).toBe('one two');
    }
  });

  it.each([
    ['the metadata field', '<details id="frontmatter-panel"', '</details>', 'frontmatter-input'],
    ['the search field', '<div id="search-panel"', '</div>\n          <details', 'search-input'],
    [
      'the replace field',
      '<div id="search-panel"',
      '</div>\n          <details',
      'search-replace-input',
    ],
    ['the table rows field', '<div id="table-dialog"', '</label>\n', 'table-rows'],
    [
      'the table columns field',
      '<div id="table-dialog"',
      '</div>\n        <div class="dialog-actions">',
      'table-cols',
    ],
    ['the link address field', '<div id="link-dialog"', '</label>', 'link-url'],
  ])('with focus in %s, as the shipped page renders it', (_name, openTag, closeTag, id) => {
    const editor = editorWithTwoSteps();
    mountShipped(openTag, closeTag);
    const field = document.getElementById(id);
    if (!(field instanceof HTMLElement)) throw new Error(`#${id} was not mounted`);
    field.hidden = false;
    field.closest('[hidden]')?.removeAttribute('hidden');
    focusOutside(field);

    const event = historyInput(editor.editor.view.dom, 'historyUndo');
    expect(event.defaultPrevented).toBe(true);
    expect(text(editor)).toBe('one two');
  });

  it('with focus in the language field of a code block', () => {
    const editor = editorWithTwoSteps();
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const popover = openLanguagePopover({
      anchor,
      initial: '',
      onCommit: () => {},
      onCancel: () => {},
    });
    focusOutside(popover.field);

    const event = historyInput(editor.editor.view.dom, 'historyUndo');
    expect(event.defaultPrevented).toBe(true);
    expect(text(editor)).toBe('one two');
    popover.close();
  });

  it('with focus on a button', () => {
    const editor = editorWithTwoSteps();
    const button = document.createElement('button');
    document.body.appendChild(button);
    focusOutside(button);

    const event = historyInput(editor.editor.view.dom, 'historyUndo');
    expect(event.defaultPrevented).toBe(true);
    expect(text(editor)).toBe('one two');
  });

  it('with nothing focused at all, the state of an application just opened', () => {
    const editor = editorWithTwoSteps();
    editor.editor.view.dom.blur();
    expect(document.activeElement).toBe(document.body);

    const event = historyInput(editor.editor.view.dom, 'historyUndo');
    expect(event.defaultPrevented).toBe(true);
    expect(text(editor)).toBe('one two');
  });

  it('aimed at a node inside the editor rather than its root', () => {
    const editor = editorWithTwoSteps();
    const button = document.createElement('button');
    document.body.appendChild(button);
    focusOutside(button);
    const paragraph = editor.editor.view.dom.querySelector('p');
    if (!paragraph) throw new Error('no paragraph rendered');

    const event = historyInput(paragraph, 'historyUndo');
    expect(event.defaultPrevented).toBe(true);
    expect(text(editor)).toBe('one two');
  });
});

describe('redo is refused the same way (#306, owner decision)', () => {
  it('a step undone in the document is not redone from a field', () => {
    const editor = editorWithTwoSteps();
    editor.editor.commands.undo();
    expect(text(editor)).toBe('one');
    const field = document.createElement('input');
    document.body.appendChild(field);
    focusOutside(field);

    const event = historyInput(editor.editor.view.dom, 'historyRedo');
    expect(event.defaultPrevented).toBe(true);
    expect(text(editor)).toBe('one');
  });
});

describe('what the guard lets through (#306, the regression half)', () => {
  it('undo and redo with focus in the document still act on the document', () => {
    const editor = editorWithTwoSteps();
    editor.editor.view.focus();
    expect(editor.editor.view.dom.contains(document.activeElement)).toBe(true);

    historyInput(editor.editor.view.dom, 'historyUndo');
    expect(text(editor)).toBe('one');
    historyInput(editor.editor.view.dom, 'historyUndo');
    expect(text(editor)).toBe('');
    historyInput(editor.editor.view.dom, 'historyRedo');
    expect(text(editor)).toBe('one');
    historyInput(editor.editor.view.dom, 'historyRedo');
    expect(text(editor)).toBe('one two');
  });

  it("a field's own undo is aimed at the field and is not touched", () => {
    const editor = editorWithTwoSteps();
    const field = document.createElement('textarea');
    document.body.appendChild(field);
    focusOutside(field);

    const event = historyInput(field, 'historyUndo');
    expect(event.defaultPrevented).toBe(false);
    expect(text(editor)).toBe('one two');
  });

  it('input other than history, aimed at the editor, is not touched', () => {
    const editor = editorWithTwoSteps();
    const field = document.createElement('textarea');
    document.body.appendChild(field);
    focusOutside(field);

    const event = new InputEvent('beforeinput', {
      inputType: 'insertText',
      data: 'x',
      bubbles: true,
      cancelable: true,
    });
    editor.editor.view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it('the Edit menu Undo and Redo still act on the document with focus in a field (#295)', () => {
    const editor = editorWithTwoSteps();
    const field = document.createElement('textarea');
    document.body.appendChild(field);
    focusOutside(field);
    const menu = historyMenuCallbacks(editor.editor);

    menu.onUndo();
    expect(text(editor)).toBe('one');
    focusOutside(field);
    menu.onRedo();
    expect(text(editor)).toBe('one two');
  });

  it('the listener leaves with the editor', () => {
    const editor = editorWithTwoSteps();
    const dom = editor.editor.view.dom;
    editor.destroy();
    instance = null;
    // Destroying takes the editor's element out of the page, and an event on a
    // detached element never reaches the document: put it back, or this row
    // would pass with the listener still installed.
    document.body.appendChild(dom);
    expect(document.contains(dom)).toBe(true);
    const field = document.createElement('textarea');
    document.body.appendChild(field);
    focusOutside(field);

    const event = new InputEvent('beforeinput', {
      inputType: 'historyUndo',
      bubbles: true,
      cancelable: true,
    });
    dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
