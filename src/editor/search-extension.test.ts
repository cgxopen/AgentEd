import type { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import {
  createSearchEngine,
  INVALID_REGEX,
  regexErrorReason,
  type SearchOptions,
  SLOW_REGEX,
} from './search-extension';

interface FakeStorage {
  results: Array<{ from: number; to: number }>;
  resultIndex: number;
}

/**
 * Build a minimal Editor stub. The wrapper only ever touches:
 *   - editor.commands.{setSearchTerm,setReplaceTerm,setCaseSensitive,
 *       resetIndex,nextSearchResult,previousSearchResult,replace,replaceAll}
 *   - editor.storage.searchAndReplace.{results,resultIndex}
 *   - editor.view.domAtPos (for scroll; we ignore here)
 * Anything else throws if accidentally invoked.
 */
function fakeEditor(storage: FakeStorage, captured: { calls: string[] }): Editor {
  const stub = {
    storage: { searchAndReplace: storage },
    view: { domAtPos: () => ({ node: null }) },
    commands: {
      setSearchTerm: (s: string) => {
        captured.calls.push(`setSearchTerm:${s}`);
        return true;
      },
      setReplaceTerm: (s: string) => {
        captured.calls.push(`setReplaceTerm:${s}`);
        return true;
      },
      setCaseSensitive: (b: boolean) => {
        captured.calls.push(`setCaseSensitive:${b}`);
        return true;
      },
      resetIndex: () => {
        storage.resultIndex = 0;
        captured.calls.push('resetIndex');
        return true;
      },
      nextSearchResult: () => {
        storage.resultIndex = (storage.resultIndex + 1) % Math.max(1, storage.results.length);
        captured.calls.push('nextSearchResult');
        return true;
      },
      previousSearchResult: () => {
        storage.resultIndex =
          storage.resultIndex === 0 ? storage.results.length - 1 : storage.resultIndex - 1;
        captured.calls.push('previousSearchResult');
        return true;
      },
      replace: () => {
        captured.calls.push('replace');
        return true;
      },
      replaceAll: () => {
        captured.calls.push('replaceAll');
        return true;
      },
      focus: () => true,
    },
  };
  return stub as unknown as Editor;
}

function opts(partial: Partial<SearchOptions> = {}): SearchOptions {
  return { caseSensitive: false, wholeWord: false, regex: false, ...partial };
}

describe('createSearchEngine — pattern compilation', () => {
  it('returns ok with zero matches when storage is empty', () => {
    const storage: FakeStorage = { results: [], resultIndex: 0 };
    const calls = { calls: [] as string[] };
    const engine = createSearchEngine(fakeEditor(storage, calls));
    const r = engine.search('cat', opts());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.matches).toBe(0);
      expect(r.current).toBe(0);
    }
  });

  it('reports matches + current=1 when storage has results', () => {
    const storage: FakeStorage = {
      results: [
        { from: 1, to: 4 },
        { from: 10, to: 13 },
      ],
      resultIndex: 0,
    };
    const engine = createSearchEngine(fakeEditor(storage, { calls: [] }));
    const r = engine.search('cat', opts());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.matches).toBe(2);
      expect(r.current).toBe(1);
    }
  });

  it('escapes regex metacharacters when regex toggle is off', () => {
    const calls = { calls: [] as string[] };
    const engine = createSearchEngine(fakeEditor({ results: [], resultIndex: 0 }, calls));
    engine.search('a.b+c', opts());
    // The wrapper must hand the engine a pre-escaped pattern.
    expect(calls.calls).toContain('setSearchTerm:a\\.b\\+c');
  });

  it('passes the raw pattern through when regex toggle is on', () => {
    const calls = { calls: [] as string[] };
    const engine = createSearchEngine(fakeEditor({ results: [], resultIndex: 0 }, calls));
    engine.search('\\b\\w+\\b', opts({ regex: true }));
    expect(calls.calls).toContain('setSearchTerm:\\b\\w+\\b');
  });

  it('wraps the pattern in word boundaries when wholeWord is on', () => {
    const calls = { calls: [] as string[] };
    const engine = createSearchEngine(fakeEditor({ results: [], resultIndex: 0 }, calls));
    engine.search('cat', opts({ wholeWord: true }));
    expect(calls.calls.some((c) => c.startsWith('setSearchTerm:\\b(?:cat)\\b'))).toBe(true);
  });

  it('escapes then word-bounds when both regex=off and wholeWord=on', () => {
    const calls = { calls: [] as string[] };
    const engine = createSearchEngine(fakeEditor({ results: [], resultIndex: 0 }, calls));
    engine.search('a.b', opts({ wholeWord: true }));
    expect(calls.calls).toContain('setSearchTerm:\\b(?:a\\.b)\\b');
  });

  it('propagates caseSensitive into the engine', () => {
    const calls = { calls: [] as string[] };
    const engine = createSearchEngine(fakeEditor({ results: [], resultIndex: 0 }, calls));
    engine.search('cat', opts({ caseSensitive: true }));
    expect(calls.calls).toContain('setCaseSensitive:true');
  });

  it('clears the engine on an empty query — but search() with empty returns ok:true', () => {
    const calls = { calls: [] as string[] };
    const engine = createSearchEngine(fakeEditor({ results: [], resultIndex: 0 }, calls));
    const r = engine.search('', opts());
    expect(r.ok).toBe(true);
    expect(calls.calls).toContain('setSearchTerm:');
  });
});

