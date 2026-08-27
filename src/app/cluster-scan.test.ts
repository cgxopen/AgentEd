/**
 * Issue #130 — a Refresh that finds nothing used to find nothing *and
 * say nothing*, while the indicator behind it vanished carrying its old
 * count.
 *
 * The scan is one function; the obligation is two. An automatic scan —
 * on open, on a document switch — was never asked a question and stays
 * silent whatever it finds, because speaking would put a message in
 * front of every plain document, which is the case R-C12 keeps clean.
 * A **Refresh** is a question, and a question that vanishes instead of
 * answering is the silent failure this project keeps deciding against
 * (#13, #24, #40, #46, #51, #58, #61).
 *
 * The mutation these are here to catch: take the speaking out of
 * `refreshClusterDetection` and the gesture tests go red; put it into
 * `scheduleClusterDetection` and the silence tests go red. Neither can
 * be satisfied by the same code.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextCluster } from '../cluster/types';
import type {
  EntryPresence,
  FileEntry,
  FileResult,
  FileSnapshot,
  PlatformIO,
} from '../platform/types';
import {
  NOTHING_RELATED_FOUND,
  refreshClusterDetection,
  reportNothingRelated,
  scheduleClusterDetection,
} from './cluster-scan';
import type { AppContext } from './context';
import { AppState } from './state';

const toasts = vi.hoisted(() => ({ shown: [] as Array<{ message: string; kind?: string }> }));
vi.mock('../ui/toast', () => ({
  showToast: (message: string, kind?: string) => {
    toasts.shown.push({ message, kind });
  },
}));

/**
 * Stub IO that resolves `entryPresence` after a configurable delay so we can
 * orchestrate rapid scan succession deterministically. Only the
 * methods touched by the detector are real; the rest throw.
 */
class SlowIO implements PlatformIO {
  readonly supportsMultiFile = false;

  async canWriteCompanions(): Promise<boolean> {
    return false;
  }
  private readonly hits: Set<string>;
  private readonly delayMs: number;

  constructor(hits: Set<string>, delayMs: number) {
    this.hits = hits;
    this.delayMs = delayMs;
  }

  async entryPresence(path: string): Promise<EntryPresence> {
    await wait(this.delayMs);
    return this.hits.has(path) ? 'present' : 'absent';
  }

  async listDir(_path: string): Promise<FileEntry[]> {
    return [];
  }

