/**
 * The one place this application turns bytes from a file into text.
 *
 * Both platforms used to reach a decoder they did not configure - the
 * desktop through the plugin binding, which calls `new TextDecoder()`
 * after the Rust side has handed back raw bytes, and the web through
 * `Blob.text()`. Both defaults are lossy: an invalid byte becomes
 * U+FFFD and nothing is raised. Measured on #259: a CP1250 document of
 * 87 bytes came back as 108 with eleven replacement characters, on
 * screen and then on disk, with opening and saving enough to do it.
 *
 * Two options change that, and they are the whole of the mechanism:
 *
 * - **`fatal`** makes the decoder throw instead of substituting, which
 *   is what lets AgentEd decline to open a file it cannot read rather
 *   than showing text that is not the text in the file.
 * - **`ignoreBOM`** keeps a leading byte order mark in the string
 *   instead of consuming it. The mark is then a property of the text
 *   the layer above can carry, the way `#79` carries line terminators.
 *   Without this the mark is gone before any AgentEd code runs.
 */

import { NOT_UTF8 } from './types';

/** A leading byte order mark, as the character a decoder yields for it. */
export const BYTE_ORDER_MARK = '﻿';

/**
 * A file whose bytes are not valid UTF-8.
 *
 * **Carries the marker rather than the sentence.** The first draft put
 * the prose here and the owner run found what that costs: the route the
 * sidebar and the file association take does not show an error's own
 * message, it asks `openFailedMessage` for one - so the user read *it
 * may have been moved, renamed or removed* about a file that was found
 * and read without trouble. The words live where the other two open
 * failures keep theirs, and this is the term that reaches them.
 */
export class NotUtf8Error extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`${NOT_UTF8}: ${path}`);
    this.name = 'NotUtf8Error';
    this.path = path;
  }
}

/**
 * Decode a file's bytes as UTF-8, or refuse.
 *
 * The decoder is built per call rather than shared: a `fatal` decoder
 * keeps no state worth reusing, and a shared one would be a mutable
 * global in a module that has none.
 */
export function decodeFileText(bytes: ArrayBuffer | Uint8Array, path: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    // The only error `decode` raises with `fatal` set is the malformed
    // input one; it is re-thrown as this application's own type so the
    // wording layer has something to recognise rather than a string to
    // match on.
    throw new NotUtf8Error(path);
  }
}
