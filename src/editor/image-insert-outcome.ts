/**
 * The contract an image insert reports itself through (#61).
 *
 * Its own module because it is shared in two directions: the editor layer
 * produces it (`image-handler.ts`) and the app layer consumes it
 * (`src/app/image-insert-report.ts`), and neither owns it. Types only —
 * a reason never carries a sentence.
 */

/**
 * Where the user stopped the insert themselves — the destination picker
 * or the `assets/` folder question. Both are answers the user gave, so
 * both stay silent; the reason is carried anyway because *which* dialog
 * was cancelled is a fact the app layer may one day want to act on.
 */
export type ImageInsertCancelledAt = 'destination' | 'assets-folder';

/**
 * Why the application stopped the insert. Facts only — the sizes are
 * bytes, not a sentence about megabytes, because the words belong to the
 * app layer (`src/app/image-insert-report.ts`).
 */
export type ImageInsertRefusal =
  | { readonly reason: 'too-large'; readonly sizeBytes: number; readonly limitBytes: number }
  | { readonly reason: 'no-free-name' }
  /**
   * One gesture asked for more bytes than it may retain (#71). Reported
   * once for the gesture rather than once per file it left out — the
   * user made one gesture and gets one answer about it.
   *
   * Counts, not names: naming fifty files the user just selected
   * themselves explains nothing and cannot fit in a message.
   */
  | {
      readonly reason: 'gesture-too-large';
      /** Everything the gesture carried, oversized files included. */
      readonly bytesAttempted: number;
      readonly budgetBytes: number;
      /** How many images actually landed. */
      readonly inserted: number;
      /** How many the budget turned away, never attempted. */
      readonly refused: number;
    };

/**
 * How one call to `handleImageFile` ended. Every exit produces one,
 * and the three kinds are the distinction the flow turns on:
 *
 * - `inserted` — the image is in the document and nothing is on disk yet;
 *   the insert's only success signal, unchanged from #48.
 * - `cancelled` — the user refused something they were asked. They know
 *   what they refused, so the app layer says nothing (#46 depends on this
 *   staying a separate kind from `refused`).
 * - `refused` — the application could not continue. It speaks.
 *
 * This module names the reason and never the wording (#61).
 */
export type ImageInsertOutcome =
  | { readonly kind: 'inserted' }
  | { readonly kind: 'cancelled'; readonly at: ImageInsertCancelledAt }
  | ({ readonly kind: 'refused' } & ImageInsertRefusal);

/**
 * The insert's only channel out. Pushed rather than returned: the drop and
 * paste plugins call `void handleImageFile(...)`, so a returned outcome is
 * exactly the thing that gets dropped. A required parameter, so a caller
 * that has nowhere to report to cannot come into existence by omission.
 */
export type ReportImageInsert = (outcome: ImageInsertOutcome) => void;
