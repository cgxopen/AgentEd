import type { Editor, Extension } from '@tiptap/core';
import { SearchAndReplace } from './vendor/search-and-replace';

export interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

/**
 * A refused pattern says two things (#373): `error`, a short label constant
 * across engines for the panel to show, and `detail`, the reason, for a
 * tooltip. The label used to be the engine text itself, which differs between
 * Chromium and WebKit, carried the pattern AgentEd builds for whole word, and
 * was long enough to squeeze the find field to nothing.
 */
export type SearchResult =
  | { ok: true; matches: number; current: number }
  | { ok: false; error: string; detail: string };

/** The label for a pattern that does not parse. */
export const INVALID_REGEX = 'Pattern not valid';
/** The label for a pattern the backtracking guard refuses. */
export const SLOW_REGEX = 'Pattern too complex';

/**
 * The reason inside an engine error, without the pattern it names. Chromium
 * writes `Invalid regular expression: /<pattern>/<flags>: <reason>`, and the
 * pattern is the one built here, not the one typed. Any other shape, such as
 * the WebKit wording, is returned whole: it only ever reaches a tooltip.
 */
export function regexErrorReason(message: string): string {
  const match = /^Invalid regular expression: \/.*\/[a-z]*: (.+)$/s.exec(message);
  return match ? match[1] : message;
}

/**
 * What Whole word counts as part of a word (#393): a letter or a mark of any
 * script, a digit, and the underscore `\b` also counts. A match is whole when
 * neither of its sides touches one. `\b` was used until #393, and in
 * JavaScript it knows only A to Z, digits and underscore, with or without the
 * `u` flag: școală, мир and über were never found whole, and cas was found
 * inside casă. The mark is what keeps a decomposed letter whole, where the
 * letter and its accent are two code points. It needs the `u` flag, which
 * both this file and the vendored `getRegex` always set.
 *
 * A `\b` the person types with the regex toggle on is theirs and is left as
 * JavaScript reads it (owner decision of 2026-09-19 on #393).
 */
const WORD_CHAR = '[\\p{L}\\p{M}\\p{N}_]';

/** The pattern of a Whole word search: `pattern` with no word character on either side. */
export function wholeWordPattern(pattern: string): string {
  return `(?<!${WORD_CHAR})(?:${pattern})(?!${WORD_CHAR})`;
}

const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;
const escapeRegex = (s: string) => s.replace(ESCAPE_RE, '\\$&');

// Probe budget for ReDoS detection. Catastrophic backtracking on short
// bait inputs (22 chars) caps at roughly 50 ms even for worst-case
// patterns like (a+)+b — well-formed patterns finish in <1 ms. We bail
// as soon as any probe exceeds this wall-clock budget so the user sees
// a friendly error instead of the multi-second freeze that would
// otherwise happen when the engine runs `matchAll` over the full doc.
const REDOS_PROBE_BUDGET_MS = 50;

// Short pathological bait strings. Length 22 keeps the worst-case
// probe under ~100 ms on hot V8; longer would risk a perceptible stall
// on the compile call itself for truly catastrophic patterns.
const REDOS_PROBE_BAITS = [
  'a'.repeat(22),
  `${'a'.repeat(22)}X`,
  `${'a'.repeat(22)}!`,
  'ab'.repeat(11),
  ' '.repeat(22),
];

/**
 * Static heuristic for the two classic ReDoS shapes — nested
 * quantifiers like `(a+)+` and quantified alternations like `(a|aa)+`.
 * Cheap and false-positive-prone in theory, but the patterns it
 * rejects are vanishingly rare in legitimate search use. Combined
 * with the runtime probe it gives us belt-and-suspenders coverage
 * for the cases the probe might miss because of engine-specific
 * optimizations.
 */
function looksLikeCatastrophicBacktracking(pattern: string): boolean {
  // Nested quantifier: `(...)*` or `(...)+` immediately re-quantified.
  if (/\([^)]*[*+?][^)]*\)[*+?]/.test(pattern)) return true;
  // Quantified alternation inside a group: `(a|aa)+`, `(.|x)*`.
  if (/\([^)]*\|[^)]*\)[*+?]/.test(pattern)) return true;
  return false;
}

/**
 * Wall-clock probe against bait strings designed to expose
 * catastrophic backtracking. Returns true when the pattern looks
 * safe; false when any probe blew the budget.
 */
function isPatternEvaluationSafe(re: RegExp): boolean {
  for (const bait of REDOS_PROBE_BAITS) {
    const t0 = performance.now();
    bait.match(re);
    if (performance.now() - t0 > REDOS_PROBE_BUDGET_MS) return false;
  }
  return true;
}

/**
 * Validate a regex pattern without throwing. Returns the compiled
 * pattern string ready for the underlying engine (which builds its
 * own RegExp with case sensitivity flags), or an error message on
 * failure. The underlying extension already escapes when its
 * `disableRegex` option is true, so the wrapper only needs to
 * pre-shape the pattern according to our higher-level flags.
 *
 * For regex/wholeWord patterns we additionally probe for ReDoS
 * (catastrophic backtracking) by running the compiled regex against
 * short pathological bait strings under a wall-clock budget. This
 * shields the UI thread from the multi-second freezes that would
 * happen when the extension runs `matchAll` against real document
 * text with a worst-case pattern like `(a+)+b`.
 */
