import { collapseDotSegments, dirname, joinPath, normalize } from '../platform/paths';
import type { EntryPresence, PlatformIO } from '../platform/types';
import { getCanonicalFilenames, getKindForFilename } from './registry';
import { type ClusterDirection, ContextCluster, type ContextFileEntry } from './types';

/** Walk-up depth cap (R-A2: at most 5 levels up). */
export const MAX_DEPTH_UP = 5;
/** Maximum sibling/child directories per listed parent. */
export const MAX_CHILDREN = 50;
/** Hard cap on returned entries. */
export const MAX_RESULTS = 20;
/**
 * Hard wall-clock budget for a single detection pass.
 * Probes that haven't resolved in time are dropped from the result —
 * the popover prefers a quick partial answer to a slow full one.
 */
export const HARD_TIMEOUT_MS = 100;

/**
 * Build-artifact / dependency / IDE directory names skipped when
 * listing siblings + children. None of these contain semantic agent
 * context files; scanning them wastes I/O.
 *
 * `.cursor/` is intentionally NOT here — `.cursor/rules/*.mdc` is a
 * canonical pattern (deferred to a follow-up: see M0 plan).
 */
const HIDDEN_DIRS: ReadonlySet<string> = new Set([
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  '.next',
  '.nuxt',
  '.turbo',
  '.svelte-kit',
  '.vercel',
  '.cache',
  '.pytest_cache',
  '__pycache__',
  '.venv',
  'venv',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.idea',
  '.vscode',
  '.DS_Store',
]);

interface ScanDir {
  readonly path: string;
  readonly distance: number;
  readonly direction: ClusterDirection;
}

/**
 * Discover canonical context files in the tree around `currentPath`.
 *
 * Pure function over `PlatformIO`. Returns an immutable `ContextCluster`
 * sorted by ascending distance (with tie-breaking by registration
 * order in the canonical filename list).
 *
 * Algorithm:
 *   1. Build the set of directories to probe = currentDir
 *      + ancestors (up to MAX_DEPTH_UP)
 *      + immediate children of currentDir
 *      + siblings (children of the immediate parent)
 *   2. For each directory, probe each canonical filename via
 *      `io.entryPresence`, and name only the ones found `present` (#126)
 *   3. Skip the open document itself
 *   4. Sort + cap at MAX_RESULTS
 *
 * I/O failures (missing dirs, permission errors) are swallowed and
 * yield empty / partial results — the popover degrades gracefully.
 */
