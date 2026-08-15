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
  ensureAssetsDir: () => Promise<string | null>,
): AnyExtension[] {
  const ImageDrop = Extension.create({
    name: 'imageDrop',
    addProseMirrorPlugins() {
      return [createImageDropPlugin(this.editor, getFilePath, requestSaveAs, ensureAssetsDir)];
    },
  });

  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      codeBlock: { HTMLAttributes: { class: 'code-block' } },
    }),
    Underline,
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
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
  ensureAssetsDir?: () => Promise<string | null>,
): EditorInstance {
  const extensions = buildExtensions(
    getFilePath ?? (() => null),
    requestSaveAs ?? (() => Promise.resolve(null)),
    ensureAssetsDir ?? (() => Promise.resolve('assets')),
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
