/**
 * Human-readable names for inserted images (R-C5) — never hashes.
 *
 *   - A file that already has a name keeps it, sanitized for portability:
 *     diacritics folded to ASCII, spaces to hyphens, characters Windows
 *     refuses removed.
 *   - A clipboard image has no name worth keeping, so it takes one from the
 *     document: `raport-lunar-01.png`, `-02`, … continuing past the highest
 *     index already in the folder.
 *   - Nothing is ever overwritten: a name already taken gains a numeric
 *     suffix (`diagram-2.png`).
 *
 * Names are compared case-insensitively, because Windows — the primary
 * target — stores them that way and would otherwise let `Diagram.png`
 * overwrite `diagram.png`.
 */

/** Where the image came from; the clipboard rarely carries a real name. */
export type ImageOrigin = 'clipboard' | 'file';

/** Longest base name we produce, extension aside — keeps paths workable. */
const MAX_BASE_LENGTH = 64;

/** Attempts at a free numeric suffix before giving up on a name. */
const MAX_COLLISION_ATTEMPTS = 1000;

/** Used when nothing usable survives sanitizing, or the document is unsaved. */
const FALLBACK_BASE = 'image';

/** Names clipboards hand out in place of a real one. */
const GENERIC_CLIPBOARD_NAMES = new Set(['image', 'unknown', 'blob', 'untitled', 'screenshot']);

/** Device names Windows cannot use as a file name, whatever the extension. */
const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * Latin letters that are not an ASCII letter plus a combining mark, so
 * decomposing leaves them untouched. Without these, `Größe` would come out
 * as `Gro-e` — sanitized, but no longer readable.
 */
const LETTER_EQUIVALENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/ß/g, 'ss'],
  [/æ/g, 'ae'],
  [/Æ/g, 'AE'],
  [/œ/g, 'oe'],
  [/Œ/g, 'OE'],
  [/ø/g, 'o'],
  [/Ø/g, 'O'],
  [/đ|ð/g, 'd'],
  [/Đ|Ð/g, 'D'],
  [/ł/g, 'l'],
  [/Ł/g, 'L'],
  [/þ/g, 'th'],
  [/Þ/g, 'Th'],
];

function foldLetters(name: string): string {
  let folded = name;
  for (const [pattern, replacement] of LETTER_EQUIVALENTS) {
    folded = folded.replace(pattern, replacement);
  }
  return folded;
}

export interface ImageNameRequest {
  /** The file's own name; may be empty or a clipboard placeholder. */
  readonly sourceName: string;
  /** The document's file name (e.g. `Raport lunar.md`), null when unsaved. */
  readonly documentName: string | null;
  /** Names already in the assets folder, including ones claimed this session. */
  readonly taken: ReadonlySet<string>;
  readonly origin: ImageOrigin;
}

/** Extension without the dot, lowercased; empty when there is none. */
export function extensionOf(name: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(name);
  return match ? match[1].toLowerCase() : '';
}

/** Name with its final extension removed. */
function withoutExtension(name: string): string {
  return name.replace(/\.[A-Za-z0-9]+$/, '');
}

/**
 * A file name portable across Windows, macOS and Linux, and readable by a
 * human: `Raport lunar (final).png` → `Raport-lunar-final`.
 */
export function sanitizeBaseName(name: string): string {
  const folded = foldLetters(name)
    // Decompose, then drop the combining marks: ă → a, ș → s, é → e.
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    // Anything left that is not a plain name character, including the
    // characters Windows reserves (< > : " / \ | ? *) and control codes.
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    // Slicing can leave a trailing separator behind.
    .replace(/[-.]+$/g, '');

  if (folded.length === 0) return FALLBACK_BASE;
  // `con.png` is unopenable on Windows whatever the extension.
  return RESERVED_WINDOWS_NAMES.test(folded) ? `${folded}-${FALLBACK_BASE}` : folded;
}

/** True when the clipboard offered a placeholder rather than a real name. */
export function isGenericName(name: string): boolean {
  const base = withoutExtension(name).trim().toLowerCase();
  if (base.length === 0) return true;
  // "image (1)", "screenshot 2026-08-15" and friends are placeholders too.
  const stem = base.split(/[\s._-]/)[0];
  return GENERIC_CLIPBOARD_NAMES.has(stem);
}

/** Base name a clipboard image takes from its document: `Raport lunar.md` → `raport-lunar`. */
export function documentBaseName(documentName: string | null): string {
  if (!documentName) return FALLBACK_BASE;
  const base = sanitizeBaseName(withoutExtension(documentName)).toLowerCase();
  return base.length === 0 ? FALLBACK_BASE : base;
}

/** Two-digit sequence numbers read better; longer ones simply grow. */
function formatIndex(index: number): string {
  return index < 100 ? String(index).padStart(2, '0') : String(index);
}

/**
 * One past the highest `<base>-NN` already taken, whatever the extension —
 * so a `.jpg` pasted after `raport-01.png` becomes `raport-02.jpg` rather
 * than reusing the number.
 */
export function nextDocumentIndex(base: string, taken: ReadonlySet<string>): number {
  const pattern = new RegExp(`^${escapeForRegExp(base)}-(\\d+)\\.[A-Za-z0-9]+$`, 'i');
  let highest = 0;
  for (const name of taken) {
    const match = pattern.exec(name);
    if (!match) continue;
    const index = Number.parseInt(match[1], 10);
    if (Number.isFinite(index) && index > highest) highest = index;
  }
  return highest + 1;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * `name` itself when free, otherwise the same name with the first numeric
 * suffix that is: `diagram.png` → `diagram-2.png`. Null when even that
 * runs out — the caller must not fall back to overwriting.
 */
export function resolveCollision(name: string, taken: ReadonlySet<string>): string | null {
  const lowered = new Set(Array.from(taken, (entry) => entry.toLowerCase()));
  if (!lowered.has(name.toLowerCase())) return name;

  const base = withoutExtension(name);
  const extension = extensionOf(name);
  const suffix = extension.length > 0 ? `.${extension}` : '';
  for (let attempt = 2; attempt < MAX_COLLISION_ATTEMPTS + 2; attempt++) {
    const candidate = `${base}-${attempt}${suffix}`;
    if (!lowered.has(candidate.toLowerCase())) return candidate;
  }
  return null;
}

/**
 * The name an image keeps from its own source, sanitized and before any
 * collision is resolved — `Diagramă finală.PNG` → `Diagrama-finala.png`.
 * Null when the image has no name worth keeping and takes one from the
 * document instead.
 *
 * Separate from `buildImageName` because it is the only part of a name that
 * does not depend on what is already taken, which is what lets the caller
 * ask "is the file this image wants to be already on disk?" before it
 * allocates anything (#52).
 */
export function keptFileName(sourceName: string, origin: ImageOrigin): string | null {
  if (sourceName.length === 0) return null;
  if (origin !== 'file' && isGenericName(sourceName)) return null;
  const extension = extensionOf(sourceName) || 'png';
  return `${sanitizeBaseName(withoutExtension(sourceName))}.${extension}`;
}

/**
 * The name an inserted image is written under. Null when no free name could
 * be found, which the caller must report rather than overwrite anything.
 */
export function buildImageName(request: ImageNameRequest): string | null {
  const kept = keptFileName(request.sourceName, request.origin);
  if (kept) return resolveCollision(kept, request.taken);

  const extension = extensionOf(request.sourceName) || 'png';
  const base = documentBaseName(request.documentName);
  const index = nextDocumentIndex(base, request.taken);
  return resolveCollision(`${base}-${formatIndex(index)}.${extension}`, request.taken);
}
