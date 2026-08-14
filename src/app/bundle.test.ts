import { describe, expect, it } from 'vitest';
import type { ContextCluster } from '../cluster/types';
import type { FileEntry, FileResult, PlatformIO } from '../platform/types';
import { scheduleClusterDetection } from './bundle';
import type { AppContext } from './context';
import { AppState } from './state';

/**
 * Stub IO that resolves `exists` after a configurable delay so we can
 * orchestrate rapid scan succession deterministically. Only the
 * methods touched by the detector are real; the rest throw.
 */
class SlowIO implements PlatformIO {
  readonly supportsMultiFile = false;
  private readonly hits: Set<string>;
  private readonly delayMs: number;

  constructor(hits: Set<string>, delayMs: number) {
    this.hits = hits;
    this.delayMs = delayMs;
  }

  async exists(path: string): Promise<boolean> {
    await wait(this.delayMs);
    return this.hits.has(path);
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
  async saveFileAs(): Promise<string | null> {
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
  // Only the state field of AppContext is consumed by
  // scheduleClusterDetection; the rest stays uninitialised.
  return { state } as AppContext;
}

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
