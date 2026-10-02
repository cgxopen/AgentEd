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
 * - **The text of a raw-text element is not markup.** Inside `script`,
 *   `style`, `textarea`, `title`, `xmp`, `iframe`, `noembed` and `noframes`
 *   nothing is a tag or a quote until the matching end tag, and after
 *   `plaintext` nothing ever is. `noscript` is not one of them here: the
 *   parse this pipeline runs has scripting off, where its content is markup.
 * - **Words inside a tag after a blank line are attribute names.** `marked`
 *   keeps `<div`, a blank line and `some text` in one block, and the parser
 *   reads `some` and `text` as attributes of the `div`, so the words are gone.
 *
 * One pass over the block's own text, which bounds it.
 */

export type BlockEndState = 'data' | 'tag' | 'quote' | 'comment' | 'raw-text';

export interface BlockEnd {
  readonly state: BlockEndState;
  /** Whether words stood inside a tag after a blank line inside that tag. */
  readonly wordsAfterBlankLineInTag: boolean;
  /**
   * Where the block ends inside raw text (#458): the element, the offset of its
   * start tag in the block, and its text up to the end of the block.
   */
  readonly rawText?: { readonly element: string; readonly start: number; readonly text: string };
}

const RAW_TEXT = new Set([
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'plaintext',
]);

type Inside =
  | 'data'
  | 'tag-name'
  | 'before-name'
  | 'name'
  | 'after-name'
  | 'before-value'
  | 'quoted-value'
  | 'unquoted-value'
  | 'comment'
  | 'raw-text';

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

/** Whether the end tag of `name` begins at `i`, as the tokenizer matches it. */
function endTagAt(raw: string, i: number, name: string): boolean {
  if (raw[i] !== '<' || raw[i + 1] !== '/') return false;
  const candidate = raw.slice(i + 2, i + 2 + name.length).toLowerCase();
  const after = raw[i + 2 + name.length] ?? '';
  return candidate === name && (after === '' || after === '>' || after === '/' || isSpace(after));
}

export function htmlBlockEnd(raw: string): BlockEnd {
  let inside: Inside = 'data';
  let quote = '';
  let tagName = '';
  let endTag = false;
  let rawTextName = '';
  let tagStart = 0;
  let rawTextStart = 0;
  let rawTextBody = 0;
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
        if (c === '<' && /[A-Za-z]/.test(raw[i + 1] ?? '')) {
          tagStart = i;
          inside = 'tag-name';
          tagName = '';
          endTag = false;
          blankInTag = false;
        } else if (c === '<' && raw[i + 1] === '/' && /[A-Za-z]/.test(raw[i + 2] ?? '')) {
          inside = 'tag-name';
          tagName = '';
          endTag = true;
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
      case 'raw-text':
        if (rawTextName !== 'plaintext' && endTagAt(raw, i, rawTextName)) {
          inside = 'tag-name';
          tagName = '';
          endTag = true;
          blankInTag = false;
          i += 2;
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
        } else if (c === '>' && inside === 'data') {
          const name = tagName.toLowerCase();
          if (!endTag && RAW_TEXT.has(name)) {
            inside = 'raw-text';
            rawTextName = name;
            rawTextStart = tagStart;
            rawTextBody = i + 1;
          }
        } else if (inside === 'tag-name') tagName += c;
    }
    i++;
  }
  const state = endStateOf(inside);
  if (state !== 'raw-text') return { state, wordsAfterBlankLineInTag };
  const text = raw.slice(rawTextBody);
  return {
    state,
    wordsAfterBlankLineInTag,
    rawText: { element: rawTextName, start: rawTextStart, text },
  };
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
  if (inside === 'raw-text') return 'raw-text';
  return IN_TAG.has(inside) ? 'tag' : 'data';
}
