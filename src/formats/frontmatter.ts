import type { DocumentBundle } from './types';

/**
 * The spelling a rule is given when `---` would open a metadata block.
 * CommonMark reads it as a thematic break, and no front-matter reader takes
 * it for a fence.
 */
const RULE_THAT_OPENS_NO_BLOCK = '***';

/**
 * Reconstruct full markdown from frontmatter + body.
 *
 * **An empty block is a block** (#304). `null` means the document has no
 * metadata block and `''` means it has one with nothing in it; the two used
 * to be written alike, so a file holding only an opening and a closing
 * delimiter was saved as an empty file.
 */
export function assembleMarkdown(bundle: DocumentBundle): string {
  if (bundle.frontmatterRaw === null) return bodyThatOpensNoBlock(bundle.markdownBody);
  return `---\n${bundle.frontmatterRaw}\n---\n${bundle.markdownBody}`;
}

/**
 * A body written for a document with no metadata block, spelled so that it is
 * not read back as one (#304).
 *
 * A document that opens with a rule and holds a second one further down is
 * written `---` … `---` by the serializer, and that is exactly what a metadata
 * block looks like: `splitFrontmatter` took the text between the two rules
 * out of the document on the next open, and so do `gray-matter` and remark.
 * Where that would happen, the first line is written as a rule of the other
 * spelling instead, and the file reads back as the document it was.
 *
 * **Whether the body would be read as a block is asked of `splitFrontmatter`**
 * and of nothing else, so the writer cannot disagree with the reader about
 * what a block is. The first line is then the opening delimiter by that
 * function's own answer, and in a body the editor wrote it is a rule: a
 * paragraph holding three hyphens is written escaped.
 *
 * It rests on a recorded R-C2 exception — a rule is written with three
 * hyphens whatever the file used — which is why every rule after the first
 * still reads `---`. A file already on disk spelled `---` … `---` is read as
 * metadata before this runs, and is not reached by it.
 */
function bodyThatOpensNoBlock(body: string): string {
  if (splitFrontmatter(body).raw === null) return body;
  return body.replace(/^[^\r\n]*/, RULE_THAT_OPENS_NO_BLOCK);
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
