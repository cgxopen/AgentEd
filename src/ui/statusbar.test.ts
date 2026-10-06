import type { Editor } from '@tiptap/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Vite's ?raw import — the shipped page as text, no Node APIs and no new dependency.
import shippedPage from '../../index.html?raw';
import { countDocument, setupStatusbar } from './statusbar';

// Deterministic, fast stand-in for the real BPE data (~2 MB): one token per
// whitespace-separated chunk. Token counting itself is not what this file tests.
vi.mock('gpt-tokenizer/encoding/cl100k_base', () => ({
  encode: (text: string) => (text.trim() === '' ? [] : text.trim().split(/\s+/)),
}));

const HEADER_MARKUP = `
  <span id="token-number" class="indicator indicator-primary">–</span>
  <span id="token-unit" class="indicator">tokens</span>
  <span id="word-count" class="indicator">– words</span>
  <span id="char-count" class="indicator">– characters</span>
`;

interface FakeEditor {
  editor: Editor;
  setText: (text: string) => void;
}

function fakeEditor(initial: string): FakeEditor {
  let text = initial;
  const handlers: Array<() => void> = [];
  const editor = {
    state: {
      get doc() {
        return { textContent: text };
      },
    },
    on: (event: string, handler: () => void) => {
      if (event === 'update') handlers.push(handler);
    },
  } as unknown as Editor;

  return {
    editor,
    setText(next: string) {
      text = next;
      for (const handler of handlers) handler();
    },
  };
}

const el = (id: string) => document.getElementById(id) as HTMLElement;

describe('countDocument', () => {
  it('counts words and characters of a plain sentence', () => {
    const counts = countDocument('one two three');
    expect(counts.words).toBe(3);
    expect(counts.chars).toBe(13);
  });

  it('reports zero words for whitespace-only text but keeps the raw length', () => {
    const counts = countDocument('   \n  ');
    expect(counts.words).toBe(0);
    expect(counts.chars).toBe(6);
  });

  it('does not inflate the word count on runs of whitespace', () => {
    expect(countDocument('  one   two  ').words).toBe(2);
  });
});

describe('setupStatusbar — R-C12 counts', () => {
  beforeEach(() => {
    document.body.innerHTML = HEADER_MARKUP;
  });

  it('renders token, word and character counts as visible text', () => {
    const { editor } = fakeEditor('alpha beta gamma');
    setupStatusbar(editor);

    expect(el('token-number').textContent).not.toBe('–');
    expect(el('word-count').textContent).toBe('3 words');
    expect(el('char-count').textContent).toBe('16 characters');
  });

  it('updates all three counts when the document changes', () => {
    const fake = fakeEditor('alpha beta gamma');
    setupStatusbar(fake.editor);

    fake.setText('alpha');

    expect(el('word-count').textContent).toBe('1 word');
    expect(el('char-count').textContent).toBe('5 characters');
  });

  it('shows zeroes on an empty document rather than a placeholder', () => {
    const { editor } = fakeEditor('');
    setupStatusbar(editor);

    expect(el('token-number').textContent).toBe('0');
    expect(el('word-count').textContent).toBe('0 words');
    expect(el('char-count').textContent).toBe('0 characters');
  });

  it('refresh() recomputes on demand, for callers that load a document', () => {
    const fake = fakeEditor('alpha beta gamma');
    const statusbar = setupStatusbar(fake.editor);

    fake.setText('one two');
    // Simulates document-actions/editor-document, which refresh outside editor updates.
    statusbar.refresh();

    expect(el('word-count').textContent).toBe('2 words');
  });

  it('keeps the encoder name in the token tooltip', () => {
    const { editor } = fakeEditor('alpha');
    setupStatusbar(editor);

    expect(el('token-number').title).toContain('cl100k_base');
    expect(el('token-unit').title).toContain('cl100k_base');
  });
});

// The defect in #33 was not a broken computation — the counts were computed and
// then only written into a tooltip, with no element to render them. A unit test
// on a fabricated DOM cannot catch an element missing from the real page, so
// this asserts the shipped markup directly.
describe('index.html header markup', () => {
  it.each(['token-number', 'token-unit', 'word-count', 'char-count'])(
    'ships the "%s" indicator in the header',
    (id) => {
      expect(shippedPage).toContain(`id="${id}"`);
    },
  );
});
