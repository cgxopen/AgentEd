import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { copyText } from '../ui/clipboard';
import { showToast } from '../ui/toast';

/**
 * A fenced block shows a copy icon on hover (R-C15, #235).
 *
 * The second half of the R-C15 chrome that §8 carried as a candidate until the
 * owner decision of 2026-09-06. The first half is the language label (#202),
 * top-left; this is the icon, top-right. Making the label clickable stays a
 * candidate and is deliberately not here.
 *
 * ── It is chrome, and the route is what guarantees that ──
 *
 * A **widget decoration**, the same route #202 took and for the same reason: a
 * decoration is drawn by the view and exists nowhere in the document model, so
 * there is no path by which it can reach the file. The serializer is handed the
 * model, and the model has never heard of it.
 *
 * Route (b), a node view wrapping the `pre`, was the alternative and the owner
 * chose against it on the issue. It would pin the icon to the box instead of
 * letting it scroll with the code, but it would pin the language label too —
 * which the stylesheet names as an open product question — and it would change
 * how every fenced block in every document is drawn. The number that decided
 * it: measured on the 720px editor width against the stylesheet as it now
 * stands, this icon is in full view through the first 684px of horizontal
 * scroll, starts leaving at 685 and is gone at 704 — where the top-left label
 * starts leaving at 17 and is gone at 29. Same mechanism, opposite ends of the
 * box, and the consequence is not comparable.
 *
 * ── Where it differs from the label, and why each difference is needed ──
 *
 * The label carries `pointer-events: none` and `aria-hidden`. A button can
 * inherit neither: it exists to take a click, and hiding it from assistive
 * technology would hide the only affordance this adds. What it does keep from
 * the label is `contenteditable=false` and `ignoreSelection`, so a click on it
 * moves no caret, plus `stopEvent`, so the editor view leaves its events alone.
 *
 * `mousedown` is cancelled as well as `click`. Without it the browser would
 * place a selection before the click ever arrives, which is the caret movement
 * the criterion forbids rather than a redundant guard on the same event.
 *
 * ── What it copies ──
 *
 * The text of the `codeBlock` node, read from the model **at the moment of the
 * click** rather than captured when the widget was built, so an edit between
 * the two cannot put a stale string on the clipboard. Never the DOM: the label
 * of #202 is drawn at `pos + 1`, which puts it inside the rendered `<code>`,
 * so both `pre.textContent` and `code.textContent` carry it — measured, a
 * python fence reads `pythonprint(1)` through the DOM and `print(1)` through
 * the model.
 *
 * The model text is copied verbatim, trailing newline and all (owner decision,
 * 2026-09-06). It is the raw contents R-C15 promises, and a paste into a
 * terminal wants that newline; trimming it would be the copy quietly editing
 * what it copies.
 *
 * ── The keyboard, stated rather than implied ──
 *
 * The icon is a pointer affordance and a keyboard user does not get it. The
 * `pre` carries no `tabindex` and no `contenteditable` of its own — the
 * editable element is the `.tiptap` root above it — so focus never lands
 * inside the block and a `:focus-within` rule on the `pre` cannot match. The
 * button is `tabindex="-1"` so it stays out of the tab order rather than
 * appearing in it invisibly. A keyboard route would need editor state feeding
 * a class onto the block, which is a second mechanism for the same affordance
 * and is not built here.
 */
export const codeBlockCopyKey = new PluginKey('codeBlockCopy');

/** The class the stylesheet hides, and shows when the block is hovered. */
export const COPY_BUTTON_CLASS = 'code-block-copy';

/** How long the check glyph stands in for the clipboard glyph, in ms. */
export const COPY_FEEDBACK_MS = 1000;

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Inline SVG, so this adds no icon font, no asset and no dependency (Q1).
 *
 * Sized by attribute rather than by a stylesheet rule, so the class this
 * module writes has exactly the two rules the hover behaviour needs and a
 * third one cannot drift in unnoticed.
 */
function glyph(name: 'clipboard' | 'check', paths: readonly string[]): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  // Read by the tests to tell the two states apart without reading pixels.
  svg.setAttribute('data-glyph', name);
  for (const definition of paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', definition);
    svg.appendChild(path);
  }
  return svg;
}

