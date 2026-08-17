/**
 * What counts as a link address (#25), and what counts as "the clipboard holds
 * a URL and nothing else" (#25 comment).
 *
 * Two callers with deliberately different appetites:
 *
 *   - The **dialog** is an explicit authoring act, so it is forgiving: a bare
 *     host typed as `example.com` becomes `https://example.com`, the way every
 *     address bar behaves. What it refuses, it refuses quietly.
 *   - **Paste over a selection** is a guess about intent, so it is strict: an
 *     explicit scheme is required and anything but a lone URL is left to the
 *     ordinary paste. Guessing wrong in the permissive direction turns a normal
 *     paste into a mangled link, which is much worse than not linking.
 *
 * Schemes are allow-listed rather than deny-listed. `javascript:` and `data:`
 * are the reason: an href goes straight into the document, and while the parse
 * path sanitizes what comes from a file, nothing would sanitize what this
 * module hands to the editor directly.
 */

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/** A host worth prefixing with https:// — `example.com`, `sub.example.co.uk/x`. */
const BARE_HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(?:[/?#].*)?$/i;

function parsed(candidate: string): URL | null {
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

function hasAllowedScheme(candidate: string): boolean {
  const url = parsed(candidate);
  return url !== null && ALLOWED_SCHEMES.has(url.protocol);
}

/**
 * The address to store for `input`, or `null` when there is nothing usable.
 * Whitespace anywhere disqualifies it: a link address is one token.
 */
export function normalizeLinkUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '' || /\s/.test(trimmed)) return null;
  if (hasAllowedScheme(trimmed)) return trimmed;
  // No scheme: only a plausible host earns the implied https://. Anything else
  // — including `javascript:alert(1)`, which parses but is not allow-listed —
  // is refused rather than coerced into something that looks safe.
  if (parsed(trimmed) !== null) return null;
  if (!BARE_HOST.test(trimmed)) return null;
  const withScheme = `https://${trimmed}`;
  return hasAllowedScheme(withScheme) ? withScheme : null;
}

/**
 * True when `text` is a URL and nothing else — the only clipboard that turns a
 * selection into a link. A paragraph that merely contains a URL is an ordinary
 * paste, so no implied scheme here: `example.com` in a selection is far more
 * likely to be prose than an address.
 */
export function isSingleUrl(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '' || /\s/.test(trimmed)) return false;
  return hasAllowedScheme(trimmed);
}
