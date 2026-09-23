/**
 * The Image description dialog, driven the way a person drives it (#291).
 *
 * Every row below opens the dialog through the **rendered entry of the shipped
 * page**, types into the shipped field and presses the shipped button, then
 * reads the markdown a save would write. That is the #204 shape the Insert
 * Table entry records: a test that drove the mapping object would go on
 * passing with the dialog wired to nothing.
 *
 * **What it cannot see**: the dialog on screen — its size, where it sits, and
 * whether the line above the field explains what the field is for. That last
 * one is the question this whole issue rests on, and it belongs to the manual
 * pass rather than to a row here.
 */
import { NodeSelection } from '@tiptap/pm/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { createEditor, type EditorInstance } from '../editor/setup';
import { type MenuCallbacks, setupMenu } from '../ui/menu';
import { imageDescriptionRoutes } from './image-description-dialog';

const MARKDOWN = 'before\n\n![Holiday Photo.png](assets/Holiday-Photo.png)\n\nafter';
const INLINE_HTML =
  'before\n\n<img src=\'assets/p.png\' alt="a &amp; b" width=600 title="t" style="border:1px solid red">\n\nafter';

/** The shipped header and the image description dialog, without the rest of the page. */
function shippedMarkup(): string {
  const header = shippedPage.indexOf('<header id="menubar">');
  const headerEnd = shippedPage.indexOf('</header>') + '</header>'.length;
  const dialog = shippedPage.indexOf('<div id="image-description-dialog"');
  const dialogEnd = shippedPage.indexOf('<div id="link-dialog"');
  if (header < 0 || dialog < 0 || dialogEnd < 0) throw new Error('index.html changed shape');
  return shippedPage.slice(header, headerEnd) + shippedPage.slice(dialog, dialogEnd);
}

function spies(): MenuCallbacks {
  return {
    onNew: vi.fn(),
    onNewFromTemplate: vi.fn(),
    onOpen: vi.fn(),
    onOpenRecentFile: vi.fn(),
    onClearRecentFiles: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    onClose: vi.fn(),
    onFind: vi.fn(),
    onReplace: vi.fn(),
    onFindNext: vi.fn(),
    onFindPrevious: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSelectAll: vi.fn(),
    onInsertTable: vi.fn(),
    onInsertMedia: vi.fn(),
    onInsertCodeBlock: vi.fn(),
    onInsertChecklist: vi.fn(),
    onInsertFootnote: vi.fn(),
    onInsertHorizontalRule: vi.fn(),
    onInsertMetadata: vi.fn(),
    onInsertEmoji: vi.fn(),
    onImageDescription: vi.fn(),
    onToggleSpellcheck: vi.fn(),
    onAddRowAbove: vi.fn(),
    onAddRowBelow: vi.fn(),
    onDeleteRow: vi.fn(),
    onAddColumnBefore: vi.fn(),
    onAddColumnAfter: vi.fn(),
    onDeleteColumn: vi.fn(),
    onDeleteTable: vi.fn(),
    onAbout: vi.fn(),
  };
}

let instance: EditorInstance | null = null;

/** The editor, with the real entry bound to the real dialog through the real menu. */
function openWithMenu(markdown: string, imageSelected = true): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  setupMenu(
    { ...spies(), ...imageDescriptionRoutes(instance.editor) },
    () => ({ canUndo: true, canRedo: true }),
    () => ({
      imageDescription: imageSelected,
    }),
  );
  if (imageSelected) selectImage(instance);
  return instance;
}

function selectImage(editor: EditorInstance): void {
  let at = -1;
  editor.editor.state.doc.descendants((node, pos) => {
    if (at >= 0 || node.type.name !== 'image') return at < 0;
    at = pos;
    return false;
  });
  if (at < 0) throw new Error('no image in the document');
  editor.editor.view.dispatch(
    editor.editor.state.tr.setSelection(NodeSelection.create(editor.editor.state.doc, at)),
  );
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`the shipped page has no #${id}`);
  return found;
}

const field = () => element('image-description-text') as HTMLInputElement;
const isOpen = () => !element('image-description-dialog').classList.contains('hidden');

/** The entry, reached the way a person reaches it: the toggle, Edit, the entry. */
function chooseTheEntry(): void {
  element('menu-toggle').click();
  element('menu-section-edit').click();
  element('menu-image-description').click();
}

function press(key: string): void {
  element('image-description-dialog').dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
}

