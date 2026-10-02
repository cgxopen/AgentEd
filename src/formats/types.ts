import type { LineConventions } from './line-conventions';

export interface DocumentImage {
  relativePath: string;
  data: Uint8Array;
  filename: string;
}

/**
 * A document as the app holds it in memory: the markdown split into
 * frontmatter + body, plus the images referenced from it.
 *
 * There is exactly one on-disk shape — a plain `.md` file, with images
 * living in an `assets/` folder next to it (R-C5). The structured
 * document layouts (companion folder + `.agented-meta.json` sidecar)
 * left with the profile machinery in the August 2026 reset.
 */
export interface MarkdownDocument {
  /** Raw frontmatter YAML (null if no frontmatter) */
  frontmatterRaw: string | null;
  /** Markdown body without frontmatter */
  markdownBody: string;
  /** Images referenced by the document, keyed by their relative path */
  images: DocumentImage[];
  /** Path of the `.md` file on disk */
  rootPath: string;
  /**
   * Whether the file began with a byte order mark (#259). Read at the
   * same moment as the line conventions below and re-applied at the
   * same one, and required for the same reason: an omission would not
   * fail, it would silently drop three bytes from the user's file.
   */
  byteOrderMark: boolean;
  /**
   * How the text is written back: line terminator and final newline
   * (#79). Required rather than optional, because a document built
   * without them is the half-wired caller this repository refuses to
   * allow (#61) — the omission would not fail, it would silently
   * rewrite a Windows user's file.
   */
  lineConventions: LineConventions;
}

/**
 * A file whose raw HTML would cut the document at open, refused rather than
 * opened (#455), as a file that is not UTF-8 is refused (R-C3). Thrown while
 * the file is read, before the open changes anything, so the document that
 * was open stays as it was under its own path. `line` counts in the whole
 * file, metadata block included.
 */
export class OpenCutError extends Error {
  readonly path: string;
  readonly line: number;
  readonly kind: 'attribute' | 'comment' | 'raw-text';
  /** For `raw-text`, the element left open, which the repair names (#458). */
  readonly element: string | undefined;

  constructor(
    path: string,
    line: number,
    kind: 'attribute' | 'comment' | 'raw-text',
    element?: string,
  ) {
    super(`OPEN_CUT: ${path}, line ${line}`);
    this.name = 'OpenCutError';
    this.path = path;
    this.line = line;
    this.kind = kind;
    this.element = element;
  }
}
