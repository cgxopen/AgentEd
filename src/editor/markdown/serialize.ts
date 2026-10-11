import TurndownService, { type Options } from 'turndown';
import { getRelativePath } from '../image-registry';
import { BARE_BLANK_MARKER, BLOCKQUOTE_BLANK_MARKER_ATTRIBUTE } from './blockquote-spacing';
import { cellBlocks, needsCellBlockSpelling } from './cell-blocks';
import { COMMENT_TAG, decodeComment, MARKDOWN_COMMENT_ATTRIBUTE } from './comment-spelling';
import { literalAmpersands } from './destination';
import { type ContainerReplacements, createBlankReplacement } from './empty-fence';
import {
  createNarrowedEscape,
  DEFINITION_POSITION,
  resolveDefinitionPositions,
  setDocumentCarriesTheMark,
} from './escape';
import {
  decodeIndents,
  FOOTNOTE_BLANK_LINE_ATTRIBUTE,
  FOOTNOTE_DEFINITION_ATTRIBUTE,
  FOOTNOTE_INDENTS_ATTRIBUTE,
  joinDefinition,
} from './footnote';
import { decodeKeptBlockSource } from './html-wrapper';
import {
  decodeHtmlSource,
  IMAGE_HTML_SOURCE_ATTRIBUTE,
  imageMarkup,
  pixelValue,
} from './image-spelling';
import { addKeptRawHtmlRules } from './kept-raw-html';
import { LIST_MARKER_ATTRIBUTE, markerFor } from './list-marker';
import { LIST_SPACING_ATTRIBUTE } from './list-spacing';
import { decodeTableSource, TABLE_HTML_SOURCE_ATTRIBUTE } from './table-html-source';
import {
  type ColumnStyle,
  DEFAULT_TABLE_STYLE,
  decodeTableStyle,
  TABLE_STYLE_ATTRIBUTE,
  type TableStyle,
} from './table-style';
import { HTML_BLOCK_SOURCE_ATTRIBUTE } from './tag-filter';

// ── An empty fenced block (#94) ──
//
// turndown replaces every blank node before it consults a rule, so an empty
// fenced block used to leave the file entirely — see `empty-fence.ts` for the
// mechanism and for why `addRule` cannot reach it. `blankReplacement` is the
// hook that can, and it is passed **at construction** because that is when
// the service resolves it into its rule table: assigning it afterwards has no
// effect, and this option is documented where `options.rules` below is not.
//
// The default is read off a service of turndown's own making rather than
// restated, so every blank node that is not a fenced block — an empty
// paragraph, an empty inline element, an empty list item — keeps behaving
// exactly as it does today, and goes on doing so if a future release changes
// what that means. Optional in the declaration, so the check is demanded
// rather than trusted: a release that stopped resolving a default would
// otherwise fail as `blankOtherwise is not a function` on the first save that
// meets an empty paragraph, rather than here, naming its cause.
const turndownDefaults = new TurndownService().options;
const defaultBlankReplacement = turndownDefaults.blankReplacement;
if (!defaultBlankReplacement) {
  throw new Error(
    'turndown no longer resolves a default options.blankReplacement, so an empty fenced block ' +
      'cannot delegate to it (#94). See src/editor/markdown/empty-fence.ts.',
  );
}

// ── The container half of it (#104) ──
//
// A fence that is the *only* content of a blockquote or a list item went the
// same way and took its container with it, because a container holding
// nothing but a blank child is blank itself. The hook above answers for the
// container too, and this is the table it answers from: for each container a
// blank fence can hide inside, the rule that already writes that container
// when it is not blank.
//
// **Every entry delegates.** `BLOCKQUOTE`, `UL` and `OL` are turndown's own
// rules, read from its resolved defaults the way the heading rule below reads
// `heading` and for the same stated reason; `LI` is this repository's, the
// two functions the `listItem` and `taskListItem` rules are registered with
// further down — one definition each, used twice. So a container rescued here
// is written exactly as one holding a paragraph would be, indentation,
// numbering and all, and it stays that way when either rule changes.
//
// Declared optional in `src/types/turndown.d.ts`, so the check is demanded
// rather than trusted — the same guard, and the same failure it prevents, as
// `blankReplacement` above.
const builtinBlockquote = turndownDefaults.rules.blockquote;
const builtinList = turndownDefaults.rules.list;
if (!builtinBlockquote || !builtinList) {
  throw new Error(
    'turndown no longer exposes options.rules.blockquote and options.rules.list, so a fence that ' +
      'is the only content of its container cannot delegate to them (#104). ' +
      'See src/editor/markdown/empty-fence.ts.',
  );
}

const CONTAINERS: ContainerReplacements = {
  BLOCKQUOTE: builtinBlockquote.replacement,
  UL: builtinList.replacement,
  OL: builtinList.replacement,
  // The same split the two `LI` rules make between them, and it has to be
  // made here as well: rule *precedence* is what keeps those two filters
  // apart, and a blank node never reaches the rule array to be ordered by it.
  LI: (content, node, options) =>
    isTaskListItem(node)
      ? taskListItemReplacement(node)
      : listItemReplacement(content, node, options),
};

const turndown = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  fence: '```',
  emDelimiter: '*',
  strongDelimiter: '**',
  blankReplacement: createBlankReplacement(defaultBlankReplacement, CONTAINERS),
});

// #90: turndown escapes every `_` in a text node, because from one text node
// it cannot tell syntax from content. An intraword `_` is noise CommonMark
// never asked for, and it landed in the user's file on every save. The
// original method stays the authority on everything else — including every
// backtick; see `escape.ts` for why `*` and `` ` `` are deliberately not
// treated the same way.
turndown.escape = createNarrowedEscape(TurndownService.prototype.escape.bind(turndown));

// ── A number that begins a heading or a table cell (#97) ──
//
// Turndown's escape table holds `[/^(\d+)\. /g, '$1\\. ']`, so a text node
// beginning with digits and a full stop is written back with a backslash:
// `## 1. Product statement` was saved as `## 1\. Product statement`, on every
// save of every numbered document, in every diff (R-C2).
//
// **That escape matters exactly where a list can begin.** Measured on
// `marked@15` with `parse.ts`'s options: a heading and a table cell take
// inline content only, so `1. x` in either parses identically with or without
// the backslash — there it is noise. A paragraph, a blockquote body and a
// list-item body host block content, and there it is load-bearing:
// `1990. It was a good year.` without a backslash comes back as an ordered
// list starting at 1990, a sentence turned into a list. So the escape stays
// everywhere except the two contexts that know, by construction, that no list
// can start in them.
//
// This is why the fix is not a second narrowing in `escape.ts`: that function
// is handed one string and no node, so it cannot tell a heading's `1.` from a
// paragraph's. For the same reason it is not a pass over the finished
// markdown either — from the whole document those are the same characters.
// It has to be done where the context is already known.

/**
 * Drop the backslash turndown put in front of a leading `N.`, for a caller
 * that has already established a list cannot begin in it.
 *
 * Anchored to the start of the content because that is the only place the
 * escape can appear: turndown applies that rule at the start of a *text
 * node*, and in a heading or a cell parsed from a file, the leading text node
 * is the start of the content.
 *
 * A number that opens an **inline element** instead sits further in and keeps
 * its backslash — `## **1. Bold** thing`, `## *1. x* y`, `## [1. x](url) y`,
 * and the same three shapes inside a table cell. Rendering is identical and
 * the file holds still after the first save; it is recorded in R-C2 as a
 * known exception, with the constraint that decides it. Reaching those would
 * mean rewriting `N\.` anywhere in the string, which would corrupt the one
 * place those two characters are the user's own — inside a code span
 * (`` ## `1\. x` ``), whose text never reaches `escape` at all.
 */
