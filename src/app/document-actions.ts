import { clearImages } from '../editor/image-registry';
import { splitFrontmatter } from '../formats/frontmatter';
import {
  detectExternalChange,
  type LoadResult,
  loadDocument,
  parseDocument,
  saveDocument,
} from '../formats/index';
import { NotUtf8Error } from '../platform/decode';
import { getPlatformIO } from '../platform/index';
import { basename, dirname } from '../platform/paths';
import type { PlatformIO } from '../platform/types';
import { forgetRecentFile, recordRecentFile, saveLastOpenedFolder } from '../preferences';
import { getTemplate, type TemplateId } from '../templates/index';
import { shouldShowFrontmatterPanel } from '../ui/frontmatter-panel';
import { showToast } from '../ui/toast';
import type { AppContext } from './context';
import { createDiscardGate } from './discard-gate';
import { applyLoadedDocument, buildDocument } from './editor-document';
import { askAboutExternalChange } from './external-change-prompt';
import { OPEN_FAILED_TITLE, openFailedMessage, recentFileGoneMessage } from './open-failure';
import { createRequestSaveAs } from './save-as-flow';
import { SAVE_FAILED_TITLE, saveFailedMessage, saveFailureCause } from './save-failure';
import type { SidebarRedraw } from './sidebar-sync';

export interface DocumentActions {
  handleNew(): Promise<void>;
  handleNewFromTemplate(templateId: TemplateId): Promise<void>;
  handleOpen(): Promise<void>;
  handleSave(): Promise<void>;
  handleSaveAs(): Promise<void>;
  handleClose(): Promise<void>;
  /**
   * Open the document at `path`, through the unsaved-changes gate.
   *
   * `sidebarRoot` is the listing root the click came from, and only the
   * sidebar passes it (#178): given, the panel keeps that root when the
   * new document has no `assets/` folder of its own; omitted, the root
   * is re-derived from the document exactly as before. The file
   * association omits it deliberately — a document opened from the shell
   * was never in a panel at all.
   */
  openFilePath(path: string, sidebarRoot?: string): Promise<void>;
  /**
   * Open a file chosen from the recent files list (#381): `openFilePath`,
   * after one question the other routes do not ask. A file whose folder is
   * there and which is not leaves the list with a sentence saying so, and
   * **before** the unsaved-changes gate, so nobody is asked about their
   * changes for a file that is not there. Anything less certain, a folder
   * that is gone too, a drive disconnected, keeps the entry and goes on to
   * the ordinary open, which reports its own failure.
   */
  openRecentFile(path: string): Promise<void>;
  requestSaveAs(): Promise<string | null>;
  /**
   * Run the unsaved-changes gate for a window close / app quit. Resolves
   * `true` when the window may close (nothing unsaved, saved on request,
   * or discarded on request) and `false` when the user cancelled.
   */
  confirmWindowClose(): Promise<boolean>;
}

/**
 * How a failed load is reported. Grouped because the loader now also
 * takes the document's text — see `preloaded` — and four positional
 * arguments, three of them optional, is the shape a wrong one slips
 * into.
 */
interface LoadFailureReport {
  /**
   * The paragraph the user reads, or a function of the rejection that
   * chooses one (#173).
   *
   * A function because the message is composed **before** the load runs
   * and the state it describes is only known **after** it fails. Every
   * caller that has one sentence for every outcome passes the string it
   * always passed.
   */
  readonly label: string | ((error: unknown) => string);
  readonly title?: string;
  readonly detail?: 'append' | 'omit';
}

/** The optional halves of a load, grouped for the reason above. */
interface LoadOptions {
  /** The document's text, already read. See `openDocumentAtPath`. */
  readonly preloaded?: LoadResult;
  /** The sidebar listing root this open came from (#178). */
  readonly sidebarRoot?: string;
  /**
   * `same-document` for a reload of the document already on screen, which
   * does not ask for the panel (#387); every open is a document arriving.
   */
  readonly redraw?: SidebarRedraw;
}

