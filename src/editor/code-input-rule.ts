import { getMarksBetween, InputRule } from '@tiptap/core';
import type { MarkType } from '@tiptap/pm/model';

/**
 * The input rule that turns a typed backtick span into a code span, keeping
 * every character typed before it (#619).
 *
 * ── What the shipped rule did ──
 *
 * `@tiptap/extension-code` 2.27.3 finds the span with
 * `` (^|[^`])`([^`]+)`(?!`) ``, which takes the character before the opening
 * backtick into the match so that a backtick there is refused, and hands it
 * to `markInputRule` in `@tiptap/core`, which deletes from the start of the
 * match to the text of the span unless the match opens with a space. So the
 * character before the backtick went with it: `` ax`code` `` left `a` and the
 * span, `` (`code`) `` left the span and `)`, measured on `c3fd352` in the
 * harness and in Chromium under the CSP of the app. A letter, a digit, a
 * parenthesis, a quotation mark, a tilde and a slash were each lost; after a
 * space and at a line start nothing was. The bold, italic and strikethrough
 * rules open with a space or a line start and lose nothing. Read in 3.32.0:
 * the expression gains a `$` and the deletion is the same.
 *
 * ── What this rule does ──
 *
 * The same expression, anchored at the caret, so a span is made exactly
 * where the shipped rule made one: after anything but a backtick, and not
 * from a run of two. The character before is matched and left where it is;
 * only the opening backtick is taken out, and the closing one, being the
 * character typed, is never inserted. The span is marked, and the mark is
 * not carried on to what is typed next, as the shipped rule does.
 *
 * Undo is not this rule's: `InputRule` records the transaction it makes, and
 * Backspace right after it gives back the typed text, as for every input
 * rule TipTap runs.
 */
const CODE_SPAN = /(^|[^`])`([^`]+)`$/;

export function codeInputRule(type: MarkType): InputRule {
  return new InputRule({
    find: CODE_SPAN,
    handler: ({ state, range, match }) => {
      const before = match[1] ?? '';
      const text = match[2];
      if (text === undefined) return null;
      const open = range.from + before.length;
      const end = open + text.length;
      // A mark already there that refuses a code span keeps the text as typed,
      // the check the shipped rule makes.
      const refusing = getMarksBetween(open, range.to, state.doc).filter((item) =>
        (item.mark.type as MarkType & { excluded: MarkType[] }).excluded.some(
          (excluded) => excluded === type && excluded !== item.mark.type,
        ),
      );
      if (refusing.length > 0) return null;
      const { tr } = state;
      tr.delete(open, open + 1);
      tr.addMark(open, end, type.create());
      tr.removeStoredMark(type);
    },
  });
}
