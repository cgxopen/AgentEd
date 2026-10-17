import {
  type AnyExtension,
  type CommandProps,
  Editor,
  Extension,
  type Node as NodeExtension,
  Node as TipTapNode,
} from '@tiptap/core';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import Table from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableRow from '@tiptap/extension-table-row';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import Underline from '@tiptap/extension-underline';
import type { Schema, TagParseRule } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { AdjacentBlocks } from './adjacent-blocks';
import { CodeBlockCopy } from './code-block-copy';
import { codeBlockInputRules } from './code-block-input-rules';
import { CodeBlockLanguage } from './code-block-language';
import { codeSpanTextRule } from './code-span-spacing';
import { replaceDocument } from './document-load';
import { FootnoteHover } from './footnote-hover';
import { HistoryStaysWithFocus } from './history-focus';
import {
  type CanWriteCompanions,
  type ConfirmAssetsDir,
  createImageDropPlugin,
  type GetFilePath,
  type RequestSaveAs,
} from './image-handler';
import type { ReportImageInsert } from './image-insert-outcome';
import { createImageNodeView } from './image-resize';
import { KeptLink, KeptRawHtml, Keyboard, Subscript, Superscript } from './inline-html';
import { FootnoteShortcut } from './insert-footnote';
import {
  HTML_BLOCK_SOURCE,
  HTML_SOURCE,
  htmlForSave,
  KEPT_HTML_BLOCK_SOURCE,
  KEPT_HTML_SOURCE,
} from './kept-html-table';
import { isRelativeLinkAddress } from './link-url';
import { autolinkMarkAttribute } from './markdown/angle-autolink';
import {
  BARE_BLANK_MARKER,
  BLOCKQUOTE_BLANK_MARKER_ATTRIBUTE,
} from './markdown/blockquote-spacing';
import { brSpellingNodeAttribute } from './markdown/br-spelling';
import {
  COMMENT_TAG,
  decodeComment,
  encodeComment,
  MARKDOWN_COMMENT_ATTRIBUTE,
} from './markdown/comment-spelling';
import { linkDestinationMarkAttribute } from './markdown/destination-spelling';
import { emphasisDelimiterMarkAttribute } from './markdown/emphasis-delimiter';
import { fenceOpenerNodeAttribute } from './markdown/fence-spelling';
import {
  FOOTNOTE_BLANK_LINE_ATTRIBUTE,
  FOOTNOTE_DEFINITION_ATTRIBUTE,
  FOOTNOTE_INDENTS_ATTRIBUTE,
} from './markdown/footnote';
import { headingSpellingNodeAttributes } from './markdown/heading-spelling';
import { decodeKeptBlockSource } from './markdown/html-wrapper';
import {
  decodeHtmlSource,
  encodeHtmlSource,
  IMAGE_HTML_SOURCE_ATTRIBUTE,
  pixelValue,
} from './markdown/image-spelling';
import { linkPlaceMarkAttribute } from './markdown/link-place';
import { linkTitleMarkAttributes } from './markdown/link-title';
import {
  LIST_MARKER_ATTRIBUTE,
  LIST_NUMBERING_ATTRIBUTE,
  ONE_NUMBER,
} from './markdown/list-marker';
import { LIST_SPACING_ATTRIBUTE } from './markdown/list-spacing';
import { REFERENCE_DEFINITION_ATTRIBUTE, referenceMarkAttribute } from './markdown/reference';
import { htmlToMarkdown } from './markdown/serialize';
import { decodeTableSource, TABLE_HTML_SOURCE_ATTRIBUTE } from './markdown/table-html-source';
import { TABLE_STYLE_ATTRIBUTE } from './markdown/table-style';
import { HTML_BLOCK_SOURCE_ATTRIBUTE } from './markdown/tag-filter';
import { isNodeSelected } from './node-selection';
import { OrderedListContinuity } from './ordered-list-continuity';
import { PredictablePaste } from './paste';
import { createSearchExtension } from './search-extension';
import { SoftBreak } from './soft-break-node';

// ── The node that holds an HTML comment (#245) ──
//
// A comment is content the user cannot see, so the node holding it is an
// **atom**: it has no content of its own, the caret never goes inside it, and
// it is deleted whole or not at all. That is also why it cannot be typed into,
// which is why writing a comment is not something this editor offers — R-C1
// says nothing about comments, and an insert route would be a feature rather
// than this repair.
//
// **One node, inline, for both shapes.** A comment the file put on its own
// line arrives wrapped in a paragraph (see `comment-spelling.ts`), so it is
// this same node with room for a caret on either side of it. The first build
// gave it a block node of its own, and the owner manual pass found the cost:
// a block atom fills its line, so clicking the line selected it and the next
// character typed replaced the note. A paragraph has somewhere to put the
// caret.
//
// ── `selectable: false`, and why it is not the usual answer for an atom ──
//
// An image and a horizontal rule are selectable atoms: clicking one selects
// it, and the next character typed replaces it. This node was that too, and
// the second owner pass found what it costs *here*: the mark is the size of a
// character, so it reads as one — clicking it and typing is an ordinary thing
// to do, and it overwrote a note that can be forty lines long.
//
// A thing shaped like a character behaves like one. There is no node selection
// to click into, so nothing is ever typed over: the caret goes before it or
// after it, and text lands beside the note.
//
// **The two-step deletion this replaces was an argument about an invisible
// node, and it expired when the mark arrived.** Selecting first and deleting
// second is what made removing something the reader could not see deliberate;
// a mark on screen already does that, and one keystroke to remove a character
// you can see is what every other character gets.

