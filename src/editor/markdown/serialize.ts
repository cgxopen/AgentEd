import TurndownService, { type Options } from 'turndown';
import { getRelativePath } from '../image-registry';
import { BARE_BLANK_MARKER, BLOCKQUOTE_BLANK_MARKER_ATTRIBUTE } from './blockquote-spacing';
import { type ContainerReplacements, createBlankReplacement } from './empty-fence';
import { createNarrowedEscape } from './escape';
import { LIST_SPACING_ATTRIBUTE } from './list-spacing';
import {
  type ColumnStyle,
  DEFAULT_TABLE_STYLE,
  decodeTableStyle,
  TABLE_STYLE_ATTRIBUTE,
  type TableStyle,
} from './table-style';

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
  const body = taskItemBlocks(taskItemContent(li))
    .map((block) => trimBlock(turndown.turndown(block.outerHTML)))
    .filter((block) => block.length > 0)
    .join('\n');
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
  if (parent?.nodeName !== 'OL') return `${bulletMarker} `;
  const declared = Number.parseInt(parent.getAttribute('start') || '1', 10);
  const start = Number.isFinite(declared) ? declared : 1;
  const index = Array.prototype.indexOf.call(parent.children, li);
  return `${start + index}. `;
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

    return `![${alt}](${rel || src})`;
  },
});

// ── Table serialization (HTML table → GFM markdown table) ──

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
 * A cell's own content is inline by the time it is written — GFM gives a cell
 * nothing else, and the newlines are flattened here anyway — so a leading
 * `N.` cannot open a list when the table is read back, and it is written
 * without turndown's backslash (#97). The recursive call above serializes the
 * cell as a paragraph, which is where that escape comes from.
 */
function cellContent(cell: HTMLElement): string {
  const inner = turndown.turndown(cell.innerHTML);
  const flattened = inner.replace(/\n/g, ' ').replace(/\|/g, '\\|').trim();
  return withoutLeadingListEscape(flattened);
}

// ── Writing a table the way the file wrote it (#93) ──
//
// AgentEd used to pad every cell of every table out to a uniform width,
// whatever the file had: 628 of the 630 bytes by which an untouched save grew
// `README.md`, and 488 of the 487 by which it grew `WORKFLOW.md` — the
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
  const rows: string[][] = [];
  table.querySelectorAll('tr').forEach((tr) => {
    const cells: string[] = [];
    tr.querySelectorAll('th, td').forEach((cell) => {
      cells.push(cellContent(cell as HTMLElement));
    });
    rows.push(cells);
  });
  return rows;
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

turndown.addRule('table', {
  filter: 'table',
  replacement: (_content, node) => {
    const table = node as HTMLTableElement;
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

export function htmlToMarkdown(html: string): string {
  const markdown = turndown.turndown(html);
  return EMPTY_TASK_ITEM_AT_THE_END.test(markdown) ? `${markdown} ` : markdown;
}