function withoutLeadingListEscape(content: string): string {
  return content.replace(/^(\d+)\\\. /, '$1. ');
}

// The heading rule delegates to the built-in one — same filter, same output —
// and only changes the content handed to it. `headingStyle: 'atx'` and
// everything else that rule does stay turndown's business, exactly as
// `escape.ts` leaves the rest of the escape table to turndown.
//
// The parity with `escape.ts` is not exact in one respect: turndown documents
// overriding `TurndownService.prototype.escape`, but `options.rules` appears
// in neither of its README's option tables — it lives in the library's
// `defaults` and nowhere else, and the package ships no types, so TypeScript
// cannot see it change shape. Hence the guard: if a future release stops
// exposing the rule table, this fails at module load naming the cause, rather
// than as `Cannot read properties of undefined` from a blank application.
const builtinHeading = turndown.options.rules.heading;
if (!builtinHeading) {
  throw new Error(
    'turndown no longer exposes options.rules.heading, so the heading rule cannot delegate to the ' +
      'built-in one (#97). See the heading rule in src/editor/markdown/serialize.ts.',
  );
}
/*
 * The four elements whose text is not content (#311).
 *
 * Turndown keeps the **text** of an element it has no rule for, and DOMPurify
 * has already taken the element itself away — so a `<style>` arrived as a
 * paragraph holding its CSS, a `<script>` as a paragraph holding its source, a
 * `<title>` as its title and a `<noscript>` as its fallback text. Nothing ever
 * executed: the script source reached the document as text, never as a script.
 * What it was is the artifact class R-C13 names in as many words — *converts to
 * clean markdown with no artifacts (no stray `http` fragments, no leftover
 * markup)*.
 *
 * **Every paste from Excel hit it**, which is how it was found: Excel wraps its
 * grid in a document whose `<style>` holds the Office stylesheet inside an HTML
 * comment, so the whole of `mso-displayed-decimal-separator …` arrived as a
 * paragraph above the table. Measured by the owner on Windows against the same
 * clipboard in GitHub, which shows none of it.
 *
 * **Why this address rather than the paste path, which was the open question.**
 * `htmlToMarkdown` is also the save path, so the line had to be shown not to
 * cost a file anything. Measured at `c201e4e` and with the line, on a markdown
 * file holding a raw `<style>`, `<script>`, `<title>` and `<noscript>` block:
 * **173 bytes in, 38 bytes out, identical either way.** Such a file already
 * loses all four on an untouched open and save, because DOMPurify removes them
 * on the way in, long before this function runs — so there is nothing left for
 * this line to take. It adds no R-C2 exception because it changes no file.
 *
 * `<template>` is not listed and does not need to be: its content is a document
 * fragment the parser never puts in the tree, so it arrives empty already.
 *
 * **The one place a `<script>` is deliberately kept is untouched**, and that was
 * measured rather than assumed: a raw HTML table is written back as the file's
 * own bytes (#283, and REQUIREMENTS says *including markup the editor does not
 * show, such as a `<script>` that DOMPurify removes from the view*). Those bytes
 * ride on an attribute and are written by the kept-table rule, which never walks
 * the elements below — a table carrying a `<script>`, a `<caption>` and a
 * `colspan` round-trips byte-identically with this line in place.
 */
turndown.remove(['style', 'script', 'title', 'noscript']);

// A link as turndown writes it, with one difference: an ampersand in the
// destination that would begin a character reference is written as `&amp;`, so
// the next reader does not decode it into another address (#447, see
// `destination.ts`). Everything else is turndown's own `inlineLink`, restated
// because a rule cannot be adjusted in place: parentheses escaped, and the
// title quoted with its newlines collapsed the way turndown collapses them.
turndown.addRule('inlineLinkKeepingAmpersands', {
  filter: (node) => node.nodeName === 'A' && Boolean((node as HTMLElement).getAttribute('href')),
  replacement: (content, node) => {
    const element = node as HTMLElement;
    const href = literalAmpersands(element.getAttribute('href') ?? '').replace(/([()])/g, '\\$1');
    const rawTitle = element.getAttribute('title');
    const title = rawTitle ? ` "${rawTitle.replace(/(\n+\s*)+/g, '\n').replace(/"/g, '\\"')}"` : '';
    return `[${content}](${href}${title})`;
  },
});

turndown.addRule('heading', {
  filter: builtinHeading.filter,
  replacement: (content, node, options) =>
    builtinHeading.replacement(withoutLeadingListEscape(content), node, options),
});

// ── Task list serialization (#157) ──
//
// A task item used to be written as one line of text: the first paragraph's
// `textContent`, and nothing else. Everything a task item held besides that
// paragraph left the user's file on save — a list nested under it, a heading,
// a blockquote, a fenced block. This writes **every block the item holds**,
// each one through the same rules that write it anywhere else.
//
// ── Why the blocks are written one at a time ──
//
// The separator between them is not turndown's to choose here. turndown puts
// a blank line between two blocks, and **a blank line anywhere inside a task
// item ends the checkbox**: `marked` reads a task item only when the item's
// first block is a paragraph opening with the marker, and a blank line makes
// the `<input>` part of that paragraph instead. Measured — `- [ ] a` followed
// by a blank line and `  ## h` comes back as a plain bullet whose text begins
// with a checkbox character, so writing an item loosely would trade the lost
// block for a lost checkbox. Every block of a task item is therefore joined
// to the next by exactly one newline, which is the tight spelling `marked`
// reads back as the same item.
//
// The recursion this costs is over the document's own nesting — one further
// call for each task list nested inside a task item, each on a strictly
// smaller subtree — and it is the same recursive call `cellContent` further
// down already makes for a table cell, for the same reason: a container whose
// children need writing on terms the surrounding walk cannot express.

/**
 * The indent a task item's continuation lines carry.
 *
 * Two, the width of the `- ` list marker — **not** the six characters of
 * `- [ ] `. The `[ ] ` is GFM's task marker, which lives in the item's first
 * paragraph rather than in the list marker, so the item's content column is
 * the same as any bullet's. Measured rather than eyeballed: at an indent of
 * two and of four `- [ ] a` followed by `- b` reads back as a nested list, and
 * at six it reads back as two lines of text in one item.
 */
const TASK_ITEM_INDENT = 2;

/**
 * The elements that stand on their own line in the markdown this writes.
 *
 * Enumerated in this direction on purpose. An element missing from the list is
 * treated as inline and joins the paragraph around it, which at worst writes a
 * block where a paragraph would do; an inline element wrongly counted as a
 * block would break a sentence into pieces.
 */
const BLOCK_ELEMENTS: ReadonlySet<string> = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'UL',
  'OL',
  'BLOCKQUOTE',
  'PRE',
  'TABLE',
  'HR',
  'DIV',
  'FIGURE',
  'DL',
]);

function isBlockElement(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && BLOCK_ELEMENTS.has(node.nodeName);
}