/**
 * A footnote definition, as the lines the file wrote (#408).
 *
 * **Editable content rather than an atom, and that was measured.** An inert
 * carrier holding the bytes preserves every row too, but it takes no caret:
 * measured, a character typed at the definition lands beside it and reaches
 * the file as a stray paragraph. With inline content the same keystroke edits
 * the definition, which is where it was aimed. `#409` puts a surface on this;
 * until then the person sees, and can edit, the markdown the file holds.
 *
 * `defining` so that replacing the content does not dissolve the node into
 * the paragraph around it.
 *
 * The indentation of each continuation line travels as an attribute rather
 * than in the text, because the text is inline content and leading whitespace
 * there does not survive to the serializer.
 */
const FootnoteDefinition = TipTapNode.create({
  name: 'footnoteDefinition',
  group: 'block',
  content: 'inline*',
  defining: true,

  addAttributes: () => ({
    indents: {
      default: '',
      parseHTML: (element: HTMLElement) => element.getAttribute(FOOTNOTE_INDENTS_ATTRIBUTE) ?? '',
      renderHTML: (attributes: Record<string, unknown>) =>
        typeof attributes.indents === 'string' && attributes.indents !== ''
          ? { [FOOTNOTE_INDENTS_ATTRIBUTE]: attributes.indents }
          : {},
    },
    // A reference definition rides on this node too (#570): the indentation
    // of its first line, where a footnote definition carries `null`.
    referenceIndent: {
      default: null as string | null,
      parseHTML: (element: HTMLElement) => element.getAttribute(REFERENCE_DEFINITION_ATTRIBUTE),
      renderHTML: (attributes: Record<string, unknown>) =>
        typeof attributes.referenceIndent === 'string'
          ? { [REFERENCE_DEFINITION_ATTRIBUTE]: attributes.referenceIndent }
          : {},
    },
    // The gap the file left under this definition (#418). A boolean rather
    // than a value, because the only two spellings are one newline and two.
    blankLineAfter: {
      default: false,
      parseHTML: (element: HTMLElement) => element.hasAttribute(FOOTNOTE_BLANK_LINE_ATTRIBUTE),
      renderHTML: (attributes: Record<string, unknown>) =>
        attributes.blankLineAfter === true ? { [FOOTNOTE_BLANK_LINE_ATTRIBUTE]: '' } : {},
    },
  }),

  parseHTML: () => [{ tag: `div[${FOOTNOTE_DEFINITION_ATTRIBUTE}]` }],
  renderHTML: ({ HTMLAttributes }) => [
    'div',
    { ...HTMLAttributes, [FOOTNOTE_DEFINITION_ATTRIBUTE]: '' },
    0,
  ],
});

const MarkdownComment = TipTapNode.create({
  name: 'markdownComment',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes: () => ({
    comment: {
      default: null as string | null,
      parseHTML: (element: HTMLElement) =>
        decodeComment(element.getAttribute(MARKDOWN_COMMENT_ATTRIBUTE)),
      renderHTML: (attributes: Record<string, unknown>) =>
        typeof attributes.comment === 'string'
          ? { [MARKDOWN_COMMENT_ATTRIBUTE]: encodeComment(attributes.comment) }
          : {},
    },
  }),

  /**
   * The mark the reader sees where a comment is, and the note behind it.
   *
   * **Owner decision, 2026-09-07: a muted paragraph sign, with the comment
   * text on hover.** Drawing nothing was the other option and is what the
   * issue asks for literally; it was rejected on a measurement rather than on
   * taste. Of 192 comments counted in 2194 markdown files, the median is one
   * line and 63 bytes, but **one in eight is five lines or more** and the
   * largest is 40 lines — so a keystroke beside an invisible node could remove
   * a page of text with nothing on screen changing, which is the #234 shape: a
   * document that survives as bytes and not as a document. A mark is what
   * makes that deliberate.
   *
   * **A node view rather than `renderHTML`, and that is the whole reason this
   * costs nothing.** `getHTML` serializes through `renderHTML`, so the mark
   * exists only in the editing view: the carrier the serializer reads is
   * untouched and the file comes back byte for byte whatever is drawn here.
   * Measured, both with the mark and without it.
   *
   * The glyph is a CSS `::before` rather than text in this element, so a
   * selection dragged across it cannot pick the character up.
   *
   * The `title` is the note without its delimiters, which is what a reader
   * wants to read. A native tooltip draws it — no positioning code, no new
   * dependency — and it keeps the newlines of a multi-line comment.
   */
  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span');
      dom.className = 'markdown-comment-mark';
      dom.contentEditable = 'false';
      const bytes = node.attrs.comment;
      if (typeof bytes === 'string') {
        dom.title = bytes.slice('<!--'.length, -'-->'.length).trim();
      }
      return { dom };
    };
  },

  /**
   * Removing the note, explicitly rather than by whatever the browser does.
   *
   * With no node selection to delete, what would otherwise remove this is the
   * browser acting on a `contenteditable="false"` element inside an editable
   * one — behaviour that differs between engines and that **no test in this
   * repository can observe**, since a real key press needs a real view. So the
   * removal is written here: it is the same one keystroke a character gets, it
   * is certain on every platform, and it is asserted rather than assumed.
   *
   * `nodeBefore` and `nodeAfter` are read from the position rather than the
   * document, so they can only ever name a sibling inside the same paragraph —
   * a caret at the start of a block cannot reach back into the block above and
   * take a comment out of it.
   *
   * Anything else — a selection that is not a caret, a neighbour that is not a
   * comment — is declined, and the key does what it always did.
   */
  addKeyboardShortcuts() {
    const removeNeighbour = (side: 'before' | 'after') => () => {
      const { selection } = this.editor.state;
      if (!selection.empty) return false;
      const { $from } = selection;
      const node = side === 'before' ? $from.nodeBefore : $from.nodeAfter;
      if (node?.type.name !== this.name) return false;
      const from = side === 'before' ? $from.pos - node.nodeSize : $from.pos;
      return this.editor.commands.deleteRange({ from, to: from + node.nodeSize });
    };
    return { Backspace: removeNeighbour('before'), Delete: removeNeighbour('after') };
  },

  parseHTML: () => [{ tag: `${COMMENT_TAG}[${MARKDOWN_COMMENT_ATTRIBUTE}]` }],
  // `wbr` is void, so nothing is nested inside it.
  renderHTML: ({ HTMLAttributes }) => [COMMENT_TAG, HTMLAttributes],
});

