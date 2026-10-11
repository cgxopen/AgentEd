import type TurndownService from 'turndown';

/**
 * A link the file wrote as an autolink, in angle brackets, written back that
 * way while it is untouched (#567, owner decision of 2026-10-09: repaired
 * before 1.0.0).
 *
 * `<https://example.com>` came back `[https://example.com](https://example.com)`:
 * the same rendering, other bytes, in 317 of 1985 public files measured by AMP
 * on #567, and 12 examples of the CommonMark suite.
 *
 * ── Read from the token, carried on the mark ──
 *
 * The spelling is lost at serialization, never at parse: `marked` hands each
 * link token its `raw`, which opens with `<` for an autolink and with `[` for
 * every other link. The link mark holds an address and its text and nothing
 * else, so the spelling travels as an attribute, the route #566 gave the
 * delimiter of an emphasis (`emphasis-delimiter.ts`) and #431 the marker of a
 * list.
 *
 * ── Written back only while the link still says what the brackets say ──
 *
 * An autolink has no text of its own: its text is its address. So the
 * brackets are written only while the link holds plain text that gives its
 * address back the way `marked` makes it, the text itself or the text encoded,
 * and for an email `mailto:` and the text. An edit of the text, or of the address in the link
 * dialog, breaks that, and the link is written as an inline link, as every
 * link was before. **This is not R-C13**: only a link the file wrote is read
 * this way, so AgentEd writes no link the file did not hold, and a bare URL
 * stays text (`autolink.test.ts`).
 */

/** Set on a link the file wrote in angle brackets. */
export const AUTOLINK_ATTRIBUTE = 'data-autolink';

/** The link HTML of `marked` with the attribute, where the token is an autolink. */
export function withAutolinkAttribute(html: string, raw: string): string {
  return raw.startsWith('<') && html.startsWith('<a ')
    ? `<a ${AUTOLINK_ATTRIBUTE}=""${html.slice(2)}`
    : html;
}

/** The mark attribute, read from the element and rendered back onto it. */
export function autolinkMarkAttribute() {
  return {
    autolink: {
      default: false,
      parseHTML: (element: HTMLElement) => element.hasAttribute(AUTOLINK_ATTRIBUTE),
      renderHTML: (attributes: Record<string, unknown>) =>
        attributes.autolink === true ? { [AUTOLINK_ATTRIBUTE]: '' } : {},
    },
  };
}

/** What CommonMark admits between the brackets: no space, no `<`, no `>`. */
const AUTOLINK_CONTENT = /^[^\s<>]+$/;

/**
 * The text to write between the brackets, or `null` where the link is no
 * longer the autolink the file wrote: it holds markup, its text is not its
 * address, or the address holds what brackets cannot.
 */
/**
 * The address `marked` makes of autolink text: its `cleanUrl`, `encodeURI`
 * with every `%25` turned back into `%`, so `\` and a backtick in the text are
 * `%5C` and `%60` in the address. `null` where `encodeURI` refuses the text, a
 * lone surrogate, which `marked` answers by writing no link; the link is then
 * written inline, as before #567.
 */
function addressOf(text: string): string | null {
  try {
    return encodeURI(text).replace(/%25/g, '%');
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

function bracketed(link: HTMLElement): string | null {
  if (!link.hasAttribute(AUTOLINK_ATTRIBUTE) || link.title !== '') return null;
  if (link.childNodes.length !== 1 || link.firstChild?.nodeType !== 3) return null;
  const text = link.textContent ?? '';
  const href = link.getAttribute('href') ?? '';
  const address = addressOf(text);
  const spelled = address !== null && (href === address || href === `mailto:${address}`);
  return spelled && AUTOLINK_CONTENT.test(text) ? text : null;
}

/**
 * Registered by `serialize.ts`, which is over the module size guideline,
 * after its inline link rule: turndown consults the rule added last first, and
 * this one takes only an autolink that still holds.
 */
export function addAutolinkRules(turndown: TurndownService): void {
  turndown.addRule('angleAutolink', {
    filter: (node) => node.nodeName === 'A' && bracketed(node as HTMLElement) !== null,
    replacement: (_content, node) => `<${bracketed(node as HTMLElement)}>`,
  });
}
