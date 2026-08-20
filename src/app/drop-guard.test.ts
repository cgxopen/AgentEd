/**
 * Issue #65 — with `dragDropEnabled: false` the webview finally receives
 * drops on Windows, and that includes every drop the editor has no use
 * for. The browser's default action for those is to navigate away from
 * the document, so "a dropped `.docx` does nothing" stops being the
 * status quo and becomes something this code has to arrange.
 *
 * The tests below drive the two halves that are reachable here: the
 * image plugin genuinely declines a non-image drop (so nothing upstream
 * of the guard claims it), and the guard cancels exactly the drops
 * nothing claimed. What happens *after* an uncancelled drop — the
 * navigation itself — is the browser's, not this DOM's, and stays for
 * the owner's Windows pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditor, type EditorInstance } from '../editor/setup';
import { installDropGuard } from './drop-guard';

/** A drop event as the browser dispatches one, with only what is read from it. */
function dropEvent(type: 'drop' | 'dragover' | 'dragenter', files: File[] = []): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { files, types: files.length ? ['Files'] : [], getData: () => '' },
  });
  return event;
}

function nonImage(): File {
  return new File([new Uint8Array([1, 2, 3])], 'report.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

function image(): File {
  return new File([new Uint8Array([1, 2, 3])], 'diagram.png', { type: 'image/png' });
}

let uninstall: (() => void) | null = null;
let instance: EditorInstance | null = null;

/** An editor wired for images the way `main.ts` wires it. */
function wiredEditor(): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return createEditor(host, undefined, {
    getFilePath: () => '/doc/notes.md',
    requestSaveAs: async () => '/doc/notes.md',
    confirmAssetsDir: async () => '/doc/assets',
    report: vi.fn(),
  });
}

/** Ask the registered plugin whether it takes this drop, as ProseMirror does. */
function offerToPlugin(wired: EditorInstance, files: File[]): boolean {
  const { view } = wired.editor;
  const event = dropEvent('drop', files) as DragEvent;
  return Boolean(
    view.someProp('handleDrop', (handler) =>
      handler(view, event, view.state.selection.content(), false),
    ),
  );
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  instance?.destroy();
  instance = null;
});

describe('#65 — what the image plugin declines', () => {
  it('hands a non-image drop back rather than claiming it', () => {
    instance = wiredEditor();

    expect(offerToPlugin(instance, [nonImage()])).toBe(false);
  });

  it('still claims a drop that carries an image', () => {
    instance = wiredEditor();

    expect(offerToPlugin(instance, [image()])).toBe(true);
  });
});

describe('#65 — the drop guard', () => {
  it('cancels a drop nothing claimed', () => {
    uninstall = installDropGuard();
    const event = dropEvent('drop', [nonImage()]);

    document.body.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('is the only thing that cancels it — without the guard the drop stands', () => {
    // The measurement behind the guard's existence: nothing else in the
    // page cancels an unclaimed file drop, which is what leaves the
    // browser free to navigate to the dropped file.
    const event = dropEvent('drop', [nonImage()]);

    document.body.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('cancels a drop that reached the editing surface unclaimed', () => {
    instance = wiredEditor();
    uninstall = installDropGuard();
    const event = dropEvent('drop', [nonImage()]);

    instance.editor.view.dom.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
  });

  it('cancels dragover and dragenter, so a drop is delivered rather than acted on', () => {
    uninstall = installDropGuard();
    const over = dropEvent('dragover', [nonImage()]);
    const enter = dropEvent('dragenter', [nonImage()]);

    document.body.dispatchEvent(over);
    document.body.dispatchEvent(enter);

    expect(over.defaultPrevented).toBe(true);
    expect(enter.defaultPrevented).toBe(true);
  });

  it('leaves a claimed drop alone and never stops it propagating', () => {
    uninstall = installDropGuard();
    const host = document.createElement('div');
    document.body.appendChild(host);
    // Stands in for the image plugin: claims the drop by cancelling it.
    host.addEventListener('drop', (e) => e.preventDefault());
    const seenAfterGuard = vi.fn();
    window.addEventListener('drop', seenAfterGuard);

    const event = dropEvent('drop', [image()]);
    host.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(seenAfterGuard).toHaveBeenCalledTimes(1);
    window.removeEventListener('drop', seenAfterGuard);
  });

  it('stops guarding once uninstalled', () => {
    installDropGuard()();
    const event = dropEvent('drop', [nonImage()]);

    document.body.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