/**
 * StarterKit, with the declarations this project overrides. The two the
 * sections below are about are the `Code` mark, so a code span can sit
 * *inside* another mark instead of cancelling it (#84), and the `listItem`
 * node, so an item may begin with a block (#110). The rest are one line each
 * and carry their reason at the branch that makes them: `blockquote`,
 * `bulletList` and `orderedList` gain the file's own spacing (#28, #199), and
 * `codeBlock` gains the fence input rules that admit every language
 * CommonMark does (#237, written out in `code-block-input-rules.ts`).
 *
 * ── `listItem` content: `block+` rather than `paragraph block*` (#110) ──
 *
 * The shipped node takes `paragraph block*` — a paragraph **first**, then any
 * blocks. CommonMark puts no such restriction on a list item, so an item whose
 * whole body was a block could not be held: on open, ProseMirror lifted the
 * block out of the list and left an **empty item** behind, which the save then
 * dropped. Measured on `7d6cb13`, at both levels: `- ## 1. x` is byte-identical
 * through parse + serialize and comes back as `## 1. x` through the document
 * model. That split — the pair clean, the editor lossy — is what said the cause
 * was the schema rather than `marked` or turndown, and it held for every member
 * of the family: a heading, an ordered list, a fence empty or full, a
 * blockquote, and a nested list.
 *
 * **`block+` was measured, not assumed, on the two counts that decide it.**
 *
 *  - **Enter still makes a paragraph.** `splitListItem` builds the node after
 *    Enter from `grandParent.contentMatchAt(0).defaultType`, so a widening that
 *    moved `defaultType` would change what every Enter in every list produces.
 *    It does not move: `paragraph` is declared first in the `block` group, so
 *    `block+` resolves to it. `blockquote` in this same schema already takes
 *    `block+` and already reports `defaultType: paragraph` — the fact is read
 *    off this build rather than off an isolated rig.
 *  - **What `block+` newly admits, the serializer can write back.** A table and
 *    a horizontal rule as an item's whole body both round-trip; an image cannot
 *    arise, because `image` is an `inline` node and `block+` cannot hold one
 *    bare. Enter, Backspace, Tab and Shift-Tab were measured in every position
 *    before and after and none moved — Backspace is worth naming, because it is
 *    not this extension's: it comes from TipTap core's `Keymap`, whose chain is
 *    `undoInputRule → clearNodes → deleteSelection → joinBackward →
 *    selectNodeBackward`.
 *
 * **It has a second half, and they are load-bearing together.** `parse.ts` must
 * mark a task list as one (`markTaskLists`), because an unmarked one left an
 * empty `listItem` in front of every task list — invisible while an empty item
 * could hold nothing, and `- [ ] a` saving as `- - [ ] a` the moment this node
 * admits a leading block. Neither change may be removed while reading only the
 * other; the reason is written out in `markdown/task-list.ts`.
 *
 * **`taskItem` was deliberately left alone here, and is widened below.** It
 * carries the same `paragraph block*` restriction and was *not* fixed by the
 * same edit: widening it while `taskListItemReplacement` in `serialize.ts`
 * could not write a block into a task item lost content instead of keeping it
 * — measured on #110, `- [ ] 1. a` saved as `- [ ] a` and `- [ ] > q` as
 * `- [ ] q`. That was its own issue, #157, which fixed the serializer first
 * and then widened the node; `TaskItemHoldingABlock` below is that widening.
 *
 * ── The `Code` mark (#84) ──
 *
 * Two facts of the shipped extension, both measured on `@tiptap/extension-code`
 * 2.27.2 rather than read from a changelog:
 *
 *  - `excludes: '_'` — the code mark excludes **every** other mark. Marks are
 *    flat and per text node in ProseMirror, so ``**bold `code` more**`` needs
 *    its middle text node to carry `bold` *and* `code`; `excludes: '_'` forbids
 *    exactly that, and the bold run was split around the span in the document
 *    model, before turndown was ever involved. The same rule silently dropped
 *    a mark whose whole extent was a code span: on `522cc04` ``**`c`**`` was
 *    saved as ``` `c` ```, `~~`c`~~` as ``` `c` ```, and
 *    ``[`c`](https://e.com)`` as ``` `c` ``` — a link losing its destination
 *    out of the user's file, which is R-C2 losing something the reader can see.
 *  - Its **rank in the schema** decides which of two coexisting marks is the
 *    outer element in `getHTML`, and turndown writes the nesting it is given.
 *    At the default priority `code` outranks `italic`, `strike` and
 *    `underline`, so narrowing `excludes` alone put those marks *inside* the
 *    backticks — `~~a `code` b~~` came out as ``~~a~~ `~~code~~` ~~b~~``,
 *    where the tildes are no longer markup but four literal characters in a
 *    code span. That is a change of meaning, so the two go together: opening
 *    the mark set without also making `code` the innermost mark is worse than
 *    leaving both alone.
 *
 * `priority: 1` puts it below every other mark (TipTap's default is 100, and
 * `Link` sits at 1000), so a code span is always the innermost element and
 * every other mark is written outside its backticks — which is the only
 * nesting CommonMark can spell. Priority also orders the extensions for
 * plugins, input rules, paste rules and keyboard shortcuts; that was measured
 * against `522cc04` in isolation — `priority` alone, with `excludes` left as
 * it was — and moves none of them (`mark-nesting.test.ts`).
 *
 * The list is **read off StarterKit rather than restated**: whatever else the
 * kit registers goes on being registered, and goes on doing so if a future
 * release changes what that is. Importing `@tiptap/extension-code` directly
 * would restate one entry of that list and add a package to `package.json`
 * for a mark the document already contains.
 *
 * **`configure` comes before `extend`, and the order is load-bearing.** The
 * other way round — `StarterKit.extend({…}).configure({…})` — the kit builds
 * its sub-extensions from its *default* options and every value passed here is
 * silently dropped: measured on this branch, `heading` came back as levels 1–6
 * instead of 1–4. Nothing threw and no test failed, because that is
 * configuration rather than behaviour. `configure` first, then `extend`, is
 * what keeps it. `configuration survives the extend` in `mark-nesting.test.ts`
 * is the pin, and `##### Five` opening as a paragraph rather than a heading is
 * the user-visible half of the same fact (`numbered-heading.test.ts`).
 *
 * **The second value this call used to pass has gone**, owed since #202 and
 * carried here because this file is in the diff for #27, which is the condition
 * the project records attached to it. `codeBlock: { HTMLAttributes: { class: 'code-block' } }`
 * put a class on every fenced block that nothing consumed: the styling is
 * `.tiptap pre` in `src/styles.css`, which never mentioned it. It had also been
 * doing a second job as the *other* half of the pin above, and that job is
 * covered — the heading levels are the half with a consequence, which is what
 * the pin exists to catch, and the comment saying so was already in that test.
 */
