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
    // cl100k_base BPE data lands in the bundle (~2 MB instead of
    // js-tiktoken's all-encodings ~5.4 MB).
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
  // Non-null: these live in index.html and are asserted by header-markup.test.ts.
  // A missing one must fail loudly rather than silently drop a count (#33).
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
 * Wire the statusbar's spell-check toggle.
 *
 *  - Reads the initial state from AppState (always `false` at boot per
 *    R-C9 — no persistence).
 *  - Mirrors changes onto the live `.ProseMirror` element via
 *    `setAttribute('spellcheck', …)` so the toggle is instant: no
 *    editor re-init, no lost selection / undo history.
 *  - Subscribes to `state.onSpellcheckChange` so external mutations
 *    (e.g. future keyboard shortcut) update the label too.
 */
export function setupSpellcheckToggle(state: AppState): void {
  const toggle = document.getElementById('spellcheck-toggle') as HTMLButtonElement | null;
  if (!toggle) return;

  function applyToEditor(enabled: boolean): void {
    const editorEl = document.querySelector<HTMLElement>('.ProseMirror');
    if (editorEl) {
      editorEl.setAttribute('spellcheck', enabled ? 'true' : 'false');
    }
  }

  function render(enabled: boolean): void {
    if (!toggle) return;
    toggle.textContent = enabled ? 'Spell: on' : 'Spell: off';
    toggle.classList.toggle('spellcheck-on', enabled);
    toggle.classList.toggle('spellcheck-off', !enabled);
    toggle.title = enabled
      ? 'Click to disable spell-check'
      : 'Click to enable spell-check for this session';
  }

  toggle.addEventListener('click', () => {
    state.setSpellcheck(!state.spellcheckEnabled);
  });

  state.onSpellcheckChange((enabled) => {
    render(enabled);
    applyToEditor(enabled);
  });

  render(state.spellcheckEnabled);
  applyToEditor(state.spellcheckEnabled);
}
