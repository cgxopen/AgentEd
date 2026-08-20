/**
 * Nothing the editor did not take leaves the document (#65).
 *
 * Until this issue, a dropped file did nothing on the Windows build
 * because no drop ever arrived: Tauri registers its own drag-drop target
 * over the webview and the HTML5 `drop` event was never delivered.
 * Turning that off — `"dragDropEnabled": false` on the `main` window in
 * `src-tauri/tauri.conf.json`, which is a JSON file and cannot say why —
 * hands every drop to the webview, including the ones the editor has no
 * use for. That is where the danger is.
 *
 * **A dropped file the page ignores is a navigation.** That is the
 * browser's default action for a file dropped on a document, and it
 * would replace AgentEd with the contents of a `.zip` — an unsaved
 * document gone with no gate in front of it (R-C3), which reads as a
 * crash. Two separate gaps let it through, and both are in the DOM
 * rather than in our code:
 *
 *  1. **Outside the editing surface**, nothing cancels `dragover`, so no
 *     `drop` event is dispatched at all and the browser performs its
 *     default action directly. The header, the sidebar and the statusbar
 *     are all such surfaces.
 *  2. **On the editing surface**, prosemirror-view cancels `dragover`
 *     but its drop handler gives up without cancelling the drop itself
 *     when there is nothing to insert: `if (!slice) return` — reached
 *     for a file drop, because `parseFromClipboard` answers `null` when
 *     the transfer carries neither text nor HTML. Our own
 *     `handleDrop` (`createImageDropPlugin`) returns `false` for a
 *     transfer with no images, which is precisely how it hands control
 *     back to that fallback.
 *
 * So "a non-image drop does nothing" is not a behaviour that survived
 * this change — it is one this has to arrange. The guard sits on the
 * window, below everything: it cancels `dragover`/`dragenter` so a drop
 * is always *delivered* rather than acted on by the browser, and then
 * cancels the drop itself unless something upstream already claimed it.
 *
 * **`defaultPrevented` is the whole protocol.** Anything that wants a
 * drop cancels it — prosemirror-view does for an insert, the image
 * plugin does for a gesture it takes — and the guard's only job is the
 * remainder. It never inspects the payload, never decides what a file
 * is, and never stops propagation, so it cannot take a drop away from a
 * handler that would have wanted it. A future handler for a dropped
 * `.md` file (deliberately out of scope here) needs no change on this
 * side: it cancels its own event, and the guard steps back.
 *
 * Installed on both targets rather than behind `isTauri`. The hazard is
 * the webview's, not the desktop shell's — the web build reaches it the
 * same way — and a platform branch here would mean keeping one build
 * able to lose a document to a stray drag.
 */
export function installDropGuard(): () => void {
  function onDragOver(event: Event): void {
    // Unconditional: this only says "this window is a drop target", so
    // that a drop is reported to the page instead of being handled by
    // the browser. What happens to it is decided below.
    event.preventDefault();
  }

  function onDrop(event: Event): void {
    if (event.defaultPrevented) return;
    event.preventDefault();
  }

  window.addEventListener('dragenter', onDragOver);
  window.addEventListener('dragover', onDragOver);
  window.addEventListener('drop', onDrop);

  return () => {
    window.removeEventListener('dragenter', onDragOver);
    window.removeEventListener('dragover', onDragOver);
    window.removeEventListener('drop', onDrop);
  };
}