/**
 * How the file spaced this list (#28), carried on the list node itself.
 *
 * The same shape as `tableStyle` below and for the same reason: `parseHTML`
 * and `renderHTML` keep it across the document model, which is what lets an
 * untouched list be written back byte for byte. It rides on the node rather
 * than on the document so that a list and its spacing move together through
 * editing, Save As and copy-paste.
 *
 * **The default is `false`, and that is the owner decision rather than a
 * fallback**: a list created in the editor is tight. Only a list that came
 * from a file that spelled it loose carries `true`, so nothing changes for
 * what the user writes from scratch and everything changes only for what they
 * opened. Same shape as `defaultType: paragraph` on #110.
 */
function looseAttribute() {
  return {
    loose: {
      default: false,
      parseHTML: (element: HTMLElement) => element.getAttribute(LIST_SPACING_ATTRIBUTE) === 'true',
      renderHTML: (attributes: Record<string, unknown>) =>
        attributes.loose ? { [LIST_SPACING_ATTRIBUTE]: 'true' } : {},
    },
    // The marker the file used (#431), beside the spacing and for the same
    // reason: by the time the document model exists, `- a` and `* a` are the
    // same list, and two adjacent lists then merge into one.
    marker: {
      default: null as string | null,
      parseHTML: (element: HTMLElement) => element.getAttribute(LIST_MARKER_ATTRIBUTE),
      renderHTML: (attributes: Record<string, unknown>) =>
        typeof attributes.marker === 'string' && attributes.marker !== ''
          ? { [LIST_MARKER_ATTRIBUTE]: attributes.marker }
          : {},
    },
    // One number throughout an ordered list (#569), read and carried the same way.
    numbering: {
      default: null as string | null,
      parseHTML: (element: HTMLElement) =>
        element.getAttribute(LIST_NUMBERING_ATTRIBUTE) === ONE_NUMBER ? ONE_NUMBER : null,
      renderHTML: (attributes: Record<string, unknown>) =>
        attributes.numbering === ONE_NUMBER ? { [LIST_NUMBERING_ATTRIBUTE]: ONE_NUMBER } : {},
    },
  };
}

/**
 * How a quote spelled its blank lines, carried on the quote (#199).
 *
 * The same shape as `looseAttribute` above and for the same reason: the two
 * spellings are the same document, so nothing downstream can tell them apart
 * unless the file is asked while it is being read and the answer rides along.
 *
 * **The default is the spaced spelling**, which is what turndown writes when
 * nothing tells it otherwise — so a quote created in the editor, and a quote
 * from a file that had no blank line to read, are written the way they always
 * were. Only a file that spelled it bare carries the attribute.
 */
function bareBlankMarkerAttribute() {
  return {
    bareBlankMarker: {
      default: false,
      parseHTML: (element: HTMLElement) =>
        element.getAttribute(BLOCKQUOTE_BLANK_MARKER_ATTRIBUTE) === BARE_BLANK_MARKER,
      renderHTML: (attributes: Record<string, unknown>) =>
        attributes.bareBlankMarker
          ? { [BLOCKQUOTE_BLANK_MARKER_ATTRIBUTE]: BARE_BLANK_MARKER }
          : {},
    },
  };
}

