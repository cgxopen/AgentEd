import { beforeEach, describe, expect, it } from 'vitest';
import { ContextCluster } from '../cluster/types';
import { AppState } from './state';

describe('AppState', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with no document loaded', () => {
    const state = new AppState();
    expect(state.filePath).toBeNull();
    expect(state.frontmatter).toBeNull();
    expect(state.modified).toBe(false);
  });

  it('setModified notifies listeners with the new value', () => {
    const state = new AppState();
    const received: boolean[] = [];
    state.onModifiedChange((v) => received.push(v));

    state.setModified(true);
    state.setModified(false);
    expect(received).toEqual([true, false]);
  });

  it('resetDocument clears the per-document fields', () => {
    const state = new AppState();
    state.filePath = '/tmp/x.md';
    state.frontmatter = 'title: x';
    state.isFirstSave = false;
    state.assetsDirCreationDeclined = true;

    state.resetDocument();
    expect(state.filePath).toBeNull();
    expect(state.frontmatter).toBeNull();
    expect(state.isFirstSave).toBe(true);
    expect(state.assetsDirCreationDeclined).toBe(false);
  });

  it('starts with spellcheckEnabled=false', () => {
    expect(new AppState().spellcheckEnabled).toBe(false);
  });

  it('setSpellcheck notifies listeners only on value change', () => {
    const state = new AppState();
    const received: boolean[] = [];
    state.onSpellcheckChange((v) => received.push(v));

    state.setSpellcheck(true);
    state.setSpellcheck(true); // no-op
    state.setSpellcheck(false);
    expect(received).toEqual([true, false]);
  });

  describe('cluster subscription', () => {
    it('starts with a null cluster', () => {
      expect(new AppState().cluster).toBeNull();
    });

    it('setCluster notifies listeners with the new value', () => {
      const state = new AppState();
      const received: Array<ContextCluster | null> = [];
      state.onClusterChange((v) => received.push(v));

      const cluster = ContextCluster.empty('/repo/AGENTS.md');
      state.setCluster(cluster);
      state.setCluster(null);

      expect(received).toEqual([cluster, null]);
    });

    it('beginClusterScan returns a strictly monotonic generation', () => {
      const state = new AppState();
      const a = state.beginClusterScan();
      const b = state.beginClusterScan();
      const c = state.beginClusterScan();
      expect(a).toBeLessThan(b);
      expect(b).toBeLessThan(c);
    });

    it('resetDocument bumps the generation and clears the cluster', () => {
      const state = new AppState();
      state.beginClusterScan();
      state.setCluster(ContextCluster.empty('/x'));
      const before = state.clusterScanGeneration;

      const received: Array<ContextCluster | null> = [];
      state.onClusterChange((v) => received.push(v));

      state.resetDocument();
      expect(state.clusterScanGeneration).toBeGreaterThan(before);
      expect(state.cluster).toBeNull();
      expect(received).toEqual([null]);
    });
  });
});
