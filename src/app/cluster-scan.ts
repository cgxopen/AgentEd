import { detectContextCluster } from '../cluster/detector';
import { ContextCluster } from '../cluster/types';
import type { PlatformIO } from '../platform/types';
import { showToast } from '../ui/toast';
import type { AppContext } from './context';

/**
 * What the user reads when they pressed **Refresh** and the scan behind
 * it found nothing (#130).
 *
 * **Shaped like `DESTINATION_CUE`**: the fact, then the one thing left
 * to do. It has to name the way back, because there is not one on
 * screen — at count 0 the indicator is withdrawn completely and the
 * popover is closed, so the Refresh button that was just pressed is out
 * of reach until the document is opened again. Saying so is what keeps
 * this an answer rather than a vanishing act.
 *
 * It names an action and not a mechanism (#46): *reopen the document*,
 * not *the folder grant was revoked* or *the scan returned zero
 * entries*. The scan cannot tell those causes apart anyway — a file
 * deleted beside the document and a folder the browser stopped letting
 * us read both arrive here as nothing found — so a message that guessed
 * at one would be wrong half the time.
 *
 * Exported so the test reads what the user reads rather than a copy of
 * it (the #50 precedent).
 */
export const NOTHING_RELATED_FOUND =
  'No related context files found — reopen the document to look again.';

/**
 * Run one cluster scan and commit it, or drop it if a newer scan has
 * started meanwhile.
 *
 * Returns the cluster that was committed, or `null` when this scan was
 * superseded — which is the difference the gesture below needs and the
 * automatic path does not. The generation guard is unchanged from
 * `scheduleClusterDetection`: rapid Opens must not let an older scan
 * land on a newer document.
 *
 * A detector failure is not re-thrown. It is logged and committed as an
 * empty cluster, which is what this has always done: the indicator goes
 * quiet rather than the application reporting an internal fault at a
 * feature the user did not ask for.
 */
async function runClusterScan(
  path: string,
  ctx: AppContext,
  io: PlatformIO,
): Promise<ContextCluster | null> {
  const myGeneration = ctx.state.beginClusterScan();

  let cluster: ContextCluster;
  try {
    cluster = await detectContextCluster(path, io);
  } catch (e) {
    console.warn('cluster detection failed:', e);
    cluster = ContextCluster.empty(path);
  }

  if (myGeneration !== ctx.state.clusterScanGeneration) return null;
  ctx.state.setCluster(cluster);
  return cluster;
}

/**
 * The scan **nobody asked for** — on open, and on every document switch.
 *
 * It stays silent whatever it finds. A document that simply has no
 * context files beside it was never a question, and answering it would
 * put a message in front of every plain document in the product — the
 * case R-C12 keeps clean on purpose.
 *
 * Fire-and-forget by design: the document is already rendered and the
 * indicator appears if and when results land.
 */
export function scheduleClusterDetection(path: string, ctx: AppContext, io: PlatformIO): void {
  void runClusterScan(path, ctx, io);
}

/**
 * The scan the user **asked for** — the Refresh button in the popover.
 *
 * Same scan, different obligation. The distinction this project has now
 * drawn three times is *did the user ask?*: on #58 an `absent` folder
 * stays silent while an unreadable one speaks; on #61 a cancellation
 * stays silent while a refusal speaks. Here, a question was put and it
 * has an answer, so finding nothing is said out loud.
 *
 * **Tied to the gesture, not to the count.** One press, at most one
 * message — never one per scan, and never a message from the automatic
 * path above, which is the same code with the speaking removed rather
 * than a flag threaded through it.
 *
 * A superseded scan says nothing: the user opened another document while
 * this was in flight, and the answer is no longer about anything they
 * are looking at.
 */
export async function refreshClusterDetection(
  path: string,
  ctx: AppContext,
  io: PlatformIO,
): Promise<void> {
  const committed = await runClusterScan(path, ctx, io);
  if (committed === null) return;
  if (committed.relatedCount > 0) return;
  reportNothingRelated();
}

/**
 * Say that there is nothing related to show.
 *
 * Two callers, one sentence: the Refresh above, and the popover being
 * asked to open with an empty cluster — which cannot happen while the
 * indicator is withdrawn completely, and says so anyway (#130).
 */
export function reportNothingRelated(): void {
  showToast(NOTHING_RELATED_FOUND, 'info');
}