export function createDocumentActions(ctx: AppContext): DocumentActions {
  const requestSaveAs = createRequestSaveAs(ctx);

  function clearDocumentForReplacement(): void {
    ctx.state.resetDocument();
    ctx.setFilename(null);
    // The empty document arrives by the same route every other document
    // does (#206). This used to call `editor.commands.clearContent()`,
    // which is `setContent('')` — a second whole-document replacement,
    // with its own transaction in the undo stack, so an undo after New
    // or Close brought the closed document back. One address now, and
    // `document-load.ts` says why.
    ctx.setMarkdown('');
    ctx.statusbar.refresh();
    ctx.frontmatterPanel.refresh();
    ctx.frontmatterPanel.setVisible(shouldShowFrontmatterPanel(ctx.state));
    clearImages();
    ctx.state.setModified(false);
  }

  /**
   * Put the document at `path` into the editor, with everything that
   * hangs off it: the last opened folder, the sidebar, the close state.
   *
   * `preloaded` is the document's text already read, which is what File
   * → Open has: the platform read the file from the handle the user
   * picked before it answered (#141). Given it, nothing here reads the
   * file again — the lookup by name that this replaces is the one that
   * could reach a different file on the web.
   *
   * **This is the one place the kept sidebar root is written** (#178),
   * because this function is exactly the set of *a document arrived at a
   * path* events: File → Open, the sidebar, the file association and a
   * reload after an external change all pass through here and nothing
   * else does. `options.sidebarRoot` is given
   * only by the sidebar, so every other route clears the value and
   * re-derives the root. A save is deliberately **not** one of these
   * events — `handleSave` refreshes the panel without coming through
   * here — so Ctrl+S on a document opened from the tree does not
   * dissolve the tree.
   *
   * Written **after** `applyLoadedDocument`, not before the read: a load that
   * throws leaves the document, `filePath` and the R-C14 baseline
   * exactly as the user had them — the sentence the `catch` below rests
   * on — and the panel is one more thing that must still be theirs. An
   * open that failed would otherwise arm the panel to vanish on the next
   * save, having changed nothing the user can see.
   */
  async function openDocumentAtPath(
    path: string,
    failure: LoadFailureReport,
    options: LoadOptions = {},
  ): Promise<void> {
    const io = await getPlatformIO();
    try {
      const loaded = options.preloaded ?? (await loadDocument(path, io));
      await applyLoadedDocument(loaded, path, ctx, io);

      const folder = dirname(path);
      if (folder.length > 0) saveLastOpenedFolder(folder);
      // Every route that opens a document ends here, so this one line is the
      // whole of which opens enter the recent list (#381).
      if (io.pathsOutliveSession) recordRecentFile(path);

      ctx.state.sidebarRootFromClick = options.sidebarRoot ?? null;
      await ctx.refreshSidebar(options.redraw ?? 'document-arrived');
      ctx.updateCloseEnabled();
    } catch (e) {
      // **Where the read happens here**, nothing above this line has
      // touched the document: `loadDocument` throws before `applyLoadedDocument`
      // runs, and this path never clears the editor. So the editor,
      // `filePath` and the R-C14 baseline are all still the ones the
      // user had — which is what `openFailedMessage` is allowed to say
      // in as many words (#127).
      //
      // **Where `preloaded` was given**, that read is already behind us
      // and only `applyLoadedDocument` and the state it syncs are left, so a
      // failure here has replaced part of the document. That is why File
      // → Open does not pass `openFailedMessage`: its last sentence
      // would be false on the only failure that route can still reach
      // (#141). It reports the mechanism instead, which is the useful
      // thing to show for a fault with no user action behind it.
      const label = typeof failure.label === 'function' ? failure.label(e) : failure.label;
      await ctx.reporter.dialog(label, e, failure.title, failure.detail);
    }
  }

  /**
   * Tell the user the document was saved but its images were not. Modal
   * rather than a toast: the file on disk now references images that do
   * not exist next to it, which is not something to let scroll past.
   */
  async function reportAssetsFailure(error: unknown): Promise<void> {
    const needsFolderAccess = error instanceof Error && error.message.includes('NO_DIR_HANDLE');
    const remedy = needsFolderAccess
      ? 'Web mode: use Save As to grant folder access, then save again.'
      : 'The images are still open in this document — saving again will retry them.';
    await ctx.reporter.dialog(
      'The document was saved, but its images could not be written to the ' +
        `assets folder next to it.\n\n${remedy}`,
      error,
      'Images not saved',
    );
  }

  /**
   * The R-C14 gate, run before every write to a path the editor already
   * knows: is the file still the one AgentEd last read or wrote?
   *
   * Returns `'write'` when the save may go ahead — either nothing
   * changed, or the user chose to overwrite, or they chose a different
   * destination and the picker gave one. Returns `'stop'` when it may
   * not: the document was reloaded from disk instead, or the user
   * backed out. Nothing is written on that branch, and the document
   * stays modified, which is the accurate statement (R-C3).
   */
  async function resolveExternalChange(io: PlatformIO, path: string): Promise<'write' | 'stop'> {
    const change = await detectExternalChange(path, ctx.state.knownDiskText, io);
    if (change.kind === 'none') return 'write';

    switch (await askAboutExternalChange(basename(path), change)) {
      case 'overwrite':
        return 'write';
      case 'save-as':
        // The picker moves the document to a new path and clears the
        // baseline with it, so the write below lands there instead.
        return (await requestSaveAs()) ? 'write' : 'stop';
      case 'reload':
        await openDocumentAtPath(
          path,
          { label: `Failed to reload document: ${path}` },
          { redraw: 'same-document' },
        );
        return 'stop';
      case 'cancel':
        return 'stop';
    }
  }

  /**
   * Write the current document to disk exactly as the user wrote it —
   * body, plus the frontmatter block only if the document already has
   * one. Nothing is ever injected on save.
   */
  async function persistDocument(): Promise<boolean> {
    const io = await getPlatformIO();

    // Before the document is built, not after: the answer to the question
    // may move the document to a different file, and the document carries
    // the path it will be written to.
    const target = ctx.state.filePath;
    if (target !== null && (await resolveExternalChange(io, target)) === 'stop') return false;

    const document = buildDocument(ctx.state, ctx.getMarkdown);

    let result: Awaited<ReturnType<typeof saveDocument>>;
    try {
      result = await saveDocument(document, io);
    } catch (e) {
      if (e instanceof Error && e.message.includes('NO_DIR_HANDLE')) {
        showToast(
          'Web mode: please use Save As to grant folder access for this document type.',
          'warn',
        );
        return false;
      }
      // **None of the document reached the disk**, which is what
      // separates this from the assets branch below: there, part of it
      // did. Everything after this `catch` is skipped, so `isFirstSave`,
      // the R-C14 baseline and `setModified(false)` all keep the values
      // they had — and the document stays **modified**, which is the
      // accurate statement and is the point of returning here rather
      // than a consequence of it (#171). That is what keeps the
      // unsaved-changes gate (R-C3/Q4) in front of work that now exists
      // only in the editor.
      //
      // Modal rather than a toast, on the same reasoning that made
      // `reportAssetsFailure` one: the file on disk is not what the user
      // believes it is. Silence here is what made the close prompt they
      // meet afterwards look spurious, and Discard the reasonable answer
      // to it.
      //
      // `omit`, because the words are finished by the time they get
      // here: `saveFailedMessage` has already placed the platform's own
      // sentence between the statement and the remedy, where it reads.
      // The reporter's own `append` would put the whole raw string —
      // English scaffold, the path a second time, `(os error 32)` —
      // under a paragraph that ends on the remedy (#127). The error
      // still reaches the console unchanged, so this costs a line on
      // screen and never a line in the log.
      await ctx.reporter.dialog(
        saveFailedMessage(document.rootPath, saveFailureCause(e)),
        e,
        SAVE_FAILED_TITLE,
        'omit',
      );
      return false;
    }

    ctx.state.isFirstSave = false;
    // The `.md` is on disk and this is exactly what went into it, so it
    // is what the next save compares against (R-C14). Recorded before
    // the images branch below on purpose: a save whose images failed
    // still wrote the document, and the retry it invites must not find
    // AgentEd accusing itself of its own write.
    ctx.state.knownDiskText = result.writtenText;

    if (result.assetsError) {
      // The .md is on disk; its images are not. The save stands — we
      // never un-write a document — but the document stays **modified**,
      // because that is the accurate statement: not all of it reached
      // the disk. A clipboard image exists only in the in-memory
      // registry, so clearing the flag here would leave nothing between
      // the user and closing the app on top of it. Keeping it on puts
      // the existing unsaved-changes gate back in front of that loss
      // (R-C3/Q4) and gives the retry the modal promises somewhere to
      // land: Ctrl+S tries again, and discarding stays a knowing act.
      ctx.state.setModified(true);
      await reportAssetsFailure(result.assetsError);
    } else {
      ctx.state.setModified(false);
    }

    if (ctx.state.filePath) {
      const folder = dirname(ctx.state.filePath);
      if (folder.length > 0) saveLastOpenedFolder(folder);
    }
    return true;
  }

  async function handleSave(): Promise<void> {
    if (ctx.state.isSaving) return;
    // Fresh document without a path → delegate. Don't claim `isSaving`
    // here, otherwise handleSaveAs bails out on its own guard and the
    // user sees the picker never appear. handleSaveAs manages the flag
    // for that branch.
    if (!ctx.state.filePath) {
      await handleSaveAs();
      return;
    }
    ctx.state.isSaving = true;
    try {
      await persistDocument();
      // A save is not an act that asks for the panel (#387, owner decision).
      await ctx.refreshSidebar('same-document');
    } finally {
      ctx.state.isSaving = false;
    }
  }

  async function handleSaveAs(): Promise<void> {
    if (ctx.state.isSaving) return;
    ctx.state.isSaving = true;
    try {
      const path = await requestSaveAs();
      if (!path) return;
      // A document written under a new name is one the person now has, so it
      // enters the recent list as an open does (#381, owner decision).
      if ((await persistDocument()) && (await getPlatformIO()).pathsOutliveSession) {
        recordRecentFile(path);
      }
      // A save is not an act that asks for the panel (#387, owner decision).
      await ctx.refreshSidebar('same-document');
    } finally {
      ctx.state.isSaving = false;
    }
  }

  const discardCurrentDocument = createDiscardGate(ctx, handleSave);

  async function handleNew(): Promise<void> {
    if (ctx.state.isSaving) return;
    if (!(await discardCurrentDocument('new'))) return;

    clearDocumentForReplacement();
    ctx.sidebar.hide();
  }

  /**
   * Seed a fresh document from one of the built-in templates. Routes
   * through the same safety gate as `handleNew`, then splits the seed
   * into frontmatter + body and pushes both into the editor + state.
   * The document is unsaved — Save / Save As writes it to disk.
   */
  async function handleNewFromTemplate(templateId: TemplateId): Promise<void> {
    if (ctx.state.isSaving) return;

    const template = getTemplate(templateId);
    if (!template) {
      showToast(`Unknown template: ${templateId}`, 'warn');
      return;
    }

    if (!(await discardCurrentDocument('new'))) return;

    clearDocumentForReplacement();
    ctx.sidebar.hide();

    const { raw, body } = splitFrontmatter(template.body);
    ctx.state.frontmatter = raw;

    ctx.setMarkdown(body);
    ctx.frontmatterPanel.refresh();
    ctx.frontmatterPanel.setVisible(shouldShowFrontmatterPanel(ctx.state));
    ctx.statusbar.refresh();
    ctx.state.setModified(true);
  }

  async function handleClose(): Promise<void> {
    if (ctx.state.isSaving) return;
    if (!(await discardCurrentDocument('close'))) return;

    clearDocumentForReplacement();
    ctx.sidebar.hide();
  }

  /**
   * Gate for the window-close / quit path. A save already in flight blocks
   * the close rather than racing it: the write finishes and the user closes
   * again, instead of the app exiting mid-write.
   */
  async function confirmWindowClose(): Promise<boolean> {
    // The close guard refuses this case first and tells the user why; this
    // is the backstop that keeps the invariant true for any other caller.
    if (ctx.state.isSaving) return false;
    return await discardCurrentDocument('window-close');
  }

  async function handleOpen(): Promise<void> {
    if (!(await discardCurrentDocument('open'))) return;

    const io = await getPlatformIO();
    let result: Awaited<ReturnType<typeof io.openFile>>;
    try {
      result = await io.openFile();
    } catch (e) {
      // The picker route reaches the same refusals the click route does,
      // so it reads the same words (#259). `omit`, because the message
      // is the whole of what the reader needs and the second line would
      // put the platform marker under it. `NotUtf8Error` carries the
      // path; nothing else on this route knows one, since the picker
      // failed before it named a file.
      if (e instanceof NotUtf8Error) {
        await ctx.reporter.dialog(openFailedMessage(e.path, e), e, OPEN_FAILED_TITLE, 'omit');
        return;
      }
      await ctx.reporter.dialog('Failed to open file', e);
      return;
    }
    if (!result) return;

    // The text came back with the path, read from the handle the user
    // picked — so it is used, rather than the file being looked up again
    // by a name that on the web may not identify it (#141).
    await openDocumentAtPath(
      result.path,
      { label: `Failed to open document: ${result.path}` },
      { preloaded: parseDocument(result.content, result.path) },
    );
  }

  async function openFilePath(path: string, sidebarRoot?: string): Promise<void> {
    if (!(await discardCurrentDocument('open'))) return;
    // The route the sidebar and the file association both take, and the
    // one #127 was about: a file listed a
    // moment ago may be gone, or no longer reachable, by the time it is
    // clicked. It used to answer with the document already open; now it
    // says so.
    // `omit`, because `openFailedMessage` is the whole of what the user
    // should read here. The reporter's usual second line would put
    // `Could not resolve a file handle for: …` under it — a mechanism,
    // and the path a second time (#127).
    //
    // `sidebarRoot` travels straight through: the three callers are told
    // apart by whether they pass it, and only the sidebar does (#178).
    await openDocumentAtPath(
      path,
      {
        // A function of the rejection, because which of the two
        // sentences is true is not known until the read has failed
        // (#173). `omit` keeps the marker that decides it off the
        // screen, and the console still gets the error unchanged.
        label: (e) => openFailedMessage(path, e),
        title: OPEN_FAILED_TITLE,
        detail: 'omit',
      },
      { sidebarRoot },
    );
  }

  async function openRecentFile(path: string): Promise<void> {
    const io = await getPlatformIO();
    const folder = dirname(path);
    const gone =
      folder.length > 0 &&
      (await io.entryPresence(path)) === 'absent' &&
      (await io.entryPresence(folder)) === 'present';
    if (gone) {
      forgetRecentFile(path);
      await ctx.reporter.dialog(recentFileGoneMessage(path), null, OPEN_FAILED_TITLE, 'omit');
      return;
    }
    await openFilePath(path);
  }

  return {
    handleNew,
    handleNewFromTemplate,
    handleOpen,
    handleSave,
    handleSaveAs,
    handleClose,
    openFilePath,
    openRecentFile,
    requestSaveAs,
    confirmWindowClose,
  };
}
