/**
 * Pull a short, single-line preview from a context file.
 *
 * **The first line that carries text** — and when that line is a heading,
 * the heading's own text, without the marks (#138). A file opening with
 * prose previews that prose.
 *
 * This used to skip headings and show the first line of body text, on the
 * reasoning that the filename is already on the line above and a heading
 * is often the filename restated. R-A2 says `preview first line`, so the
 * build and the requirement disagreed and a test held the disagreement in
 * place. Owner decision, 2026-08-27: the heading wins. `# Backend agent
 * instructions` above `AGENTS.md` says more than the filename does, while
 * the first body line is frequently boilerplate.
 *
 * The rule that replaced it is shorter by a clause. Skipping headings
 * could leave a heading-only file with nothing to show, so there was a
 * third step that went back for the first heading; under this rule that
 * file's first heading *is* the first line carrying text, and the special
 * case has no work left to do.
 *
 * Steps:
 *
 *  1. Strip a leading YAML frontmatter block if present (`---` fenced)
 *  2. Walk the remainder line by line and return the first line that
 *     carries text, reading a heading as the text inside it
 *  3. Truncate to `maxChars`
 *  4. Sentinel `(empty)` if no line carries any
 *
 * Designed for content read lazily from disk (popover open). The full
 * file isn't loaded — callers pass the first ~1KB.
 *
 * Contract: `content` is processed up to {@link MAX_INPUT_BYTES} chars;
 * larger inputs are clipped on entry so the function stays bounded if a
 * caller forgets to pre-trim. `null`/`undefined`/non-string inputs
 * resolve to the `(empty)` sentinel rather than throwing.
 */
const FRONTMATTER_FENCE = '---';

/** Hard cap on input size processed by {@link extractSnippet}. */
const MAX_INPUT_BYTES = 16 * 1024;

/**
 * An ATX heading, as CommonMark defines one: up to three spaces of
 * indent, one to six `#`, then whitespace or the end of the line.
 *
 * **Naming the shape is the point.** The old rule called any line
 * starting with `#` a heading, which was good enough while it only had
 * to decide what to *skip*. Showing the text inside a heading means
 * taking the marks off one, so the question of what counts becomes
 * visible and is answered here rather than by a `startsWith`.
 *
 * What this deliberately excludes, each of which then falls through and
 * is shown as the text it is:
 *
 *  - **`#hashtag`** — no space after the hashes, so CommonMark reads a
 *    paragraph. It previews as `#hashtag`.
 *  - **Seven or more hashes** — past the six heading levels, so also a
 *    paragraph.
 *  - **Four or more spaces of indent** — an indented code block, whose
 *    content happens to start with a hash.
 *
 * Two more shapes need no clause here. A **setext** heading (`Title` over
 * `=====`) has its text on the first line already, so the general rule
 * returns it untouched. And **inline formatting inside a heading** is
 * left exactly as written — a preview shows what the file says, and body
 * lines have always shown their own marks, so stripping them here would
 * make the two disagree. Neither is worth a markdown parser for one line
 * of preview.
 *
 * Measured over 56 context files on the author's machine and every
 * markdown file in this repository: 54 open with an ATX heading, 2 with
 * prose, and none with any of the shapes above.
 */
const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*))?$/;

/**
 * A closing run of hashes, which CommonMark allows and does not require:
 * `## Title ##` is `Title`. It only closes when whitespace precedes it,
 * or when it is the whole of the content — so `## Title##` keeps its
 * hashes, and `## ##` is a heading with nothing in it.
 */
const ATX_CLOSING_RUN = /(^|[ \t])#+[ \t]*$/;

export function extractSnippet(content: string, maxChars = 80): string {
  if (typeof content !== 'string' || content.length === 0) return '(empty)';
  const bounded = content.length > MAX_INPUT_BYTES ? content.slice(0, MAX_INPUT_BYTES) : content;
  const body = stripFrontmatter(bounded);

  for (const raw of body.split('\n')) {
    const text = textCarriedBy(raw);
    if (text.length > 0) return truncate(text, maxChars);
  }

  return '(empty)';
}

/**
 * The text this line carries, or the empty string if it carries none.
 *
 * A blank line carries nothing, and so does an empty heading — `#` alone,
 * or `## ##`. Both are skipped for the same reason rather than for two:
 * the rule is *the first line that carries text*, and neither of them
 * does.
 */
function textCarriedBy(raw: string): string {
  // Trailing whitespace goes first so `$` means end of line for a CRLF
  // file too. Leading whitespace stays — three spaces still open a
  // heading and four no longer do.
  const line = raw.replace(/\s+$/, '');

  const heading = ATX_HEADING.exec(line);
  if (!heading) return line.trim();

  const inside = heading[2] ?? '';
  return inside.replace(ATX_CLOSING_RUN, '$1').trim();
}

function stripFrontmatter(content: string): string {
  // Skip a Unicode BOM if present so the fence comparison still works
  // for files saved with one.
  let body = content.startsWith('﻿') ? content.slice(1) : content;

  // Frontmatter has to start at line 1 (no leading whitespace).
  if (!body.startsWith(FRONTMATTER_FENCE)) return body;

  // First line must be exactly `---` (allow trailing CR for CRLF files).
  const firstNewline = body.indexOf('\n');
  if (firstNewline === -1) return body;
  const firstLine = body.slice(0, firstNewline).replace(/\r$/, '');
  if (firstLine !== FRONTMATTER_FENCE) return body;

  // Find the closing fence on its own line.
  const remainder = body.slice(firstNewline + 1);
  const closeRegex = /(^|\n)---[ \t]*(\r?\n|$)/;
  const match = closeRegex.exec(remainder);
  if (!match) return body; // Malformed — leave content alone

  const closeEnd = match.index + match[0].length;
  body = remainder.slice(closeEnd);
  return body;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}…`;
}
