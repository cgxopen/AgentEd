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
import type { Schema } from '@tiptap/pm/model';
import StarterKit from '@tiptap/starter-kit';
import { createImageDropPlugin } from './image-handler';
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

function buildExtensions(
  getFilePath: () => string | null,
  requestSaveAs: () => Promise<string | null>,
  confirmAssetsDir: () => Promise<string | null>,
): AnyExtension[] {
  const ImageDrop = Extension.create({
    name: 'imageDrop',
    addProseMirrorPlugins() {
      return [createImageDropPlugin(this.editor, getFilePath, requestSaveAs, confirmAssetsDir)];
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
  getFilePath?: () => string | null,
  requestSaveAs?: () => Promise<string | null>,
  confirmAssetsDir?: () => Promise<string | null>,
): EditorInstance {
  const extensions = buildExtensions(
    getFilePath ?? (() => null),
    requestSaveAs ?? (() => Promise.resolve(null)),
    confirmAssetsDir ?? (() => Promise.resolve('assets')),
  );

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
  const setMarkdown = (md: string) => editor.commands.setContent(markdownToHtml(md));
  const destroy = () => editor.destroy();

  return { editor, schema: editor.schema, getMarkdown, setMarkdown, destroy };
}
