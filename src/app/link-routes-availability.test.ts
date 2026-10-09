import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import shippedPage from '../../index.html?raw';
import { createEditor, type EditorInstance } from '../editor/setup';
import { setupToolbar } from '../ui/toolbar';
import { setupKeyboard } from './keyboard';
import { canMakeLink, type LinkDialog, setupLinkDialog } from './link-dialog';

/**
 * Ctrl+K and the link button of the floating toolbar follow the availability
 * the Insert entry reads since #450 (#20, owner decision of 2026-10-01).
 *
 * Inside a fenced block and on a selected rule the dialog cannot make a link:
 * measured at the #450 step zero, the address went into a fenced block as code
 * text, and on a rule nothing changed. The entry greyed there and the other
 * two doors did not, so Ctrl+K in a fenced block still put the address in as
 * code. Now the dialog does not open where `canMakeLink` says no, whichever
 * door asked, and the bar does not draw the button there - the rule #427 set
 * for a control that cannot act.
 *
 * Driven over the shipped dialog and a real editor, with Ctrl+K wired to the
 * same `open` `main.ts` wires it to. The keyboard listener is installed once,
 * since it has no teardown, and reaches the dialog of the current test.
 */

function shipped(open: string, close: string): string {
  const start = shippedPage.indexOf(open);
  const end = shippedPage.indexOf(close, start);
  if (start < 0 || end < 0) throw new Error(`index.html no longer ships ${open}`);
  return shippedPage.slice(start, end + close.length);
}

let instance: EditorInstance | null = null;
let dialog: LinkDialog | null = null;

beforeAll(() => {
  setupKeyboard({
    onSave: vi.fn(),
    onOpen: vi.fn(),
    onLink: () => dialog?.open(),
    onCodeBlock: vi.fn(),
    onToggleSidebar: vi.fn(),
  });
});

beforeEach(() => {
  document.body.innerHTML = shipped('<div id="link-dialog"', '\n    </div>');
});

afterEach(() => {
  instance?.destroy();
  instance = null;
  dialog = null;
  document.getElementById('floating-toolbar')?.remove();
  document.body.innerHTML = '';
});

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  instance = createEditor(host);
  instance.setMarkdown(markdown);
  dialog = setupLinkDialog(instance.editor);
  setupToolbar(instance.editor, { onLink: () => dialog?.open(), onImageDescription: vi.fn() });
  return instance;
}

function position(editor: EditorInstance, type: string): number {
  let found = -1;
  editor.editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.type.name === type) found = pos;
  });
  if (found < 0) throw new Error(`no ${type} in the document`);
  return found;
}

function selectText(editor: EditorInstance, from: number, to = from): void {
  editor.editor.view.dispatch(
    editor.editor.state.tr.setSelection(TextSelection.create(editor.editor.state.doc, from, to)),
  );
}

function selectNode(editor: EditorInstance, type: string): void {
  editor.editor.view.dispatch(
    editor.editor.state.tr.setSelection(
      NodeSelection.create(editor.editor.state.doc, position(editor, type)),
    ),
  );
}

const overlay = () => document.getElementById('link-dialog') as HTMLElement;
const dialogIsOpen = () => !overlay().classList.contains('hidden');

function pressCtrlK(): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'k',
    code: 'KeyK',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  document.dispatchEvent(event);
  return event;
}

/** The link button as drawn, or null where the bar leaves it out. */
function drawnLinkButton(): HTMLButtonElement | null {
  const button = Array.from(
    document.querySelectorAll<HTMLButtonElement>('#floating-toolbar button'),
  ).find((b) => b.title === 'Link (Ctrl+K)');
  if (!button) throw new Error('the toolbar rendered no link button');
  return button.hidden ? null : button;
}

const FENCE = 'before\n\n```\ncode here\n```\n\nafter';

/** [label, the document, where the selection goes, whether a link can be made] */
const PLACES: ReadonlyArray<readonly [string, string, (e: EditorInstance) => void, boolean]> = [
  ['the caret in a fenced block', FENCE, (e) => selectText(e, position(e, 'codeBlock') + 3), false],
  [
    'text selected in a fenced block',
    FENCE,
    (e) => selectText(e, position(e, 'codeBlock') + 1, position(e, 'codeBlock') + 5),
    false,
  ],
  ['a selected horizontal rule', 'a\n\n---\n\nb', (e) => selectNode(e, 'horizontalRule'), false],
  ['a selected image', 'a ![alt](i.png) b', (e) => selectNode(e, 'image'), true],
  ['text selected in a paragraph', 'plain words', (e) => selectText(e, 1, 6), true],
];

describe('Ctrl+K follows the availability of the Insert entry (#20)', () => {
  it.each(PLACES)('%s', (_label, markdown, place, linkable) => {
    const editor = editorWith(markdown);
    place(editor);
    expect(canMakeLink(editor.editor.state.selection), 'the reading the entry greys on').toBe(
      linkable,
    );

    const event = pressCtrlK();
    const opened = dialogIsOpen();
    // Where it opened, finish what the person would: an address and Enter.
    // On the build before this change that is what wrote the address into
    // the fenced block as code text.
    if (opened) {
      (document.getElementById('link-url') as HTMLInputElement).value = 'https://example.com';
      (document.getElementById('link-confirm') as HTMLButtonElement).click();
    }

    expect(opened).toBe(linkable);
    // The chord is claimed either way, so nothing else answers it.
    expect(event.defaultPrevented).toBe(true);
    if (!linkable) expect(editor.getMarkdown()).toBe(markdown);
  });
});

/** The bar hides at a bare caret (#409), so the caret row has no bar to ask. */
const WITH_A_BAR = PLACES.filter(([label]) => !label.startsWith('the caret'));

describe('the toolbar link button is drawn where a link can be made (#20)', () => {
  it.each(WITH_A_BAR)('%s', (_label, markdown, place, linkable) => {
    const editor = editorWith(markdown);
    place(editor);
    expect(drawnLinkButton() !== null).toBe(linkable);
  });
});
