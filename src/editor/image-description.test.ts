/**
 * The description of an image, and what writing one reaches (#291).
 *
 * **All of this is state and bytes, which the harness sees in full.** What it
 * cannot see is the control: whether the button is drawn, what the bar looks
 * like with it, and whether the line inside the dialog explains what the field
 * is for. Those are named in the pull request as the manual pass; the rows
 * here are the file.
 */
import { NodeSelection } from '@tiptap/pm/state';
import { describe, expect, it } from 'vitest';
import {
  hasImageSelected,
  imageDescription,
  imageDescriptionAvailability,
  setImageDescription,
} from './image-description';
import { createEditor, type EditorInstance } from './setup';

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const instance = createEditor(host);
  instance.setMarkdown(markdown);
  return instance;
}

/** The position of the first image in the document. */
function imagePosition(instance: EditorInstance): number {
  let at = -1;
  instance.editor.state.doc.descendants((node, pos) => {
    if (at >= 0 || node.type.name !== 'image') return at < 0;
    at = pos;
    return false;
  });
  if (at < 0) throw new Error('no image in the document');
  return at;
}

/** The selection a click on an image leaves: the node itself. */
function selectImage(instance: EditorInstance): void {
  instance.editor.view.dispatch(
    instance.editor.state.tr.setSelection(
      NodeSelection.create(instance.editor.state.doc, imagePosition(instance)),
    ),
  );
}

/** The bytes a save writes, reopened and saved again. */
function reread(markdown: string): string {
  const reopened = editorWith(markdown);
  const again = reopened.getMarkdown();
  reopened.destroy();
  return again;
}

const MARKDOWN = 'before\n\n![Holiday Photo.png](assets/Holiday-Photo.png)\n\nafter';
/** The spelling #27 keeps: quoting, an unquoted width, a title and a style. */
const INLINE_HTML =
  'before\n\n<img src=\'assets/p.png\' alt="a &amp; b" width=600 title="t" style="border:1px solid red">\n\nafter';
const NO_DESCRIPTION = 'before\n\n<img src="assets/p.png" width="600">\n\nafter';

describe('what the control is offered for (#291)', () => {
  it('is offered with an image selected and not otherwise', () => {
    const instance = editorWith(MARKDOWN);

    instance.editor.commands.setTextSelection(2);
    expect(hasImageSelected(instance.editor)).toBe(false);
    expect(imageDescriptionAvailability(instance.editor)).toEqual({ imageDescription: false });
    expect(imageDescription(instance.editor)).toBeNull();

    selectImage(instance);
    expect(hasImageSelected(instance.editor)).toBe(true);
    expect(imageDescriptionAvailability(instance.editor)).toEqual({ imageDescription: true });
  });

  /**
   * The reading is `isActive` rather than what the command answers, and this
   * row is why: with the caret merely beside an image, `updateAttributes`
   * answers true and changes nothing — an entry greyed from that would be
   * offered over a press that does nothing, the #275 shape.
   */
  it('is not offered with the caret beside an image, where a write would change nothing', () => {
    const instance = editorWith(MARKDOWN);
    instance.editor.commands.setTextSelection(2);

    expect(hasImageSelected(instance.editor)).toBe(false);
    expect(instance.editor.chain().focus().updateAttributes('image', { alt: 'x' }).run()).toBe(
      true,
    );
    expect(instance.getMarkdown()).toBe(MARKDOWN);
  });

  it('shows the description the image already carries, which is the file name until it is set', () => {
    const instance = editorWith(MARKDOWN);
    selectImage(instance);

    expect(imageDescription(instance.editor)).toBe('Holiday Photo.png');
  });

  it('shows an empty field for an image the file gave no description', () => {
    const instance = editorWith(NO_DESCRIPTION);
    selectImage(instance);

    expect(imageDescription(instance.editor)).toBe('');
  });
});