function clipboardGlyph(): SVGElement {
  return glyph('clipboard', [
    'M9 3h6a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z',
    'M16 5h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2',
  ]);
}

function checkGlyph(): SVGElement {
  return glyph('check', ['M20 6 9 17l-5-5']);
}

/**
 * The text of the fenced block this widget sits in, read from the model now.
 *
 * `null` where the block is gone — a widget can outlive the node it was drawn
 * for by the length of a click, and a copy of nothing is a thing to say rather
 * than an exception to swallow.
 */
export function blockTextAt(view: EditorView, pos: number): string | null {
  const { doc } = view.state;
  if (pos < 0 || pos > doc.content.size) return null;
  const parent = doc.resolve(pos).parent;
  if (parent.type.name !== 'codeBlock') return null;
  return parent.textContent;
}

/** The button, with its own feedback timer so two blocks cannot share one. */
function buildButton(view: EditorView, getPos: () => number | undefined): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = COPY_BUTTON_CLASS;
  button.setAttribute('contenteditable', 'false');
  button.setAttribute('tabindex', '-1');
  button.setAttribute('aria-label', 'Copy the contents of this block');
  button.title = 'Copy';
  button.replaceChildren(clipboardGlyph());

  let revert: ReturnType<typeof setTimeout> | null = null;

  function showCopied(): void {
    if (revert !== null) clearTimeout(revert);
    button.replaceChildren(checkGlyph());
    revert = setTimeout(() => {
      button.replaceChildren(clipboardGlyph());
      revert = null;
    }, COPY_FEEDBACK_MS);
  }

  // Cancelled before the browser can place a selection from it; see the header.
  button.addEventListener('mousedown', (event) => event.preventDefault());

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();

    // `getPos` answers `undefined` once the widget has outlived its node, which
    // is the same answer as a position that no longer resolves to a fence.
    const pos = getPos();
    const text = pos === undefined ? null : blockTextAt(view, pos);
    if (text === null) {
      showToast('Could not copy — this block is no longer in the document.', 'warn');
      return;
    }
    if (text === '') {
      // `copyText` refuses the empty string, so this would otherwise arrive as
      // a failure. An empty block is not a failure; it has nothing to give.
      showToast('Nothing to copy — this block is empty.', 'warn');
      return;
    }

    void copyText(text).then((copied) => {
      if (copied) {
        showCopied();
        return;
      }
      // The clipboard write was refused. Measured on the shipped Windows build
      // (#235 step zero) as writing silently, so this is the path that has not
      // been seen rather than the path that cannot happen — and a copy that
      // did not happen is something to tell the user.
      showToast('Could not copy to the clipboard.', 'warn');
    });
  });

  return button;
}

/**
 * One widget per fenced block, at the block's start.
 *
 * Every fenced block, unlike the language label: R-C15 gives the plain text box
 * the same hover Copy button as a block with a language, so there is no
 * attribute to read and no negative case here.
 */
export function copyDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true;

    decorations.push(
      Decoration.widget(pos + 1, (view, getPos) => buildButton(view, getPos), {
        // `side: -1` draws it before any content at this position. The label of
        // #202 asks for the same side at the same position; both are absolutely
        // positioned against the `pre`, at opposite corners, so their order in
        // the DOM decides nothing about where either is drawn.
        side: -1,
        ignoreSelection: true,
        stopEvent: () => true,
      }),
    );

    // A code block holds text and nothing else, so nothing below it can be a
    // fenced block of its own — descending would be wasted work.
    return false;
  });

  return DecorationSet.create(doc, decorations);
}

export function createCodeBlockCopyPlugin(): Plugin {
  return new Plugin({
    key: codeBlockCopyKey,
    props: {
      decorations: (state) => copyDecorations(state.doc),
    },
  });
}

export const CodeBlockCopy = Extension.create({
  name: 'codeBlockCopy',
  addProseMirrorPlugins() {
    return [createCodeBlockCopyPlugin()];
  },
});
