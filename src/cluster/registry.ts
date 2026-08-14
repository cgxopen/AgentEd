import type { ContextFileKind } from './types';

/**
 * Canonical list of context-file filenames that the cluster detector
 * recognises.
 *
 * `caseSensitive` controls the match. All current entries are
 * case-sensitive — they reflect ecosystem conventions where the
 * canonical filename is fixed (e.g. `AGENTS.md`, not `agents.md`).
 *
 * Entries are matched in order; the first hit wins. Two entries can
 * share a `kind` (e.g. `.hermes.md` and `HERMES.md` both map to
 * `hermes-context`).
 */
interface CanonicalEntry {
  readonly filename: string;
  readonly kind: ContextFileKind;
  readonly caseSensitive: boolean;
}

const CANONICAL: ReadonlyArray<CanonicalEntry> = [
  { filename: 'AGENTS.md', kind: 'agents-md', caseSensitive: true },
  { filename: 'CLAUDE.md', kind: 'claude-md', caseSensitive: true },
  { filename: '.hermes.md', kind: 'hermes-context', caseSensitive: true },
  { filename: 'HERMES.md', kind: 'hermes-context', caseSensitive: true },
  { filename: '.cursorrules', kind: 'cursor-rules', caseSensitive: true },
  { filename: 'SOUL.md', kind: 'hermes-soul', caseSensitive: true },
];

/**
 * Resolve a filename to its `ContextFileKind`, or `null` if the
 * filename is not a recognised context-file convention.
 *
 * Pure string match — no filesystem access, no path normalisation.
 * Callers must pass the basename, not a full path.
 */
export function getKindForFilename(name: string): ContextFileKind | null {
  for (const entry of CANONICAL) {
    if (entry.caseSensitive) {
      if (entry.filename === name) return entry.kind;
    } else if (entry.filename.toLowerCase() === name.toLowerCase()) {
      return entry.kind;
    }
  }
  return null;
}

/**
 * Snapshot of the canonical filenames the detector should probe in
 * each candidate directory. Returned as a fresh array so callers can
 * iterate without copy concerns; the underlying registry is constant.
 */
export function getCanonicalFilenames(): string[] {
  return CANONICAL.map((entry) => entry.filename);
}
