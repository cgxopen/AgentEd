import { Extension } from '@tiptap/core';
import { SPACER_ATTRIBUTE } from './markdown/spacer-paragraph';

/**
 * Whether the file wrote this paragraph as `&nbsp;` alone (#606). Set by the
 * parse, so a paragraph `marked` makes of a stray U+00A0 carries nothing and
 * is written as before; not kept on a split, so a paragraph the editor makes
 * carries nothing either.
 */
export const SpacerParagraphs = Extension.create({
  name: 'spacerParagraphs',
  addGlobalAttributes: () => [
    {
      types: ['paragraph'],
      attributes: {
        spacer: {
          default: false,
          keepOnSplit: false,
          parseHTML: (element: HTMLElement) => element.hasAttribute(SPACER_ATTRIBUTE),
          renderHTML: (attributes: Record<string, unknown>) =>
            attributes.spacer === true ? { [SPACER_ATTRIBUTE]: '' } : {},
        },
      },
    },
  ],
});