describe('createSearchEngine — regex safety', () => {
  it('returns ok:false with an error message on an unbalanced bracket', () => {
    const engine = createSearchEngine(fakeEditor({ results: [], resultIndex: 0 }, { calls: [] }));
    const r = engine.search('[a-', opts({ regex: true }));
    expect(r.ok).toBe(false);
    // The label is constant (#373); what the bracket was is in the reason.
    if (!r.ok) {
      expect(r.error).toBe(INVALID_REGEX);
      expect(r.detail.toLowerCase()).toMatch(/character class|bracket|unterminated/);
    }
  });

  it('returns ok:false on a dangling backref', () => {
    const engine = createSearchEngine(fakeEditor({ results: [], resultIndex: 0 }, { calls: [] }));
    const r = engine.search('(?<', opts({ regex: true }));
    expect(r.ok).toBe(false);
  });

  it('does not throw on invalid regex (returns discriminated union instead)', () => {
    const engine = createSearchEngine(fakeEditor({ results: [], resultIndex: 0 }, { calls: [] }));
    expect(() => engine.search('[invalid', opts({ regex: true }))).not.toThrow();
  });

  it('accepts a valid regex with no errors', () => {
    const engine = createSearchEngine(fakeEditor({ results: [], resultIndex: 0 }, { calls: [] }));
    const r = engine.search('\\b\\w+\\b', opts({ regex: true }));
    expect(r.ok).toBe(true);
  });

  it('rejects ReDoS catastrophic backtracking pattern (a+)+b', () => {
    const engine = createSearchEngine(fakeEditor({ results: [], resultIndex: 0 }, { calls: [] }));
    const t0 = performance.now();
    const r = engine.search('(a+)+b', opts({ regex: true }));
    const elapsed = performance.now() - t0;
    expect(r.ok).toBe(false);
    // The label is short and constant (#373); the sentence is the reason.
    if (!r.ok) {
      expect(r.error).toBe(SLOW_REGEX);
      expect(r.detail.toLowerCase()).toMatch(/performance|simpler/);
    }
    // The probe-based guard must itself terminate well below the multi-second
    // freeze that would otherwise occur against real document text.
    expect(elapsed).toBeLessThan(2000);
  });

  it('rejects nested-quantifier ReDoS pattern (a|aa)+$', () => {
    const engine = createSearchEngine(fakeEditor({ results: [], resultIndex: 0 }, { calls: [] }));
    const r = engine.search('^(a|aa)+$', opts({ regex: true }));
    expect(r.ok).toBe(false);
  });

  it('accepts complex but linear regex (email-like)', () => {
    const engine = createSearchEngine(fakeEditor({ results: [], resultIndex: 0 }, { calls: [] }));
    const r = engine.search('\\b\\w+@\\w+\\.\\w+\\b', opts({ regex: true }));
    expect(r.ok).toBe(true);
  });

  it('clears the searchTerm in storage when regex is invalid', () => {
    const calls = { calls: [] as string[] };
    const engine = createSearchEngine(fakeEditor({ results: [], resultIndex: 0 }, calls));
    engine.search('[bad', opts({ regex: true }));
    // The wrapper must reset the searchTerm so stale highlights from a
    // previous valid pattern don't linger after the user types into a
    // broken regex.
    expect(calls.calls).toContain('setSearchTerm:');
  });
});

