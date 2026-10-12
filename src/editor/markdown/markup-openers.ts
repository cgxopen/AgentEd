import { marked, type Token } from 'marked';
import { lexMarkdown } from './parse';

/**
 * Where a `<` or a `&` in a text node would open markup on the next read
 * (#565, owner decision D1 on #565, comment 6122593588).
 *
 * `marked` reads an escaped character as the character, the editor holds it
 * as text, and turndown writes `<` and `&` bare, since its escape table holds
 * neither. So text the file kept as text came back as markup after an
 * unedited save: `\<br/>` a line break, `\&ouml;` an o with umlaut,
 * `&lt;nathan@tootallnate.net&gt;` an email link in 85 files of the corpus of
 * the step zero, and `\<script>` and `\<img onerror=...>` live tags in the
 * file. Text typed with a tag reopened as markup the same way, the exception
 * #461 recorded for a typed tag.
 *
 * ── Asked of the reader, not restated ──
 *
 * A `<` is escaped where the inline lexer of `marked`, configured as
 * `parse.ts` configures it, reads raw HTML or an autolink starting there; and
 * where it may begin a line, the start of the text node or after a newline,
 * also where the block lexer opens a block there that is not a paragraph,
 * since CommonMark opens an HTML block on less than a tag: `<div` with no `>`,
 * `<!--` with no `-->`, `<?`. A text node may begin after bold rather than at
 * a line start, so such a `<` can gain a backslash it did not need: bytes,
 * never meaning, the trade #90 and #96 settled.
 *
 * The nine names of the GFM tag filter are escaped like any tag (owner
 * decision D1): bare in prose they are text in AgentEd and on GitHub, but a
 * renderer without the filter runs them.
 *
 * A `&` is escaped where an entity follows it: a number within the bounds
 * CommonMark gives it, or a name the platform HTML parser decodes, so no
 * table of names is carried. `&MadeUpEntity;` is text to both and is left as
 * it is.
 */

/** The longest stretch after a `<` the lexers are handed, a bound on the work per character. */
const LOOKAHEAD = 4096;

/** Every shape after a `<` that opens markup starts with something other than a space. */
const MAY_OPEN = /[^\s<]/;

/** A name or a number between `&` and `;`, as CommonMark bounds them. */
const ENTITY = /(?:[A-Za-z][A-Za-z0-9]{0,31}|#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6});/y;

/** Whether the inline lexer reads raw HTML or an autolink at the start of `source`. */
function opensInline(source: string): boolean {
  const first = marked.Lexer.lexInline(source, marked.defaults)[0] as Token | undefined;
  if (first === undefined) return false;
  return first.type === 'html' || (first.type === 'link' && first.raw.startsWith('<'));
}

/** Whether the block lexer opens a block other than a paragraph at the start of `source`. */
function opensBlock(source: string): boolean {
  const first = lexMarkdown(source)[0];
  return first !== undefined && !['paragraph', 'text', 'space'].includes(first.type);
}

/** The text a `textarea` decodes `entity` to, which is `entity` itself where it is no entity. */
function decoded(entity: string): string {
  const area = document.createElement('textarea');
  area.innerHTML = entity;
  return area.value;
}

function opensEntity(text: string, at: number): boolean {
  ENTITY.lastIndex = at + 1;
  const match = ENTITY.exec(text);
  if (match === null) return false;
  if (match[0].startsWith('#')) return true;
  const entity = `&${match[0]}`;
  return decoded(entity) !== entity;
}

function opensMarkup(text: string, at: number): boolean {
  if (!MAY_OPEN.test(text[at + 1] ?? ' ')) return false;
  const source = text.slice(at, at + LOOKAHEAD);
  if (opensInline(source)) return true;
  const lineStart = at === 0 || text[at - 1] === '\n';
  return lineStart && opensBlock(`${source.split('\n')[0]}\n`);
}

/** The offsets of `text` holding a `<` or a `&` that would open markup on the next read. */
export function markupOpenings(text: string): number[] {
  const openings: number[] = [];
  for (const match of text.matchAll(/[<&]/g)) {
    const at = match.index;
    if (match[0] === '<' ? opensMarkup(text, at) : opensEntity(text, at)) openings.push(at);
  }
  return openings;
}