/**
 * A paragraph that may stand for a raw HTML block holding one of the nine
 * names of the GFM tag filter (#461), or for a wrapper around an image or
 * text (#468): the bytes the file wrote, never rendered, and the mark that
 * says to write them, never parsed. The same pair a raw table carries (#283),
 * for the same reason, set out in `kept-html-table.ts`. A wrapper reaches the
 * editor as an element carrying the bytes, read as the paragraph it holds.
 */
/** The pair of attributes a block standing for kept bytes carries (#461, #468, #470). */
function keptBlockSourceAttributes() {
  return {
    [HTML_BLOCK_SOURCE]: {
      default: null,
      rendered: false,
      parseHTML: (element: HTMLElement) =>
        decodeKeptBlockSource(element.getAttribute(HTML_BLOCK_SOURCE_ATTRIBUTE)),
    },
    [KEPT_HTML_BLOCK_SOURCE]: {
      default: null,
      parseHTML: () => null,
      renderHTML: (attributes: Record<string, unknown>) => {
        const source = attributes[KEPT_HTML_BLOCK_SOURCE];
        return typeof source === 'string'
          ? { [HTML_BLOCK_SOURCE_ATTRIBUTE]: encodeURIComponent(source) }
          : {};
      },
    },
  };
}

function paragraphKeepingBlockSource(extension: AnyExtension): AnyExtension {
  return extension.extend({
    // The paragraph extension reads `p` alone; the element a wrapper reaches
    // the editor as is read as a paragraph too.
    parseHTML() {
      return [{ tag: 'p' }, { tag: `div[${HTML_BLOCK_SOURCE_ATTRIBUTE}]`, priority: 60 }];
    },
    addAttributes() {
      return { ...this.parent?.(), ...keptBlockSourceAttributes() };
    },
  });
}

/**
 * A heading that may stand for a heading spelled as HTML, or a wrapper around
 * a markdown heading (#470): the same pair, so a centred `h1` keeps its bytes
 * while it is drawn as the heading of its level it is.
 */
function headingKeepingBlockSource(extension: AnyExtension): AnyExtension {
  return extension.extend({
    addAttributes() {
      // The underline or closing hashes the file spelled it with (#573).
      return {
        ...this.parent?.(),
        ...keptBlockSourceAttributes(),
        ...headingSpellingNodeAttributes(),
      };
    },
  });
}

function starterKitWithLocalSchemaRules() {
  return StarterKit.configure({
    heading: { levels: [1, 2, 3, 4, 5, 6] },
  }).extend({
    addExtensions() {
      const registered = (this.parent?.() ?? []) as AnyExtension[];
      if (!registered.some((extension) => extension.name === 'code')) {
        // A named cause at module load rather than a silent regression: if the
        // kit ever stops registering `code` under that name, every shape this
        // change fixed would quietly go back to being split, and the suite
        // would be the only thing that noticed.
        throw new Error('StarterKit no longer registers a mark named "code" (see #84)');
      }
      if (!registered.some((extension) => extension.name === 'listItem')) {
        // Same reasoning as the `code` guard above, and the same failure mode:
        // the day the kit stops registering `listItem` under that name, every
        // bullet this fix restored would quietly go back to being dropped, and
        // nothing would say so.
        throw new Error('StarterKit no longer registers a node named "listItem" (see #110)');
      }
      if (!registered.some((extension) => extension.name === 'codeBlock')) {
        // Same shape again (#237). The day the kit stops registering
        // `codeBlock` under that name, the input rules below would stop being
        // replaced and every language outside `a`-`z` would quietly go back to
        // making no block at all.
        throw new Error('StarterKit no longer registers a node named "codeBlock" (see #237)');
      }
      return registered.map((extension) => {
        if (extension.name === 'paragraph') return paragraphKeepingBlockSource(extension);
        if (extension.name === 'heading') return headingKeepingBlockSource(extension);
        // The delimiter the file wrote, `_` or none (#566).
        // The tag a line break was written with, or none (#577).
        if (extension.name === 'hardBreak') {
          return extension.extend({
            addAttributes() {
              return { ...this.parent?.(), ...brSpellingNodeAttribute() };
            },
          });
        }
        if (extension.name === 'bold' || extension.name === 'italic') {
          return extension.extend({
            addAttributes() {
              return { ...this.parent?.(), ...emphasisDelimiterMarkAttribute() };
            },
          });
        }
        if (extension.name === 'code') {
          return extension.extend({
            excludes: '',
            priority: 1,
            // The text of a code span as it stands, white space included (#603).
            parseHTML() {
              const inherited = (this.parent?.() ?? [{ tag: 'code' }]) as readonly TagParseRule[];
              return [codeSpanTextRule, ...inherited];
            },
            // ── The refusal on a node selection (#427) ──
            //
            // `toggleCode` on a selected image wrote the image markdown as
            // literal text inside a code span - the picture gone, measured on
            // `8934c82`. It is reached by the toolbar button and by `Ctrl+E`,
            // and the chord is TipTap's own binding on this extension, so a
            // guard around one caller would leave the other one working. This
            // is the extension both routes run, which is why the refusal is
            // here rather than in `toolbar.ts`.
            //
            // The inherited command is **wrapped rather than restated**: what
            // a code span does to a text selection goes on being whatever the
            // shipped extension does, and goes on doing so across a release
            // that changes it. Returning `false` is the ordinary way a
            // ProseMirror command declines, so `can()` answers false too and
            // nothing downstream has to know why.
            addCommands() {
              const inherited = this.parent?.() ?? {};
              return {
                ...inherited,
                toggleCode:
                  () =>
                  (props: CommandProps): boolean => {
                    if (isNodeSelected(props.state)) return false;
                    const original = inherited.toggleCode;
                    return original ? original()(props) : false;
                  },
              };
            },
          });
        }
        if (extension.name === 'listItem') return extension.extend({ content: 'block+' });
        // The fence input rules, widened to every language CommonMark admits
        // (#237). Extended off the kit rather than imported, for the reason
        // the comment above gives; `code-block-input-rules.ts` carries the
        // shipped patterns, what they refused, and why the group is what it
        // is.
        if (extension.name === 'codeBlock') {
          // Narrowed to a node extension because `registered` is typed
          // `AnyExtension[]`, and only the node member of that union carries
          // `this.type` — the value the rules are built against. The guard
          // above is what makes the narrowing true at runtime.
          return (extension as NodeExtension).extend({
            // The opening run the file wrote the fence with (#573).
            addAttributes() {
              return { ...this.parent?.(), ...fenceOpenerNodeAttribute() };
            },
            addInputRules() {
              return codeBlockInputRules(this.type);
            },
          });
        }
        // The two list containers StarterKit registers gain the file's own
        // spacing (#28). Extended here rather than imported directly, for the
        // reason the comment above gives: the list is read off the kit.
        if (extension.name === 'blockquote') {
          return extension.extend({
            addAttributes() {
              return { ...this.parent?.(), ...bareBlankMarkerAttribute() };
            },
          });
        }
        if (extension.name === 'bulletList' || extension.name === 'orderedList') {
          return extension.extend({
            addAttributes() {
              return { ...this.parent?.(), ...looseAttribute() };
            },
          });
        }
        return extension;
      });
    },
  });
}

