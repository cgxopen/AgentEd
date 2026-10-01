/**
 * What counts as a link address (#25, #42), and what counts as "the clipboard
 * holds a URL and nothing else" (#25 comment).
 *
 * Two callers with deliberately different appetites:
 *
 *   - The **dialog** is an explicit authoring act. It accepts a web address or
 *     a relative path to a neighbouring file, and stores **exactly what was
 *     typed**. It never invents a scheme: `example.com` becomes
 *     `[text](example.com)`, which is what every markdown renderer would have
 *     read it as anyway, and whoever means the web writes `https://`.
 *   - **Paste over a selection** is a guess about intent, so it is strict: an
 *     explicit scheme is required and anything but a lone URL is left to the
 *     ordinary paste. Guessing wrong in the permissive direction turns a normal
 *     paste into a mangled link, which is much worse than not linking.
 *
 * **Why the implied `https://` went** (#40 gave it, #42 took it back). A bare
 * host and a neighbouring file are indistinguishable by shape — `.md` is a real
 * TLD — so the courtesy turned `README.md` into `https://README.md`, silently,
 * on the most ordinary link this repository writes. The dialog has one field
 * and cannot ask. Inventing an address the user did not type is also the same
 * class of thing R-C13 legislates against, one keystroke away. A `www.`-only
 * exception was considered and rejected: a courtesy that works for
 * `www.example.com` and not for `github.com/x` is a second rule, not a
 * convenience.
 *
 * Schemes are allow-listed rather than deny-listed. `javascript:` and `data:`
 * are the reason: an href goes straight into the document, and while the parse
 * path sanitizes what comes from a file, nothing would sanitize what this
 * module hands to the editor directly.
 *
 * Classification goes through the `URL` API, never a colon test. `new URL(x)`
 * succeeding means the address carries a scheme of its own — which is how
 * `C:\notes\x.md` (scheme `c:`) is refused without being enumerated, while
 * `./notes:draft.md` (a colon inside a filename) is not. Resolving against a
 * sentinel base then separates a relative path from a protocol-relative one:
 * `//evil.com` and `\\evil.com` land on another host, and an address that
 * borrows the page's scheme has a scheme.
 */

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

/**
 * A base for resolving scheme-less addresses. `.invalid` is reserved by
 * RFC 2606 and resolves nowhere; the path segments only make `../a/b.md` and
 * `/docs/x.md` resolvable, since nothing is ever read back from the result but
 * its origin.
 */
const SENTINEL_BASE = 'https://agented.invalid/base/dir/';
const SENTINEL_ORIGIN = 'https://agented.invalid';

/** What an address is, once the `URL` parser has had its say. */
type LinkAddressKind =
  /** An allow-listed scheme: `http:`, `https:`, `mailto:`. */
  | 'web'
  /** No scheme of its own, resolving onto the base: a path or an anchor. */
  | 'relative'
  /** Any other scheme, or an address that borrows the page's. */
  | 'refused';

function parsed(candidate: string, base?: string): URL | null {
  try {
    return new URL(candidate, base);
  } catch {
    return null;
  }
}

function classify(candidate: string): LinkAddressKind {
  const absolute = parsed(candidate);
  if (absolute !== null) return ALLOWED_SCHEMES.has(absolute.protocol) ? 'web' : 'refused';
  const resolved = parsed(candidate, SENTINEL_BASE);
  if (resolved === null) return 'refused';
  return resolved.origin === SENTINEL_ORIGIN ? 'relative' : 'refused';
}

function hasAllowedScheme(candidate: string): boolean {
  return classify(candidate) === 'web';
}

/**
 * True when `candidate` is a path to a neighbouring file rather than an
 * address with a scheme — `./notes.md`, `docs/guide.md`, `../a/b.md`,
 * `/docs/x.md`, `#section`.
 *
 * Shared with the editor's `isAllowedUri` override (src/editor/setup.ts) so
 * that the dialog and the document agree: an address the dialog accepts must
 * be one `setLink` will insert and `parseHTML` will keep. Whitespace is *not*
 * judged here — the dialog refuses it separately, because "a link address is
 * one token" is a rule about typing, while a file already containing
 * `my%20notes.md` must keep its link (R-C2).
 *
 * An empty address is reported as relative, which is what TipTap's default
 * answers for one; `renderHTML`'s stripped branch depends on that.
 */
export function isRelativeLinkAddress(candidate: string): boolean {
  return classify(candidate) === 'relative';
}

/**
 * Whether `text` holds a C0 control character or DEL (#447).
 *
 * The URL parser strips or ignores most of them, so `java` NUL `script:`
 * classified as a relative path and the dialog stored it; the save wrote the
 * NUL into the file and the link came back as text on the next open.
 * Measured on #20. A link address is one token of printable characters.
 */
function hasControlCharacter(text: string): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * The address to store for `input`, or `null` when there is nothing usable.
 * Whitespace or a control character anywhere disqualifies it: a link address
 * is one token.
 *
 * What survives is stored **as typed** — no scheme added, no `./` added, no
 * judgement about whether a scheme-less token looks like a file.
 */
export function normalizeLinkUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '' || /\s/.test(trimmed) || hasControlCharacter(trimmed)) return null;
  return classify(trimmed) === 'refused' ? null : trimmed;
}

/**
 * True when `text` is a URL and nothing else — the only clipboard that turns a
 * selection into a link. A paragraph that merely contains a URL is an ordinary
 * paste, and a relative path pasted over a selection is an ordinary paste too:
 * this path guesses at intent, so it requires an explicit scheme where the
 * dialog, which was asked, does not.
 */
export function isSingleUrl(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '' || /\s/.test(trimmed)) return false;
  return hasAllowedScheme(trimmed);
}

/**
 * The address to hand the operating system for `text`, as the URL parser read
 * it, or `null` when `text` is not a single web address (#448).
 *
 * `isSingleUrl` answers through the URL parser, which folds the scheme and
 * repairs what WHATWG repairs: `HTTPS://`, `https:\\host`, `https:host` and a
 * leading control character are all `https://host/`. The shell scope in
 * `tauri.conf.json` matches the string it is handed, so handing it the
 * spelling rather than the parse opened nothing for exactly those addresses.
 * Handing it the parse means the scope and the allow-list judge the same
 * string, and the scope did not have to be widened to do it: the scheme of
 * what is handed is the scheme `classify` admitted.
 */
export function webAddressFor(text: string): string | null {
  if (!isSingleUrl(text)) return null;
  return new URL(text.trim()).href;
}