/**
 * Where a task item keeps its blocks.
 *
 * The two halves of the pipeline hand this rule two different shapes and both
 * are real: `marked` writes a tight item's content straight into the `<li>`,
 * and TipTap renders `<li><label>…checkbox…</label><div>…content…</div></li>`.
 * The wrapper is recognised by that exact shape rather than by a tag name
 * anywhere in the item, so a `<div>` a document of its own brought along is
 * not mistaken for it — and so that a future release of the extension which
 * renders the item differently falls back to the `<li>` and fails in the
 * round-trip table rather than quietly writing the wrong thing.
 */
function taskItemContent(li: HTMLElement): HTMLElement {
  const children = li.children;
  if (children.length === 2 && children[0].nodeName === 'LABEL' && children[1].nodeName === 'DIV') {
    return children[1] as HTMLElement;
  }
  return li;
}

/**
 * The item's content as a list of blocks, with any bare inline run wrapped in
 * a paragraph so that the two shapes above become one.
 *
 * Works on a detached copy: nothing here may disturb the tree turndown is
 * walking. The loop is bounded by the item's own children, and each of them is
 * visited once — the snapshot is taken before the first move, so a node that
 * is moved into a paragraph is not visited again.
 */
function taskItemBlocks(host: HTMLElement): HTMLElement[] {
  const scratch = host.ownerDocument.createElement('div');
  scratch.innerHTML = host.innerHTML;

  let paragraph: HTMLElement | null = null;
  for (const child of Array.from(scratch.childNodes)) {
    if (isBlockElement(child)) {
      paragraph = null;
      continue;
    }
    // The newlines `marked` leaves between elements are not content, and a
    // paragraph made of them would write a blank line into the item.
    if (child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim() === '') {
      scratch.removeChild(child);
      continue;
    }
    if (!paragraph) {
      paragraph = scratch.ownerDocument.createElement('p');
      scratch.insertBefore(paragraph, child);
    }
    paragraph.appendChild(child);
  }

  return Array.from(scratch.children) as HTMLElement[];
}

/** Leading blank lines and trailing whitespace off one written block. */
function trimBlock(markdown: string): string {
  return markdown.replace(/^\n+/, '').replace(/\s+$/, '');
}

// A function declaration rather than an inline replacement because the
// container table above delegates to this same function for a blank task item
// (#104) — one definition, two callers, no restatement.
function taskListItemReplacement(node: Node): string {
  const li = node as HTMLLIElement;
  // Read off the item rather than off a checkbox somewhere inside it. Both
  // halves of the pipeline write this attribute — `parse.ts` puts it there and
  // TipTap renders it — while the `<input>` element exists only in the
  // editor's HTML, so a `querySelector` for one used to lose the tick on every
  // save that did not come from an editor. It is also the only reading that
  // cannot be answered by the *nested* item's checkbox instead of this one's.
  const checked = li.getAttribute('data-checked') === 'true' ? 'x' : ' ';
  const blocks = taskItemBlocks(taskItemContent(li));
  // ── A block after a table inside an item (#281) ──
  //
  // The blocks of an item are written one newline apart — the recorded
  // exception for two paragraphs in one task item — and that is exactly where
  // GFM expects another table row. Measured on `c96ad04`: an item holding a
  // table and then the paragraph `after` read back with `after` as a third row
  // of that table, and a second table after the first turned two rows into
  // five. Six other blocks survive on their own spelling, because a heading, a
  // bullet or ordered list, a fence, a blockquote and a rule each end a table
  // on the line where they start; a paragraph and a table row cannot.
  //
  // **So an item that holds a table writes all of its blocks a blank line
  // apart**, owner decision of 2026-09-12. Spacing only after the table was
  // measured and is cheaper — it moves no test and no document — but it leaves
  // the item spelled tight before the table and loose after it, which `marked`
  // reads as a tight list: the content then arrives as bare text rather than
  // paragraphs, and the paragraph comes back carrying a leading space. Written
  // loose throughout, the document comes back exactly as it went out.
  //
  // An item that holds no table is untouched, so the recorded exception holds
  // everywhere it held before.
  //
  // **Only the item's own blocks are asked**, so an item whose nested list
  // holds the table is written tight around that list. Measured on `2bf4f1a`
  // (#283), with a paragraph after the nested list in the outer item, for a
  // nested checklist and a nested bullet list: the document reads back as it
  // went out and the second save moves nothing, because the nested item
  // spaces its own blocks and the outer paragraph ends the table by its lesser
  // indentation. Pinned by two rows in `src/editor/roundtrip.test.ts`.
  const holdsATable = blocks.some((block) => block.nodeName.toUpperCase() === 'TABLE');
  const body = blocks
    .map((block) => trimBlock(turndown.turndown(block.outerHTML)))
    .filter((block) => block.length > 0)
    .join(holdsATable ? '\n\n' : '\n');
  const separator = li.nextSibling !== null && isLooseList(li) ? '\n\n' : '\n';
  return `- [${checked}] ${indentContinuation(body, TASK_ITEM_INDENT)}${separator}`;
}

turndown.addRule('taskListItem', {
  filter: (node) => {
    return node.nodeName === 'LI' && node.parentElement?.getAttribute('data-type') === 'taskList';
  },
  replacement: (_content, node) => taskListItemReplacement(node),
});

// ── List serialization ──
//
// Turndown's built-in rules pad every marker to a fixed width ("-   item",
// "1.  item") and, because TipTap wraps each item body in <p>, leave an
// indented blank line behind every item. Both rewrite list markup the user
// never touched, which breaks the R-C2 round-trip. The rules below emit the
// canonical single-space markers, honour the parent <ol start> so a list
// interrupted by a paragraph keeps its numbering (R-C1), and indent
// continuation lines by exactly the marker width, as CommonMark requires.

function isTaskListItem(node: Node): boolean {
  return (node as HTMLElement).parentElement?.getAttribute('data-type') === 'taskList';
}

/** Marker for one item: "- " for bullets, "N. " for ordered items. */
function listItemPrefix(li: HTMLElement, bulletMarker: string): string {
  const parent = li.parentElement;
  // The marker the file used, where the list carries one (#431). The option is
  // what a list the editor made is written with, and stays the fallback: an
  // absent attribute means the default rather than an unknown.
  const carried = parent?.getAttribute(LIST_MARKER_ATTRIBUTE) ?? null;
  if (parent?.nodeName !== 'OL') {
    return `${carried === null ? bulletMarker : markerFor(carried, false)} `;
  }
  const declared = Number.parseInt(parent.getAttribute('start') || '1', 10);
  const start = Number.isFinite(declared) ? declared : 1;
  const index = Array.prototype.indexOf.call(parent.children, li);
  return `${start + index}${markerFor(carried, true)} `;
}

/** Indent every line but the first by the marker width; blank lines stay empty. */
function indentContinuation(body: string, width: number): string {
  const pad = ' '.repeat(width);
  return body
    .split('\n')
    .map((line, i) => (i === 0 || line.length === 0 ? line : pad + line))
    .join('\n');
}

// Named for the same reason as `taskListItemReplacement` above: the container
// table delegates to it for a list item that is blank only because the fence
// inside it was (#104).
/**
 * Whether the list holding this item was spelled loose in the file (#28).
 *
 * This used to be derived from the content — an item whose body held more
 * than one block was written with a blank line after it — and that rule
 * decided the byte from CommonMark's question rather than the file's. It got
 * the loose case wrong in one direction and the tight case wrong in the
 * other: a file spelled `- one`⏎⏎`  second para`⏎`- two` is tight between its
 * items and gained a blank line it never had, 26 bytes in and 27 out, while a
 * file spelled loose lost the blank lines it did have.
 *
 * One fact answers both, and it is the one the file carries.
 */
