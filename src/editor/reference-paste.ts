import { Fragment, type Mark, type Node, Slice } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { marked, type Tokens } from 'marked';
import { lexMarkdown, markdownToHtml } from './markdown/parse';
import { foldLabel } from './markdown/reference';

/**
 * A pasted reference link keeps its spelling only where its label names, in
 * the document it lands in, a definition with the address the link holds
 * (#570, review 5491435367 on #589).
 *
 * A link the file wrote as a reference carries its label, and at save it is
 * written as its reference whenever the label names a definition (E4). A copy
 * inside one window keeps that label, so pasted into a document defining the
 * same label to another address it was saved as the reference and reopened
 * at the other address, measured on `185b798`, where `1793896` wrote it with
 * its own. So a paste is asked once, as it lands: the label is read against
 * the definitions of the document it lands in, the ones above the paste, the
 * ones it brings and the ones below it, in that order, the first of a label
 * being the one `marked` reads; and where that definition gives another
 * address, or there is none, the link loses its spelling and is written
 * inline with its own. A link left in place keeps following its definition.
 */

/** How deep the walk of a pasted slice goes, a bound on the recursion. */
const MAX_DEPTH = 200;

/** The text of a reference definition node, its lines joined, or `null` for any other node. */
function definitionText(node: Node): string | null {
  if (node.type.name !== 'footnoteDefinition' || typeof node.attrs.referenceIndent !== 'string') {
    return null;
  }
  let text = '';
  node.forEach((child) => {
    text += child.type.name === 'hardBreak' ? '\n' : (child.text ?? '');
  });
  return text;
}

/** The definitions of `fragment`, in order, added to `into` where their label is new. */
function collect(fragment: Fragment, into: Map<string, string>): void {
  fragment.descendants((node) => {
    const text = definitionText(node);
    if (text === null) return true;
    const label = /^\s*\[((?:[^\]\\]|\\.)+)\]:/.exec(text)?.[1];
    if (label !== undefined && !into.has(foldLabel(label))) into.set(foldLabel(label), text);
    return false;
  });
}

/** The address `marked` gives a link or an image of `label` under `definition`. */
function addressUnder(label: string, definition: string, image: boolean): string | null {
  const html = markdownToHtml(`${image ? '!' : ''}[x][${label}]\n\n${definition}`, {
    keepRawHtml: false,
  });
  const box = document.createElement('div');
  box.innerHTML = html;
  const element = box.querySelector(image ? 'img' : 'a');
  return element?.getAttribute(image ? 'src' : 'href') ?? null;
}

/** The label of a reference attribute value, or `null`. */
function labelOf(reference: unknown): string | null {
  if (typeof reference !== 'string') return null;
  try {
    const decoded = decodeURIComponent(reference);
    return decoded.slice(decoded.indexOf(':') + 1);
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

/** Whether a reference spelling may stay on something whose address is `address`. */
function keeps(reference: unknown, address: unknown, image: boolean, defined: Map<string, string>) {
  const label = labelOf(reference);
  if (label === null || typeof address !== 'string') return false;
  const definition = defined.get(foldLabel(label));
  return definition !== undefined && addressUnder(label, definition, image) === address;
}

/**
 * The same question of a kept link (#564), whose address is not live and so
 * not in the page: the address its definition gives, read by `marked`,
 * against the address of the inline link it keeps beside its spelling.
 */
function keepsKept(mark: Mark, defined: Map<string, string>): boolean {
  const label = labelOf(mark.attrs.reference);
  if (label === null || typeof mark.attrs.raw !== 'string') return false;
  const definition = defined.get(foldLabel(label));
  if (definition === undefined) return false;
  const links = (lexMarkdown(definition) as unknown as { links: Record<string, { href: string }> })
    .links;
  let inline: string;
  try {
    inline = decodeURIComponent(mark.attrs.raw);
  } catch (error) {
    if (error instanceof URIError) return false;
    throw error;
  }
  const link = marked.Lexer.lexInline(inline)[0] as Tokens.Link | undefined;
  return link?.type === 'link' && links[foldLabel(label)]?.href === link.href;
}

/** Whether a mark carrying a reference spelling may keep it. */
function markKeeps(mark: Mark, defined: Map<string, string>): boolean {
  if (mark.attrs.reference === null || mark.attrs.reference === undefined) return true;
  if (mark.type.name === 'link')
    return keeps(mark.attrs.reference, mark.attrs.href, false, defined);
  if (mark.type.name === 'keptLink') return keepsKept(mark, defined);
  return true;
}

function withoutReference(mark: Mark): Mark {
  return mark.type.create({ ...mark.attrs, reference: null });
}

function walk(fragment: Fragment, defined: Map<string, string>, depth: number): Fragment {
  if (depth > MAX_DEPTH) return fragment;
  const children: Node[] = [];
  fragment.forEach((node) => {
    let next = node;
    if (node.type.name === 'image' && node.attrs.reference !== null) {
      if (!keeps(node.attrs.reference, node.attrs.src, true, defined)) {
        next = node.type.create({ ...node.attrs, reference: null }, node.content, node.marks);
      }
    } else if (node.isText) {
      const marks = node.marks.map((mark) =>
        markKeeps(mark, defined) ? mark : withoutReference(mark),
      );
      next = node.mark(marks);
    } else if (node.content.size > 0) {
      next = node.copy(walk(node.content, defined, depth + 1));
    }
    children.push(next);
  });
  return Fragment.fromArray(children);
}

/** The slice with each reference spelling kept only where the paste rule allows. */
export function withPastedReferences(slice: Slice, state: EditorState): Slice {
  const defined = new Map<string, string>();
  const { from, to } = state.selection;
  collect(state.doc.slice(0, from).content, defined);
  collect(slice.content, defined);
  collect(state.doc.slice(to).content, defined);
  return new Slice(walk(slice.content, defined, 0), slice.openStart, slice.openEnd);
}
