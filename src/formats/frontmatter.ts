import type { DocumentBundle } from './types';

/** Reconstruct full markdown from frontmatter + body. */
export function assembleMarkdown(bundle: DocumentBundle): string {
  if (!bundle.frontmatterRaw) return bundle.markdownBody;
  return `---\n${bundle.frontmatterRaw}\n---\n${bundle.markdownBody}`;
}

/**
 * Split frontmatter from markdown text.
 *
 * The raw block comes back with `\n` line endings whatever the file
 * used: it is handed to a `<textarea>`, which normalises to `\n` the
 * moment the user edits it anyway, so a CRLF document would otherwise
 * show — and store — stray `\r` until the first edit. This is **not**
 * where the file's line endings are preserved: the write path re-applies
 * them to the whole assembled text and does not depend on what this
 * function does (#79).
 */
export function splitFrontmatter(text: string): { raw: string | null; body: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { raw: null, body: text };
  return { raw: match[1].replace(/\r\n/g, '\n'), body: match[2] };
}
