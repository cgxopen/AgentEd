import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * A fenced block shows the language it was written with (R-C15, #195).
 *
 * Without it a fence with a language and one without are indistinguishable on
 * screen, which is what #103 met when a manual step asked for a label the
 * build could not show. R-C15 splits its chrome by phase and this is the
 * committed half; the hover Copy button and making this label clickable are
 * §8 candidates and are deliberately not here.
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

/** One widget per fenced block that has a language, at the block's start. */
export function languageDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock') return true;
    const label = labelFor(node);
    // A code block holds text and nothing else, so nothing below it can be a
    // fenced block of its own — descending would be wasted work.
    if (label === null) return false;

    decorations.push(
      Decoration.widget(
        pos + 1,
        () => {
          const element = document.createElement('span');
          element.className = LANGUAGE_LABEL_CLASS;
          // Read-only chrome. `contenteditable=false` keeps the caret out of
          // it, and `aria-hidden` keeps it out of the text a screen reader
          // reads as the block's content — the language is a property of the
          // block rather than a line of its code.
          element.setAttribute('contenteditable', 'false');
          element.setAttribute('aria-hidden', 'true');
          element.textContent = label;
          return element;
        },
        // `side: -1` puts the widget before any content at this position, and
        // `ignoreSelection` keeps a click on it from moving the caret into a
        // place the user did not ask for.
        { side: -1, ignoreSelection: true },
      ),
    );
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
