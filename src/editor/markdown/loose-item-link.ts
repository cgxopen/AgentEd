/**
 * A loose list item whose text is one link (#602).
 *
 * ── What was lost ──
 *
 * For a loose item `marked` turns the text token of the item into a
 * paragraph token it builds itself, and gives it as `raw` the HTML the
 * inline renderer has already produced. The paragraph renderer of `parse.ts`
 * hands that `raw` to the wrapper test of #468, which read `<a href="/x">a</a>`
 * as an `a` the file wrote standing alone on its line and kept it as the bytes
 * of the file: `- [a](/x)`, a blank line and `- d` came back with the item
 * written `- <a href="/x">a</a>`. Measured on the step zero of #573 (item 4b):
 * 20 files of the corpus snapshot were written with the anchor, 265 links.
 *
 * ── The route ──
 *
 * Where the text of a loose item is one link and nothing else but white
 * space, the shape the wrapper test reads as an `a` alone, the text token is handed to `marked` as
 * the paragraph token it would build, carrying the `raw` of the file instead
 * of the HTML. The wrapper test then reads the markdown the file wrote, which
 * is no anchor. A raw `a` the file wrote alone is not one link token but
 * HTML, so it goes the way it went and keeps its bytes.
 *
 * Only that shape is handed over, so every other loose item, its soft breaks
 * over several text tokens and its several paragraphs included, is rendered
 * by `marked` exactly as before. A task item is left alone too: `marked`
 * writes its checkbox into the same paragraph, which already keeps the
 * wrapper test from reading an `a` alone.
 */
import type { Token, Tokens } from 'marked';

/** The text tokens of a loose item that hold one link alone, turned into paragraph tokens. */
export function paragraphsOfALinkAlone(item: Tokens.ListItem): void {
  if (!item.loose || item.task) return;
  const tokens = item.tokens;
  tokens.forEach((token, i) => {
    if (token.type !== 'text' || tokens[i - 1]?.type === 'text' || tokens[i + 1]?.type === 'text') {
      return;
    }
    const inline = (token as Tokens.Text).tokens ?? [];
    const links = inline.filter((part) => part.type === 'link').length;
    const blank = (part: Token) => part.type === 'text' && part.raw.trim() === '';
    if (links !== 1 || !inline.every((part) => part.type === 'link' || blank(part))) return;
    const paragraph: Tokens.Paragraph = {
      type: 'paragraph',
      raw: token.raw,
      text: (token as Tokens.Text).text,
      tokens: inline,
    };
    tokens[i] = paragraph;
  });
}