export async function detectContextCluster(
  currentPath: string,
  io: PlatformIO,
  options: { timeoutMs?: number } = {},
): Promise<ContextCluster> {
  // Collapse `..` and `.` once at the boundary so the walk can't be
  // tricked into stepping outside the visible tree. We never construct
  // paths with `..` ourselves; this defends against caller-supplied
  // currentPath values that already contain them.
  const normalisedCurrent = collapseDotSegments(normalize(currentPath));
  if (normalisedCurrent.length === 0) return ContextCluster.empty(normalisedCurrent);

  const currentDir = dirname(normalisedCurrent);
  if (currentDir.length === 0) return ContextCluster.empty(normalisedCurrent);

  const scanDirs = await collectScanDirs(currentDir, io);
  const filenames = getCanonicalFilenames();

  const hits: ContextFileEntry[] = [];
  const collectors = scanDirs.flatMap((scan) =>
    filenames.map(async (filename) => {
      const entry = await probeOne(scan, filename, normalisedCurrent, currentDir, io);
      if (entry !== null) hits.push(entry);
    }),
  );

  const timeoutMs = options.timeoutMs ?? HARD_TIMEOUT_MS;
  // The race bounds the wait, not the run. Every collector is already in
  // flight before it starts and nothing cancels them, so the timeout
  // decides when the caller stops listening and not when the filesystem
  // stops being asked. Their *number* is bounded: at most 106 directories
  // (currentDir, plus MAX_DEPTH_UP ancestors, plus two rounds of
  // MAX_CHILDREN for children and siblings) times the 6 canonical
  // filenames in `registry.ts`, so at most 636 probes. Their duration is
  // not — a slow network share makes each probe slow rather than making
  // more of them. Probes that land after the timeout push into `hits`
  // after its slice has been taken and returned; nothing reads those
  // writes, and the array is unreachable once the last one settles.
  await Promise.race([Promise.all(collectors), wait(timeoutMs)]);

  hits.sort((a, b) => a.distance - b.distance);
  return new ContextCluster(normalisedCurrent, hits.slice(0, MAX_RESULTS));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function collectScanDirs(currentDir: string, io: PlatformIO): Promise<ScanDir[]> {
  const seen = new Map<string, ScanDir>();
  add(seen, { path: currentDir, distance: 0, direction: 'self' });

  // Walk up ancestors. `dirname('/')` and `dirname('')` both terminate
  // the loop because the result equals the input or is empty.
  let cursor = currentDir;
  for (let depth = 1; depth <= MAX_DEPTH_UP; depth++) {
    const parent = dirname(cursor);
    if (parent.length === 0 || parent === cursor) break;
    add(seen, { path: parent, distance: depth, direction: 'ancestor' });
    cursor = parent;
  }

  // Immediate children of currentDir → "child" entries (distance 1).
  await addChildren(seen, currentDir, 1, 'child', io);

  // Siblings: children of the direct parent (distance 1) other than
  // currentDir itself. Without this step a file at depth N can't see
  // its peer at the same depth — the reference example explicitly
  // shows this case (frontend/AGENTS.md ↔ backend/AGENTS.md).
  const directParent = dirname(currentDir);
  if (directParent.length > 0 && directParent !== currentDir) {
    await addChildren(seen, directParent, 1, 'sibling', io, currentDir);
  }

  return Array.from(seen.values());
}

function add(seen: Map<string, ScanDir>, scan: ScanDir): void {
  const existing = seen.get(scan.path);
  if (existing && existing.distance <= scan.distance) return;
  seen.set(scan.path, scan);
}

async function addChildren(
  seen: Map<string, ScanDir>,
  parent: string,
  distance: number,
  direction: ClusterDirection,
  io: PlatformIO,
  excludePath?: string,
): Promise<void> {
  let entries: Awaited<ReturnType<PlatformIO['listDir']>>;
  try {
    entries = await io.listDir(parent);
  } catch {
    return; // Missing dir or permission denied — partial result is fine.
  }
  let added = 0;
  for (const entry of entries) {
    if (added >= MAX_CHILDREN) break;
    if (!entry.isDirectory) continue;
    if (HIDDEN_DIRS.has(entry.name)) continue;
    const childPath = normalize(entry.path);
    if (childPath === excludePath) continue;
    add(seen, { path: childPath, distance, direction });
    added++;
  }
}

async function probeOne(
  scan: ScanDir,
  filename: string,
  currentPath: string,
  currentDir: string,
  io: PlatformIO,
): Promise<ContextFileEntry | null> {
  const fullPath = joinPath(scan.path, filename);
  if (fullPath === currentPath) return null;

  // Only a file *found* to be there is named in the indicator (R-A2).
  // `absent` and `unknown` are both "do not claim this", and keeping
  // them apart matters only to whoever asked: here they lead to the same
  // silence. Under #58's boolean an unanswered lookup counted as a hit,
  // and a revoked folder grant produced six context files nobody could
  // open (#126).
  //
  // **Deliberate against a case where it is wrong, one module over**
  // (#184). `shouldShowSidebar` no longer merges these two, because an
  // absent panel does not merely withhold — it asserts that nothing
  // sits beside the document, and with no folder granted that assertion
  // is false. This indicator asserts nothing when it withdraws: #130
  // decided that a scan nobody asked for stays silent whatever it
  // finds, so `absent` and `unknown` really do lead to the same place
  // here. The merge is right for a badge that answers only when asked
  // and wrong for a panel whose absence speaks.
  //
  // The guard stays even though `entryPresence` is contracted never to
  // reject: one probe taking the whole scan down with it is the opposite
  // of the graceful degradation this module promises, and a contract is
  // not a reason to let a rejection travel.
  let presence: EntryPresence;
  try {
    presence = await io.entryPresence(fullPath);
  } catch {
    return null;
  }
  if (presence !== 'present') return null;

  const kind = getKindForFilename(filename);
  if (kind === null) return null; // Defensive: registry desync.

  return {
    path: fullPath,
    filename,
    kind,
    direction: scan.direction,
    distance: scan.distance,
    relativePath: makeRelativePath(currentDir, fullPath),
  };
}

/**
 * Render `to` as a relative path from `from`. Both inputs are
 * forward-slash absolute paths. Used for the secondary line in the
 * popover ("../AGENTS.md", "backend/AGENTS.md", etc.).
 */
function makeRelativePath(from: string, to: string): string {
  const fromParts = from.split('/').filter(Boolean);
  const toParts = to.split('/').filter(Boolean);

  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common++;
  }

  const ups = fromParts.slice(common).map(() => '..');
  const downs = toParts.slice(common);
  const joined = [...ups, ...downs].join('/');
  return joined.length === 0 ? '.' : joined;
}
