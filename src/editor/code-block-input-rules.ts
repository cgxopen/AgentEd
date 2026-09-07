import { type InputRule, textblockTypeInputRule } from '@tiptap/core';
import type { NodeType } from '@tiptap/pm/model';

/**
 * The two markdown input rules that turn a typed fence into a code block
 * (#237), replacing the pair `@tiptap/extension-code-block` ships.
 *
 * ── What the shipped rules were, and what they cost ──
 *
 * Read out of `node_modules/@tiptap/extension-code-block/dist/index.js` at
 * 2.27.2, the version `package-lock.json` pins:
 *
 *     const backtickInputRegex = /^```([a-z]+)?[\s\n]$/;
 *     const tildeInputRegex = /^~~~([a-z]+)?[\s\n]$/;
 *
 * The language group is `a` to `z`. Everything else a user types as a
 * language — `Python`, `JS`, `C`, `c#`, `c++`, `objective-c`, `py3`, `html5` —
 * failed the match, so no block was made, nothing was said, and the paragraph
 * of literal backticks left behind was escaped on save into backslashes the
 * user never typed. Measured on `8114e5b`, all eight, on Enter and on space
 * alike.
 *
 * That was one rule disagreeing with the rest of the product rather than a
 * limit of what AgentEd can hold: the parser, the schema, the serializer and
 * the #202 language label already carry every one of those spellings, and a
 * file containing them round-trips byte for byte (the rows in
 * `roundtrip.test.ts`). R-C1 promises the rule "optionally with a language
 * between them" and names no restriction.
 *
 * ── What the group is now, and why exactly that ──
 *
 * CommonMark's info string for a backtick fence is the rest of the line after
 * the opening markers, trimmed; it **may not contain a backtick**; and the
 * language is conventionally its first word. So the group is *any run of
 * characters that is neither whitespace nor a backtick*, and the rule's
 * trailing `[\s\n]` is what stops it at the first space — the first space is
 * the character that fires the rule, so what follows it is typed into the
 * block rather than into its language. `Python` stays `Python`: there is no
 * normalisation here, because what this rule sets is what the file will carry
 * and what the label will draw.
 *
 * **The backtick half of the group is the rule agreeing with CommonMark
 * rather than a restriction of ours.** ```` ```py`thon ```` opens no fence in
 * any CommonMark reader, so making a block for it would write a file that
 * comes back as a paragraph — R-C2 losing a block out of the user's document.
 * It stays a paragraph, which is what CommonMark says it is.
 *
 * **The tilde twin carries the same exclusion, and CommonMark would allow it
 * one.** A tilde fence's info string may hold backticks. The exclusion is kept
 * because turndown writes *every* fenced block with backticks — measured:
 * `~~~python` typed here is saved as ```` ```python ```` — so a backtick that
 * reached the language through the tilde rule would land in a backtick fence,
 * which is the same broken file by a longer route.
 *
 * The `getAttributes` shape is the shipped one, unchanged: a group that did
 * not participate gives `undefined`, and the node's own `language` default
 * (`null`) applies — which is how three backticks alone go on making a block
 * with no language.
 */
export const BACKTICK_FENCE_INPUT_REGEX = /^```([^\s`]+)?[\s\n]$/;

/** The tilde spelling of the same fence. See the comment above. */
export const TILDE_FENCE_INPUT_REGEX = /^~~~([^\s`]+)?[\s\n]$/;

/**
 * Both rules, built against the node type the kit registered. Bounded at two
 * by the two fence markers CommonMark spells; there is no loop over user
 * input here.
 */
export function codeBlockInputRules(type: NodeType): InputRule[] {
  return [BACKTICK_FENCE_INPUT_REGEX, TILDE_FENCE_INPUT_REGEX].map((find) =>
    textblockTypeInputRule({
      find,
      type,
      getAttributes: (match) => ({ language: match[1] }),
    }),
  );
}
