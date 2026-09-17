import type { Editor } from '@tiptap/core';
import { setTagAttribute } from './markdown/image-spelling';

/**
 * The description of an image, and the command that writes it (#291).
 *
 * **An image gets its description from the name of the file it came from and
 * nothing changed it.** `handleImageFile` passes `alt: file.name` at both call
 * sites, so a picked `Holiday Photo.png` is written
 * `![Holiday Photo.png](assets/Holiday-Photo.png)` and a pasted `image.png`
 * is written `![image.png](assets/notes-01.png)` — a description naming a file
 * that does not exist. The product chose a value on the user behalf and then
 * offered no way to change it; this is that way.
 *
 * **What a description is for**, since the word has to carry it: it is what a
 * reader with a screen reader is given instead of the picture, and what every
 * renderer shows where the image cannot be loaded. The dialog says that in one
 * line, which is where the explaining lives — a tooltip long enough to teach
 * it would be too long to read (owner decision, 2026-09-17).
 *
 * ── Why the write is here and not in the serializer ──
 *
 * An image the file wrote as inline HTML carries **its own bytes** on the node
 * (#27), and `imageMarkup` writes those bytes back with `src`, `width` and
 * `height` patched into them. The description is not among them, so writing it
 * onto the node alone changes the screen and not the file — measured at
 * `af219a2`: the document showed the new description and the file kept
 * `alt="a &amp; b"`.
 *
 * **The serializer is not where that is repaired.** A serializer that wrote the
 * description into the bytes on every save would rewrite entities, quoting and
 * attribute order on images nobody had touched, which is the defect #27 exists
 * to prevent. So the command writes both: the attribute the editor draws from,
 * and the one attribute inside the kept bytes, through `setTagAttribute` — the
 * same function a resize already uses for `width`. Measured on
 * `<img src='assets/p.png' alt="a &amp; b" width=600 title="t" style="border:1px solid red">`:
 * after a write only the description changed, the single quotes, the unquoted
 * `width=600`, the `title` and the `style` all still there, and the document
 * reads back and holds still. An `<img>` carrying no description at all is
 * given one, which is an addition and nothing else.
 *
 * **An empty description is accepted** (owner decision, 2026-09-17): it is the
 * correct answer for a decorative image, CommonMark spells it, and it was
 * measured written, read back and holding still on both spellings. On the
 * markdown path an empty description and one nobody wrote are the same file,
 * `![](src)`; on the HTML path they differ, `alt=""` against no attribute.
 * Nothing is built for that difference.
 */

/** The key the menu greys this entry from, and what the dialog is called. */
export const IMAGE_DESCRIPTION_KEY = 'imageDescription';

/** Whether the selection is an image, which is the only state the control has. */
export function hasImageSelected(editor: Editor): boolean {
  return editor.isActive('image');
}

/**
 * The description the selected image carries, or `null` with no image
 * selected. An image whose description the file never wrote answers the empty
 * string, which is what the field then shows.
 */
export function imageDescription(editor: Editor): string | null {
  if (!hasImageSelected(editor)) return null;
  const alt = editor.getAttributes('image').alt;
  return typeof alt === 'string' ? alt : '';
}

/**
 * Write the description onto the selected image, in one transaction.
 *
 * One chain, so one step of undo — measured 1 of 1 `docChanged` transaction on
 * both spellings, with the original bytes back after a single press (R-C16).
 * It answers `false` where there is no image, so a route that reached it
 * through some other door changes nothing rather than writing onto whatever is
 * selected.
 */
export function setImageDescription(editor: Editor, description: string): boolean {
  if (!hasImageSelected(editor)) return false;
  const source = editor.getAttributes('image').htmlSource;
  const attributes: Record<string, unknown> = { alt: description };
  // Only an image the file spelled as inline HTML has bytes to keep in step;
  // for every other image the attribute stays what it was, which is null.
  if (typeof source === 'string') {
    attributes.htmlSource = setTagAttribute(source, 'alt', description);
  }
  return editor.chain().focus().updateAttributes('image', attributes).run();
}

/**
 * Which entries the menu can offer, in the shape `setupMenu` reads when it
 * opens — the same shape `table-shape.ts` uses, and for the same reason: an
 * entry that would do nothing is greyed rather than pressed in silence (the
 * #275 shape). `editor.can()` is not asked here either; what says an image is
 * there is `isActive`, since `updateAttributes` answers true with the caret
 * merely beside one and changes nothing.
 */
export function imageDescriptionAvailability(editor: Editor): Record<string, boolean> {
  return { [IMAGE_DESCRIPTION_KEY]: hasImageSelected(editor) };
}
