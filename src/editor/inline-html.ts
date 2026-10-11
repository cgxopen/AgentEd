import { Mark, Node } from '@tiptap/core';
import {
  decodeKeptRawHtml,
  KEPT_RAW_HTML_ATTRIBUTE,
  KEPT_RAW_HTML_TAG,
} from './markdown/kept-raw-html';

/**
 * Raw HTML the editor cannot hold, held as its bytes (#563): an anchor with a
 * `name` or an `id`, the tags of a `span`, a comment sharing a block, a
 * processing instruction, a declaration, CDATA, an unknown element. See
 * `markdown/kept-raw-html.ts` for what is taken and what never is.
 *
 * **Not drawn**, by the owner decision on #563: where the file holds markup the
 * reader is not shown, the editor shows nothing. A comment is drawn as a mark
 * (#245) because a comment is a note a person wrote; these are markup. An atom,
 * so the caret steps over it, and a Backspace beside it removes it as it would
 * a character - the half pair measured in the pull request of #563.
 */
export const KeptRawHtml = Node.create({
  name: 'keptRawHtml',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes: () => ({
    bytes: {
      default: null as string | null,
      parseHTML: (element: HTMLElement) =>
        decodeKeptRawHtml(element.getAttribute(KEPT_RAW_HTML_ATTRIBUTE)),
      renderHTML: (attributes: Record<string, unknown>) =>
        typeof attributes.bytes === 'string'
          ? { [KEPT_RAW_HTML_ATTRIBUTE]: encodeURIComponent(attributes.bytes) }
          : {},
    },
  }),

  parseHTML: () => [{ tag: `${KEPT_RAW_HTML_TAG}[${KEPT_RAW_HTML_ATTRIBUTE}]` }],
  // `wbr` is void, so nothing is nested inside it.
  renderHTML: ({ HTMLAttributes }) => [KEPT_RAW_HTML_TAG, HTMLAttributes],
});

/**
 * An exponent, an index and a key (#563, owner decision on #563). Measured on
 * the step zero: of 8706 files, 211 lost a `sup` or a `sub` and 25 a `kbd` on an
 * unedited save, and `2<sup>n - 1</sup>` came back as `2n - 1`, which changes
 * what it says. Drawn, and written back as the tag.
 *
 * **Not inclusive**: text typed at the end of one is plain, so a formula does
 * not swallow the sentence after it.
 */
function inlineElement(name: 'sup' | 'sub' | 'kbd') {
  return Mark.create({
    name,
    inclusive: false,
    parseHTML: () => [{ tag: name }],
    renderHTML: () => [name, 0],
  });
}

export const Superscript = inlineElement('sup');
export const Subscript = inlineElement('sub');
export const Keyboard = inlineElement('kbd');
