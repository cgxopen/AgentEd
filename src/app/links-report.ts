import type { Editor } from '@tiptap/core';
import { isReplacingDocument } from '../editor/document-load';
import type { PlatformIO } from '../platform/types';
import type { LinksPopover } from '../ui/links-popover';
import { showToast } from '../ui/toast';
import { checkLinks, collectLinks, type DocumentLink } from './link-check';

/**
 * When the broken link check of #729 runs, and where its answer goes.
 *
 * **At open and at save, never at an edit.** `run` is called for a document
 * arriving, by every route R-C16 names, and after a save that wrote; nothing
 * calls it from a keystroke. So between two saves the badge says what the last
 * check found, and the User Guide says so.
 *
 * **The latest check wins.** A check is a run of presence questions, so a
 * document opened while the last one was still asking would otherwise take the
 * older answer; each run takes a number and an answer that is not the latest is
 * dropped.
 */
export interface LinksReportDeps {
  readonly editor: Editor;
  readonly documentPath: () => string | null;
  readonly io: () => Promise<PlatformIO>;
  readonly refreshBadge: (broken: number) => void;
  readonly popover: LinksPopover;
}

export interface LinksReport {
  /** Check the document now on screen. Resolves when its answer is drawn, or dropped. */
  run: () => Promise<void>;
  /** Put the caret on `link`, found again in the document as it stands. */
  jump: (link: DocumentLink) => void;
}

export const LINK_GONE_MESSAGE = 'This link is no longer in the document.';

export function createLinksReport(deps: LinksReportDeps): LinksReport {
  let generation = 0;

  async function run(): Promise<void> {
    generation += 1;
    const mine = generation;
    const links = collectLinks(deps.editor.state.doc);
    const io = await deps.io();
    const result = await checkLinks(deps.documentPath(), links, io);
    if (mine !== generation) return;
    deps.refreshBadge(result.broken.length);
    deps.popover.show(result);
  }

  /**
   * The link is found again by its address and its place among the links that
   * hold the same address, since an edit after the check moves every position
   * after it.
   */
  function jump(link: DocumentLink): void {
    const now = collectLinks(deps.editor.state.doc).filter((l) => l.href === link.href);
    const found = now.find((l) => l.occurrence === link.occurrence) ?? now[0];
    if (!found) {
      showToast(LINK_GONE_MESSAGE, 'info');
      return;
    }
    deps.editor
      .chain()
      .focus()
      .setTextSelection({ from: found.from, to: found.to })
      .scrollIntoView()
      .run();
  }

  return { run, jump };
}

/** After the next frame: a document is drawn before its links are checked. */
function afterNextFrame(fn: () => void): void {
  requestAnimationFrame(() => setTimeout(fn, 0));
}

/**
 * Run `check` for every document that arrives, by every route of R-C16, and
 * for nothing else: the transaction of a whole-document replacement is the one
 * address that tells a load from a keystroke (`isReplacingDocument`). The
 * check is put after the next frame, so it never stands between the person and
 * the document they opened.
 */
export function checkOnArrival(
  editor: Editor,
  check: () => void,
  defer: (fn: () => void) => void = afterNextFrame,
): void {
  editor.on('transaction', ({ transaction }) => {
    if (transaction.docChanged && isReplacingDocument()) defer(check);
  });
}