function isLooseList(li: Node): boolean {
  return (li as HTMLElement).parentElement?.getAttribute(LIST_SPACING_ATTRIBUTE) === 'true';
}

function listItemReplacement(content: string, node: Node, options: Options): string {
  const prefix = listItemPrefix(node as HTMLElement, options.bulletListMarker ?? '-');
  const body = content.replace(/^\n+/, '').replace(/\s+$/, '');
  const separator = isLooseList(node) ? '\n\n' : '\n';
  return prefix + indentContinuation(body, prefix.length) + (node.nextSibling ? separator : '');
}

// The filter explicitly excludes task list items so this rule cannot shadow
// the 'taskListItem' rule above — turndown gives precedence to the rule added
// last, so the two filters must not overlap.
turndown.addRule('listItem', {
  filter: (node) => node.nodeName === 'LI' && !isTaskListItem(node),
  replacement: listItemReplacement,
});

// A paragraph inside a list item ends with a single newline when a nested
// list follows, so the nested list stays tight ("- one\n  - nested"); two
// paragraphs in the same item keep the blank line that separates them.
turndown.addRule('listItemParagraph', {
  filter: (node) => {
    const parent = node.parentElement;
    return node.nodeName === 'P' && parent?.nodeName === 'LI' && !isTaskListItem(parent);
  },
  replacement: (content, node) => {
    const next = (node as HTMLElement).nextElementSibling;
    const nestedListFollows = next?.nodeName === 'UL' || next?.nodeName === 'OL';
    return `\n\n${content}${next && !nestedListFollows ? '\n\n' : '\n'}`;
  },
});

// ── Two adjacent lists of different kinds (#160) ──
//
// A list whose items are not all task items cannot be held as one list — a
// `taskList` takes `taskItem+` and nothing else — so `- [ ] a` followed by
// `- b` is **two top-level lists** in the document model, and two adjacent
// blocks are written a line apart. Reading that back, the blank line makes
// the two runs one **loose** list, where `marked` sees no task marker at all:
// measured, `- [ ] a`⏎`- b` saved as `- [ ] a`⏎⏎`- b` and then as `- a`⏎`- b`,
// the checkbox gone on the second save and the file settling only on the
// third. R-C2 carries fifteen recorded exceptions and every one of them
// changes the file once and then holds still; this did not.
//
// **Written tightly, the pair is a fixed point.** The tight spelling is what
// the file already said, and it reads back into exactly the two lists it was
// written from — so the join is not a normalisation, it is the file's own
// text.
//
// ── Why the rule is different *kinds* rather than adjacency ──
//
// Two adjacent lists of the **same** kind would merge if they were written
// tightly: two `<ul>` become one list, two `<ol>` lose the second one's start,
// two task lists become one. Measured directly, on the DOM this rule is handed.
// Different kinds cannot merge, because the marker itself separates them —
// which is what makes this rule safe without depending on how #28 decides the
// blank line between items. So the rule refuses exactly as reliably as it
// joins, and a same-kind pair keeps the blank line it has today.
//
// The **filter** is the narrowing, not the replacement: a list with no
// different-kind list beside it never reaches this rule, and goes on being
// written by turndown's own, exactly as before. What it repairs is eight
// shapes, four of which have nothing to do with task lists at all — `- a`⏎`1. b`
// and its mirror gained a blank line too, in ordinary markdown.

/** Which list this is, as the marker it will be written with. */
function listKind(list: Element): 'ol' | 'task' | 'ul' {
  if (list.nodeName === 'OL') return 'ol';
  return list.getAttribute('data-type') === 'taskList' ? 'task' : 'ul';
}

/**
 * Whether `sibling` is a list that this one cannot be merged with on the way
 * back in — the whole of the safety argument, in one comparison.
 */
function isDifferentKindOfList(list: Element, sibling: Element | null): boolean {
  if (sibling === null) return false;
  if (sibling.nodeName !== 'UL' && sibling.nodeName !== 'OL') return false;
  return listKind(list) !== listKind(sibling);
}

turndown.addRule('adjacentListsOfDifferentKinds', {
  filter: (node) => {
    if (node.nodeName !== 'UL' && node.nodeName !== 'OL') return false;
    const list = node as HTMLElement;
    return (
      isDifferentKindOfList(list, list.previousElementSibling) ||
      isDifferentKindOfList(list, list.nextElementSibling)
    );
  },
  // Delegates, and only changes the newlines on the sides that face another
  // list — so numbering, indentation and everything else stay turndown's
  // business, the way the heading rule leaves `headingStyle` to it. turndown
  // joins two siblings with the *larger* of the newline runs they offer, so
  // both sides of a join have to be narrowed for the blank line to go.
  replacement: (content, node, options) => {
    const list = node as HTMLElement;
    let written = builtinList.replacement(content, node, options);
    if (isDifferentKindOfList(list, list.previousElementSibling)) {
      written = written.replace(/^\n+/, '\n');
    }
    if (isDifferentKindOfList(list, list.nextElementSibling)) {
      written = written.replace(/\n+$/, '\n');
    }
    return written;
  },
});

// Preserve underline as <u> tag (not standard MD, but round-trips)
// ── A blockquote keeps the blank-line spelling its file used (#199) ──
//
// turndown prefixes every line of a quote, blank ones included, with a marker
// **and a space**. So `> a`, `>`, `> b` came back with that middle line as
// `> ` — one byte per blank line, in every diff, for ever. Both spellings read
// the same, which is what made it a recorded R-C2 exception rather than a
// defect that loses anything.
//
// The two spellings are byte-identical by the time this HTML exists, so the
// file is asked while it is being read and the answer rides on the node — see
// `blockquote-spacing.ts`. This is the other end of that: when the quote says
// its file spelled blank lines bare, the single space is taken back off.
//
// **Delegating and narrowing, the shape this file already uses twice** — the
// heading rule hands the built-in rule different content, and
// `adjacentListsOfDifferentKinds` narrows what the built-in list rule
// returned. Nothing here re-implements a quote: indentation, nesting and the
// marker itself stay turndown's business.
//
// ── Why the narrowing cannot eat content, measured rather than argued ──
//
// A line of a quote that is exactly a marker run and **one** space is always a
// blank line. It cannot be content: a fenced block inside a quote holding a
// line of one space is written with **two** — measured on this build, a marker
// and two spaces for a single space of content, a marker and one space for a
// blank line, and a marker and four for a three-space line. So the pattern
// below, anchored at both ends and admitting exactly one trailing space,
// reaches blank lines and nothing a user typed.
//
// Nesting needs no arithmetic. An inner quote writes first and the outer one
// prefixes over it, and the result is still one marker run and one space —
// measured at two and three levels — so this runs once on the finished text
// rather than composing per level.
const BLANK_QUOTE_LINE_WITH_SPACE = /^((?:[ \t]*>)+) $/gm;

turndown.addRule('blockquoteKeepingItsBlankLineSpelling', {
  filter: 'blockquote',
  replacement: (content, node, options) => {
    const written = builtinBlockquote.replacement(content, node, options);
    const bare =
      (node as HTMLElement).getAttribute(BLOCKQUOTE_BLANK_MARKER_ATTRIBUTE) === BARE_BLANK_MARKER;
    return bare ? written.replace(BLANK_QUOTE_LINE_WITH_SPACE, '$1') : written;
  },
});

