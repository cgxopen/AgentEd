/**
 * The code of an indented fence as CommonMark reads it (#603, example 133).
 *
 * CommonMark removes up to as many spaces of indentation from each line of a
 * fence as the opening fence was indented by, so a line indented less loses
 * all of it. `marked` removes them only from a line indented at least as far
 * as the fence (`indentCodeCompensation`), and keeps a line indented less as
 * it is: `   ```` over `  aaa` held `  aaa` where GitHub reads `aaa`, and the
 * save, which writes the fence at the margin, wrote the two spaces into the
 * code. Example 133 of the CommonMark suite; no file of the corpus snapshot
 * holds the shape, measured on #613.
 *
 * So the fence tokenizer of `marked` is restated with the text read by the
 * CommonMark rule: the same expression finds the fence and its language, and
 * only the text of the code is read otherwise. A fence at the margin is read
 * exactly as `marked` reads it.
 */
import type { MarkedExtension } from 'marked';

/** The indentation of the opening fence of `raw`: zero to three spaces. */
const OPENING = /^( {0,3})(?:`{3,}|~{3,})/;

/** The text of a fence, each line losing up to the indentation of its opening fence. */
export function fenceText(raw: string, content: string): string {
  const indent = OPENING.exec(raw)?.[1].length ?? 0;
  if (indent === 0) return content;
  const strip = new RegExp(`^ {1,${indent}}`);
  return content
    .split('\n')
    .map((line) => line.replace(strip, ''))
    .join('\n');
}

/** The fence tokenizer of `marked`, its text read by the rule above. */
export const fenceIndentationExtension: MarkedExtension = {
  tokenizer: {
    fences(src) {
      const fence = this.rules.block.fences.exec(src);
      if (fence === null) return undefined;
      const lang = fence[2]
        ? fence[2].trim().replace(this.rules.inline.anyPunctuation, '$1')
        : fence[2];
      return { type: 'code', raw: fence[0], lang, text: fenceText(fence[0], fence[3] ?? '') };
    },
  },
};
