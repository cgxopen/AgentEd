/**
 * Pull a short, single-line preview from the body of a context file.
 *
 * The popover uses snippets to give users a "what's actually in this
 * file" hint without opening it. Strategy (per task brief M0 §4):
 *
 *  1. Strip a leading YAML frontmatter block if present (`---` fenced)
 *  2. Walk the remainder line-by-line, picking the first non-empty
 *     line that doesn't start with `#` (heading marker)
 *  3. If everything is a heading, fall back to the first heading's
 *     text without the `#` markers
 *  4. Truncate to `maxChars`
 *  5. Sentinel `(empty)` if the file has no body content at all
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

export function extractSnippet(content: string, maxChars = 80): string {
  if (typeof content !== 'string' || content.length === 0) return '(empty)';
  const bounded = content.length > MAX_INPUT_BYTES ? content.slice(0, MAX_INPUT_BYTES) : content;
  const body = stripFrontmatter(bounded);
  const lines = body.split('\n');

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('#')) continue;
    return truncate(trimmed, maxChars);
  }

  // Fallback: every non-empty line was a heading. Use the first one's
  // text content so the snippet still conveys *what* the file is about.
  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith('#')) {
      const stripped = trimmed.replace(/^#+\s*/, '').trim();
      if (stripped.length > 0) return truncate(stripped, maxChars);
    }
  }

  return '(empty)';
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
