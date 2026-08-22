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
  type ConfirmAssetsDir,
  createImageDropPlugin,
  type GetFilePath,
  type RequestSaveAs,
} from './image-handler';
import type { ReportImageInsert } from './image-insert-outcome';
import { isRelativeLinkAddress } from './link-url';
import { markdownToHtml } from './markdown/parse';
import { htmlToMarkdown } from './markdown/serialize';
import { OrderedListContinuity } from './ordered-list-continuity';
import { PredictablePaste } from './paste';
import { createSearchExtension } from './search-extension';

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
  /** How every insert — landed, cancelled or refused — is reported (#61). */
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
          images.report,
        ),
      ];
    },
  });

  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      codeBlock: { HTMLAttributes: { class: 'code-block' } },
    }),
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
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.configure({ inline: true, allowBase64: false }),
    // resizable: false — GFM markdown has no column width syntax.
    // Enabling resize produces UX inconsistency (widths reset at save).
    Table.configure({ resizable: false, HTMLAttributes: { class: 'tiptap-table' } }),
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

  // The open path parses with ProseMirror directly, the way `paste.ts` does —
  // one parser for both routes, so a document opened from a file and the same
  // text pasted into the editor arrive as the same document (#89).
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