describe('writing a description reaches the file (#291)', () => {
  it('writes it into a markdown-spelled image', () => {
    const instance = editorWith(MARKDOWN);
    selectImage(instance);

    expect(setImageDescription(instance.editor, 'A dog asleep on a sofa')).toBe(true);

    const written = instance.getMarkdown();
    expect(written).toBe('before\n\n![A dog asleep on a sofa](assets/Holiday-Photo.png)\n\nafter');
    expect(reread(written)).toBe(written);
  });

  /**
   * **The measurement this control exists to respect.** An image the file
   * spelled as inline HTML carries its own bytes (#27) and the serializer
   * writes them back with only `src`, `width` and `height` patched — so a
   * description written onto the node alone would change the screen and not
   * the file. The command writes the one attribute inside those bytes as well,
   * and this row asserts what that leaves alone: the single quotes, the
   * unquoted width, the title and the style, character for character.
   */
  it('writes it inside the bytes of an image the file wrote as inline HTML, and moves nothing else', () => {
    const instance = editorWith(INLINE_HTML);
    selectImage(instance);

    setImageDescription(instance.editor, 'A dog asleep on a sofa');

    const written = instance.getMarkdown();
    expect(written).toBe(
      'before\n\n<img src=\'assets/p.png\' alt="A dog asleep on a sofa" width=600 title="t" style="border:1px solid red">\n\nafter',
    );
    expect(reread(written)).toBe(written);
  });

  it('gives a description to an inline HTML image that had none, and nothing else', () => {
    const instance = editorWith(NO_DESCRIPTION);
    selectImage(instance);

    setImageDescription(instance.editor, 'A dog asleep on a sofa');

    expect(instance.getMarkdown()).toBe(
      'before\n\n<img src="assets/p.png" width="600" alt="A dog asleep on a sofa">\n\nafter',
    );
  });

  it('writes nothing at all with no image selected', () => {
    const instance = editorWith(MARKDOWN);
    instance.editor.commands.setTextSelection(2);

    expect(setImageDescription(instance.editor, 'A dog asleep on a sofa')).toBe(false);
    expect(instance.getMarkdown()).toBe(MARKDOWN);
  });

  it.each([
    ['a markdown-spelled image', MARKDOWN],
    ['an image the file wrote as inline HTML', INLINE_HTML],
  ])('is one press of undo on %s', (_label, markdown) => {
    const instance = editorWith(markdown);
    selectImage(instance);
    setImageDescription(instance.editor, 'A dog asleep on a sofa');
    expect(instance.getMarkdown()).not.toBe(markdown);

    instance.editor.commands.undo();

    expect(instance.getMarkdown()).toBe(markdown);
  });
});

/**
 * An empty description is the correct answer for a decorative image and
 * CommonMark spells it, so it is accepted rather than refused — owner
 * decision, 2026-09-17, taken on the figures below. On the markdown path an
 * empty description and one nobody wrote are the same file; on the HTML path
 * they differ, and both hold still.
 */
describe('an empty description is accepted (#291)', () => {
  it('empties a markdown-spelled image, and the file reads back the same', () => {
    const instance = editorWith(MARKDOWN);
    selectImage(instance);

    setImageDescription(instance.editor, '');

    const written = instance.getMarkdown();
    expect(written).toBe('before\n\n![](assets/Holiday-Photo.png)\n\nafter');
    expect(reread(written)).toBe(written);
    const reopened = editorWith(written);
    selectImage(reopened);
    expect(imageDescription(reopened.editor)).toBe('');
  });

  it('empties an inline HTML image without taking its attribute away', () => {
    const instance = editorWith(INLINE_HTML);
    selectImage(instance);

    setImageDescription(instance.editor, '');

    const written = instance.getMarkdown();
    expect(written).toBe(
      'before\n\n<img src=\'assets/p.png\' alt="" width=600 title="t" style="border:1px solid red">\n\nafter',
    );
    expect(reread(written)).toBe(written);
  });

  it('leaves a file that already spells an empty description exactly as it is', () => {
    const file = 'before\n\n![](assets/p.png)\n\nafter';
    const instance = editorWith(file);

    expect(instance.getMarkdown()).toBe(file);
  });
});
