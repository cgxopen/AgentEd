import type { Editor } from '@tiptap/core';
import type { AppState } from '../app/state';

type TiktokenEncoder = { encode: (text: string) => number[] };

const ENCODER_NAME = 'cl100k_base';

let encoder: TiktokenEncoder | null = null;
let encoderLoading = false;

async function loadEncoder(): Promise<void> {
  if (encoder || encoderLoading) return;
  encoderLoading = true;
  try {
    // gpt-tokenizer ships per-encoding entry points so only the
    // cl100k_base BPE data lands in the Vite bundle (974210 bytes in
    // `dist`, measured at #650, instead of js-tiktoken's all-encodings
    // ~5.4 MB).
    const tokenizer = await import('gpt-tokenizer/encoding/cl100k_base');
    encoder = { encode: tokenizer.encode };
  } catch (e) {
    console.warn('tokenizer load failed, using estimate:', e);
  }
  encoderLoading = false;
}

function countTokens(text: string): number {
  if (!encoder) return Math.ceil(text.length / 4);
  try {
    return encoder.encode(text).length;
  } catch {
    return Math.ceil(text.length / 4);
  }
}

export interface Statusbar {
  refresh: () => void;
}

/** Counts derived from the document text, as R-C12 lists them. */
export interface DocumentCounts {
  tokens: number;
  words: number;
  chars: number;
}

export function countDocument(text: string): DocumentCounts {
  const trimmed = text.trim();
  return {
    tokens: countTokens(text),
    words: trimmed === '' ? 0 : trimmed.split(/\s+/).length,
    chars: text.length,
  };
}

function plural(count: number, unit: string): string {
  return `${count.toLocaleString()} ${unit}${count === 1 ? '' : 's'}`;
}

export function setupStatusbar(editor: Editor): Statusbar {
  // Non-null: these live in index.html, and header-button-family.test.ts reads
  // all four out of it. A missing one throws at the first refresh, below, rather
  // than silently dropping a count (#33).
  const tokenNumberEl = document.getElementById('token-number')!;
  const tokenUnitEl = document.getElementById('token-unit')!;
  const wordCountEl = document.getElementById('word-count')!;
  const charCountEl = document.getElementById('char-count')!;

  function refresh() {
    const { tokens, words, chars } = countDocument(editor.state.doc.textContent);

    const tokensFmt = tokens.toLocaleString();

    tokenNumberEl.textContent = tokensFmt;
    // Same tooltip on number + unit so hovering either names the encoding.
    const tooltip = `${tokensFmt} tokens (${ENCODER_NAME})`;
    tokenNumberEl.title = tooltip;
    tokenUnitEl.title = tooltip;

    // Word and character counts are visible text, not tooltip-only: they are
    // part of the header per R-C12, and the overflow popover clones the label
    // when the breakpoint hides them.
    wordCountEl.textContent = plural(words, 'word');
    charCountEl.textContent = plural(chars, 'character');
  }

  void loadEncoder().then(refresh).catch(console.error);
  editor.on('update', refresh);
  refresh();

  return { refresh };
}

/**
 * Keep the spell-check entry of the Edit menu, and the editor, in step with
 * the session setting (#360; it was a header button until then).
 *
 *  - Reads the initial state from AppState (always `false` at boot per
 *    R-C9 — no persistence).
 *  - Mirrors changes onto the live `.ProseMirror` element via
 *    `setAttribute('spellcheck', …)` so the toggle is instant: no
 *    editor re-init, no lost selection / undo history.
 *  - Writes the state onto the entry whenever the setting changes, through
 *    `state.onSpellcheckChange`, so the entry never has to be read when the
 *    menu opens: it is never greyed, and the reading `refreshEntries` makes
 *    there exists for the focus selector, which skips greyed entries only.
 *
 * **The entry is the first checkable one in the menu, and its shape is the
 * owner decision of 2026-09-18**: the label stays **Spell check** and the
 * state is a word on the right, **On** or **Off**, in the column the shortcuts
 * use. `aria-pressed` says the same to a screen reader, the precedent of the
 * search toggles, and the word is hidden from it so the state is not read
 * twice. The click is bound by `setupMenu` to `spellcheckMenuCallbacks`
 * below, and **leaves the menu open** so the new state is seen where it was
 * chosen (owner decision of 2026-09-18, the rule for a checkable entry).
 */
export function setupSpellcheckToggle(state: AppState): void {
  const entry = document.getElementById('menu-spellcheck');
  const word = entry?.querySelector('.menu-state');
  if (!entry || !word) throw new Error('the Edit menu has no spell-check entry');

  function applyToEditor(enabled: boolean): void {
    const editorEl = document.querySelector<HTMLElement>('.ProseMirror');
    if (editorEl) {
      editorEl.setAttribute('spellcheck', enabled ? 'true' : 'false');
    }
  }

  function render(enabled: boolean): void {
    entry?.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    if (word) word.textContent = enabled ? 'On' : 'Off';
  }

  state.onSpellcheckChange((enabled) => {
    render(enabled);
    applyToEditor(enabled);
  });

  render(state.spellcheckEnabled);
  applyToEditor(state.spellcheckEnabled);
}

/**
 * What choosing the entry does: turn the session setting over (#360). Spread
 * into `setupMenu` by `main.ts`, the way the other entries that own their
 * command are, so a test reaches the command the application runs.
 */
export function spellcheckMenuCallbacks(state: AppState): { onToggleSpellcheck: () => void } {
  return {
    onToggleSpellcheck: () => state.setSpellcheck(!state.spellcheckEnabled),
  };
}