turndown.addRule('underline', {
  filter: ['u'],
  replacement: (content) => `<u>${content}</u>`,
});

// Strikethrough (#85). Turndown ships no rule for it, and its default for an
// element it does not recognise is to keep the text and drop the element — so
// `~~gone~~` was saved as `gone`, the only R-C2 exception that lost something
// the reader can see, and reachable from the floating toolbar's own S button.
// The filter covers both ends of the pipeline: `marked` (gfm) emits <del>,
// TipTap's Strike renders <s>, and <strike> is the legacy spelling its
// parseHTML also accepts. `~~` is GFM, the dialect the parser already runs.
// No overlap with the list, table or underline filters, so rule precedence
// (last one added wins) is not in play here.
turndown.addRule('strikethrough', {
  filter: ['s', 'del', 'strike'],
  replacement: (content) => `~~${content}~~`,
});

// Relativize image src via the registry at Turndown time.
// The node's src attribute is the exact string used to register the image,
// so the registry lookup is guaranteed to match (no intermediate normalization).
//
// ── The form the file used, and the size (#27) ──
//
// **The title was being dropped here too** (#230), and by this rule alone:
// `marked` writes it onto the `<img>`, DOMPurify keeps it and the image node
// carries it, and then this read `alt` and `src` and nothing else — so
// `![alt](img.png "the title")` was saved as `![alt](img.png)` and the text the
// user wrote left the file. Measured layer by layer before the repair.
//
// This rule used to write `![alt](src)` unconditionally, which is the second
// of the two places a width was being dropped: the schema carried no size and
// this would have discarded one anyway. It now asks `imageMarkup`, which
// answers with the markdown form for an image that has neither an HTML
// spelling nor a size — every image in every document nobody has resized — and
// with the file's own bytes for one the file spelled as HTML.
//
// **The relativized `src` is used for both forms**, and the first version of
// this change used it for the markdown form alone, on the reasoning that HTML
// bytes already carry the address the file wrote. That reasoning was wrong, and
// the way it was wrong is worth keeping: `prepareMarkdownForDisplay` in
// `src/app/image-loader.ts` rewrites every reference it can resolve **in the
// raw markdown, before the parser sees it**, so what the spelling carrier
// captures for a resolvable image is `<img src="blob:…">` — and a save wrote
// that blob address into the user's file, destroying the reference. Found by
// the owner's manual pass; the guards missed it because every one of them skips
// the display pass, and the repository's own documents reference only remote
// badges, which the loader leaves alone.
//
// So the address is mapped back for the HTML form exactly as it always has been
// for the markdown one. It costs nothing: `setTagAttribute` returns its input
// unchanged when the value already matches, so an image the loader never
// touched keeps its bytes to the character, quoting included. Held by
// `src/app/image-display-roundtrip.test.ts`, which runs the whole route.
// A comment, written back as the bytes the file used (#245).
//
// One rule for both shapes, because there is one carrier: a comment the file
// put on its own line is a paragraph holding it, and the paragraph rule
// supplies the blank lines around it. A `wbr` is void, so turndown neither
// judges it blank nor descends into it — it reaches this rule, and the
// whitespace beside it in a sentence survives.
//
// A value that does not decode writes nothing. It cannot come from this
// pipeline, since `parse.ts` encodes what it stamps, so what it answers for is
// a `data-comment` a user document wrote by hand — and these bytes go into the
// file verbatim.
// Raw HTML kept as bytes, and `sup`, `sub` and `kbd` (#563).
addKeptRawHtmlRules(turndown);

turndown.addRule('markdownComment', {
  filter: (node) =>
    node.nodeName === COMMENT_TAG.toUpperCase() &&
    (node as HTMLElement).hasAttribute(MARKDOWN_COMMENT_ATTRIBUTE),
  replacement: (_content, node) =>
    decodeComment((node as HTMLElement).getAttribute(MARKDOWN_COMMENT_ATTRIBUTE)) ?? '',
});

/**
 * A footnote definition, written back as the lines the file wrote (#408).
 *
 * **The rule reads its neighbours, and that is where the single newline comes
 * from.** Two consecutive definitions are two blocks, and turndown puts a
 * blank line between two blocks — measured, and it is what took the two
 * candidates that carry the construct rather than its lines down to 10 of 14
 * acceptance rows. So a definition standing next to another leads with one
 * newline and ends with none, and one standing next to anything else keeps
 * the blank lines a block is owed.
 *
 * Deciding from a sibling is an established shape in this file rather than a
 * new one: the list-item rule reads `nextSibling` for loose and tight spacing
 * (#28, #199), and the list rule reads both siblings to keep two adjacent
 * lists of different kinds apart.
 *
 * A `<br>` inside the element is a continuation line, and the indentation the
 * file used for it comes off the element — it cannot be read from the text,
 * because leading whitespace in inline content does not reach here.
 */
function isFootnoteDefinition(node: Node | null): boolean {
  return (
    node !== null &&
    node.nodeName === 'DIV' &&
    (node as HTMLElement).hasAttribute(FOOTNOTE_DEFINITION_ATTRIBUTE)
  );
}

turndown.addRule('footnoteDefinition', {
  filter: (node) => isFootnoteDefinition(node),
  replacement: (_content, node) => {
    const element = node as HTMLElement;
    const indents = decodeIndents(element.getAttribute(FOOTNOTE_INDENTS_ATTRIBUTE));
    // The element's own lines, split at the hard breaks it carries. Bounded by
    // the child list, which a parse of one definition builds.
    const lines: string[] = [];
    let current = '';
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeName === 'BR') {
        lines.push(current);
        current = '';
        continue;
      }
      current += child.textContent ?? '';
    }
    lines.push(current);
    const text = joinDefinition({ lines, indents });
    // Two definitions are a single newline apart unless the one above spelled
    // a blank line there (#418). The gap belongs to the pair, and it is read
    // off the sibling that carries it rather than off this one.
    const above = element.previousElementSibling;
    const lead =
      above !== null &&
      isFootnoteDefinition(above) &&
      !above.hasAttribute(FOOTNOTE_BLANK_LINE_ATTRIBUTE)
        ? '\n'
        : '\n\n';
    const tail = isFootnoteDefinition(element.nextElementSibling) ? '' : '\n\n';
    return `${lead}${text}${tail}`;
  },
});

turndown.addRule('agentedImage', {
  filter: 'img',
  replacement: (_content, node) => {
    const img = node as HTMLImageElement;
    const src = img.getAttribute('src') || '';
    const alt = img.getAttribute('alt') || '';
    const rel = getRelativePath(src);

    // Defensive: if src looks like our asset/blob URL but isn't in the registry,
    // log it — that would mean the registry has a bug, don't hide it.
    if (!rel && /^(http:\/\/asset\.localhost|blob:)/.test(src)) {
      console.warn('[agented] image src looks like asset URL but not in registry:', src);
    }

    return imageMarkup(
      decodeHtmlSource(img.getAttribute(IMAGE_HTML_SOURCE_ATTRIBUTE)),
      alt,
      rel || src,
      // `getAttribute` answers `null` for an image with no title, which is the
      // same answer the node carries, so absent and empty stay distinct all the
      // way to the writer. An empty title is not a shape markdown can hold —
      // `![a](i.png "")` parses to no title at all, measured — so nothing
      // downstream has to tell them apart.
      img.getAttribute('title'),
      {
        width: pixelValue(img.getAttribute('width')),
        height: pixelValue(img.getAttribute('height')),
      },
    );
  },
});

