import { Extension } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { openLanguagePopover } from '../ui/language-popover';

/**
 * A fenced block shows the language it was written with (R-C15, #195).
 *
 * Without it a fence with a language and one without are indistinguishable on
 * screen, which is what #103 met when a manual step asked for a label the
 * build could not show. Since #238 it is also the control that **sets** the
 * language: clicking it opens a field, which was the last R-C15 candidate §8
 * carried.
 *
 * ── A block with no language draws a mark too, and only on hover (#238) ──
 *
 * Owner decision, 2026-09-07, taken on this branch with both shapes built and
 * measured in Chromium against the stylesheet. The alternative was a
 * permanent muted `text` in the same corner, drawn on every plain block in
 * every document. R-C15 is what decided it: a fence with no language is *the
 * same bordered block with the same hover Copy button, no language label (the
 * picker offers Text)* — so a permanent word there would have been a
 * requirement change rather than a detail of this one, and #211 kept the
 * plain box plain. The mark is an **icon** rather than the word for the same
 * sentence: the plain box gains an affordance, not a label.
 *
 * Neither shape moved the document. Measured on the web build at the 720px
 * editor width: the block box stayed 720 by 60 and the first line of code
 * stayed at the same y in both, because the mark is drawn inside the 16px top
 * padding the block already has — the fact #202 established for the label,
 * re-measured rather than assumed.
 *
 * ── It is chrome, and the route is what guarantees that ──
 *
 * The label is a **widget decoration**, not a node view and not a node
 * attribute. A decoration is drawn by the view and exists nowhere in the
 * document model, so there is no path by which it can reach the file: the
 * serializer is handed the model, and the model has never heard of it. That
 * is a stronger statement than a test can make, and it is why this route was
 * taken over the alternatives:
 *
 *  - A `::before` rule reading the class would have been cheaper and is the
 *    shape #198 used for a loose list. It was rejected on two counts: the
 *    text of a pseudo-element is not in the DOM, so the label could not be
 *    asserted by reading what the editor renders, and a pseudo-element cannot
 *    take a click — which would foreclose the §8 candidate.
 *  - A node view would replace how a fenced block is drawn. That is a visual
 *    change to every document and an owner decision rather than a detail of
 *    this one.
 *
 * A widget leaves that door open: it is a real element, so a later change can
 * give it a handler without moving the label anywhere else.
 *
 * ── What it reads ──
 *
 * `codeBlock` carries the info string as its `language` attribute — measured
 * through the ordinary open path, where ```` ```python ```` arrives as
 * `codeBlock` with `language: "python"` and renders `<code
 * class="language-python">`, and a fence with no info string arrives with
 * `language: null` and renders a `<code>` with no class at all. It survives
 * typing inside the block, Enter and Backspace at its edges and copy-paste of
 * the whole block, all measured, so the label cannot read an attribute the
 * first keystroke drops.
 *
 * The negative half is the same fact: no language, no decoration, and a fence
 * created in the editor has no language, so nothing is drawn on it.
 */
export const codeBlockLanguageKey = new PluginKey('codeBlockLanguage');

/** The class the stylesheet positions the label with. */
export const LANGUAGE_LABEL_CLASS = 'code-block-language';

/** The class the stylesheet hides, and shows on hover, for a plain block. */
export const EMPTY_AFFORDANCE_CLASS = 'code-block-language-empty';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The language of this node as a label, or `null` where there is nothing to
 * show. `language` is `null` for a fence with no info string; the guards
 * around it are for a document model that has been through a paste or an
 * older file, where the attribute could be present and empty.
 */
function labelFor(node: ProseMirrorNode): string | null {
  const language: unknown = node.attrs.language;
  if (typeof language !== 'string') return null;
  const trimmed = language.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * The mark a plain block carries: a chevron pair, the ordinary sign for a
 * language, drawn inline so this adds no icon font, no asset and no
 * dependency (Q1). Sized by attribute rather than by a stylesheet rule, so
 * the class this module writes keeps exactly the rules the hover behaviour
 * needs.
 */
function languageGlyph(): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  // Read by the tests, so the mark can be told apart without reading pixels.
  svg.setAttribute('data-glyph', 'language');
  for (const definition of ['M9 8 5 12l4 4', 'M15 8l4 4-4 4']) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', definition);
    svg.appendChild(path);
  }
  return svg;
}

