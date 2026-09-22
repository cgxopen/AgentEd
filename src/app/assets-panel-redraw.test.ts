import { describe, expect, it } from 'vitest';
import loadSource from '../editor/document-load.ts?raw';
import { createEditor } from '../editor/setup';
import mainSource from '../main.ts?raw';
import type { FileEntry, PlatformIO } from '../platform/types';
import { documentReferencesImage } from '../ui/document-badges';
import type { Sidebar } from '../ui/sidebar';
import { refreshSidebar } from './sidebar-sync';
import { AppState } from './state';

function countingIo(calls: string[]): PlatformIO {
  return {
    entryPresence: async (p: string) => {
      calls.push(`entryPresence ${p}`);
      return p === '/proj/assets' ? ('present' as const) : ('absent' as const);
    },
    listDir: async (p: string): Promise<FileEntry[]> => {
      calls.push(`listDir ${p}`);
      return [{ name: 'photo.png', path: '/proj/assets/photo.png', isDirectory: false }];
    },
    canWriteCompanions: async () => true,
  } as unknown as PlatformIO;
}

function bar(): Sidebar {
  const s = {} as Record<string, unknown>;
  for (const n of [
    'toggle',
    'setOnFileClick',
    'onVisibleChange',
    'setOnRequestAccess',
    'forgetClosedByHand',
    'markUnused',
    'setOnOpenByHand',
    'showTree',
    'showNothingRelated',
    'showAccessOffer',
    'showUnreadable',
    'hide',
  ])
    s[n] = () => {};
  s.isVisible = () => true;
  s.isCurrent = () => true;
  s.beginSwitch = () => 0;
  s.isLatest = () => true;
  s.isClosedByHand = () => false;
  return s as unknown as Sidebar;
}

/**
 * Issue #418, point f — what the panel redraw costs, and how often it happens.
 *
 * The owner chose to redraw the files panel when the document crosses between
 * referencing an image and not, rather than narrowing R-C6, and asked for both
 * figures with the repair because the choice rests on them. They are rows
 * rather than a sentence in a description, so a later change that makes the
 * redraw expensive, or makes it fire on every keystroke, is caught here.
 *
 * **What is not here**: that `main.ts` asks on the crossing and not on an
 * ordinary edit is wiring over an editor, and the manual pass is where it is
 * seen. These rows are the two halves that are countable.
 */
/**
 * **The wiring is read rather than driven, and that is stated.** `main.ts` is
 * the bootstrap: importing it runs the application, so no row can start it and
 * watch a transaction. Building the repair backwards confirms the gap - taking
 * the redraw out leaves the whole suite green - so what is held here is the
 * mechanism at its one address, the shape `toolbar-floor.test.ts` and
 * `header-room-triggers.test.ts` use for the same reason. That the panel is
 * right on screen after the last picture goes is the manual pass.
 */
describe('#418 point f, the wiring the harness cannot start', () => {
  const flat = mainSource.replace(/\s+/g, ' ');

  it('the redraw is asked on the crossing, not on every edit', () => {
    // Measured on `7fd1550`: the badge withdrew on the transaction and the
    // panel kept its tree until the next save.
    expect(flat).toContain('const crossed = referencesImage !== state.referencesImage;');
    expect(flat).toContain('if (!crossed) return;');
    expect(flat).toContain("void ctx.refreshSidebar('same-document')");
  });

  it('and not while a document is being put on screen, which redraws anyway', () => {
    // Without this the open of a document holding a picture reads the folder
    // twice: the crossing fires on the way in, and the open route refreshes.
    expect(flat).toContain('if (isReplacingDocument()) return;');
    // The flag is true for exactly the transactions a replacement makes, at
    // the one address R-C16 guarantees every route reaches.
    expect(loadSource.replace(/\s+/g, ' ')).toContain('replacing = true; try {');
    expect(loadSource).toContain('export function isReplacingDocument(): boolean');
  });

  it('the failure is reported rather than swallowed', () => {
    expect(flat).toContain(
      "console.error('[main] the files panel could not be redrawn after an edit:'",
    );
  });
});

describe('#418 point f, the two figures the decision rests on', () => {
  it('one redraw is one directory read', async () => {
    const calls: string[] = [];
    const state = new AppState();
    state.filePath = '/proj/chapter.md';
    state.referencesImage = true;
    await refreshSidebar(state, bar(), countingIo(calls), 'same-document');
    // Named rather than counted loosely: what the redraw asks of the platform.
    // Two calls - one presence check and one listing - and both are on the
    // folder beside the document. `canWriteCompanions` is asked first and is
    // path arithmetic on the desktop, so it is not recorded here.
    expect(calls).toEqual(['entryPresence /proj/assets', 'listDir /proj/assets']);
  });

  it('ordinary typing crosses nothing', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const editor = createEditor(host);
    let last = false;
    let crossings = 0;
    const observe = () => {
      const now = documentReferencesImage(editor.editor);
      if (now !== last) crossings++;
      last = now;
    };

    // A document with a picture, then twelve ordinary edits to its prose.
    editor.setMarkdown('# Chapter\n\n![a](assets/photo.png)\n\nProse.');
    observe();
    for (let i = 0; i < 12; i++) {
      editor.setMarkdown(`# Chapter\n\n![a](assets/photo.png)\n\nProse ${'and more '.repeat(i)}.`);
      observe();
    }
    expect(crossings).toBe(1); // the arrival of the picture, and nothing since

    // Then the picture goes, and comes back.
    editor.setMarkdown('# Chapter\n\nProse.');
    observe();
    editor.setMarkdown('# Chapter\n\n![a](assets/photo.png)\n\nProse.');
    observe();
    expect(crossings).toBe(3);
    editor.destroy();
    host.remove();
  });
});