/**
 * The task item, widened the way `listItem` was in #110 — and, unlike that
 * one, only after the serializer could write the result (#157).
 *
 * The shipped node takes `paragraph block*` when it is configured to nest, so
 * an item whose **whole body** is a block could not be held: on open,
 * ProseMirror lifted the block out of the list and left an empty item behind,
 * and `- [ ] ## 1. x` came back as an empty checkbox with the heading below
 * it. Measured on `63568bc` at both levels — byte-identical through parse +
 * serialize, lossy through the document model — which is the same split #110
 * was named by, and it says the cause is the schema rather than `marked` or
 * turndown.
 *
 * **The order is the reverse of #110's, and the issue is right about why.**
 * Widening this node while `taskListItemReplacement` still wrote one line per
 * item turns a visible lift into silent content loss: measured on `63568bc`
 * with this edit alone, `- [ ] 1. a` saved as `- [ ] a` and `- [ ] > q` as
 * `- [ ] q` — a marker and a quote gone out of the file rather than merely
 * displaced. So the serializer landed first, with the shapes it repairs proven
 * under the *unwidened* schema, and this is the last step.
 *
 * **`content` is overridden as a method, not as a string.** The shipped
 * declaration is `content() { return this.options.nested ? 'paragraph block*'
 * : 'paragraph+' }` — read off `@tiptap/extension-task-item` 2.27.2, the
 * version this repository locks. Replacing it with `'block+'` would drop the
 * `nested` distinction along with it: nothing would break today, because
 * `nested: true` is configured on the very next line, but the value would have
 * quietly stopped depending on the option, which is a defect waiting for
 * whoever changes it. The method keeps the distinction and widens exactly the
 * branch this repository uses.
 *
 * **What `block+` newly admits, the serializer can write back**, measured the
 * way #110 measured `listItem`: a heading, an ordered or bullet list, a
 * blockquote, a fence empty or full, a table and a horizontal rule as the
 * whole body of a task item all round-trip byte-identically, and an image
 * cannot arise, because `image` is an inline node and `block+` cannot hold one
 * bare. `defaultType` stays `paragraph`, so `splitListItem` — which builds the
 * node after Enter from `contentMatchAt(0).defaultType` — goes on making a
 * paragraph. Enter, Backspace, Tab and Shift-Tab were measured in every
 * position before and after and none of them moved.
 *
 * **The checkbox does not move either**, which is the check `listItem` did not
 * have to pass: `renderHTML` and the node view both build the item as
 * `<li><label>…checkbox…</label><div>…content…</div></li>`, so the label is a
 * sibling of the content rather than part of its first paragraph, whatever
 * that first block turns out to be.
 */
/**
 * The task list, with the same spacing attribute as the other two (#28).
 * Since #160 the loose-list exception covered bullet, ordered and task lists
 * alike, so the repair has to reach all three.
 */
const TaskListWithSpacing = TaskList.extend({
  addAttributes() {
    return { ...this.parent?.(), ...looseAttribute() };
  },
});

const TaskItemHoldingABlock = TaskItem.extend({
  content() {
    return this.options.nested ? 'block+' : 'paragraph+';
  },
}).configure({ nested: true });

/**
 * The image node, plus the three attributes #27 needs.
 *
 * `image` is an **inline** node — confirmed on this build, and it is why a
 * standalone `<img>` line, which `marked` reads as a block, still arrives
 * inside a paragraph. So there is no block image to give a size to; a width
 * rides on a node sitting in a line of text.
 *
 * The size is the whole visible feature and `htmlSource` is what keeps it
 * honest: the bytes the file spelled this image with, so an image the user
 * never touched is written back exactly as it was found, whatever spelling
 * that was. See `markdown/image-spelling.ts` for why the bytes and not the
 * width alone.
 *
 * All three ride through every edit, Save As and copy-paste the way the table
 * spelling does, and all three are editor state until the serializer reads
 * them — the difference from `tableStyle` being that these *can* reach the
 * user's document, because writing a size is the point.
 */