// ── Table serialization (HTML table → GFM markdown table) ──

// ── A table inside a table cell (#278) ──
//
// The editor can hold one — `tableCell` takes `block+`, and a table is a block
// — and GFM cannot spell one: a cell is a single line of inline content. Until
// #278 the serializer did not know it was looking at one. `collectRows` walked
// the outer table with `querySelectorAll`, which reaches into the nested table,
// so the inner rows were written as rows of the outer table and the inner cells
// as extra columns: measured, a two-by-two table holding a three-by-three one
// was saved as eleven columns and five rows, with the inner table's text also
// flattened into its cell.
//
// **So a table inside a cell is written as inline HTML**: `<table>`, its rows
// and its cells, and nothing else, on the cell's one line. CommonMark admits
// inline HTML and GitHub draws it, `marked` reads it back as the nested table it
// was, and it is the precedent #27 set for an image size, which markdown cannot
// spell either. Rows and cells are always the table's **own**, at every level.
//
// `cellDepth` is how many cells deep the writer is: zero while writing the
// document, one inside a cell of a top-level table. It is what tells the `table`
// rule which spelling a table gets, because `cellContent` hands turndown the
// cell as a string and the nested table arrives with no parent to ask.

/** How many table cells deep the serializer is — 0 for the document itself. */
let cellDepth = 0;

/**
 * The deepest a table is written as a table inside a cell. Past it, a table's
 * cells are written as their text, so the recursion through `cellContent` is
 * bounded whatever a file holds.
 */
const MAX_CELL_DEPTH = 16;

const nameOf = (element: Element): string => element.nodeName.toUpperCase();

/** The table's own rows in order — never the rows of a table in one of its cells. */
function ownRows(table: HTMLTableElement): HTMLElement[] {
  const rows: HTMLElement[] = [];
  for (const child of Array.from(table.children)) {
    const name = nameOf(child);
    if (name === 'TR') {
      rows.push(child as HTMLElement);
    } else if (name === 'THEAD' || name === 'TBODY' || name === 'TFOOT') {
      for (const row of Array.from(child.children)) {
        if (nameOf(row) === 'TR') rows.push(row as HTMLElement);
      }
    }
  }
  return rows;
}

/** The row's own cells in order. */
function ownCells(row: HTMLElement): HTMLElement[] {
  return Array.from(row.children).filter((cell): cell is HTMLElement => {
    const name = nameOf(cell);
    return name === 'TH' || name === 'TD';
  });
}

// ── A horizontal rule inside a table cell (#282) ──
//
// A cell takes any block and a rule is a block, so the editor holds one; GFM
// gives a cell one line of inline content, so it cannot spell one. Written as
// the three characters the service is configured with, the rule was flattened
// into the cell as `---` and read back as text — measured on `21ae688`, the
// construct was gone after one save and the file took a second save to settle,
// a cell holding only a rule being written `| --- |` and then escaped to
// `| \--- |`.
//
// `<hr>` is what a cell can carry: DOMPurify keeps the element and `marked`
// reads it back as a rule, measured for `<hr>`, `<hr />` and `<hr/>` alike. It
// is the same answer #278 gave a table one construct over, and it fires at any
// cell depth, so a rule inside a table nested in a cell is written the same way.
//
// Outside a cell nothing changes, and that is delegated rather than restated
// (#283): turndown's own rule writes the rule there, read from its resolved
// defaults the way the heading rule reads `heading`, and guarded for the same
// stated reason. Until #283 this branch spelled out what that rule returns;
// measured on `2bf4f1a` the two were byte-identical, and nothing checked it.
const builtinHorizontalRule = turndown.options.rules.horizontalRule;
if (!builtinHorizontalRule) {
  throw new Error(
    'turndown no longer exposes options.rules.horizontalRule, so a rule outside a table cell ' +
      'cannot delegate to the built-in one (#282). See src/editor/markdown/serialize.ts.',
  );
}

turndown.addRule('horizontalRuleInACell', {
  filter: 'hr',
  replacement: (content, node, options) =>
    cellDepth > 0 ? '<hr>' : builtinHorizontalRule.replacement(content, node, options),
});

// ── A hard break inside a table cell (#300) ──
//
// turndown writes a hard break as two spaces and a newline, and `cellContent`
// flattens that newline to a space: Shift+Enter in a cell was written
// `one   two` and read back as one line, the break gone on the next open.
// `<br>` is what a cell line carries, measured on the step zero of #300 to come
// back as the break, and GitHub and Obsidian both draw it as one. Outside a
// cell the built-in rule writes the break, delegated for the reason the rule
// above gives.
const builtinLineBreak = turndown.options.rules.lineBreak;
if (!builtinLineBreak) {
  throw new Error(
    'turndown no longer exposes options.rules.lineBreak, so a break outside a table cell ' +
      'cannot delegate to the built-in one (#300). See src/editor/markdown/serialize.ts.',
  );
}

turndown.addRule('hardBreakInACell', {
  filter: 'br',
  replacement: (content, node, options) =>
    cellDepth > 0 ? '<br>' : builtinLineBreak.replacement(content, node, options),
});

/** A table inside a cell, as one line of inline HTML. */
function inlineTable(table: HTMLTableElement): string {
  const rows = ownRows(table).map((row) => {
    const cells = ownCells(row).map((cell) => {
      const tag = nameOf(cell) === 'TH' ? 'th' : 'td';
      const content =
        cellDepth < MAX_CELL_DEPTH
          ? cellContent(cell)
          : (cell.textContent ?? '').replace(/\s+/g, ' ').trim();
      return `<${tag}>${content}</${tag}>`;
    });
    return `<tr>${cells.join('')}</tr>`;
  });
  return `<table>${rows.join('')}</table>`;
}

/**
 * The space around an element written inline in a cell — and the answer is not
 * the same for the two of them, measured rather than chosen (#278, #282).
 *
 * turndown separates two blocks with a blank line, which becomes two spaces
 * once a cell is flattened. A **table** keeps one space on each side: it is
 * written with an opening and a closing tag, and the text beside it is read
 * back as it was. A **rule** keeps none, because `<hr>` is a void element and a
 * space after it stays in the text of the block that follows — `| x <hr> y |`
 * reads back with the paragraph ` y`, while `| x<hr>y |` reads back with `y`.
 */
function spaceAroundInlineHtml(text: string): string {
  return text
    .replace(/\s+<table>/g, ' <table>')
    .replace(/<\/table>\s+/g, '</table> ')
    .replace(/\s*<hr>\s*/g, '<hr>');
}

/**
 * Serialize a table cell's HTML to markdown.
 *
 * ⚠ Calls `turndown.turndown()` recursively from within a turndown rule.
 * This works only because the `tableSection` rule (see below) neutralizes
 * tr/th/td/thead/tbody/tfoot so they don't get serialized independently
 * by the recursive call. If you reorder rules or upgrade turndown, verify
 * tableSection still wins the rule match for table sub-elements.
 *
 * Newlines are flattened to spaces (MD tables are single-line) and
 * pipes are escaped to avoid breaking the column structure.
 *
 * **A block the cell holds is written as its HTML element** (#300), through
 * `cell-blocks.ts`, because a cell line carries inline content and nothing
 * else: flattened as markdown, a heading, a list or a fence was read back as its
 * own text and gone on the next open. A cell of paragraphs, rules and tables in
 * the shapes this function already wrote stays on the path below unchanged.
 *
 * On either path, text at the start of the cell line cannot open a list when the
 * table is read back, so a leading `N.` is written without turndown's backslash
 * (#97). The recursive call serializes the cell as a paragraph, which is where
 * that escape comes from.
 */
