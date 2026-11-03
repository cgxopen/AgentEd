import { marked } from 'marked';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDocument } from '../app/editor-document';
import { AppState } from '../app/state';
import { loadMarkdown, saveMarkdown } from '../formats/plain';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import type { PredictablePasteStorage } from './paste';
import { createEditor, type EditorInstance } from './setup';

vi.mock('../ui/toast', () => ({ showToast: vi.fn() }));

/**
 * #689: a task list pasted as HTML keeps its checkboxes.
 *
 * On `9a4ba37` a task list copied from GitHub, or in the shape `marked`
 * writes, arrived as plain bullets: turndown writes nothing for the checkbox
 * input, and the space it left behind lifted a nested item out of its parent.
 * Each shape is pasted as HTML into an empty document, with the plain text a
 * clipboard carries beside it, saved, and saved again. The GitHub shape is the
 * HTML GitHub renders for `- [ ] a`, `- [x] b`, loose and nested, as it was
 * read back off the clipboard of Chromium on #689, inline styles included.
 */

let instances: EditorInstance[] = [];

afterEach(() => {
  for (const instance of instances) instance.destroy();
  instances = [];
  document.body.innerHTML = '';
});

const DOCUMENT_PATH = '/doc/notes.md';

/** A disk that records exactly what was written to it (the shape #79 uses). */
function recordingIO(disk: Map<string, string>): PlatformIO {
  return {
    canWriteCompanions: async () => true,
    openFile: async () => null,
    pickFile: async () => null,
    readText: async (path: string) => {
      const text = disk.get(path);
      if (text === undefined) throw new Error(`no such file: ${path}`);
      return text;
    },
    saveFile: async (path: string, content: string) => {
      disk.set(path, content);
    },
    readSnapshot: async (path: string): Promise<FileSnapshot> => {
      const text = disk.get(path);
      return text === undefined ? { kind: 'absent' } : { kind: 'file', text };
    },
    pickSavePath: async () => null,
    installCloseGuard: async () => {},
    readBinary: async () => new Uint8Array(),
    writeBinary: async () => {},
    entryPresence: async () => 'absent' as const,
    listDir: async (): Promise<FileEntry[]> => [],
    mkdir: async () => {},
    openWithSystem: async () => {},
  };
}

function editorWith(markdown: string): EditorInstance {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const instance = createEditor(host);
  (instance.editor.storage.predictablePaste as PredictablePasteStorage).plainPasteRequestedAt = 0;
  instance.setMarkdown(markdown);
  instances.push(instance);
  return instance;
}

/**
 * Open `text` as a file, run `edit` on the editor, save, and return the bytes
 * that reached the disk: the whole path, so the line endings and the final
 * newline are the ones a save writes.
 */
async function openAndSave(
  text: string,
  edit: (instance: EditorInstance) => void = () => {},
): Promise<string> {
  const disk = new Map<string, string>([[DOCUMENT_PATH, text]]);
  const io = recordingIO(disk);
  const loaded = await loadMarkdown(DOCUMENT_PATH, io);
  const instance = editorWith(loaded.document.markdownBody);
  edit(instance);
  const state = new AppState();
  state.filePath = DOCUMENT_PATH;
  state.frontmatter = loaded.document.frontmatterRaw;
  state.lineConventions = loaded.document.lineConventions;
  const result = await saveMarkdown(buildDocument(state, instance.getMarkdown), io);
  return result.writtenText;
}

const STYLE = 'color: rgb(0, 0, 0); font-family: Times New Roman; font-size: medium;';
const GH_INPUT = 'type="checkbox" id="" disabled="" class="task-list-item-checkbox"';
const gh = {
  tight: `<ul class="contains-task-list" style="${STYLE}"><li class="task-list-item"><input ${GH_INPUT} aria-label="Incomplete task"> a</li><li class="task-list-item"><input ${GH_INPUT} aria-label="Completed task" checked=""> b</li></ul>`,
  loose: `<ul class="contains-task-list" style="${STYLE}"><li class="task-list-item"><p dir="auto"><input ${GH_INPUT} aria-label="Incomplete task"> a</p></li><li class="task-list-item"><p dir="auto"><input ${GH_INPUT} aria-label="Completed task" checked=""> b</p></li></ul>`,
  nested: `<ul class="contains-task-list" style="${STYLE}"><li class="task-list-item"><input ${GH_INPUT} aria-label="Incomplete task"> a<ul class="contains-task-list"><li class="task-list-item"><input ${GH_INPUT} aria-label="Completed task" checked=""> b</li></ul></li></ul>`,
};
const md = (text: string) => marked.parse(text, { async: false }) as string;