const ImageWithSpelling = Image.extend({
  addNodeView() {
    return (props) => createImageNodeView(props);
  },

  addAttributes() {
    return {
      ...this.parent?.(),
      // An image the file wrote as a reference knows its spelling (#570).
      ...referenceMarkAttribute(),
      htmlSource: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          decodeHtmlSource(element.getAttribute(IMAGE_HTML_SOURCE_ATTRIBUTE)),
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.htmlSource === 'string'
            ? { [IMAGE_HTML_SOURCE_ATTRIBUTE]: encodeHtmlSource(attributes.htmlSource) }
            : {},
      },
      // Read back through `pixelValue`, so a width the file wrote as `60%` or
      // `auto` — which a markdown renderer may honour and this editor cannot
      // express as a drag — is no size at all rather than a number guessed out
      // of it. It stays in `htmlSource`, so it is still written back.
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => pixelValue(element.getAttribute('width')),
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.width === 'number' ? { width: String(attributes.width) } : {},
      },
      height: {
        default: null,
        parseHTML: (element: HTMLElement) => pixelValue(element.getAttribute('height')),
        renderHTML: (attributes: Record<string, unknown>) =>
          typeof attributes.height === 'number' ? { height: String(attributes.height) } : {},
      },
    };
  },
});

/**
 * The table node, plus the attribute #93 needs: the spelling the file used for
 * this table. `parseHTML`/`renderHTML` keep it on the round trip through the
 * document model, which is what lets an untouched table be written back byte
 * for byte.
 *
 * And the two #283 needs, for a table the file wrote as raw HTML: the bytes it
 * used, and the mark that says to write them. Why they are two, and why one is
 * never rendered and the other never parsed, is in `kept-html-table.ts`.
 */
const TableWithStyle = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      tableStyle: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute(TABLE_STYLE_ATTRIBUTE),
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.tableStyle ? { [TABLE_STYLE_ATTRIBUTE]: attributes.tableStyle as string } : {},
      },
      [HTML_SOURCE]: {
        default: null,
        rendered: false,
        parseHTML: (element: HTMLElement) =>
          decodeTableSource(element.getAttribute(TABLE_HTML_SOURCE_ATTRIBUTE)),
      },
      [KEPT_HTML_SOURCE]: {
        default: null,
        parseHTML: () => null,
        renderHTML: (attributes: Record<string, unknown>) => {
          const source = attributes[KEPT_HTML_SOURCE];
          return typeof source === 'string'
            ? { [TABLE_HTML_SOURCE_ATTRIBUTE]: encodeURIComponent(source) }
            : {};
        },
      },
    };
  },
});

export interface EditorInstance {
  editor: Editor;
  schema: Schema;
  getMarkdown: () => string;
  /**
   * Replace the whole document. This is a document **load**, not an edit
   * (R-C16): it does not go into the undo stack, and it takes the
   * previous document's history with it. Every route that puts a
   * document on screen calls this one — see `document-load.ts`.
   */
  setMarkdown: (md: string) => void;
  destroy: () => void;
}

/**
 * Everything an editor needs to accept an image (R-C5). Kept together
 * because they are not independently useful: a surface that can ask for
 * a destination but has nowhere to report the outcome is exactly the
 * half-wired caller #61 exists to make impossible. An editor built
 * without this handles no image drops or pastes at all.
 */
export interface ImageInsertWiring {
  readonly getFilePath: GetFilePath;
  readonly requestSaveAs: RequestSaveAs;
  readonly confirmAssetsDir: ConfirmAssetsDir;
  /** Whether a companion file can be written for this document now (#46). */
  readonly canWriteCompanions: CanWriteCompanions;
  /**
   * How every insert is reported (#61) — landed, cancelled, refused, or
   * unavailable because this document cannot hold an image here at all.
   */
  readonly report: ReportImageInsert;
}