  async openFile(): Promise<FileResult | null> {
    throw new Error('not implemented');
  }
  async pickFile(): Promise<string | null> {
    throw new Error('not implemented');
  }
  async readText(): Promise<string> {
    throw new Error('not implemented');
  }
  async saveFile(): Promise<void> {
    throw new Error('not implemented');
  }
  async readSnapshot(): Promise<FileSnapshot> {
    throw new Error('not implemented');
  }
  async pickSavePath(): Promise<string | null> {
    throw new Error('not implemented');
  }
  async installCloseGuard(): Promise<void> {
    throw new Error('not implemented');
  }
  async readBinary(): Promise<Uint8Array> {
    throw new Error('not implemented');
  }
  async writeBinary(): Promise<void> {
    throw new Error('not implemented');
  }
  async mkdir(): Promise<void> {
    throw new Error('not implemented');
  }
  async remove(): Promise<void> {
    throw new Error('not implemented');
  }
  async openWithSystem(): Promise<void> {
    throw new Error('not implemented');
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeCtx(state: AppState): AppContext {
  // Only the state field of AppContext is consumed by the scans; the
  // rest stays uninitialised.
  return { state } as AppContext;
}

beforeEach(() => {
  toasts.shown = [];
});

describe('scheduleClusterDetection — generation guard', () => {
  it('drops the result when a newer scan supersedes the previous one', async () => {
    const state = new AppState();
    const ctx = makeCtx(state);

    const slow = new SlowIO(new Set(['/old/AGENTS.md']), 30);
    const fast = new SlowIO(new Set(['/new/AGENTS.md']), 1);

    const received: Array<ContextCluster | null> = [];
    state.onClusterChange((c) => received.push(c));

    scheduleClusterDetection('/old/file.md', ctx, slow);
    // Schedule a second scan immediately — its generation supersedes the first.
    scheduleClusterDetection('/new/file.md', ctx, fast);

    // Wait long enough for both promises to settle.
    await wait(80);

    // The "new" scan committed; the "old" one bailed silently.
    expect(received).toHaveLength(1);
    const final = state.cluster;
    expect(final?.entries.some((e) => e.path === '/new/AGENTS.md')).toBe(true);
    expect(final?.entries.some((e) => e.path === '/old/AGENTS.md')).toBe(false);
  });

  it('still commits the result when only one scan is in flight', async () => {
    const state = new AppState();
    const ctx = makeCtx(state);
    const io = new SlowIO(new Set(['/repo/AGENTS.md']), 1);

    scheduleClusterDetection('/repo/notes.md', ctx, io);
    await wait(40);

    expect(state.cluster?.entries.some((e) => e.path === '/repo/AGENTS.md')).toBe(true);
  });
});

describe('#130 — a Refresh answers, an automatic scan does not', () => {
  it('says so when the scan the user asked for finds nothing', async () => {
    const state = new AppState();
    const ctx = makeCtx(state);
    // Nothing is present anywhere: the state a revoked folder grant
    // produces, and the state a deleted CLAUDE.md produces on the
    // desktop. The scan cannot tell them apart and does not try.
    const io = new SlowIO(new Set(), 1);

    await refreshClusterDetection('/repo/notes.md', ctx, io);

    expect(state.cluster?.relatedCount).toBe(0);
    expect(toasts.shown).toEqual([{ message: NOTHING_RELATED_FOUND, kind: 'info' }]);
  });

  it('speaks once per press, not once per scan', async () => {
    const state = new AppState();
    const ctx = makeCtx(state);
    const io = new SlowIO(new Set(), 1);

    await refreshClusterDetection('/repo/notes.md', ctx, io);
    await refreshClusterDetection('/repo/notes.md', ctx, io);

    expect(toasts.shown).toHaveLength(2);
  });

  it('stays quiet when the scan the user asked for finds something', async () => {
    const state = new AppState();
    const ctx = makeCtx(state);
    const io = new SlowIO(new Set(['/repo/AGENTS.md']), 1);

    await refreshClusterDetection('/repo/notes.md', ctx, io);

    expect(state.cluster?.relatedCount).toBe(1);
    expect(toasts.shown).toEqual([]);
  });

  it('stays quiet when a newer scan superseded the one it asked for', async () => {
    // The user opened another document while this was in flight. The
    // answer is no longer about anything they are looking at, so it is
    // neither committed nor announced.
    const state = new AppState();
    const ctx = makeCtx(state);
    const slow = new SlowIO(new Set(), 30);
    const fast = new SlowIO(new Set(['/new/AGENTS.md']), 1);

    const pending = refreshClusterDetection('/old/notes.md', ctx, slow);
    scheduleClusterDetection('/new/notes.md', ctx, fast);
    await pending;
    await wait(60);

    expect(toasts.shown).toEqual([]);
    expect(state.cluster?.entries.some((e) => e.path === '/new/AGENTS.md')).toBe(true);
  });

  it('an automatic scan that finds nothing says nothing', async () => {
    // The document nobody asked about: no context files beside it, and
    // no badge, and no message. Reverse this and every plain document in
    // the product gets a toast on open.
    const state = new AppState();
    const ctx = makeCtx(state);
    const io = new SlowIO(new Set(), 1);

    scheduleClusterDetection('/repo/notes.md', ctx, io);
    await wait(40);

    expect(state.cluster?.relatedCount).toBe(0);
    expect(toasts.shown).toEqual([]);
  });

  it('the sentence names an action and not a mechanism', () => {
    // The #46 test, kept as an assertion rather than a habit: the user
    // is told what to do, never what the application observed.
    expect(NOTHING_RELATED_FOUND).toBe(
      'No related context files found — reopen the document to look again.',
    );
    for (const jargon of ['grant', 'permission', 'scan', 'cluster', 'handle', 'API']) {
      expect(NOTHING_RELATED_FOUND.toLowerCase()).not.toContain(jargon.toLowerCase());
    }
  });

  it('the popover asked to open with nothing to show says the same thing', () => {
    // Unreachable by arrangement — at count 0 the indicator is withdrawn
    // and the overflow menu does not offer it. Pinned so the branch stays
    // audible if some later arrangement routes a click back into it.
    reportNothingRelated();

    expect(toasts.shown).toEqual([{ message: NOTHING_RELATED_FOUND, kind: 'info' }]);
  });
});
