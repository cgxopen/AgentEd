import { DOMSerializer, type Fragment, type Schema } from '@tiptap/pm/model';

/**
 * How a paste knows it is a copy from this window (#447).
 *
 * `isInternalPaste` used to answer from `data-pm-slice`, the attribute
 * ProseMirror writes on what it copies. Any page can spell it, and a paste
 * that carries it is left to ProseMirror as it is, attributes the pipeline
 * stamps for itself included: measured on #447, a page spelling it put an
 * event handler, a `javascript:` link or a heading into a file through one
 * paste. So the window makes a token once, writes it into the HTML it puts on
 * the clipboard, and looks for it at paste.
 *
 * **A token rather than a comparison of the plain text** (owner decision of
 * 2026-10-01 on #447): the plain text of a page is chosen by whoever wrote the
 * page, so a match by text can be arranged, where a value nobody sees cannot
 * be guessed. It is made from `crypto.getRandomValues`, which needs no secure
 * context, kept in memory only, and lost with the window. A copy from another
 * AgentEd window therefore carries a token this one does not know and is
 * treated as foreign; that cost is the R-C2 exception REQUIREMENTS records.
 */
export const COPY_TOKEN_ATTRIBUTE = 'data-agented-copy';

const TOKEN_BYTES = 16;

function makeToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** This window's token: made once, held for the life of the window. */
const COPY_TOKEN = makeToken();

/** Whether `html` was put on the clipboard by this window. */
export function carriesThisWindowsToken(html: string): boolean {
  return html.includes(`${COPY_TOKEN_ATTRIBUTE}="${COPY_TOKEN}"`);
}

/**
 * The serializer ProseMirror uses for what it puts on the clipboard, with the
 * token written on the first element of the copy.
 *
 * ProseMirror serializes a copy with `serializeFragment` into a wrapper and
 * puts the wrapper's inner HTML on the clipboard, so an attribute on its
 * first element child travels with the copy. The method is called again for
 * the content of every node, so only the outermost call writes the token. A
 * copy whose first child is not an element, which a copy of block content
 * never is, carries no token and is treated as foreign: the safe direction.
 */
export function clipboardSerializerWithToken(schema: Schema): DOMSerializer {
  const base = DOMSerializer.fromSchema(schema);
  const serializer = new DOMSerializer(base.nodes, base.marks);
  const serializeFragment = serializer.serializeFragment.bind(serializer);
  let depth = 0;
  serializer.serializeFragment = (
    fragment: Fragment,
    options?: { document?: Document },
    target?: HTMLElement | DocumentFragment,
  ) => {
    depth += 1;
    try {
      const out = serializeFragment(fragment, options, target);
      if (depth === 1) out.firstElementChild?.setAttribute(COPY_TOKEN_ATTRIBUTE, COPY_TOKEN);
      return out;
    } finally {
      depth -= 1;
    }
  };
  return serializer;
}
