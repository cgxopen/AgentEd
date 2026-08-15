import { Extension } from '@tiptap/core';
import { Fragment, DOMParser as ProseMirrorDOMParser, Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { showToast } from '../ui/toast';
import { markdownToHtml } from './markdown/parse';
import { htmlToMarkdown } from './markdown/serialize';

/**
 * Predictable paste (R-C13, defect D2).
 *
 * Paste is handled here from end to end rather than left to ProseMirror's
 * clipboard path, because that path applies TipTap's paste rules — the rules
 * that turn `**text**` in *plain* text into bold and a bare URL into a link.
 * A transaction dispatched here carries no `uiEvent: 'paste'` meta, so those
 * rules never see it, and `preventAutolink` keeps the Link extension from
 * linkifying pasted text (typing a URL still autolinks, which is the only way
 * to make a link in this build).
 *
 * Three sources, three answers:
 *
 *   - **Plain text** goes in exactly as it stands. Newlines split paragraphs,
 *     except inside a fenced block where they are content.
 *   - **Rich HTML** is converted with the same serializer that writes the
 *     file, then re-parsed: whatever the source page wrapped its text in —
 *     spans, styles, classes, editor chrome — cannot survive a round trip
 *     through plain markdown, so no leftover markup reaches the document.
 *   - **A copy from this editor** (`data-pm-slice`) is left to ProseMirror.
 *     Its HTML is already ours, so there is nothing to clean, and its slice
 *     context is what keeps copying a table row or a list item faithful.
 */

/**
 * How long a Ctrl+Shift+V keypress arms the plain-text paste that follows.
 * The keypress and the paste event it triggers are consecutive, so the window
 * only has to outlast one event loop turn; a stale flag must never turn an
 * ordinary paste two minutes later into a plain one.
 */
const PLAIN_PASTE_WINDOW_MS = 1000;

/**
 * Clipboard HTML above this size is pasted as plain text instead of being
 * converted. Serializing then re-parsing multiple megabytes of markup would
 * block the UI thread, and the plain text alternative is always at hand.
 */
const MAX_PASTED_HTML_LENGTH = 2 * 1024 * 1024;

export interface PredictablePasteStorage {
  /** Timestamp of the last Ctrl+Shift+V, or 0 when none is pending. */
  plainPasteRequestedAt: number;
}

/** Rich HTML rewritten as the markdown pipeline would write and read it. */
export function cleanPastedHtml(html: string): string {
  return markdownToHtml(htmlToMarkdown(html));
}

/** True for HTML this editor put on the clipboard itself. */
export function isInternalPaste(html: string): boolean {
  return html.includes('data-pm-slice');
}

function insertPlainText(view: EditorView, text: string): void {
  const { state } = view;
  const tr = state.tr.setMeta('preventAutolink', true);

  // Inside a fenced block newlines are content, not block boundaries.
  if (state.selection.$from.parent.type.spec.code) {
    view.dispatch(tr.insertText(text).scrollIntoView());
    return;
  }

  const paragraph = state.schema.nodes.paragraph;
  const blocks = text
    .split(/\r\n?|\n/)
    .map((line) => paragraph.create(null, line.length > 0 ? state.schema.text(line) : null));
  // Both ends open, so a single pasted line merges into the paragraph the
  // caret sits in instead of breaking the sentence in two.
  view.dispatch(tr.replaceSelection(new Slice(Fragment.from(blocks), 1, 1)).scrollIntoView());
}

function insertCleanedHtml(view: EditorView, html: string): void {
  const container = document.createElement('div');
  // cleanPastedHtml ends in markdownToHtml, which sanitizes with DOMPurify.
  container.innerHTML = cleanPastedHtml(html);
  const slice = ProseMirrorDOMParser.fromSchema(view.state.schema).parseSlice(container, {
    preserveWhitespace: false,
  });
  view.dispatch(
    view.state.tr.replaceSelection(slice).setMeta('preventAutolink', true).scrollIntoView(),
  );
}

function pastePlainText(view: EditorView, text: string): boolean {
  if (!text) return false;
  insertPlainText(view, text);
  return true;
}

export function createPastePlugin(storage: PredictablePasteStorage): Plugin {
  return new Plugin({
    key: new PluginKey('predictablePaste'),
    props: {
      handlePaste(view: EditorView, event: ClipboardEvent): boolean {
        if (!event.clipboardData) return false;
        const text = event.clipboardData.getData('text/plain');
        const html = event.clipboardData.getData('text/html');

        const requestedAt = storage.plainPasteRequestedAt;
        storage.plainPasteRequestedAt = 0;
        const forcePlain = requestedAt > 0 && Date.now() - requestedAt < PLAIN_PASTE_WINDOW_MS;

        if (forcePlain || !html) {
          if (!pastePlainText(view, text)) return false;
          event.preventDefault();
          return true;
        }

        // A copy from this editor: ProseMirror's own path preserves the
        // slice context, and the markup is already ours.
        if (isInternalPaste(html)) return false;

        if (html.length > MAX_PASTED_HTML_LENGTH) {
          if (!pastePlainText(view, text)) return false;
          showToast('Pasted as plain text — the copied content was too large to convert.', 'warn');
          event.preventDefault();
          return true;
        }

        try {
          insertCleanedHtml(view, html);
        } catch (error) {
          // Never drop the paste on the floor: fall back to the text the
          // clipboard also carries, and say why the formatting was lost.
          console.error('[agented] failed to convert pasted HTML:', error);
          if (!pastePlainText(view, text)) return false;
          showToast('Pasted as plain text — the copied formatting could not be read.', 'warn');
        }
        event.preventDefault();
        return true;
      },
    },
  });
}

export const PredictablePaste = Extension.create<Record<string, never>, PredictablePasteStorage>({
  name: 'predictablePaste',

  addStorage() {
    return { plainPasteRequestedAt: 0 };
  },

  addKeyboardShortcuts() {
    return {
      // Arm the plain-text branch, then let the keystroke through: the
      // browser's own paste-as-plain-text raises the paste event we answer.
      'Mod-Shift-v': () => {
        this.storage.plainPasteRequestedAt = Date.now();
        return false;
      },
    };
  },

  addProseMirrorPlugins() {
    return [createPastePlugin(this.storage)];
  },
});
