import type { Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { getPlatformIO } from '../platform/index';
import { basename, joinPath } from '../platform/paths';
import type { FileEntry } from '../platform/types';
import { bytesEqual, findIdenticalImage, findNameAmong } from './image-dedup';
import type { ReportImageInsert } from './image-insert-outcome';
import { buildImageName, type ImageOrigin, keptFileName } from './image-names';
import { getAllImages, getDisplayUrl, registerImage } from './image-registry';

export type GetFilePath = () => string | null;
export type RequestSaveAs = () => Promise<string | null>;

/**
 * Resolves the assets/ folder for the current document, asking the user
 * to agree to its creation when it does not exist yet. Returns `null`
 * when the user declines or there is no usable path. It does **not**
 * create the folder — the save flow does that (#14).
 */
export type ConfirmAssetsDir = () => Promise<string | null>;

/**
 * Whether a companion file can be written for the current document right
 * now (#46). Wired to `PlatformIO.canWriteCompanions`, and asked **after**
 * the destination step rather than before: on the web build the save
 * picker is what acquires the folder access, so an answer taken earlier
 * is stale in exactly the case the step just repaired.
 */
export type CanWriteCompanions = () => Promise<boolean>;

// Reject paste/drop of images past this size to prevent OOM. file.arrayBuffer()
// allocates the whole buffer up front, and the registry then keeps a copy alive
// as a Blob, so peak usage is ~2× the file size. 25 MB covers normal screenshots
// and design exports while keeping a comfortable memory ceiling.
export const MAX_IMAGE_SIZE = 25 * 1024 * 1024;

/**
 * The most one gesture may insert, counted in the bytes it would retain
 * (#71). `MAX_IMAGE_SIZE` bounds one file; nothing bounded their sum
 * until this, and a two-hundred-file paste is a loop over user input
 * with no ceiling — which CLAUDE.md asks not to exist.
 *
 * **128 MB, measured rather than guessed.** An inserted image is held
 * twice over until the document is saved — the `Uint8Array` the registry
 * keeps and the `Blob` behind its display URL — and that factor was
 * measured at **2.0×** across three gesture shapes (200 MB as 20×10 MB,
 * 128 MB as 64×2 MB, 125 MB as 5×25 MB; `arrayBuffers` grew 1.94× to
 * 2.18× each time). So this budget is a peak of about **256 MB** of
 * image data, which has to sit alongside the document, the editor and
 * the tokenizer.
 *
 * 128 rather than 100 or 150 for one concrete reason beyond the round
 * number: five files at the per-file cap are 125 MB, so the two bounds
 * agree instead of contradicting each other — a user pasting five
 * maximum-size scans is refused by neither. In ordinary units it admits
 * about 25 phone photos, 60 screenshots, or 5 design exports at the cap.
 *
 * Counted in bytes and never in files, because a count fails in both
 * directions: twenty screenshots would be refused for nothing, and
 * twenty files at the per-file cap would pass and take the process down.
 */
export const MAX_GESTURE_BYTES = 128 * 1024 * 1024;

interface TakenNames {
  /** Names present in the assets folder on disk. */
  readonly onDisk: Set<string>;
  /** Everything a new name must avoid: what is on disk plus this session's claims. */
  readonly all: Set<string>;
}

/**
 * What the assets folder was able to say about the names in it.
 *
 * `unreadable` is a fourth thing the naming step can end in, and it is
 * not an empty set of names (#58). The set is what stands between a new
 * image and one already in the folder, so *"I could not read it"*
 * delivered as *"nothing is taken"* is the sentence that ends in an
 * overwrite. It is answered rather than thrown because the caller has to
 * report it, and an exception here would leave through the same door the
 * old `catch` did.
 */
type AssetsFolderNames =
  | { readonly kind: 'names'; readonly taken: TakenNames }
  | { readonly kind: 'unreadable' };

/**
 * Read the assets folder, and report either every name already spoken
 * for in it — what is on disk, plus what this session has claimed but
 * not yet written — or that it could not be read.
 *
 * The two are kept apart because only a name that is genuinely *on disk*
 * has a file behind it to compare bytes against (#52); a name this session
 * claimed has already been compared, in memory, by `findIdenticalImage`.
 *
 * **A failed read is settled by a second question, never by reading the
 * error** (#58). Two states arrive here as one rejection — the folder is
 * not there yet, which is the ordinary state of every never-saved
 * document since #14 and #45, and the folder is there and could not be
 * listed, which is the defect this whole path exists for. What tells
 * them apart is `entryPresence`, exactly as `readSnapshot` has told
 * `absent` from `unreadable` since #55. Not the text of the error: on the desktop
 * build that text is written by the operating system and translated into
 * its language, so a check that read it would work in one locale and
 * fail silently in the next.
 */
async function readAssetsFolder(assetsDir: string): Promise<AssetsFolderNames> {
  const onDisk = new Set<string>();
  const all = new Set<string>();
  for (const image of getAllImages()) all.add(basename(image.relativePath));

  const io = await getPlatformIO();
  let entries: readonly FileEntry[];
  try {
    entries = await io.listDir(assetsDir);
  } catch (readFailed) {
    // Only a folder found to be *absent* is the ordinary state. Both of
    // the others refuse: one because there is something there we could
    // not read, the other because we could not tell — and less than we
    // knew a moment ago is not permission to guess a name (R-C5).
    //
    // `entryPresence` reports its own failure as `unknown` rather than
    // raising, so there is no second `catch` here to merge the states in
    // (#126). That merging is exactly what this function was fixing one
    // level up.
    if ((await io.entryPresence(assetsDir)) === 'absent') {
      // Not there yet: the ordinary state of every never-saved document
      // since #14 and #45. Nothing on disk holds a name, nothing is
      // said, and the insert carries on exactly as it always has.
      return { kind: 'names', taken: { onDisk, all } };
    }
    console.warn('[agented] the assets folder could not be read:', readFailed);
    return { kind: 'unreadable' };
  }

  for (const entry of entries) {
    if (entry.isDirectory) continue;
    onDisk.add(entry.name);
    all.add(entry.name);
  }
  return { kind: 'names', taken: { onDisk, all } };
}

/**
 * The name to reuse when the file this image wants to be is already in the
 * assets folder and holds exactly these bytes — the same picture inserted
 * again in a later session (#52).
 *
 * Null when the bytes differ, which is a genuine collision and keeps its
 * numeric suffix, and null when the file cannot be read: an unreadable
 * neighbour is never grounds for assuming a match. Costs one read, only on
 * a name collision, and never a scan.
 */
async function fileAlreadyInAssets(
  assetsDir: string,
  sourceName: string,
  origin: ImageOrigin,
  data: Uint8Array,
  onDisk: ReadonlySet<string>,
): Promise<string | null> {
  const wanted = keptFileName(sourceName, origin);
  if (!wanted) return null;
  const match = findNameAmong(wanted, onDisk);
  if (!match) return null;

  try {
    const io = await getPlatformIO();
    const existing = await io.readBinary(joinPath(assetsDir, match));
    return bytesEqual(existing, data) ? match : null;
  } catch (e) {
    console.warn('[agented] could not read an assets file to compare it:', e);
    return null;
  }
}

/**
 * Insert one image file into the document (R-C5). Any document can
 * receive images at any time — there is no document kind to check.
 */
export async function handleImageFile(
  file: File,
  editor: Editor,
  getFilePath: GetFilePath,
  requestSaveAs: RequestSaveAs,
  confirmAssetsDir: ConfirmAssetsDir,
  canWriteCompanions: CanWriteCompanions,
  origin: ImageOrigin,
  report: ReportImageInsert,
): Promise<void> {
  if (file.size > MAX_IMAGE_SIZE) {
    report({
      kind: 'refused',
      reason: 'too-large',
      sizeBytes: file.size,
      limitBytes: MAX_IMAGE_SIZE,
    });
    return;
  }

  // Need a file path before we can decide where assets/ goes.
  //
  // **Offered on every platform** (#46). It used to be gated on `isTauri`,
  // so the web build never asked — and `assets/` then had nowhere to go,
  // which came out as the same silent early return a user cancellation
  // takes. On web this step is also what *acquires* the folder access:
  // `pickSavePath` calls the directory picker straight after the save
  // picker, so offering it is what makes everything below possible.
  if (!getFilePath()) {
    const saved = await requestSaveAs();
    if (!saved) {
      report({ kind: 'cancelled', at: 'destination' });
      return;
    }
  }

  // Asked here and not one line earlier (#46). The step above is what
  // grants the access on the web build, so an answer taken before it
  // would tell the user it cannot be done a moment after they granted it.
  //
  // A separate kind from both neighbours, deliberately: it speaks, unlike
  // the cancellation below, and it ends the whole gesture, unlike a
  // refusal — the cause belongs to the document and the environment, so
  // every image of this paste would fail the same way.
  if (!(await canWriteCompanions())) {
    report({ kind: 'unavailable', reason: 'no-folder-access' });
    return;
  }

  // Settle where assets/ will go, and get the user's agreement to create
  // it if it is not there yet — asked here, before the image is placed,
  // even though the folder itself only appears on save (#14).
  const assetsDir = await confirmAssetsDir();
  if (!assetsDir) {
    // A cancellation, because that is what it is today: the user just
    // declined the folder for this image, and nothing is remembered
    // about it (#66). Since #68 this kind also ends the gesture it
    // belongs to — the files behind this one are not asked again.
    //
    // **This branch is now only ever a cancellation** (#46). The web
    // build's missing folder access used to arrive here too, silently,
    // wearing a user's answer — it is reported above as `unavailable`
    // before this line can be reached, and it says so out loud. The
    // other false cancellation, a dialog guard answering null under a
    // concurrent insert, went with #68's sequencing.
    //
    // #51 was listed here once and never belonged: an agreement that
    // outlives its document returns a directory, not null, so it could
    // not reach this branch. It is the deliberate promise of R-C5.
    report({ kind: 'cancelled', at: 'assets-folder' });
    return;
  }

  // Read the bytes before allocating anything: they are what decides
  // whether this document already has this picture (#52).
  const data = new Uint8Array(await file.arrayBuffer());

  // Already inserted in this document → point at the same file instead of
  // storing a second copy of it. Costs no I/O, and skips the naming step
  // entirely.
  const identical = findIdenticalImage(data, getAllImages());
  const identicalUrl = identical ? getDisplayUrl(identical.relativePath) : undefined;
  if (identicalUrl) {
    editor.chain().focus().setImage({ src: identicalUrl, alt: file.name }).run();
    report({ kind: 'inserted' });
    return;
  }

  const folder = await readAssetsFolder(assetsDir);
  if (folder.kind === 'unreadable') {
    // The folder is there and AgentEd could not list it, so every name
    // in it is unknown — and a name picked against an unknown folder is
    // a name that may already have a file behind it, which the save
    // would then write over (#58, R-C5). Refusing is what the
    // requirement already implies: nothing is ever overwritten.
    //
    // `unavailable` rather than a refusal, for the two reasons that kind
    // exists (#46): the cause is the document's folder rather than this
    // file, so every image of the gesture would meet it identically, and
    // nobody has told the user anything yet.
    report({ kind: 'unavailable', reason: 'assets-folder-unreadable' });
    return;
  }
  const taken = folder.taken;

  // Or already in assets/ from an earlier session, under the very name
  // this one wants.
  const reused = await fileAlreadyInAssets(assetsDir, file.name, origin, data, taken.onDisk);

  const documentPath = getFilePath();
  const filename =
    reused ??
    buildImageName({
      sourceName: file.name,
      documentName: documentPath ? basename(documentPath) : null,
      taken: taken.all,
      origin,
    });
  if (!filename) {
    // Only reachable with a thousand taken variants of the same name;
    // refusing beats overwriting one of them (R-C5).
    report({ kind: 'refused', reason: 'no-free-name' });
    return;
  }

  // Convention: relativePath is always assets/<filename>. Save flow
  // resolves the absolute path against the document's own folder.
  const relativePath = `assets/${filename}`;

  // Use blob URLs universally for display (both Tauri and Web)
  // No eager disk write — save is the single source of truth
  const displayUrl = URL.createObjectURL(new Blob([data.slice().buffer as ArrayBuffer]));
  registerImage(displayUrl, { relativePath, data, filename: file.name });

  editor.chain().focus().setImage({ src: displayUrl, alt: file.name }).run();

  // The image is in the document and nothing is on disk. Reported last, so
  // no cue is raised for an insert that bailed out above — and after the
  // assets/ dialog rather than under it.
  report({ kind: 'inserted' });
}

function getImagesFromDataTransfer(dataTransfer: DataTransfer): File[] {
  const files: File[] = [];
  for (let i = 0; i < dataTransfer.files.length; i++) {
    const file = dataTransfer.files[i];
    if (file.type.startsWith('image/')) files.push(file);
  }
  return files;
}

interface GestureBudget {
  /** The leading files the budget admits, in the order the gesture carried them. */
  readonly accepted: readonly File[];
  /** How many files were left out — everything after `accepted`, never attempted. */
  readonly refused: number;
  /** What the whole gesture weighed, oversized files included: what the user asked for. */
  readonly bytesAttempted: number;
}

/**
 * How much of a gesture fits in `MAX_GESTURE_BYTES` (#71).
 *
 * **Decided from `file.size` alone, before a single byte is read.** That
 * is the whole point: reading two hundred files to discover that only
 * twelve fit is the allocation the budget exists to prevent. It also
 * lets the message name both counts the moment it appears, rather than
 * discovering the limit halfway through.
 *
 * **The first file that does not fit ends the run**, and everything
 * behind it is left out — rather than skipping it and squeezing in
 * smaller files further along. A gesture is an ordered thing the user
 * made; "the first twelve landed" is something they can act on, while a
 * scattered subset chosen by size is not.
 *
 * **A file over the per-file cap consumes nothing.** It refuses itself
 * inside `handleImageFile`, with its own message, and is never read — so
 * charging the gesture for bytes it will not retain would truncate a
 * gesture for an image that was never going to land.
 *
 * **The count is deliberately slightly high.** An image the document
 * already holds is referenced rather than stored (#52), so it retains
 * nothing, yet it is charged here — because recognising it means reading
 * its bytes, which is the very thing being bounded. Erring toward
 * refusing one image too many, on a gesture already over 128 MB, is the
 * cheaper mistake.
 */
function applyGestureBudget(files: readonly File[]): GestureBudget {
  let bytesAttempted = 0;
  for (const file of files) bytesAttempted += file.size;

  let used = 0;
  let cut = files.length;
  for (let i = 0; i < files.length; i++) {
    const size = files[i].size;
    if (size > MAX_IMAGE_SIZE) continue;
    if (used + size > MAX_GESTURE_BYTES) {
      cut = i;
      break;
    }
    used += size;
  }

  return { accepted: files.slice(0, cut), refused: files.length - cut, bytesAttempted };
}

/**
 * Insert every image of one gesture, one after another (#68).
 *
 * **Sequenced, not concurrent.** The loop this replaces fired one
 * `void handleImageFile(...)` per file, so every image of a paste reached
 * the `assets/` question in the same tick — and `showConfirmDialog`
 * refuses a second dialog while one is open, answering `null`. That
 * `null` is indistinguishable from a user pressing Cancel, so a paste
 * carrying three images kept the first and dropped two, silently,
 * whichever button the user pressed. Awaiting each insert is the whole
 * fix: the first file settles the destination and the folder consent,
 * and the rest find both already answered (R-C5, once per folder).
 *
 * With the gesture sequenced, no two inserts of it are ever in flight at
 * once, so nothing on this path meets that guard any more — and no new
 * outcome kind is needed to tell its `null` from a user's Cancel. A
 * second gesture cannot start under the dialog either: the overlay is
 * fixed over the whole viewport and takes the focus, so the menu that
 * reaches Insert Media is beneath it and neither a paste nor a drop is
 * delivered to the editor while it is open.
 *
 * Sequencing also settles three things the concurrent loop left to
 * chance: the images land in the order the gesture carried them, the
 * destination picker opens at most once per gesture rather than once per
 * file, and the same picture twice in one gesture is recognised as the
 * copy it is (#52) — the second insert now runs after the first has
 * registered.
 *
 * **A cancellation ends the gesture; a refusal does not.** They are
 * already different kinds on the #61 contract, and that is exactly the
 * distinction this loop needs: a user who declines the `assets/` folder
 * declined it for this paste, so the files behind it are not asked again
 * — they are not attempted at all, which is why they report nothing and
 * say nothing. A refusal the *application* made concerns one file, so a
 * gesture of three images with one over the size cap still lands two and
 * warns once.
 *
 * The outcome is read off the same channel the app layer reads rather
 * than returned beside it: `handleImageFile` pushes precisely because a
 * returned value dies at a `void` call (#61), and a second way out kept
 * only for this loop is a second thing to keep in step. Reading it is
 * also how the gesture counts what landed, which the truncation message
 * has to be exact about.
 *
 * **Bounded by `MAX_GESTURE_BYTES`** (#71). Sequencing is what made the
 * bound matter: before it, a concurrency defect truncated every large
 * gesture to one image, wrongly and silently, and fixing that removed
 * the thing that was accidentally acting as a limit. What fits lands,
 * the rest is refused with a message, and nothing that landed is rolled
 * back — the user can paste the rest.
 */
export async function insertImageGesture(
  files: readonly File[],
  editor: Editor,
  getFilePath: GetFilePath,
  requestSaveAs: RequestSaveAs,
  confirmAssetsDir: ConfirmAssetsDir,
  canWriteCompanions: CanWriteCompanions,
  origin: ImageOrigin,
  report: ReportImageInsert,
): Promise<void> {
  const budget = applyGestureBudget(files);

  // Two kinds end the run, for two different reasons (#46). A
  // `cancelled` ends it because asking the files behind this one is
  // asking the same question again; an `unavailable` ends it because the
  // answer is a property of the document and the environment, so every
  // file left would fail identically and say so identically.
  let ended = false;
  let inserted = 0;
  const watch: ReportImageInsert = (outcome) => {
    if (outcome.kind === 'cancelled' || outcome.kind === 'unavailable') ended = true;
    if (outcome.kind === 'inserted') inserted++;
    report(outcome);
  };

  for (const file of budget.accepted) {
    await handleImageFile(
      file,
      editor,
      getFilePath,
      requestSaveAs,
      confirmAssetsDir,
      canWriteCompanions,
      origin,
      watch,
    );
    if (ended) return;
  }

  if (budget.refused === 0) return;

  // Reported after the loop, so `inserted` is what actually landed
  // rather than what the budget predicted — a file inside the accepted
  // prefix may still have refused itself for its own size, and a message
  // that counted it would be wrong about the one thing it exists to be
  // exact about.
  //
  // Not reported at all when the run ended early: a user who cancelled
  // stopped the gesture themselves and hears nothing about it (#61), and
  // a document that cannot hold images has already been told the one
  // thing that matters. A budget message on top of either would explain
  // something that never happened.
  report({
    kind: 'refused',
    reason: 'gesture-too-large',
    bytesAttempted: budget.bytesAttempted,
    budgetBytes: MAX_GESTURE_BYTES,
    inserted,
    refused: budget.refused,
  });
}

/**
 * Drop and paste — the two routes that can carry several images at once.
 *
 * Both hand the gesture over whole and return synchronously: ProseMirror
 * needs the boolean now, and the inserts run after it. The list is taken
 * from the event before any `await`, because `dataTransfer` does not
 * survive the tick the event was dispatched in.
 *
 * One report per file stays deliberate: three oversized files still
 * produce three messages. Batching them into one is a change in a single
 * app-layer function (#61), not in this loop.
 */
export function createImageDropPlugin(
  editor: Editor,
  getFilePath: GetFilePath,
  requestSaveAs: RequestSaveAs,
  confirmAssetsDir: ConfirmAssetsDir,
  canWriteCompanions: CanWriteCompanions,
  report: ReportImageInsert,
): Plugin {
  return new Plugin({
    key: new PluginKey('imageDropHandler'),
    props: {
      handleDrop(_view: EditorView, event: DragEvent) {
        if (!event.dataTransfer) return false;
        const images = getImagesFromDataTransfer(event.dataTransfer);
        if (images.length === 0) return false;
        event.preventDefault();
        // A dropped file brings its own name (R-C5).
        void insertImageGesture(
          images,
          editor,
          getFilePath,
          requestSaveAs,
          confirmAssetsDir,
          canWriteCompanions,
          'file',
          report,
        ).catch(console.error);
        return true;
      },
      handlePaste(_view: EditorView, event: ClipboardEvent) {
        if (!event.clipboardData) return false;
        const images = getImagesFromDataTransfer(event.clipboardData);
        if (images.length === 0) return false;
        event.preventDefault();
        void insertImageGesture(
          images,
          editor,
          getFilePath,
          requestSaveAs,
          confirmAssetsDir,
          canWriteCompanions,
          'clipboard',
          report,
        ).catch(console.error);
        return true;
      },
    },
  });
}