function cellContent(cell: HTMLElement): string {
  cellDepth += 1;
  try {
    const inner = needsCellBlockSpelling(cell)
      ? cellBlocks(cell, { inline: cellInline, table: inlineTable })
      : turndown.turndown(cell.innerHTML);
    const flattened = spaceAroundInlineHtml(inner.replace(/\n/g, ' ')).trim();
    // Pipes are escaped once, by the outermost cell. A table inside the cell is
    // written with its own cells unescaped and this pass reaches them inside
    // the HTML; escaping at every level would write `\\|` there (#278).
    const escaped = cellDepth === 1 ? flattened.replace(/\|/g, '\\|') : flattened;
    return withoutLeadingListEscape(escaped);
  } finally {
    cellDepth -= 1;
  }
}

/** The inline content of one block inside a cell, as markdown on one line. */
function cellInline(block: Element): string {
  return turndown.turndown(block.innerHTML).replace(/\n/g, ' ').trim();
}

// ── Writing a table the way the file wrote it (#93) ──
//
// AgentEd used to pad every cell of every table out to a uniform width,
// whatever the file had: 628 of the 630 bytes by which an untouched save grew
// `README.md`, and the 488 bytes it added to `WORKFLOW.md`, as REQUIREMENTS
// records for #93, since moved out of this repository (#474) — the
// largest single term in "an untouched save rewrites the user's file" (R-C2).
// Minimal cells everywhere would have removed those bytes and moved the same
// exception onto every file whose author aligned a table by hand, so what is
// written now is what the file used: `table-style.ts` reads each table's
// spelling from the raw markdown on the way in, and the rules below apply it
// on the way out.
//
// **A carried width is a floor, not a size.** A cell the user edits past its
// column's width widens the column rather than breaking the alignment, and a
// column the user adds gets the width its content needs, in the table's own
// spelling. Preserving the source text verbatim would have no answer for
// either.

/** The cell text as it will be written, between the two pipes. */
function renderCell(
  content: string,
  column: ColumnStyle | undefined,
  width: number,
  emptyCell: string | null,
): string {
  // Hugging an empty cell gives `|  |` on its own; a file that wrote `| |`
  // gets `| |` back. A padded column pads its empty cells like any other.
  if (content.length === 0 && column?.kind !== 'fixed' && emptyCell === ' ') return ' ';
  const padded = column?.kind === 'fixed' ? content.padEnd(width) : content;
  return ` ${padded} `;
}

/**
 * The separator cell for one column.
 *
 * It is written back verbatim while the column above it is unchanged — which
 * is every table nobody edited, and the only way to keep a spelling this
 * varied: `| --- |`, `|---|`, `|:----|`, dashes filled to the width. It is
 * re-spelled only when the column's width has moved, and then in its own
 * spelling: the spaces it had, the alignment colons it had, and dashes that
 * follow the width only if they did before.
 */
function renderSeparator(column: ColumnStyle | undefined, headerWidth: number): string {
  const sample = column?.separator ?? ' --- ';
  // The comparison is against the *header* cell, because that is what a
  // separator is written to line up with — in a hugging column the rows below
  // are all different widths and none of them decides anything.
  if (column !== undefined && headerWidth === column.width) return sample;

  const spaced = sample.startsWith(' ') && sample.endsWith(' ');
  const core = sample.trim();
  const left = core.startsWith(':') ? ':' : '';
  const right = core.endsWith(':') ? ':' : '';
  const followedWidth = column !== undefined && sample.length === column.width;
  const marks = left.length + right.length;
  const dashes = followedWidth
    ? Math.max(3, headerWidth - (spaced ? 2 : 0) - marks)
    : Math.max(3, core.length - marks);
  const core2 = `${left}${'-'.repeat(dashes)}${right}`;
  return spaced ? ` ${core2} ` : core2;
}

function collectRows(table: HTMLTableElement): string[][] {
  return ownRows(table).map((row) => ownCells(row).map((cell) => cellContent(cell)));
}

/**
 * The width of each column: what the file used, never less than what the
 * content needs today. A column the style says nothing about — one the user
 * added — gets its content's width, which for a hugging column costs nothing.
 */
function columnWidths(rows: string[][], colCount: number, style: TableStyle): number[] {
  const widths: number[] = [];
  for (let c = 0; c < colCount; c++) {
    let max = 0;
    for (const row of rows) max = Math.max(max, (row[c] || '').length);
    const column = style.columns[c];
    widths.push(column?.kind === 'fixed' ? Math.max(column.width - 2, max) : max);
  }
  return widths;
}

function renderRow(row: string[], widths: number[], colCount: number, style: TableStyle): string[] {
  const cells: string[] = [];
  for (let c = 0; c < colCount; c++) {
    cells.push(renderCell(row[c] || '', style.columns[c], widths[c], style.emptyCell));
  }
  return cells;
}

const joinRow = (cells: string[]): string => `|${cells.join('|')}|`;

function formatMarkdownTable(rows: string[][], widths: number[], style: TableStyle): string {
  const colCount = widths.length;
  const header = renderRow(rows[0], widths, colCount, style);
  const lines: string[] = [joinRow(header)];

  // The separator, in the spelling the file used, measured against the header
  // cell it sits under.
  lines.push(joinRow(header.map((cell, c) => renderSeparator(style.columns[c], cell.length))));

  for (let r = 1; r < rows.length; r++) {
    lines.push(joinRow(renderRow(rows[r], widths, colCount, style)));
  }

  return `\n\n${lines.join('\n')}\n\n`;
}

/**
 * The spelling this table is written in: its own, or — for a table the user
 * created, which has none — the spelling of the first table in the document
 * that has one, so a document does not end up spelled two ways. With no table
 * to inherit from, `DEFAULT_TABLE_STYLE`.
 */
function styleFor(table: HTMLTableElement): TableStyle {
  const own = decodeTableStyle(table.getAttribute(TABLE_STYLE_ATTRIBUTE));
  if (own) return own;
  const sibling = table.ownerDocument?.querySelector(`table[${TABLE_STYLE_ATTRIBUTE}]`);
  return (
    decodeTableStyle(sibling?.getAttribute(TABLE_STYLE_ATTRIBUTE) ?? null) ?? DEFAULT_TABLE_STYLE
  );
}

// ── A table the file wrote as raw HTML (#283) ──
//
// Written back as the bytes the file used, when the editor marked it as
// unedited at save — see `kept-html-table.ts` for how that is decided and
// `table-html-source.ts` for the owner decision. Everything else, including the
// same table once it is edited, falls through to GFM below.
//
// **Only when the caller is the save path**, which asks for it through
// `htmlToMarkdown`. The other caller is paste, which runs rich HTML from any
// page through this serializer, and a page can carry the attribute. Measured
// with the attribute honoured there: a pasted table holding `p`, carrying a
// source holding `other`, arrived as `other`. So paste never reads it, and a
// pasted table is written as GFM, as the owner decision says.

/** Whether the running conversion writes kept tables. Set only by `htmlToMarkdown`. */
let writingKeptTables = false;

