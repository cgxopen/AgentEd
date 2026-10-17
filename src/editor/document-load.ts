import type { Editor } from '@tiptap/core';
import {
  DOMParser as ProseMirrorDOMParser,
  type Node as ProseMirrorNode,
  type Schema,
} from '@tiptap/pm/model';
import type { Plugin } from '@tiptap/pm/state';
import { parseKeepingCodeSpacing } from './code-span-spacing';
import { markdownToHtml } from './markdown/parse';

/**
 * The one place a whole document is put into the editor (#206).
 *
 * Every route that replaces the document reaches this function — File →
 * Open, the sidebar, the file association, a reload after an external
 * change, New, New from Template and Close. Before
 * this existed there were two primitives across three call sites, and
 * the repair below had to be applied to each of them separately; a route
 * added later would have reached for `setContent` and quietly missed it.
 * That is the same reasoning `insert-code-block.ts` was extracted under
 * on #205.
 */

/**
 * The plugin state field `prosemirror-history` keeps its stacks in.
 *
 * ProseMirror names a plugin's state field after its key, and
 * `prosemirror-history` builds its plugin with a module-level
 * `PluginKey("history")`, so the field is `history$`. The property is on
 * the plugin object and off the published typings — `@tiptap/core` reads
 * it the same way in `unregisterPlugin`, with the same cast — so the
 * guard in `forgetUndoHistory` is what stands in for the type here.
 */
const HISTORY_PLUGIN_KEY = 'history$';

/** `Plugin.key` as it exists at runtime. See `HISTORY_PLUGIN_KEY`. */
type KeyedPlugin = Plugin & { readonly key: string };

/**
 * Drop the undo history, both stacks, and leave every other plugin's
 * state exactly as it was.
 *
 * ── Why the plugin field rather than a flag on the transaction ──
 *
 * `prosemirror-history` 1.5.0 exports no way to clear its stacks: the
 * public surface is `closeHistory`, `history`, `isHistoryTransaction`,
 * `undo`, `redo`, their no-scroll variants and `undoDepth`/`redoDepth`.
 * The obvious alternative — `addToHistory: false` on the load
 * transaction — was **run** on this build before this was written, and
 * it repairs only half the defect: the load stops being undoable, but
 * the *previous* document's events stay on the stack. Undo after a
 * document switch then still fires, still consumes an event, and maps
 * that event's steps through a full-document replacement, so what it
 * does to the new document is whatever the position mapping happens to
 * produce. Measured on that build: a save afterwards wrote document A's
 * text over document B's file. Half a repair, and the dangerous half
 * left standing.
 *
 * ── Why the field is dropped and restored rather than the whole state ──
 *
 * `EditorState.create` would give a fresh history too, but it
 * re-initialises **every** plugin's state. Measured: with a search open
 * across an external-change reload, the decoration plugin came back at
 * `DecorationSet.empty` while `editor.storage.searchAndReplace` still
 * held the *previous* document's match positions — the panel reporting
 * "1 of 2" over a document with no matches, and Replace pointed at
 * offsets belonging to a file that is no longer on screen. That is a
 * behaviour change, and this defect does not need one.
 *
 * `reconfigure` keeps the state of every field present in both plugin
 * sets and calls `init` for the ones that are new, so removing the
 * history field and putting it back re-initialises that field and
 * nothing else. The same plugin instance goes back in, at the same index
 * in the same array, so the History extension's own `depth` and
 * `newGroupDelay` are not restated anywhere and plugin order — which
 * decides keymap precedence — is unchanged.
 */
function forgetUndoHistory(editor: Editor): void {
  const { view } = editor;
  const withHistory = view.state.plugins;
  const withoutHistory = withHistory.filter(
    (plugin) => !(plugin as KeyedPlugin).key.startsWith(HISTORY_PLUGIN_KEY),
  );

  const removed = withHistory.length - withoutHistory.length;
  if (removed !== 1) {
    // A named cause rather than a silent regression, the shape the `code`
    // and `listItem` guards in `setup.ts` use. If the kit stops
    // registering the history plugin, or registers a second one, this
    // function would return having dropped nothing — and every route
    // below would go back to carrying the load in the undo stack with
    // nothing to say so.
    throw new Error(`Expected exactly one history plugin, found ${removed} (see #206)`);
  }

  view.updateState(view.state.reconfigure({ plugins: withoutHistory }));
  view.updateState(view.state.reconfigure({ plugins: withHistory }));
}