/**
 * Write a language onto one fenced block, as **one** transaction (R-C16).
 *
 * `closeHistory` for the reason #229 gives at `commitImageSize`: the history
 * plugin appends a change to the previous event when the two are close enough
 * in time, so setting the language of two blocks quickly would otherwise
 * collapse into a single undo. Closing the event on the way out means the
 * next change starts its own, and one gesture stays one step.
 *
 * `false` where the block is gone or already carries this language — a widget
 * can outlive its node by the length of a click, and a transaction that
 * changes nothing would still cost an undo step.
 */
export function commitBlockLanguage(
  view: EditorView,
  widgetPos: number,
  language: string | null,
): boolean {
  // `getPos` on a widget answers the position the widget sits **at**, which is
  // `pos + 1` — inside the block rather than at it, because that is where the
  // decoration was placed. So the node is the parent of that position and the
  // node's own position is `before` it. `nodeAt(widgetPos)` would hand back
  // the block's first text node instead, and the write would go nowhere:
  // measured on this branch, where every language set through this route
  // arrived as `null`. `blockTextAt` in `code-block-copy.ts` resolves the same
  // way for the same reason.
  const { doc } = view.state;
  if (widgetPos < 0 || widgetPos > doc.content.size) return false;
  const $pos = doc.resolve(widgetPos);
  const node = $pos.parent;
  if (node.type.name !== 'codeBlock') return false;
  if (node.attrs.language === language) return false;

  const tr = view.state.tr.setNodeMarkup($pos.before(), undefined, { ...node.attrs, language });
  view.dispatch(closeHistory(tr));
  return true;
}

/**
 * The label, or the mark a plain block carries, as one button.
 *
 * A `button` rather than the `span` this used to be: it exists to take a
 * click, so it takes the four things #236 gave the Copy icon — a click
 * handler, a cancelled `mousedown` so the browser places no selection before
 * the click arrives, a `tabindex` of -1 so it stays out of the tab order
 * rather than appearing in it invisibly, and an `aria-label` in place of the
 * `aria-hidden` a read-only label carried. What it keeps from that label is
 * `contenteditable=false`, and `user-select: none` in the stylesheet — which
 * #236 showed a clickable widget in this box can keep, against what the
 * comment there predicted.
 */
function buildLabel(
  view: EditorView,
  getPos: () => number | undefined,
  label: string | null,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = label === null ? EMPTY_AFFORDANCE_CLASS : LANGUAGE_LABEL_CLASS;
  button.setAttribute('contenteditable', 'false');
  button.setAttribute('tabindex', '-1');
  button.setAttribute(
    'aria-label',
    label === null ? 'Set the language of this block' : `Language: ${label}. Change it`,
  );
  button.title = label === null ? 'Set language' : 'Change language';

  if (label === null) button.replaceChildren(languageGlyph());
  else button.textContent = label;

  // Cancelled before the browser can place a selection from it (#236).
  button.addEventListener('mousedown', (event) => event.preventDefault());

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();

    // `getPos` answers `undefined` once the widget has outlived its node,
    // which is the same answer as a position that no longer resolves.
    const pos = getPos();
    if (pos === undefined) return;

    openLanguagePopover({
      anchor: button,
      initial: label ?? '',
      onCommit: (language) => {
        commitBlockLanguage(view, pos, language);
        // The caret goes back where it was, so a gesture that started at the
        // pointer does not leave the keyboard stranded outside the document.
        view.focus();
      },
      onCancel: () => view.focus(),
    });
  });

  return button;
}

/**
 * One widget per fenced block, at the block's start.
 *
 * **Every** fenced block since #238, where this used to draw only on blocks
 * that had a language: a plain block needs somewhere to click to be given
 * one, which was the whole of the issue. Which of the two the widget is
 * decided by the same `labelFor` answer as before, so there is still one walk
 * of the document here and not two.
 */
export function languageDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true;
    const label = labelFor(node);

    decorations.push(
      Decoration.widget(pos + 1, (view, getPos) => buildLabel(view, getPos, label), {
        // `side: -1` puts the widget before any content at this position, and
        // `ignoreSelection` keeps a click on it from moving the caret into a
        // place the user did not ask for. `stopEvent` is what #236 added for a
        // widget that takes a click: the editor view leaves its events alone.
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

export function createCodeBlockLanguagePlugin(): Plugin {
  return new Plugin({
    key: codeBlockLanguageKey,
    props: {
      decorations: (state) => languageDecorations(state.doc),
    },
  });
}

export const CodeBlockLanguage = Extension.create({
  name: 'codeBlockLanguage',
  addProseMirrorPlugins() {
    return [createCodeBlockLanguagePlugin()];
  },
});