/** Paste `html` into an empty document, with plain text beside it, and save. */
async function pasted(html: string): Promise<string> {
  const once = await openAndSave('', (instance) => {
    const { view } = instance.editor;
    const data: Record<string, string> = { 'text/html': html, 'text/plain': 'a b' };
    const event = {
      clipboardData: { types: Object.keys(data), getData: (t: string) => data[t] ?? '', files: [] },
      preventDefault: () => undefined,
    } as unknown as ClipboardEvent;
    view.someProp('handlePaste', (handler) => handler(view, event, view.state.selection.content()));
  });
  expect(await openAndSave(once), 'the second save').toBe(once);
  return once;
}

describe('a task list pasted as HTML arrives as a task list (#689)', () => {
  it.each([
    ['GitHub, tight', gh.tight, '- [ ] a\n- [x] b'],
    ['GitHub, loose, written tight as any pasted loose list is', gh.loose, '- [ ] a\n- [x] b'],
    ['GitHub, nested', gh.nested, '- [ ] a\n  - [x] b'],
    ['marked, tight', md('- [ ] a\n- [x] b\n'), '- [ ] a\n- [x] b'],
    ['marked, loose', md('- [ ] a\n\n- [x] b\n'), '- [ ] a\n- [x] b'],
    ['marked, nested', md('- [ ] a\n  - [x] b\n'), '- [ ] a\n  - [x] b'],
  ])('%s', async (_shape, html, expected) => {
    expect(await pasted(html)).toBe(expected);
  });
});

describe('what the change leaves as it was (#689)', () => {
  it.each([
    [
      'a checkbox inside the text of an item',
      '<ul><li>see <input type="checkbox" checked> here</li></ul>',
      '- see here',
    ],
    [
      'a checkbox in an ordered list',
      '<ol><li><input type="checkbox" checked> a</li><li><input type="checkbox"> b</li></ol>',
      '1. a\n2. b',
    ],
    ['a text input opening an item', '<ul><li><input type="text" value="v"> a</li></ul>', '- a'],
    ['a checkbox alone in a paragraph', '<p><input type="checkbox" checked> lone</p>', 'lone'],
    [
      'a checkbox in a form, in a label',
      '<form><label><input type="checkbox" name="agree"> I agree</label></form>',
      'I agree',
    ],
    ['a list with no checkbox', '<ul><li>a</li><li>b</li></ul>', '- a\n- b'],
    [
      'an AgentEd copy from another window',
      '<ul data-type="taskList" data-agented-copy="0000" data-pm-slice="0 0 []"><li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>a</p></div></li><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>b</p></div></li></ul>',
      '- [ ] a\n- [x] b',
    ],
  ])('%s', async (_shape, html, expected) => {
    expect(await pasted(html)).toBe(expected);
  });
});

describe('only the tick crosses (#689, #447)', () => {
  it('a page spelling data-checked with an event handler and a stamped attribute', async () => {
    const html =
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true" onclick="alert(1)" data-html-source="&lt;img src=x onerror=alert(1)&gt;"><p>a</p></li></ul>';
    expect(await pasted(html)).toBe('- [x] a');
  });

  it('a checkbox carrying an event handler, a stamped attribute and a style', async () => {
    const html =
      '<ul><li><input type="checkbox" checked onclick="alert(1)" data-fence-blank-line data-html-source="&lt;b&gt;x&lt;/b&gt;" style="color: red"> a</li></ul>';
    expect(await pasted(html)).toBe('- [x] a');
  });

  it('checked=false is ticked, as a browser reads the attribute', async () => {
    expect(await pasted('<ul><li><input type="checkbox" checked="false"> a</li></ul>')).toBe(
      '- [x] a',
    );
  });
});