/**
 * Replace the whole document with `markdown`, and forget the undo
 * history that belonged to the document before it (R-C16).
 *
 * The content change is an ordinary transaction, so every other plugin
 * sees the new document the way it always has — the search decorations
 * recompute against it, as they did before this function existed. Only
 * the history is reset, and only after the content has landed.
 *
 * ── The parser, and why it is not `setContent` with a string (#89) ──
 *
 * The open path parses with ProseMirror directly, the way `paste.ts`
 * already did — this was the only route that still met TipTap's own
 * helper, so both routes now reach the same DOM parser.
 *
 * **The parser is what they share, not the markdown reading.** `paste.ts`
 * calls `markdownToHtml` with `breaks: true` and this path leaves it
 * false, so a single newline is a hard break in pasted text and a space
 * in an opened file — measured on `marked` 15.0.12: `<a>A</a><br><a>B</a>`
 * for the paste, `<a>A</a>\n<a>B</a>` for the open. That difference is
 * deliberate and argued at `ParseOptions.breaks` in `markdown/parse.ts`:
 * a file's author chose where the paragraphs are, while for pasted text
 * the copied lines are the only structure on offer. Do not unify the two
 * options to make the routes "agree" — they are not meant to.
 *
 * Handing `setContent` a string instead would route it through TipTap's
 * `elementFromString`, whose `removeWhitespaces` deletes every text node
 * that is *exactly* a newline, at every depth. In `marked`'s output that
 * node is a **soft line break** whenever an inline element ends one line
 * and another starts the next, so the separator was removed and
 * ProseMirror then merged the adjacent text: `**a**`⏎`**b**` opened as
 * `<strong>ab</strong>` and was saved as `**ab**` — two words merged into
 * one, out of the user's file (R-C2). The helper was written to tidy
 * pretty-printed HTML and no `parseOptions` bypasses it;
 * `createNodeFromContent` returns a ProseMirror `Node` untouched, which
 * is the whole of the fix.
 *
 * The helper's reach was wider than the soft break — `marked` emits such
 * a node between list items, around table rows, inside blockquotes and
 * inside `<pre><code>` too. Those contexts were measured on both routes
 * and save byte-identically, because ProseMirror ignores whitespace-only
 * text outside inline context; the one place the node now survives into
 * the document model is an empty fenced block, where the saved bytes are
 * unchanged anyway for a reason of the serializer's. Both are pinned in
 * `soft-break.test.ts`.
 *
 * Parse options are deliberately left at their defaults: that is what
 * `setContent` used for the string, so whitespace is handled exactly as
 * before everywhere the helper was not the difference — a soft break
 * between two text characters still collapses to a single space, and a
 * fenced block still keeps its newlines through ProseMirror's own `pre`
 * rule.
 */
let replacing = false;

/**
 * Whether the transaction being handled right now is a whole-document
 * replacement rather than an edit (#418, point f).
 *
 * **This is the one address that can answer it**, for the reason R-C16 already
 * rests on: every route that puts a document on screen reaches
 * `replaceDocument`, and `src/app/document-load-routes.test.ts` enumerates them
 * one by one. A caller that wants to tell a load from a keystroke has nowhere
 * else to ask, and a flag set at a second address would go stale the day a
 * ninth route is added.
 *
 * `setContent` dispatches synchronously, so the flag is true for exactly the
 * transactions that replacement produces and for no others.
 */
export function isReplacingDocument(): boolean {
  return replacing;
}

export function replaceDocument(editor: Editor, markdown: string): void {
  replacing = true;
  try {
    editor.commands.setContent(parseDocument(editor.schema, markdown));
  } finally {
    replacing = false;
  }
  forgetUndoHistory(editor);
}

/**
 * The document `markdown` becomes on load, without loading it.
 *
 * Its own function so that the question `kept-html-table.ts` asks at save —
 * would this table's source bytes read back as the table the editor holds —
 * is answered by the route a load takes, rather than by a copy of it.
 */
export function parseDocument(schema: Schema, markdown: string): ProseMirrorNode {
  const container = document.createElement('div');
  container.innerHTML = markdownToHtml(markdown);
  // The white space of a code span and around it, as the HTML holds it (#603).
  return parseKeepingCodeSpacing(ProseMirrorDOMParser.fromSchema(schema), container);
}