/** A display address the image loader puts in place of an image it resolved. */
const DISPLAY_ADDRESS = /blob:[^\s"'<>()]+/g;

/**
 * Kept bytes with each display address written back as the image path the
 * file used (#468). Every kept source is read from the markdown after the
 * display pass has put a `blob:` address in place of each image it resolved,
 * the same thing the image spelling met at #27, so its bytes hold that address
 * and an untouched save wrote it into the file: measured on #468 for a raw
 * table, a block of the tag filter and a wrapper alike. The registry answers
 * with the address as the file wrote it; one it does not know stays as it is.
 */
function withFileAddresses(bytes: string): string {
  return bytes.replace(DISPLAY_ADDRESS, (address) => getRelativePath(address) ?? address);
}

/** The bytes to write for a table, or `null` when it is written as GFM. */
function keptHtmlSource(table: HTMLTableElement): string | null {
  if (!writingKeptTables) return null;
  const source = decodeTableSource(table.getAttribute(TABLE_HTML_SOURCE_ATTRIBUTE));
  return source === null ? null : withFileAddresses(source);
}

// ── A raw HTML block of the GFM tag filter (#461) ──
//
// Written back as the bytes the file used, when the editor marked it unedited
// at save, under the same switch as a kept table: only the save path writes
// them, so a pasted paragraph that spells the attribute is written as its text.
// Everything else, the same block once it is edited included, falls through to
// the paragraph rules as the text the editor shows.

/** The bytes to write for a paragraph, or `null` when it is written as text. */
function keptHtmlBlockSource(node: Node): string | null {
  if (!writingKeptTables || !/^(?:P|H[1-6])$/.test(node.nodeName)) return null;
  const source = decodeKeptBlockSource(
    (node as HTMLElement).getAttribute(HTML_BLOCK_SOURCE_ATTRIBUTE),
  );
  return source === null ? null : withFileAddresses(source);
}

turndown.addRule('keptHtmlBlock', {
  filter: (node) => keptHtmlBlockSource(node) !== null,
  replacement: (_content, node) => `\n\n${keptHtmlBlockSource(node)}\n\n`,
});

turndown.addRule('table', {
  filter: 'table',
  replacement: (_content, node) => {
    const table = node as HTMLTableElement;
    // turndown processes a table's content before calling its rule, and the
    // `tableSection` rule then throws that content away. A table inside a cell
    // of the pass that is running is therefore thrown away too — its cell
    // writes it, through `cellContent` — so writing it here would be wasted,
    // and done at every level it doubled the work per level: measured, a file
    // nesting eighteen tables ran the heap out of memory on save (#278).
    if (table.parentElement?.closest('td, th')) return '';
    if (cellDepth > 0) return inlineTable(table);
    const kept = keptHtmlSource(table);
    if (kept !== null) return `\n\n${kept}\n\n`;
    const rows = collectRows(table);
    if (rows.length === 0) return '';
    const colCount = Math.max(...rows.map((r) => r.length));
    const style = styleFor(table);
    return formatMarkdownTable(rows, columnWidths(rows, colCount, style), style);
  },
});

// Neutralize table sub-elements so they don't get serialized independently.
// Critical for the recursive turndown() call in cellContent (see above).
turndown.addRule('tableSection', {
  filter: ['thead', 'tbody', 'tfoot', 'tr', 'th', 'td'],
  replacement: () => '',
});

// ── The space GFM requires after an empty task marker (#160) ──
//
// A document that **ends** with an empty task item lost the space after its
// marker, and `- [ ]` without it is not a task item at all: GFM reads the
// marker only when whitespace follows, so the next save wrote `- \[ \]` —
// literal brackets in a plain bullet, the checkbox gone from the user's file.
// It is the state the editor itself makes: press Enter at the end of a task
// list and stop typing.
//
// **The cause is not in this repository and is not narrowed here.** turndown's
// `postProcess` ends with `output.replace(/^[\t\r\n]+/, '').replace(/[\t\r\n\s]+$/, '')`
// — the trailing class carries `\s` where the leading one does not — and it
// runs **once, over the whole document**. That is exactly why only the final
// position is affected: measured in six positions, an empty item first, in the
// middle, or followed by a paragraph is byte-identical today and always was.
// Loosening that trim would reach the end of every document AgentEd saves,
// where a recorded R-C2 exception already decides what happens to a run of
// blank lines and #79 decides how a file ends. So the space is put back after
// the trim rather than withheld from it.
//
// **The test is on the output because that is where the context is.** An
// unescaped `- [ ]` at the very end of the document can only have been written
// by the task-item rule: an item with content has that content after the
// marker, and literal brackets in text are escaped by turndown wherever they
// appear — measured, `x [ ] y` is written `x \[ \] y`. A fenced block cannot
// impersonate one either, because its closing fence is written after it. So
// the pattern cannot match a line the user typed, and a document that does not
// end in an empty task item is byte-identical before and after this change, by
// construction rather than by hope — measured on the twelve documents the
// guard already reads, digest for digest.
//
// The `[>\s]*` reaches the same item inside a blockquote or an indented list,
// where the marker is written with a prefix. **It does not reach every empty
// item at the end of a document**, and the ones it misses are not this
// defect: `- a`⏎`  - [ ] ` loses its marker in *one* save rather than two,
// because `marked` never read the nested item as a task item at all. That is a
// parse-level shape, measured identical before and after this change, and it
// belongs to whoever picks up member 3a.
const EMPTY_TASK_ITEM_AT_THE_END = /(?:^|\n)[>\s]*- \[[ x]\]$/;

export interface SerializeOptions {
  /**
   * Write a table marked as an unedited raw HTML table as its own bytes
   * (#283). On for the save path, which is the only one that marks them; off
   * for everything else, and paste in particular. See `keptHtmlSource`.
   */
  readonly keepHtmlTables?: boolean;
}

export function htmlToMarkdown(html: string, options: SerializeOptions = {}): string {
  // Restored rather than cleared when this call ends, so a call made while
  // another is writing does not switch the kept tables off under it (#288).
  const outerWritingKeptTables = writingKeptTables;
  writingKeptTables = options.keepHtmlTables ?? false;
  // ── The one question that has to be asked of the whole document (#425) ──
  //
  // The escape marks a reference that begins its text node and is followed by
  // a colon, because from there it cannot tell a line start from a text node
  // that merely starts after bold (#409); this function is where the
  // assembled line is readable, so it is where the mark is answered, and no
  // mark survives this call.
  //
  // **A document that carries the mark character itself is written without
  // any of that.** The sweep that ends `resolveDefinitionPositions` reaches
  // the assembled markdown, which includes the places the escape never runs -
  // a fenced block, a code span, kept HTML - so a U+E012 the person typed was
  // deleted there. Asked here rather than in the escape because it is a
  // property of the document and the escape is handed one text node.
  //
  // `html` is what the document is about to be written from, so it carries
  // every character the model holds; a mark cannot yet exist in it, since the
  // only thing that writes one is the escape, below this line.
  const carriesTheMark = html.includes(DEFINITION_POSITION);
  setDocumentCarriesTheMark(carriesTheMark);
  try {
    const written = turndown.turndown(html);
    const markdown = carriesTheMark ? written : resolveDefinitionPositions(written);
    return EMPTY_TASK_ITEM_AT_THE_END.test(markdown) ? `${markdown} ` : markdown;
  } finally {
    setDocumentCarriesTheMark(false);
    writingKeptTables = outerWritingKeptTables;
  }
}