describe('createSearchEngine — navigation + commands', () => {
  it('findNext walks to the next result and wraps around', () => {
    const storage: FakeStorage = {
      results: [
        { from: 1, to: 4 },
        { from: 10, to: 13 },
      ],
      resultIndex: 0,
    };
    const engine = createSearchEngine(fakeEditor(storage, { calls: [] }));
    engine.findNext();
    expect(storage.resultIndex).toBe(1);
    engine.findNext();
    expect(storage.resultIndex).toBe(0);
  });

  it('findPrevious walks backwards and wraps to the last match', () => {
    const storage: FakeStorage = {
      results: [
        { from: 1, to: 4 },
        { from: 10, to: 13 },
        { from: 30, to: 33 },
      ],
      resultIndex: 0,
    };
    const engine = createSearchEngine(fakeEditor(storage, { calls: [] }));
    engine.findPrevious();
    expect(storage.resultIndex).toBe(2);
  });

  it('replace forwards the replacement and triggers the replace command', () => {
    const calls = { calls: [] as string[] };
    const engine = createSearchEngine(
      fakeEditor({ results: [{ from: 1, to: 4 }], resultIndex: 0 }, calls),
    );
    engine.replace('astonishing');
    expect(calls.calls).toContain('setReplaceTerm:astonishing');
    expect(calls.calls).toContain('replace');
  });

  it('replaceAll forwards the replacement and triggers replaceAll', () => {
    const calls = { calls: [] as string[] };
    const engine = createSearchEngine(
      fakeEditor({ results: [{ from: 1, to: 4 }], resultIndex: 0 }, calls),
    );
    engine.replaceAll('x');
    expect(calls.calls).toContain('setReplaceTerm:x');
    expect(calls.calls).toContain('replaceAll');
  });

  it('clear() wipes the searchTerm and remembered query', () => {
    const calls = { calls: [] as string[] };
    const engine = createSearchEngine(fakeEditor({ results: [], resultIndex: 0 }, calls));
    engine.search('cat', opts());
    engine.clear();
    expect(engine.lastQuery()).toBe('');
    expect(calls.calls.filter((c) => c.startsWith('setSearchTerm:'))).toContain('setSearchTerm:');
  });

  it('lastQuery + lastOptions survive across searches until clear', () => {
    const engine = createSearchEngine(fakeEditor({ results: [], resultIndex: 0 }, { calls: [] }));
    engine.search('cat', opts({ caseSensitive: true }));
    expect(engine.lastQuery()).toBe('cat');
    expect(engine.lastOptions().caseSensitive).toBe(true);
  });
});

describe('a refused pattern says a short label and its reason (#373)', () => {
  const engine = () =>
    createSearchEngine(fakeEditor({ results: [], resultIndex: 0 }, { calls: [] }));

  it('labels a pattern that does not parse with one constant word pair', () => {
    for (const query of ['(', '[a-', '(?<', 'a{2,1}']) {
      const r = engine().search(query, opts({ regex: true }));
      expect(r.ok, query).toBe(false);
      if (!r.ok) expect(r.error, query).toBe(INVALID_REGEX);
    }
  });

  it('gives the reason without the pattern AgentEd built, whole word or not', () => {
    // The owner capture: an open parenthesis with whole word and regex on
    // showed the wrapper `\\b(?:()\\b` and the flags to the user.
    for (const wholeWord of [false, true]) {
      const r = engine().search('(', opts({ regex: true, wholeWord }));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.detail, `whole word ${wholeWord}`).toBe('Unterminated group');
        expect(r.detail).not.toMatch(/\/|\(\?:/);
      }
    }
  });
});

describe('regexErrorReason (#373)', () => {
  it('takes the Chromium prefix and the pattern off, even a pattern holding slashes', () => {
    expect(regexErrorReason('Invalid regular expression: /a\\/b(/gu: Unterminated group')).toBe(
      'Unterminated group',
    );
  });

  it('returns any other shape whole, since it only reaches a tooltip', () => {
    expect(regexErrorReason('missing )')).toBe('missing )');
    expect(regexErrorReason('Invalid regular expression: missing )')).toBe(
      'Invalid regular expression: missing )',
    );
  });
});
