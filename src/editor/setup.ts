import { type AnyExtension, Editor, Extension } from '@tiptap/core';
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
import { DOMParser as ProseMirrorDOMParser, type Schema } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import {
  type CanWriteCompanions,
  type ConfirmAssetsDir,
  createImageDropPlugin,
  type GetFilePath,
  type RequestSaveAs,
} from './image-handler';
import type { ReportImageInsert } from './image-insert-outcome';
import { isRelativeLinkAddress } from './link-url';
import { LIST_SPACING_ATTRIBUTE } from './markdown/list-spacing';
import { markdownToHtml } from './markdown/parse';
import { htmlToMarkdown } from './markdown/serialize';
import { TABLE_STYLE_ATTRIBUTE } from './markdown/table-style';
import { OrderedListContinuity } from './ordered-list-continuity';
import { PredictablePaste } from './paste';
import { createSearchExtension } from './search-extension';

/**
 * StarterKit, with the two declarations this project overrides: the `Code`
 * mark, so a code span can sit *inside* another mark instead of cancelling it
 * (#84), and the `listItem` node, so an item may begin with a block (#110).
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
 * for a mark the bundle already contains.
 *
 * **`configure` comes before `extend`, and the order is load-bearing.** The
 * other way round — `StarterKit.extend({…}).configure({…})` — the kit builds
 * its sub-extensions from its *default* options and every value passed here is
 * silently dropped: measured on this branch, `heading` came back as levels 1–6
 * instead of 1–4, and the code block lost the `code-block` class. Nothing
 * threw and no test failed, because both are configuration rather than
 * behaviour. `configure` first, then `extend`, is what keeps them.
 * `configuration survives the extend` in `mark-nesting.test.ts` is the pin.
 *
 * **Only one of the two had a user-visible consequence, and it is the heading
 * levels** — with 1–6 restored, `##### Five` becomes a heading here instead of
 * the paragraph the rest of the codebase assumes (`numbered-heading.test.ts`).
 * `code-block` is **not** what a fenced block's appearance hangs on: the
 * styling is `.tiptap pre` in `src/styles.css`, and that class is referenced
 * nowhere in it — it is configuration this file asks for and nothing consumes.
 * An earlier version of this comment said the opposite; the owner's manual
 * check on 2026-08-24 is what corrected it, after a step written from that
 * wrong reading asked him for a border the application never draws. Whether
 * dead configuration should be removed is its own question, not this one's.
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
  };
}

function starterKitWithLocalSchemaRules() {
  return StarterKit.configure({
    heading: { levels: [1, 2, 3, 4] },
    codeBlock: { HTMLAttributes: { class: 'code-block' } },
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
      return registered.map((extension) => {
        if (extension.name === 'code') return extension.extend({ excludes: '', priority: 1 });
        if (extension.name === 'listItem') return extension.extend({ content: 'block+' });
        // The two list containers StarterKit registers gain the file's own
        // spacing (#28). Extended here rather than imported directly, for the
        // reason the comment above gives: the list is read off the kit.
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
 * The table node, plus the one attribute #93 needs: the spelling the file
 * used for this table. `parseHTML`/`renderHTML` keep it on the round trip
 * through the document model, which is what lets an untouched table be
 * written back byte for byte.
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
    };
  },
});

export interface EditorInstance {
  editor: Editor;
  schema: Schema;
  getMarkdown: () => string;
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
    Underline,
    Link.configure({
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
    TaskListWithSpacing,
    TaskItemHoldingABlock,
    Image.configure({ inline: true, allowBase64: false }),
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

  const getMarkdown = () => htmlToMarkdown(editor.getHTML());

  // The open path parses with ProseMirror directly, the way `paste.ts` already
  // did — `setMarkdown` was the only route that still met TipTap's own helper,
  // so both routes now reach the same DOM parser (#89).
  //
  // **The parser is what they share, not the markdown reading.** `paste.ts`
  // calls `markdownToHtml` with `breaks: true` and this path leaves it false,
  // so a single newline is a hard break in pasted text and a space in an
  // opened file — measured on `marked` 15.0.12: `<a>A</a><br><a>B</a>` for the
  // paste, `<a>A</a>\n<a>B</a>` for the open. That difference is deliberate and
  // argued at `ParseOptions.breaks` in `markdown/parse.ts`: a file's author
  // chose where the paragraphs are, while for pasted text the copied lines are
  // the only structure on offer. Do not unify the two options to make the
  // routes "agree" — they are not meant to.
  //
  // Handing `setContent` a string instead would route it through TipTap's
  // `elementFromString`, whose `removeWhitespaces` deletes every text node
  // that is *exactly* a newline, at every depth. In `marked`'s output that
  // node is a **soft line break** whenever an inline element ends one line
  // and another starts the next, so the separator was removed and ProseMirror
  // then merged the adjacent text: `**a**`⏎`**b**` opened as `<strong>ab</strong>`
  // and was saved as `**ab**` — two words merged into one, out of the user's
  // file (R-C2). The helper was written to tidy pretty-printed HTML and no
  // `parseOptions` bypasses it; `createNodeFromContent` returns a ProseMirror
  // `Node` untouched, which is the whole of the fix.
  //
  // The helper's reach was wider than the soft break — `marked` emits such a
  // node between list items, around table rows, inside blockquotes and inside
  // `<pre><code>` too. Those contexts were measured on both routes and save
  // byte-identically, because ProseMirror ignores whitespace-only text outside
  // inline context; the one place the node now survives into the document
  // model is an empty fenced block, where the saved bytes are unchanged anyway
  // for a reason of the serializer's. Both are pinned in `soft-break.test.ts`.
  //
  // Parse options are deliberately left at their defaults: that is what
  // `setContent` used for the string, so whitespace is handled exactly as
  // before everywhere the helper was not the difference — a soft break
  // between two text characters still collapses to a single space, and a
  // fenced block still keeps its newlines through ProseMirror's own `pre`
  // rule.
  const setMarkdown = (md: string) => {
    const container = document.createElement('div');
    container.innerHTML = markdownToHtml(md);
    editor.commands.setContent(ProseMirrorDOMParser.fromSchema(editor.schema).parse(container));
  };
  const destroy = () => editor.destroy();

  return { editor, schema: editor.schema, getMarkdown, setMarkdown, destroy };
}
