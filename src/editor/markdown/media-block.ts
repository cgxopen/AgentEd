import { withBytesOnFirstBlock } from './kept-block-stamp';

/**
 * A raw HTML block holding a `video` or an `audio`, kept as its bytes while
 * untouched (#604, head 3, owner decision of 2026-10-17, comment 6239356606).
 *
 * ── What was lost ──
 *
 * The schema has no node for a media element. A block of a `video` and its
 * `source` children alone is kept whole as an inert carrier by `DRAWS_BESIDE_MEDIA`
 * in `kept-raw-html.ts`. A block that also holds what the editor draws, a
 * poster `img` or fallback text, cannot be taken whole: its `video` tags were
 * carriers, its `source` dropped by the schema, and it was written
 * `<video controls> ... </video>`, which GitHub reads as a player with nothing
 * to play and the fallback hidden, where `main` wrote the fallback alone.
 * Measured on the stop of head 3 (comment 6239315164 on #616) on fixtures; no
 * file of the corpus snapshot holds the shape.
 *
 * ── The route ──
 *
 * The block is drawn as before: its tags as carriers, which draw nothing, and
 * the poster or the text as the editor draws them. Its bytes ride on the
 * paragraph it is drawn as, the route of the `dl` in `dl-region.ts`, an `img`
 * being inline content there, so the poster stays in that paragraph. At save
 * the bytes are written while the paragraph is what they read as; an edit
 * lets them go, option i of #468. No `video` element is built at any point:
 * the tags are carriers before the parser sees them.
 */

/** A start tag of a media element. */
export const MEDIA_START = /<(?:video|audio)(?=[\s/>])/i;

/** The block as the editor reads it, its bytes on its paragraph, where it holds a media element. */
export function mediaBlock(drawn: string, raw: string): string {
  return MEDIA_START.test(raw) ? withBytesOnFirstBlock(drawn, raw, true) : drawn;
}

/** Whether bytes carried on a paragraph are a block of this route: it opens with a media element. */
export function isMediaBlockBytes(decoded: string): boolean {
  return /^ {0,3}<(?:video|audio)(?=[\s/>])/i.test(decoded);
}
