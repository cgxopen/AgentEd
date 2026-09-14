import { Extension } from '@tiptap/core';
import { Fragment, DOMParser as ProseMirrorDOMParser, Slice } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { isInTable, handlePaste as pasteCellsIntoTable } from '@tiptap/pm/tables';
import type { EditorView } from '@tiptap/pm/view';
import { showToast } from '../ui/toast';
import { isSingleUrl } from './link-url';
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
 * Four sources, four answers:
 *
 *   - **Plain text** is read as markdown, the way the file-open path reads a
 *     document: a heading pasted from another editor or an AI chat arrives as
 *     a heading, not as escaped source. Single newlines become line breaks
 *     rather than spaces, so the lines the user copied stay the lines they
 *     pasted.
 *   - **Rich HTML** is converted with the same serializer that writes the
 *     file, then re-parsed: whatever the source page wrapped its text in —
 *     spans, styles, classes, editor chrome — cannot survive a round trip
 *     through plain markdown, so no leftover markup reaches the document.
 *   - **A forced plain paste** (Ctrl+Shift+V) inserts the characters
 *     literally, markdown syntax and all — the escape hatch for when the
 *     text is meant to be read, not obeyed.
 *   - **A copy from this editor** (`data-pm-slice`) is left to ProseMirror.
 *     Its HTML is already ours, so there is nothing to clean, and its slice
 *     context is what keeps copying a table row or a list item faithful.
 *
 * A caret inside a fenced block short-circuits all of it: there, every source
 * is text and newlines are content.
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

/**
 * True for the keystroke that requests a forced plain paste: Ctrl+Shift+V, or
 * Cmd+Shift+V on macOS.
 *
 * Matched here rather than through a ProseMirror `Mod-Shift-v` binding, which
 * is what #32 broke on. `Mod-Shift-v` normalizes to the map entry
 * `Ctrl-Shift-v` (lowercase v), while a real Ctrl+Shift+V keydown reports
 * `key === 'V'` — shifted, so uppercase — and looks up `Ctrl-Shift-V`. The two
 * only meet through prosemirror-keymap's fallback on the *deprecated*
 * `event.keyCode`; any WebView that omits or zeroes that field never fires the
 * binding, the plain branch is never armed, and the paste falls through to the
 * ordinary one — exactly the reported symptom.
 *
 * `event.code` is the physical key, unaffected by the shift state and by the
 * keyboard layout, so it is tried first; `event.key` covers events that carry
 * no code (synthetic events, some IMEs).
 */
export function isPlainPasteShortcut(event: KeyboardEvent): boolean {
  if (!(event.ctrlKey || event.metaKey)) return false;
  if (!event.shiftKey || event.altKey) return false;
  return event.code === 'KeyV' || event.key === 'v' || event.key === 'V';
}

/** Rich HTML rewritten as the markdown pipeline would write and read it. */
export function cleanPastedHtml(html: string): string {
  return markdownToHtml(htmlToMarkdown(html));
}

/** True for HTML this editor put on the clipboard itself. */
export function isInternalPaste(html: string): boolean {
  return html.includes('data-pm-slice');
}

/** True when the caret sits in a block whose content is literal text. */
function isCodeBlockSelection(view: EditorView): boolean {
  return view.state.selection.$from.parent.type.spec.code === true;
}

