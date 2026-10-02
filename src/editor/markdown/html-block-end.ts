/**
 * Where the HTML tokenizer stands at the end of a raw HTML block (#455).
 *
 * A small reading of the HTML tokenizer, enough to answer what `open-cut.ts`
 * asks and no more. It follows the states the HTML standard names for the
 * three things the first version of this read wrong, each measured on the
 * #457 review in Chromium:
 *
 * - **A quote opens a value only where a value begins**, right after `=` and
 *   any whitespace. Inside an attribute name or an unquoted value it is a
 *   character of that name or value, so `title=don't` holds no open quote.
 * - **The nine names of the GFM tag filter are text, not tags** (#461), as
 *   the parser reads them since then: `script`, `style`, `textarea`, `title`,
 *   `xmp`, `iframe`, `noembed`, `noframes` and `plaintext`. Until #461 they
 *   were read as the raw-text elements HTML makes of them, whose text is not
 *   markup; they are the only raw-text elements, so that state is gone, and
 *   what follows one of them is read as the parser now reads it. `noscript`
 *   was never one: the parse here runs with scripting off.
 * - **Words inside a tag after a blank line are attribute names.** `marked`
 *   keeps `<div`, a blank line and `some text` in one block, and the parser
 *   reads `some` and `text` as attributes of the `div`, so the words are gone.
 *
 * One pass over the block's own text, which bounds it.
 */

import { filteredTagAt } from './tag-filter';

export type BlockEndState = 'data' | 'tag' | 'quote' | 'comment';

export interface BlockEnd {
  readonly state: BlockEndState;
  /** Whether words stood inside a tag after a blank line inside that tag. */
  readonly wordsAfterBlankLineInTag: boolean;
}

type Inside =
  | 'data'
  | 'tag-name'
  | 'before-name'
  | 'name'
  | 'after-name'
  | 'before-value'
  | 'quoted-value'
  | 'unquoted-value'
  | 'comment';

const IN_TAG = new Set<Inside>([
  'tag-name',
  'before-name',
  'name',
  'after-name',
  'before-value',
  'unquoted-value',
]);

const isSpace = (c: string): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\f';

/** Whether a blank line begins at the newline at `i`. */
function blankLineAt(raw: string, i: number): boolean {
  if (raw[i] !== '\n') return false;
  let j = i + 1;
  while (j < raw.length && (raw[j] === ' ' || raw[j] === '\t')) j++;
  return raw[j] === '\n';
}

export function htmlBlockEnd(raw: string): BlockEnd {
  let inside: Inside = 'data';
  let quote = '';
  let blankInTag = false;
  let wordsAfterBlankLineInTag = false;
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (IN_TAG.has(inside)) {
      if (blankLineAt(raw, i)) blankInTag = true;
      else if (blankInTag && !isSpace(c) && c !== '>') wordsAfterBlankLineInTag = true;
    }
    switch (inside) {
      case 'data':
        if (raw.startsWith('<!--', i)) {
          // `<!-->` and `<!--->` are whole, empty comments.
          const empty = raw.startsWith('>', i + 4) ? 5 : raw.startsWith('->', i + 4) ? 6 : 0;
          if (empty === 0) inside = 'comment';
          i += empty === 0 ? 4 : empty;
          continue;
        }
        // A tag of the nine is text, as the parser reads it since #461.
        if (filteredTagAt(raw, i)) break;
        if (c === '<' && /[A-Za-z]/.test(raw[i + 1] ?? '')) {
          inside = 'tag-name';
          blankInTag = false;
        } else if (c === '<' && raw[i + 1] === '/' && /[A-Za-z]/.test(raw[i + 2] ?? '')) {
          inside = 'tag-name';
          blankInTag = false;
          i += 2;
          continue;
        }
        break;
      case 'comment':
        if (raw.startsWith('-->', i)) {
          inside = 'data';
          i += 3;
          continue;
        }
        break;
      case 'quoted-value':
        if (c === quote) inside = 'after-name';
        break;
      default:
        inside = inTag(inside, c);
        if (inside === 'before-value' && (c === '"' || c === "'")) {
          inside = 'quoted-value';
          quote = c;
        }
    }
    i++;
  }
  return { state: endStateOf(inside), wordsAfterBlankLineInTag };
}

/**
 * The next state inside a tag for the character `c`, quoted values aside: a
 * quote is a value only from `before-value`, which the caller handles.
 */
function inTag(inside: Inside, c: string): Inside {
  if (c === '>') return 'data';
  switch (inside) {
    case 'tag-name':
      return isSpace(c) || c === '/' ? 'before-name' : 'tag-name';
    case 'before-name':
      return isSpace(c) || c === '/' ? 'before-name' : 'name';
    case 'name':
      if (isSpace(c)) return 'after-name';
      if (c === '/') return 'before-name';
      return c === '=' ? 'before-value' : 'name';
    case 'after-name':
      if (isSpace(c)) return 'after-name';
      if (c === '/') return 'before-name';
      return c === '=' ? 'before-value' : 'name';
    case 'before-value':
      return isSpace(c)
        ? 'before-value'
        : c === '"' || c === "'"
          ? 'before-value'
          : 'unquoted-value';
    case 'unquoted-value':
      return isSpace(c) ? 'before-name' : 'unquoted-value';
    default:
      return inside;
  }
}

function endStateOf(inside: Inside): BlockEndState {
  if (inside === 'quoted-value') return 'quote';
  if (inside === 'comment') return 'comment';
  return IN_TAG.has(inside) ? 'tag' : 'data';
}
