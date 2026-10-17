/**
 * The text of a code span as CommonMark reads it from the file (#603).
 *
 * `marked` turns each line ending of a span into a space and strips one space
 * of padding from each end, as CommonMark does; but it reads the span out of
 * a paragraph that still holds the indentation of its continuation lines,
 * which CommonMark strips before any inline is read. So a span wrapped onto
 * an indented line, `&'static` and `Log` on two lines, came to the editor
 * with the indentation inside it. While the editor collapsed every run in a
 * span that went unseen; once the text of a span reaches the file as held,
 * it would write a run GitHub never read, measured on 1 file of the corpus.
 *
 * So the text is read again from the bytes of the span: a line ending and the
 * white space that opens the next line are one space, then the padding rule.
 */
import type { MarkedExtension } from 'marked';

/** The span of `raw`: its run of backticks, its content, the same run. */
const SPAN = /^(`+)([\s\S]*?)\1$/;

/** The text of the code span `raw` spells, or `null` where `raw` is not one. */
export function codeSpanText(raw: string): string | null {
  const span = SPAN.exec(raw);
  if (span === null) return null;
  const text = span[2].replace(/\r?\n[ \t]*/g, ' ');
  return /[^ ]/.test(text) && text.startsWith(' ') && text.endsWith(' ') ? text.slice(1, -1) : text;
}

/**
 * The code span tokenizer of `marked`, restated with the text above: the
 * same expression finds the span, and only its text is read otherwise. A
 * tokenizer rather than `walkTokens`, which walks every token of a document
 * and cost 1.3 s on the 884 KB changelog of the census on #20.
 */
export const codeSpanTextExtension: MarkedExtension = {
  tokenizer: {
    codespan(src) {
      const span = this.rules.inline.code.exec(src);
      if (span === null) return undefined;
      return { type: 'codespan', raw: span[0], text: codeSpanText(span[0]) ?? span[2] };
    },
  },
};
