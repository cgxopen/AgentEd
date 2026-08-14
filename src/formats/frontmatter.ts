import type { DocumentBundle } from './types';

/** Reconstruct full markdown from frontmatter + body. */
export function assembleMarkdown(bundle: DocumentBundle): string {
  if (!bundle.frontmatterRaw) return bundle.markdownBody;
  return `---\n${bundle.frontmatterRaw}\n---\n${bundle.markdownBody}`;
}

/** Split frontmatter from markdown text. */
export function splitFrontmatter(text: string): { raw: string | null; body: string } {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { raw: null, body: text };
  return { raw: match[1], body: match[2] };
}
