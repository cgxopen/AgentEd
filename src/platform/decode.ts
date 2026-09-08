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

/** A leading byte order mark, as the character a decoder yields for it. */
export const BYTE_ORDER_MARK = '﻿';

/**
 * A file whose bytes are not valid UTF-8.
 *
 * Carries the sentence a person reads rather than a code, because both
 * routes that open a document put an error's own message in front of
 * the user. It names what happened and what AgentEd will not do, and it
 * offers no conversion: rescuing a legacy encoding is a different
 * product from the one REQUIREMENTS describes.
 */
export class NotUtf8Error extends Error {
  readonly path: string;

  constructor(path: string) {
    super(
      'This file is not saved in UTF-8, the text encoding AgentEd reads and writes. ' +
        'It has not been opened, because showing it would mean replacing the characters ' +
        'AgentEd cannot read - and saving would then write those replacements over your file.',
    );
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