function buildExtensions(images: ImageInsertWiring | undefined): AnyExtension[] {
  const ImageDrop = Extension.create({
    name: 'imageDrop',
    addProseMirrorPlugins() {
      if (!images) return [];
      return [
        createImageDropPlugin(
          this.editor,
          images.getFilePath,
          images.requestSaveAs,
          images.confirmAssetsDir,
          images.canWriteCompanions,
          images.report,
        ),
      ];
    },
  });

  return [
    starterKitWithLocalSchemaRules(),
    // Undo and redo reach the document only while it has focus (#306). Its
    // place in this list does not matter: it listens on the document.
    HistoryStaysWithFocus,
    MarkdownComment,
    KeptRawHtml,
    KeptLink,
    // A line break inside a paragraph, drawn as a space (#571).
    SoftBreak,
    Superscript,
    Subscript,
    Keyboard,
    FootnoteDefinition,
    Underline,
    // A link the file wrote in angle brackets says so (#567), and a link keeps
    // its title and the delimiter of it (#562).
    Link.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
          ...autolinkMarkAttribute(),
          ...linkTitleMarkAttributes(),
          // What the file wrote between its parentheses (#573).
          ...linkDestinationMarkAttribute(),
          // Two links side by side with one destination stay two (#565).
          ...linkPlaceMarkAttribute(),
          // A link the file wrote as a reference knows its spelling (#570).
          ...referenceMarkAttribute(),
        };
      },
    }).configure({
      // A plain click places the caret; Ctrl/Cmd+click follows the link
      // through the platform layer (wired in main.ts).
      openOnClick: false,
      // R-C13, now uniform: AgentEd never writes link syntax the user did not
      // ask for. `linkOnPaste` kept a pasted URL as text (#21); `autolink`
      // used to make one anyway, a keystroke later, as soon as a boundary
      // character followed — the same artifact, merely delayed (#37). Both are
      // off, and the explicit routes (toolbar button, Ctrl+K, pasting a URL
      // over a selection) are what make a link now.
      autolink: false,
      linkOnPaste: false,
      // `target: null` rather than an omitted key: TipTap's `configure` merges
      // deeply, so the extension's own `target: '_blank'` default survives
      // anything short of overwriting it, and null is what its
      // `mergeAttributes` drops. In an editing surface a target does nothing
      // useful, and it is what turns a plain click into a new-window request
      // that the host shell then honours — the link opening in the browser
      // without anyone asking for it. Following a link is the modifier
      // gesture's job (src/app/link-open.ts), through the platform layer.
      // `rel` is kept: it costs nothing and stays correct if this HTML is ever
      // rendered somewhere else.
      HTMLAttributes: { rel: 'noopener noreferrer', target: null },
      // #42: a relative path is a link address. The extension's own allow-list
      // is consulted at `parseHTML`, `renderHTML` and `setLink`, and in 2.27.2
      // it is built from a template literal in which `\-` is not an escape —
      // so its last character class is `[^a-z+.-:]`, where `.-:` is a *range*
      // covering `/`. Any scheme-less address whose first label is followed by
      // a slash therefore failed it: `docs/guide.md` was dropped to bare text
      // on open (measured here, not read from the regex), which is R-C2 losing
      // a destination out of the user's file. The `./` shape passed through
      // `[^a-z]`, which is why it never showed.
      //
      // The override widens by exactly one case and narrows by none: what the
      // extension already accepts, it goes on accepting — delegating to
      // `defaultValidate` rather than restating an allow-list, so a `tel:` or
      // `ftp:` link in someone's file keeps its destination and this fix does
      // not introduce the very exception it removes. `javascript:`, `data:`,
      // `vbscript:`, `file:` and `C:\notes\x.md` are refused by that default,
      // so the override is never looser than the dialog on anything dangerous.
      // An empty href answers true, as the default does, leaving
      // `renderHTML`'s stripped branch exactly as it behaves today.
      isAllowedUri: (url, ctx) => isRelativeLinkAddress(url) || ctx.defaultValidate(url),
    }),
    Placeholder.configure({ placeholder: 'Start writing…' }),
    // A block the file wrote directly under another (#568).
    AdjacentBlocks,
    TaskListWithSpacing,
    TaskItemHoldingABlock,
    ImageWithSpelling.configure({ inline: true, allowBase64: false }),
    // resizable: false — GFM markdown has no column width syntax.
    // Enabling resize produces UX inconsistency (widths reset at save).
    //
    // The extension is widened by one attribute: how the file spelled this
    // table (#93). It is read from the raw markdown on the way in, rides on
    // the table node through every edit, Save As and copy, and is consumed by
    // the serializer on the way out — so a table and its spelling never
    // travel separately, and nothing in the app has to carry them in step.
    // It is editor state, never file content: the serializer writes markdown,
    // so the attribute cannot reach the user's document.
    TableWithStyle.configure({ resizable: false, HTMLAttributes: { class: 'tiptap-table' } }),
    TableRow,
    TableCell,
    TableHeader,
    ImageDrop,
    // Registered after ImageDrop so a pasted image is still handled as an
    // image; this takes over everything else the clipboard carries (R-C13).
    PredictablePaste,
    // A paragraph inserted mid-list must not restart the numbering (R-C1).
    OrderedListContinuity,
    CodeBlockLanguage,
    CodeBlockCopy,
    // A reference shows its note under the pointer, and `Ctrl+Alt+F` makes a
    // footnote from the document (#409). Both are the editing surface R-C17
    // names; neither reaches the file.
    FootnoteHover,
    FootnoteShortcut,
    // Find & Replace highlights (R-C4). The wrapper in
    // src/editor/search-extension.ts owns the user-facing API; this
    // call only registers the underlying decoration plugin so matches
    // can be highlighted as the user types in the search panel.
    createSearchExtension(),
  ];
}

export function createEditor(
  element: HTMLElement,
  onChange?: () => void,
  images?: ImageInsertWiring,
): EditorInstance {
  const extensions = buildExtensions(images);

  const editor = new Editor({
    element,
    extensions,
    autofocus: true,
    // Spell-check off by default (R-C9) — technical documents are full
    // of identifiers and code blocks that browser spell-checkers
    // underline as misspellings.
    // Re-enabled per session via the statusbar toggle; AppState owns the
    // flag and main.ts mirrors it onto `.ProseMirror` directly.
    editorProps: {
      attributes: {
        spellcheck: 'false',
      },
    },
    onUpdate: () => {
      onChange?.();
    },
  });

  // `htmlForSave` is `editor.getHTML()` with each unedited raw HTML table
  // marked to be written as its own bytes (#283).
  const getMarkdown = () => htmlToMarkdown(htmlForSave(editor), { keepHtmlTables: true });

  // Every route that replaces the whole document goes through this one
  // function, which also forgets the undo history the previous document
  // left behind (#206, R-C16). The parser argument that used to live here
  // moved with it.
  const setMarkdown = (md: string) => replaceDocument(editor, md);
  const destroy = () => editor.destroy();

  return { editor, schema: editor.schema, getMarkdown, setMarkdown, destroy };
}
