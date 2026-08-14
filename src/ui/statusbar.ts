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

export function setupStatusbar(editor: Editor): Statusbar {
  const tokenNumberEl = document.getElementById('token-number')!;
  const tokenUnitEl = document.getElementById('token-unit')!;

  function refresh() {
    const text = editor.state.doc.textContent;
    const chars = text.length;
    const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
    const tokens = countTokens(text);

    const tokensFmt = tokens.toLocaleString();
    const wordsFmt = words.toLocaleString();
    const charsFmt = chars.toLocaleString();

    tokenNumberEl.textContent = tokensFmt;
    // Same tooltip on number + unit so hovering either reveals the full stats.
    const tooltip = `${tokensFmt} tokens (${ENCODER_NAME})\n${wordsFmt} words\n${charsFmt} characters`;
    tokenNumberEl.title = tooltip;
    tokenUnitEl.title = tooltip;
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
