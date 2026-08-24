import type { BlankReplacement, Options } from 'turndown';

/**
 * Keeping a fenced block that has nothing in it (#94).
 *
 * turndown replaces a **blank** node — one whose text content is entirely
 * whitespace — before it consults any rule: `forNode` short-circuits on
 * `node.isBlank`, and `PRE` is not on its `meaningfulWhenBlank` list. So an
 * empty fenced block was written as the blank rule's `'\n\n'` and the block
 * left the file: opening fence, closing fence and language with it. Not a
 * respelling but a loss the reader can see, reported by nothing, and found
 * only on the next open (R-C2). It is also R-C15's first moment failing: the
 * ``` input rule makes exactly this node, so a plain text box saved before
 * anything was typed into it did not survive the save.
 *
 * **`turndown.addRule` cannot reach it** — the lever that fixed #85 and,
 * differently, #97 — because a blank node never reaches the rule array. That
 * is not an implementation detail read off the source: turndown's README says
 * it in those words, *"it overrides every rule (even those added via
 * `addRule`)"*, and names `blankReplacement` as the option that customises
 * it. So this hook is documented where `options.rules` is not, and it is
 * passed at construction because the service resolves it into its rule table
 * there and reads it from nowhere else afterwards.
 *
 * **The override is narrow because that hook is wide.** Instrumented over
 * `<p>a</p><pre><code></code></pre><p>b</p><p></p><p>c <em></em> d</p>` plus
 * an empty list, the nodes that arrive are `CODE`, `PRE`, `P`, `EM`, `LI`,
 * `UL`: an empty paragraph, an empty inline element and an empty list come
 * through the same hook as the fence. Everything that is not a fenced block
 * is handed back to turndown's own blank rule rather than to a restatement of
 * it, so this file decides one shape and leaves every other blank node
 * exactly as it behaved before.
 *
 * The child `CODE` arrives **before** its `PRE`, which is why the fence is
 * written for the `PRE`: written for the `CODE` it would land inside a block
 * that is then replaced in its turn.
 *
 * **Where this does not reach**: a fence that is the *only* content of a
 * blockquote or a list item. The container is blank too, so the blank rule
 * replaces the whole of it and the `PRE` inside is never offered here — the
 * same mechanism, one level up. Measured, pinned as a labelled gap in
 * `empty-fence.test.ts`, and left out of R-C2 deliberately, because it loses
 * a block rather than respelling one. Anyone widening this should start from
 * that: the fence is kept wherever it is *reached*, and it is not reached
 * when its whole container is blank.
 */

/** The language, as turndown's own fenced rule reads it off the `<code>`. */
const LANGUAGE_CLASS = /language-(\S+)/;

/**
 * A fenced block, by the same three conditions turndown's `fencedCodeBlock`
 * rule uses. Restated rather than delegated to: it is a *filter*, and the
 * declared shape of `options.rules` allows a filter to be a tag name or a
 * list of them, so reaching for that function would cost a second runtime
 * check for no more certainty than these three lines carry.
 */
function isFencedBlock(node: Node, options: Options): boolean {
  return (
    options.codeBlockStyle === 'fenced' &&
    node.nodeName === 'PRE' &&
    node.firstChild?.nodeName === 'CODE'
  );
}

/**
 * The fence this block was: ```` ```⏎``` ````, and ```` ```js⏎``` ```` when
 * it has a language — `class="language-js"` is on the `<code>` even when the
 * block is empty, so the language is recoverable here and nothing about it
 * has to be carried from anywhere else.
 *
 * This is turndown's own `fencedCodeBlock` shape with **one line omitted**:
 * for empty content its rule writes ```` ```⏎⏎``` ````, a fence around a
 * blank line, where the file had ```` ```⏎``` ```` — so delegating to it
 * would respell the very bytes this fix exists to keep. Everything else
 * follows it, deliberately: the same `options.fence`, the same
 * `language-(\S+)` reading of the class, and the same single trailing newline
 * stripped from the content, which is the parser's rather than the file's.
 *
 * **A whitespace-only fence keeps its whitespace.** The spaces are in the
 * document model — the editor holds ```` ```⏎␣␣␣⏎``` ```` as a code block
 * whose text is `"   \n"` — so writing them back is writing what the block
 * holds, and that fence round-trips byte for byte too. Dropping them would be
 * this issue's own defect, one size smaller.
 *
 * Fence-size escalation is turndown's answer to content holding a run of
 * backticks. A blank node's content is whitespace by definition, so there is
 * nothing here to escalate against.
 */
function fenceFor(node: Node, options: Options): string {
  const code = node.firstChild as HTMLElement;
  const language = code.getAttribute('class')?.match(LANGUAGE_CLASS)?.[1] ?? '';
  const fence = options.fence ?? '```';
  const content = (code.textContent ?? '').replace(/\n$/, '');
  const body = content === '' ? '' : `${content}\n`;
  return `\n\n${fence}${language}\n${body}${fence}\n\n`;
}

/**
 * Wrap turndown's blank rule so an empty fenced block is written as a fence.
 *
 * `blankOtherwise` is turndown's own default, read off a service of its
 * making rather than restated, for the reason `escape.ts` delegates to the
 * original `escape`: it stays the authority on every blank node that is not
 * ours, and it goes on being that if a future release changes what it does.
 *
 * **One shape normalises, and this fix is not what normalises it.**
 * ```` ```⏎⏎``` ```` — a fence around a single blank line — is read by
 * `marked` as the same `<pre><code>\n</code></pre>` as ```` ```⏎``` ````, so
 * the two are indistinguishable by the time anything here runs and both are
 * written as ```` ```⏎``` ````. That is the recorded R-C2 exception *a blank
 * line at the end of a fenced block*, which is upstream in `marked`, meeting
 * this fix. Telling them apart would mean reading each block's spelling from
 * the raw markdown on open and carrying it on the node — the #93 shape — to
 * preserve a blank line that R-C2 already records as lost on the way in.
 */
export function createBlankReplacement(blankOtherwise: BlankReplacement): BlankReplacement {
  return (content, node, options) =>
    isFencedBlock(node, options) ? fenceFor(node, options) : blankOtherwise(content, node, options);
}
