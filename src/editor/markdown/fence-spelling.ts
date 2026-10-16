import { marked, type Token } from 'marked';
import type TurndownService from 'turndown';
import type { Rule } from 'turndown';

/**
 * How the file opened a fenced block, where it is not the spelling written
 * unasked (#573, owner decision C of 2026-10-16 on the step zero).
 *
 * `serialize.ts` writes every fenced block with three backticks and the info
 * string straight after them, through turndown's own `fencedCodeBlock`, so a
 * fence of four backticks, a fence of tildes and ```` ``` js ```` came back
 * as ```` ```js ````: the same rendering, other bytes. Measured on the step
 * zero of #573, on the frozen corpus of 8361 files: 25 files held a longer
 * run and 57 a gap before the info string; no file held a tilde fence, and
 * the CommonMark suite does.
 *
 * ── Read from the token, carried on the node ──
 *
 * `marked` hands each `code` token its `raw`, whose first line is the opening
 * run and what follows it; the code block node holds its language and its
 * text, so the opening travels as one attribute, the route
 * `heading-spelling.ts` gives the underline of a heading: the run, backticks
 * or tildes and their length, and the spaces or tabs between it and the info
 * string. The closing fence is written with the same run. Nothing is written
 * for three backticks with no gap, the spelling written unasked.
 *
 * **Only a file.** The attribute is stamped only where the parse keeps raw
 * HTML, which is a file and never a paste; a fence the editor makes carries
 * none and is written as before, and so does the second half of a block
 * split in two, below.
 *
 * ── What is not carried ──
 *
 * An indented fence keeps the spelling it had before, written at the margin
 * of its container, and so does a closing fence longer than the opening one,
 * which is written as long as the opening one. An empty fenced block is written by the blank
 * rule of `empty-fence.ts`, which this does not reach, as three backticks.
 *
 * ── Checked at save ──
 *
 * The content can hold a line that closes the run: a fence of tildes written
 * around content holding `~~~`, or one of four backticks around ```` ```` ````.
 * A run written shorter than one in the content opens a block that closes too
 * early. So the spelling is written only where `marked` reads it back as the
 * same code block, with the same language and the same text, as the spelling
 * turndown chose, and that spelling is written otherwise.
 */

/** Set on a fenced block the file opened otherwise: the opening run and its gap, encoded. */
export const FENCE_OPENER_ATTRIBUTE = 'data-fence-opener';

/** The opening of a fence: up to three spaces, a run of three or more, and the gap after it. */
const OPENING = /^ {0,3}(`{3,}|~{3,})([ \t]*)/;
/** An opener the attribute can hold: a run, then spaces or tabs. */
const OPENER = /^(?:`{3,}|~{3,})[ \t]*$/;

/** The attribute for the `pre` of a `code` token, or nothing. */
export function fenceOpenerAttribute(
  raw: string,
  lang: string | undefined,
  fromAFile: boolean,
): string {
  if (!fromAFile) return '';
  const match = OPENING.exec(raw);
  if (!match) return '';
  const run = match[1] ?? '';
  // The gap belongs to the info string; with none, the spaces are not spelling.
  const gap = lang !== undefined && lang !== '' ? (match[2] ?? '') : '';
  const opener = `${run}${gap}`;
  // Encoded, since the sanitizer trims an attribute value and the gap can end it.
  return opener === '```' ? '' : ` ${FENCE_OPENER_ATTRIBUTE}="${encodeURIComponent(opener)}"`;
}

/** The opener an attribute value encodes, or null where it encodes none. */
function openerOf(value: string | null): string | null {
  if (value === null) return null;
  try {
    const decoded = decodeURIComponent(value);
    return OPENER.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/**
 * The node attribute at the value a block the editor makes holds. Enter in a
 * block writes a newline, but the `splitBlock` command and blocks inserted in
 * the middle of one split it with `tr.split`, which copies every attribute;
 * the plugin #594 gave the adjacency flag, in `adjacent-blocks.ts`, reads this
 * and clears the opener off the second half.
 */
export const FENCE_SPELLING_UNSET: Readonly<Record<string, null>> = { fenceOpener: null };

/** The node attribute, read from the element and rendered back onto it. */
export function fenceOpenerNodeAttribute() {
  return {
    fenceOpener: {
      default: null as string | null,
      keepOnSplit: false,
      parseHTML: (element: HTMLElement) => openerOf(element.getAttribute(FENCE_OPENER_ATTRIBUTE)),
      renderHTML: (attributes: Record<string, unknown>) =>
        typeof attributes.fenceOpener === 'string'
          ? { [FENCE_OPENER_ATTRIBUTE]: encodeURIComponent(attributes.fenceOpener) }
          : {},
    },
  };
}

/** The one code block `markdown` reads as, by language and text, or null. */
function onlyCodeBlock(markdown: string): { lang: string; text: string } | null {
  const blocks = marked.lexer(markdown).filter((token: Token) => token.type !== 'space');
  const code = blocks[0] as { type?: string; lang?: string; text?: string } | undefined;
  if (blocks.length !== 1 || code?.type !== 'code') return null;
  return { lang: code.lang ?? '', text: code.text ?? '' };
}

/** What turndown wrote: the newlines around it, the fence, the info string and the code. */
const WRITTEN = /^(\n*)(`{3,})([^\n]*)\n([\s\S]*)\n\2(\n*)$/;

/**
 * The fenced block as the file opened it, or `written`, the spelling turndown
 * chose, where the block carries no opener or the opener would read as
 * another block.
 */
export function withFenceSpelling(node: HTMLElement, written: string): string {
  const opener = openerOf(node.getAttribute(FENCE_OPENER_ATTRIBUTE));
  const match = WRITTEN.exec(written);
  if (opener === null || !match) return written;
  const [, before = '', , info = '', code = '', after = ''] = match;
  const run = /^(`+|~+)/.exec(opener)?.[0] ?? '';
  const gap = info === '' ? '' : opener.slice(run.length);
  const spelled = `${run}${gap}${info}\n${code}\n${run}`;
  const chosen = onlyCodeBlock(written.trim());
  const read = onlyCodeBlock(spelled);
  if (chosen === null || read === null || read.lang !== chosen.lang || read.text !== chosen.text) {
    return written;
  }
  return `${before}${spelled}${after}`;
}

/** Registered by `serialize.ts`, which is over the module size guideline. */
export function addFenceSpellingRule(turndown: TurndownService): void {
  // turndown's own rule for a fence, which `src/types/turndown.d.ts` does not
  // declare among the built-in rules it names; read the same way, and guarded.
  const builtin = (turndown.options.rules as { readonly fencedCodeBlock?: Rule }).fencedCodeBlock;
  if (!builtin) {
    throw new Error(
      'turndown no longer exposes options.rules.fencedCodeBlock, so a fence cannot keep its ' +
        'opening run (#573). See src/editor/markdown/fence-spelling.ts.',
    );
  }
  turndown.addRule('fenceKeepingItsOpener', {
    filter: (node, options) =>
      typeof builtin.filter === 'function' &&
      builtin.filter(node, options) &&
      (node as HTMLElement).hasAttribute(FENCE_OPENER_ATTRIBUTE),
    replacement: (content, node, options) =>
      withFenceSpelling(node as HTMLElement, builtin.replacement(content, node, options)),
  });
}