beforeEach(() => {
  document.body.innerHTML = shippedMarkup();
});

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.innerHTML = '';
});

describe('the Image description dialog (#291)', () => {
  it('opens from the Edit entry with the description the image carries, selected', () => {
    openWithMenu(MARKDOWN);

    chooseTheEntry();

    expect(isOpen()).toBe(true);
    expect(field().value).toBe('Holiday Photo.png');
    expect(document.activeElement).toBe(field());
  });

  it('writes what was typed into the document, from the shipped button', () => {
    const editor = openWithMenu(MARKDOWN);
    chooseTheEntry();

    field().value = 'A dog asleep on a sofa';
    element('image-description-confirm').click();

    expect(isOpen()).toBe(false);
    expect(editor.getMarkdown()).toBe(
      'before\n\n![A dog asleep on a sofa](assets/Holiday-Photo.png)\n\nafter',
    );
  });

  it('writes from Enter as well as from the button', () => {
    const editor = openWithMenu(MARKDOWN);
    chooseTheEntry();

    field().value = 'A dog asleep on a sofa';
    press('Enter');

    expect(isOpen()).toBe(false);
    expect(editor.getMarkdown()).toContain('![A dog asleep on a sofa]');
  });

  it('accepts an empty description, which the file then spells', () => {
    const editor = openWithMenu(MARKDOWN);
    chooseTheEntry();

    field().value = '';
    element('image-description-confirm').click();

    expect(editor.getMarkdown()).toBe('before\n\n![](assets/Holiday-Photo.png)\n\nafter');
  });

  it('keeps the other bytes of an image the file wrote as inline HTML', () => {
    const editor = openWithMenu(INLINE_HTML);
    chooseTheEntry();

    expect(field().value).toBe('a & b');
    field().value = 'A dog asleep on a sofa';
    element('image-description-confirm').click();

    expect(editor.getMarkdown()).toBe(
      'before\n\n<img src=\'assets/p.png\' alt="A dog asleep on a sofa" width=600 title="t" style="border:1px solid red">\n\nafter',
    );
  });

  it('changes nothing on Escape, and on Cancel', () => {
    const editor = openWithMenu(MARKDOWN);

    chooseTheEntry();
    field().value = 'never written';
    press('Escape');
    expect(isOpen()).toBe(false);
    expect(editor.getMarkdown()).toBe(MARKDOWN);

    chooseTheEntry();
    field().value = 'never written either';
    element('image-description-cancel').click();
    expect(editor.getMarkdown()).toBe(MARKDOWN);
  });

  it('is one press of undo after a write', () => {
    const editor = openWithMenu(MARKDOWN);
    chooseTheEntry();
    field().value = 'A dog asleep on a sofa';
    element('image-description-confirm').click();

    editor.editor.commands.undo();

    expect(editor.getMarkdown()).toBe(MARKDOWN);
  });

  /**
   * The entry is greyed with no image, so this state cannot be reached from
   * the menu — and the dialog refuses it anyway rather than asking for a
   * description nothing would receive. Both halves are asserted: the entry
   * cannot be chosen, and the door behind it does nothing if it is.
   */
  it('cannot be chosen with no image selected, and opens nothing if it is reached anyway', () => {
    const editor = openWithMenu(MARKDOWN, false);
    editor.editor.commands.setTextSelection(2);

    element('menu-toggle').click();
    element('menu-section-edit').click();
    expect((element('menu-image-description') as HTMLButtonElement).disabled).toBe(true);

    element('menu-image-description').click();

    expect(isOpen()).toBe(false);
    expect(editor.getMarkdown()).toBe(MARKDOWN);
  });

  /**
   * The line above the field is the only explaining surface in the product,
   * and it is what the owner condition rests on. The row pins that it ships
   * and that it says what the field is for; whether it *works* is the manual
   * pass.
   */
  it('carries one plain line above the field saying what the description is for', () => {
    openWithMenu(MARKDOWN);
    chooseTheEntry();

    const note = element('image-description-dialog').querySelector('.dialog-note');
    const dialog = element('image-description-dialog').querySelector('.dialog');
    expect(note?.textContent).toBe(
      'Read out instead of the picture, and shown wherever the image cannot be loaded.',
    );
    // Above the field rather than under it, where the eye already is.
    expect(Array.from(dialog?.children ?? []).indexOf(note as Element)).toBeLessThan(
      Array.from(dialog?.children ?? []).findIndex((c) => c.classList.contains('dialog-fields')),
    );
  });
});
