/**
 * A reader for the shipped stylesheet, for tests that ask what a rule does to
 * an element the editor rendered: the rule is read out of the sheet and its
 * selector run against the element. happy-dom performs no layout, so what that
 * establishes is the rule and not what it looks like on screen, which is owed
 * to a manual pass.
 *
 * Moved out of `ui/menu.test.ts` by #312, whose search button rows stand on the
 * same reader; its own rows are in `stylesheet-rules.test.ts`.
 */
export interface StyleRule {
  readonly selector: string;
  /** The at-rules the rule sits inside, outermost first, such as `@media (max-width: 600px)`. */
  readonly conditions: readonly string[];
  readonly declarations: ReadonlyMap<string, string>;
}

/** The index just past the quoted string that opens at `start`. */
function stringEnd(css: string, start: number): number {
  const quote = css[start];
  for (let i = start + 1; i < css.length; i++) {
    if (css[i] === '\\') i++;
    else if (css[i] === quote) return i + 1;
  }
  throw new Error(`an unterminated string at ${start} in the stylesheet`);
}

function isQuote(ch: string): boolean {
  return ch === '"' || ch === "'";
}

/** The stylesheet with its comments removed, leaving any `/*` inside a string alone. */
function withoutComments(css: string): string {
  let out = '';
  for (let i = 0; i < css.length; i++) {
    if (isQuote(css[i])) {
      const end = stringEnd(css, i);
      out += css.slice(i, end);
      i = end - 1;
    } else if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      if (end < 0) throw new Error(`an unterminated comment at ${i} in the stylesheet`);
      i = end + 1;
    } else {
      out += css[i];
    }
  }
  return out;
}

/** The index of the `}` that closes a block whose body starts at `start`. */
function blockEnd(css: string, start: number): number {
  let depth = 0;
  for (let i = start; i < css.length; i++) {
    if (isQuote(css[i])) i = stringEnd(css, i) - 1;
    else if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      if (depth === 0) return i;
      depth--;
    }
  }
  throw new Error(`an unclosed block at ${start} in the stylesheet`);
}

/**
 * The declarations of one block. A semicolon ends a declaration only outside
 * parentheses and strings, so a value such as `url(data:image/svg+xml;base64,…)`
 * stays whole, and the property is what precedes the first colon, so a colon
 * inside the value stays in the value.
 */
function declarationsOf(body: string): Map<string, string> {
  const declarations = new Map<string, string>();
  const take = (part: string) => {
    const colon = part.indexOf(':');
    if (colon > 0) declarations.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
  };
  let parens = 0;
  let from = 0;
  for (let i = 0; i < body.length; i++) {
    if (isQuote(body[i])) i = stringEnd(body, i) - 1;
    else if (body[i] === '(') parens++;
    else if (body[i] === ')') parens--;
    else if (body[i] === ';' && parens === 0) {
      take(body.slice(from, i));
      from = i + 1;
    }
  }
  take(body.slice(from));
  return declarations;
}

/** At-rules whose blocks hold rules rather than declarations. */
const GROUPING_AT_RULE = /^@(media|supports|container|layer|document)\b/;

/**
 * Every style rule in a stylesheet, as its selector, the at-rules it sits
 * inside, and its declarations. Every rule inside a `@media` block carries that
 * condition, the first and every one after it — the reader this replaced kept
 * the at-rule only on the first rule of each block and read the rest as rules
 * that apply at every width. At-rules that hold declarations, such as
 * `@font-face`, are not style rules and are left out.
 */
export function stylesheetRules(source: string): StyleRule[] {
  const css = withoutComments(source);
  const rules: StyleRule[] = [];
  const conditions: string[] = [];
  let prelude = '';
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (isQuote(ch)) {
      const end = stringEnd(css, i);
      prelude += css.slice(i, end);
      i = end - 1;
    } else if (ch === ';') {
      prelude = '';
    } else if (ch === '}') {
      if (conditions.pop() === undefined)
        throw new Error(`an unmatched } at ${i} in the stylesheet`);
      prelude = '';
    } else if (ch === '{') {
      const head = prelude.trim();
      prelude = '';
      if (GROUPING_AT_RULE.test(head)) {
        conditions.push(head);
        continue;
      }
      const end = blockEnd(css, i + 1);
      if (!head.startsWith('@')) {
        rules.push({
          selector: head,
          conditions: [...conditions],
          declarations: declarationsOf(css.slice(i + 1, end)),
        });
      }
      i = end;
    } else {
      prelude += ch;
    }
  }
  if (conditions.length > 0) throw new Error(`an unclosed ${conditions.at(-1)} in the stylesheet`);
  return rules;
}

/** A list split at the commas that are not inside parentheses, such as a selector list. */
export function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let parens = 0;
  let from = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '(') parens++;
    else if (list[i] === ')') parens--;
    else if (list[i] === ',' && parens === 0) {
      parts.push(list.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(list.slice(from));
  return parts.map((part) => part.trim());
}

/** Whether a selector list reaches the element. A selector the DOM cannot parse reaches nothing. */
export function reaches(selector: string, target: Element): boolean {
  return splitTopLevel(selector).some((one) => {
    try {
      return target.matches(one);
    } catch {
      return false;
    }
  });
}

/**
 * The values a property takes in every rule of `rules` that reaches the
 * element, in stylesheet order — **at any window width**: a rule inside
 * `@media` counts, because at some width it applies.
 */
export function valuesReaching(
  rules: readonly StyleRule[],
  target: Element,
  property: string,
): string[] {
  return rules
    .filter((rule) => reaches(rule.selector, target) && rule.declarations.has(property))
    .map((rule) => rule.declarations.get(property) as string);
}
