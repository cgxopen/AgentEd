/**
 * HTML parsed where nothing in it can act (#664).
 *
 * The HTML `marked` writes for a file holds the raw HTML of that file, and
 * four passes read it as a tree before `DOMPurify.sanitize` has seen it:
 * `moveAdjacencyMarks`, `rewriteCheckboxes` and `markTaskLists` on every open
 * and every markdown paste, and `labelText` on a save. Each used to assign it
 * to `innerHTML` of a `div` the live document created, where it is parsed in
 * that document: an image in it starts loading and its event handler
 * attributes run, before anything has removed them. The content of a
 * `template` element belongs to a document of its own with no browsing
 * context, so the same HTML parsed there loads nothing and runs nothing. Eight
 * other modules of this folder already parse into one.
 *
 * Measured in Chromium on #664, with no Content Security Policy: on `main` an
 * open ran the handlers of a file twice, a markdown paste twice, a file with
 * an adjacency mark three times and a save of an image label once; through
 * this function, none ran and none reached an element of the live document.
 * The test harness cannot show that part: happy-dom gives the content of a
 * `template` the live document as its owner, so the rows of
 * `inert-html.test.ts` check where the HTML is parsed, not that it is inert.
 *
 * **What it changes in what the passes read, measured.** The 11513 distinct
 * strings the four passes received over the corpus of #664 serialize the same
 * from a `template` as from a `div` in Chromium, and the corpus saves byte for
 * byte as before. One shape differs and the corpus holds none of it: a `div`
 * of the live document parses with scripting enabled, so the content of a
 * `noscript` is text there, and a `template` content parses it as markup. A
 * task list inside a raw `noscript` block therefore keeps its markers, where
 * it lost them; R-C2 records it beside the exception on a raw `noscript`.
 *
 * The caller reads and changes `template.content` and serializes with
 * `template.innerHTML`. Nothing here sanitizes: what this returns is still the
 * HTML of the file, and it still goes through `DOMPurify.sanitize` before it
 * reaches the editor.
 */
export function inertTemplate(html: string): HTMLTemplateElement {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template;
}