function insertLiteralText(view: EditorView, text: string): void {
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

/**
 * Already-sanitized HTML as a document slice. Both ends come back open, so a
 * single pasted paragraph merges into the sentence at the caret instead of
 * breaking it in two.
 */
function parseSlice(view: EditorView, html: string): Slice {
  const container = document.createElement('div');
  container.innerHTML = html;
  return ProseMirrorDOMParser.fromSchema(view.state.schema).parseSlice(container, {
    preserveWhitespace: false,
  });
}

/** True when the parsed clipboard holds a table at the top of its content. */
function holdsATable(slice: Slice): boolean {
  let found = false;
  slice.content.forEach((node) => {
    if (node.type.name === 'table') found = true;
  });
  return found;
}

/**
 * Cells from anywhere else, placed where cells copied from this editor are
 * placed (#293).
 *
 * ── The two paths, and why only one of them used to be reached ──
 *
 * `prosemirror-tables` carries its own paste handler, and it is the one that
 * answers a copy from this editor: it reads the slice as cells, overwrites the
 * cells it lands on, and grows the table **only at the right end of a row and
 * only with whole rows at the bottom** (`insertCells`, then `growTable`).
 * Nothing is ever inserted in the middle of a row.
 *
 * This plugin never let that handler see any other clipboard. TipTap builds
 * its plugin list from the extension array **reversed**, so an extension later
 * in the list answers first, and `PredictablePaste` sits after the table
 * extension in `setup.ts`. This handler took the paste, returned true and
 * called `preventDefault`, so the table handler was never asked — and
 * `replaceSelection` below fits a slice by splitting the row open and putting
 * the pasted cells inside it, which pushed the cells that were already there
 * to the right and left a value under another header.
 *
 * Handing the slice over restores what this repository did before a paste
 * handler existed: measured at the reset commit `a8c770c`, the same paste
 * overwrote and grew at the right, and the behaviour arrived with `df91691`,
 * the commit that added this file.
 *
 * **Only a clipboard that holds a table is handed over**, which is narrower
 * than the table handler itself would accept and is measured rather than
 * cautious: over a selection of cells that handler wraps any other content
 * into one cell and tiles it across the whole selection, so plain text pasted
 * over three selected cells landed in all three where it used to clear them
 * and land in the last. That behaviour is pinned by `cell-selection.test.ts`
 * and belongs to no part of this defect. A paragraph therefore still reaches
 * `replaceSelection` below and merges into the cell the caret is in.
 */
function placedAsCells(view: EditorView, event: ClipboardEvent, slice: Slice): boolean {
  if (!isInTable(view.state) || !holdsATable(slice)) return false;
  return pasteCellsIntoTable(view, event, slice);
}

/**
 * A pasted table does not swallow the text that follows the caret (#293).
 *
 * `parseSlice` returns a table four levels open at each end — table, row,
 * cell, paragraph — which is what lets a pasted paragraph merge into the
 * sentence at the caret. For a table that open end is harm rather than help:
 * the text after the caret is fitted **into the last pasted cell**, so
 * `before text|after` came back as a table whose last cell read `y after`,
 * and the same in a blockquote and in a heading.
 *
 * Closing the end leaves the trailing text where it was, below the table.
 * The start is left as parsed: closing it as well was built and measured to
 * write the same bytes in all 35 cases, so it buys nothing.
 */
function withoutTheTrailingMerge(slice: Slice): Slice {
  if (!holdsATable(slice)) return slice;
  return new Slice(slice.content, slice.openStart, 0);
}

function insertParsedHtml(view: EditorView, event: ClipboardEvent, html: string): void {
  const slice = parseSlice(view, html);
  if (placedAsCells(view, event, slice)) return;
  view.dispatch(
    view.state.tr
      .replaceSelection(withoutTheTrailingMerge(slice))
      .setMeta('preventAutolink', true)
      .scrollIntoView(),
  );
}

/**
 * Plain text read as markdown — the same reading the file-open path gives.
 *
 * A paste that is a single line keeps the spaces around it: markdown treats
 * edge whitespace as insignificant (and four of them as a code block), but a
 * word dropped into the middle of a sentence needs the space the user
 * copied, so those spaces are set aside and put back around the result.
 */
function insertMarkdown(view: EditorView, event: ClipboardEvent, text: string): void {
  const singleLine = !/[\r\n]/.test(text);
  const leading = singleLine ? (/^[ \t]*/.exec(text)?.[0] ?? '') : '';
  const trailing = singleLine ? (/[ \t]*$/.exec(text)?.[0] ?? '') : '';
  const body = singleLine ? text.slice(leading.length, text.length - trailing.length) : text;

  // A markdown table reaches the document through the same two answers a rich
  // HTML one does: the table path when the caret is in a table, and a closed
  // end when it is not.
  const slice = parseSlice(view, markdownToHtml(body, { breaks: true }));
  if (placedAsCells(view, event, slice)) return;

  const tr = view.state.tr.setMeta('preventAutolink', true);
  if (leading.length > 0) tr.insertText(leading);
  tr.replaceSelection(withoutTheTrailingMerge(slice));
  if (trailing.length > 0) tr.insertText(trailing);
  view.dispatch(tr.scrollIntoView());
}

function insertCleanedHtml(view: EditorView, event: ClipboardEvent, html: string): void {
  // cleanPastedHtml ends in markdownToHtml, which sanitizes with DOMPurify.
  insertParsedHtml(view, event, cleanPastedHtml(html));
}

function pasteLiterally(view: EditorView, text: string): boolean {
  if (!text) return false;
  insertLiteralText(view, text);
  return true;
}

/**
 * Paste a URL over a selection and the selection becomes a link to it — the
 * gesture Word, Google Docs and GitHub's editor all share, and how most links
 * actually get written: the sentence first, the address after (#25).
 *
 * This is the opposite of what R-C13 forbids. R-C13 is about a pasted URL
 * linking *itself* — syntax appearing in the file the user did not ask for.
 * Here the user selected the text and supplied the destination, which is an
 * authoring act, and the two live a few lines apart on purpose.
 *
 * Deliberately narrow, because a wrong guess in the permissive direction turns
 * an ordinary paste into a mangled link:
 *
 *   - the clipboard must hold a URL and nothing else (`isSingleUrl`);
 *   - the selection must be non-empty and inside a single text block — a
 *     selection spanning paragraphs is not link text;
 *   - Ctrl+Shift+V never reaches here: forced-plain returns above it;
 *   - a copy from this editor keeps going to ProseMirror, which owns the
 *     slice context for internal pastes.
 */
function isLinkableSelection(view: EditorView): boolean {
  const { selection, schema } = view.state;
  if (selection.empty || !schema.marks.link) return false;
  if (!(selection instanceof TextSelection)) return false;
  return selection.$from.sameParent(selection.$to) && selection.$from.parent.isTextblock;
}

function linkSelection(view: EditorView, href: string): void {
  const { state } = view;
  // One transaction, so undo returns to the selected text in a single step
  // rather than "link removed, then text restored". addMark drops any link
  // mark already in the range, so pasting over an existing link replaces its
  // destination instead of nesting one link inside another.
  const tr = state.tr.addMark(
    state.selection.from,
    state.selection.to,
    state.schema.marks.link.create({ href }),
  );
  view.dispatch(tr.scrollIntoView());
}

/**
 * Arm the plain branch from a DOM keydown, in the capture phase, and let the
 * keystroke through: the WebView's own paste-as-plain-text raises the paste
 * event that follows. Capture phase and the document as the listener target
 * mean nothing between the key and the editor can swallow the request first.
 * The editor must own the keystroke, though — a Ctrl+Shift+V typed in the
 * search field is not a request to paste into the document.
 */
function armPlainPasteOnKeydown(view: EditorView, storage: PredictablePasteStorage): () => void {
  const doc = view.dom.ownerDocument;

  function onKeydown(event: KeyboardEvent): void {
    if (!isPlainPasteShortcut(event)) return;
    const target = event.target;
    if (!(target instanceof Node) || !view.dom.contains(target)) return;
    storage.plainPasteRequestedAt = Date.now();
  }

  doc.addEventListener('keydown', onKeydown, true);
  return () => doc.removeEventListener('keydown', onKeydown, true);
}

export function createPastePlugin(storage: PredictablePasteStorage): Plugin {
  return new Plugin({
    key: new PluginKey('predictablePaste'),
    view(view: EditorView) {
      const disarm = armPlainPasteOnKeydown(view, storage);
      return { destroy: disarm };
    },
    props: {
      handlePaste(view: EditorView, event: ClipboardEvent): boolean {
        if (!event.clipboardData) return false;
        const text = event.clipboardData.getData('text/plain');
        const html = event.clipboardData.getData('text/html');

        const requestedAt = storage.plainPasteRequestedAt;
        storage.plainPasteRequestedAt = 0;
        const forcePlain = requestedAt > 0 && Date.now() - requestedAt < PLAIN_PASTE_WINDOW_MS;

        // Ctrl+Shift+V, or a fenced block where markdown means nothing and
        // newlines are content: the characters go in exactly as they stand.
        if (forcePlain || isCodeBlockSelection(view)) {
          if (!pasteLiterally(view, text)) return false;
          event.preventDefault();
          return true;
        }

        // A lone URL dropped on a selection links it (#25). Checked before the
        // clipboard's HTML is looked at: copying a link out of a web page puts
        // an <a> on the clipboard next to the URL text, and the gesture means
        // the same thing either way. A copy from this editor is left alone.
        const internal = html !== '' && isInternalPaste(html);
        if (!internal && isSingleUrl(text) && isLinkableSelection(view)) {
          linkSelection(view, text.trim());
          event.preventDefault();
          return true;
        }

        if (!html) {
          if (!text) return false;
          try {
            insertMarkdown(view, event, text);
          } catch (error) {
            console.error('[agented] failed to read pasted text as markdown:', error);
            if (!pasteLiterally(view, text)) return false;
          }
          event.preventDefault();
          return true;
        }

        // A copy from this editor: ProseMirror's own path preserves the
        // slice context, and the markup is already ours.
        if (isInternalPaste(html)) return false;

        if (html.length > MAX_PASTED_HTML_LENGTH) {
          if (!pasteLiterally(view, text)) return false;
          showToast('Pasted as plain text — the copied content was too large to convert.', 'warn');
          event.preventDefault();
          return true;
        }

        try {
          insertCleanedHtml(view, event, html);
        } catch (error) {
          // Never drop the paste on the floor: fall back to the text the
          // clipboard also carries, and say why the formatting was lost.
          console.error('[agented] failed to convert pasted HTML:', error);
          if (!pasteLiterally(view, text)) return false;
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

  // Ctrl+Shift+V is armed by the plugin's own DOM listener rather than by a
  // keyboard shortcut here — see isPlainPasteShortcut for why (#32).

  addProseMirrorPlugins() {
    return [createPastePlugin(this.storage)];
  },
});