function compilePattern(
  query: string,
  opts: SearchOptions,
): { ok: true; pattern: string } | { ok: false; error: string; detail: string } {
  if (!query) return { ok: true, pattern: '' };

  let pattern = opts.regex ? query : escapeRegex(query);
  if (opts.wholeWord) pattern = wholeWordPattern(pattern);

  if (opts.regex || opts.wholeWord) {
    let compiled: RegExp;
    try {
      compiled = new RegExp(pattern, opts.caseSensitive ? 'gu' : 'gui');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: INVALID_REGEX, detail: regexErrorReason(msg) };
    }
    if (looksLikeCatastrophicBacktracking(pattern) || !isPatternEvaluationSafe(compiled)) {
      return {
        ok: false,
        error: SLOW_REGEX,
        // The word regex left the interface with #373; the reason follows it.
        detail: 'Pattern may cause performance issues. Try a simpler pattern.',
      };
    }
  }
  return { ok: true, pattern };
}

/**
 * Returns the `Extension` to register on the TipTap editor. The
 * extension itself stores searchTerm/replaceTerm/caseSensitive on
 * `editor.storage.searchAndReplace`; the wrapper below exposes a
 * higher-level API so the rest of the app never reaches into storage.
 */
export function createSearchExtension(): Extension {
  return SearchAndReplace.configure({
    searchResultClass: 'search-result',
    // We always feed pre-shaped patterns into the extension, so its
    // own escape-on-input is disabled. Whole-word + regex flags live
    // in the SearchEngine wrapper rather than at extension level.
    disableRegex: false,
  });
}

export interface SearchEngine {
  search(query: string, opts: SearchOptions): SearchResult;
  findNext(): void;
  findPrevious(): void;
  replace(replacement: string): void;
  replaceAll(replacement: string): void;
  clear(): void;
  /** Cached results from the most recent search, used for confirmation gates. */
  matchCount(): number;
  currentIndex(): number;
  /**
   * Make match `index` (1-based) the current one, clamped to the matches
   * there are, in one transaction rather than one per step (#384).
   */
  goTo(index: number): void;
  lastQuery(): string;
  lastOptions(): SearchOptions;
}

/**
 * Wraps the vendored extension with our search-extension surface:
 * safe regex parsing, whole-word support, and a stable command set
 * (search / findNext / findPrevious / replace / replaceAll / clear)
 * that doesn't leak ProseMirror or TipTap types into the UI layer.
 */
export function createSearchEngine(editor: Editor): SearchEngine {
  let lastQuery = '';
  let lastOpts: SearchOptions = { caseSensitive: false, wholeWord: false, regex: false };

  function storage() {
    return editor.storage.searchAndReplace as
      | { results: Array<{ from: number; to: number }>; resultIndex: number }
      | undefined;
  }

  function scrollCurrentIntoView(): void {
    const s = storage();
    if (!s || s.results.length === 0) return;
    const r = s.results[s.resultIndex];
    if (!r) return;
    // Focus + select so the editor scrolls to the current match,
    // but don't steal focus from the search input — caller restores
    // the focus contract.
    const dom = (editor.view.domAtPos(r.from)?.node as HTMLElement | null) ?? null;
    if (dom && typeof dom.scrollIntoView === 'function') {
      dom.scrollIntoView({ block: 'center', behavior: 'auto' });
    }
  }

  return {
    search(query, opts) {
      const compiled = compilePattern(query, opts);
      if (!compiled.ok) {
        editor.commands.setSearchTerm('');
        return { ok: false, error: compiled.error, detail: compiled.detail };
      }

      lastQuery = query;
      lastOpts = { ...opts };

      editor.commands.setCaseSensitive(opts.caseSensitive);
      editor.commands.setSearchTerm(compiled.pattern);
      editor.commands.resetIndex();

      const s = storage();
      const matches = s?.results.length ?? 0;
      return { ok: true, matches, current: matches > 0 ? 1 : 0 };
    },
    findNext() {
      editor.commands.nextSearchResult();
      scrollCurrentIntoView();
    },
    findPrevious() {
      editor.commands.previousSearchResult();
      scrollCurrentIntoView();
    },
    replace(replacement) {
      editor.commands.setReplaceTerm(replacement);
      editor.commands.replace();
    },
    replaceAll(replacement) {
      editor.commands.setReplaceTerm(replacement);
      editor.commands.replaceAll();
    },
    clear() {
      lastQuery = '';
      editor.commands.setSearchTerm('');
      editor.commands.resetIndex();
    },
    matchCount() {
      return storage()?.results.length ?? 0;
    },
    currentIndex() {
      const s = storage();
      if (!s || s.results.length === 0) return 0;
      return s.resultIndex + 1;
    },
    goTo(index) {
      const s = storage();
      if (!s || s.results.length === 0) return;
      s.resultIndex = Math.min(Math.max(index, 1), s.results.length) - 1;
      // The plugin redraws the current match on the next transaction, and
      // an empty one carries no step, so it reaches no undo history.
      editor.view.dispatch(editor.state.tr);
      scrollCurrentIntoView();
    },
    lastQuery() {
      return lastQuery;
    },
    lastOptions() {
      return { ...lastOpts };
    },
  };
}
