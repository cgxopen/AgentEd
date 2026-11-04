import type { Fragment, Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import { htmlForSave } from './kept-html-table';
import { htmlToMarkdown } from './markdown/serialize';

/**
 * The markdown a document is written as: one function for the save and for
 * the plain text of a copy (#697, owner decision 1 of 2026-11-04).
 *
 * The save asks it of the editor state; a copy asks it of a document made of
 * the copied blocks. Both go through `htmlForSave`, so a raw HTML table or
 * block the file keeps as bytes is written as those bytes in both, and the
 * two cannot answer differently.
 */
export function markdownOf(state: EditorState): string {
  return htmlToMarkdown(htmlForSave({ state, schema: state.schema }), { keepHtmlTables: true });
}

/**
 * The markdown of some blocks, written as the file would write them if they
 * were the whole document.
 *
 * The blocks may be cut, as a copied slice cuts them, so the document is made
 * without the content check: the serializer writes what it is handed.
 */
export function markdownOfBlocks(content: Fragment, schema: Schema): string {
  const doc = schema.topNodeType.create(null, content);
  return markdownOf(EditorState.create({ doc }));
}
