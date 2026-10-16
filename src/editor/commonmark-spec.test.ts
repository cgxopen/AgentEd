/**
 * Every example of the CommonMark spec, opened and saved unedited (#557).
 *
 * R-C2 is tested construct by construct elsewhere, so a change that breaks a
 * construct no test names could merge with CI green. This file runs the 652
 * examples of CommonMark 0.31.2 - the version `marked` 15.0.12 tests itself
 * against - through the path a real open and save take, twice, and compares
 * the result with a list of the examples known to change.
 *
 * ── What the list holds, and why a hash ──
 *
 * `commonmark-spec-changes.json` names every example whose first save
 * differs from the example. Each entry carries a 16-character SHA-256 of the
 * bytes that first save wrote, `first`, and of the bytes a second save writes
 * where that moves again, `second`. So the suite fails when an unlisted
 * example changes, when a listed one comes back unchanged - the entry is then
 * removed, which is how the list only shrinks - and when a listed one changes
 * differently. A list recording only that an example differs would guard the
 * examples that come back unchanged and nothing else: measured on the step
 * zero of #557 with one construct broken on purpose, it reddened 4 examples
 * where the hash reddens 7. A hash rather than the bytes because the bytes
 * are derived from the examples, which are CC-BY-SA 4.0, and a hash carries
 * nothing of them into this repository (owner decision on #557).
 *
 * ── The causes ──
 *
 * Each entry names one cause from `CAUSES` below, the most severe one where
 * an example shows several. A cause is either a recorded R-C2 exception,
 * named by its title in REQUIREMENTS, which this file reads and checks, or a
 * defect, with the promise it breaks. The cause was assigned by hand: it is
 * what a reader reviews, and the hash, not the label, is what fails. A cause
 * marked `caseNotNamed` is one whose exception is recorded for another case
 * of the same mechanism; the label says where it belongs, not that it is
 * covered.
 *
 * ── Where the examples come from ──
 *
 * The npm package `commonmark-spec`, a dev dependency pinned to 0.31.2, read
 * as the text of its `spec.txt`. Nothing of it reaches the build: only this
 * file imports it. Its arrow for a tab is turned into the tab it stands for,
 * as the spec says of its own examples.
 */
import specText from 'commonmark-spec/spec.txt?raw';
import { describe, expect, it } from 'vitest';
import requirementsMd from '../../REQUIREMENTS.md?raw';
import { buildDocument } from '../app/editor-document';
import { AppState } from '../app/state';
import { loadMarkdown, saveMarkdown } from '../formats/plain';
import type { FileEntry, FileSnapshot, PlatformIO } from '../platform/types';
import changesJson from './commonmark-spec-changes.json?raw';
import { STAMPED_ATTRIBUTES } from './markdown/stamped-attributes';
import { createEditor } from './setup';

/** A recorded exception, by its title in REQUIREMENTS after `Known exception — `. */
interface Recorded {
  readonly recorded: string;
  readonly caseNotNamed?: true;
}
/** A difference REQUIREMENTS does not record, and the promise it breaks. */
interface Defect {
  readonly breaks: 'R-C2 file' | 'R-C2 document' | 'R-C13' | 'Q4';
  readonly what: string;
}
type Cause = Recorded | Defect;

const CAUSES: Readonly<Record<string, Cause>> = {
  // Recorded, and this is the case the exception was written for.
  'escape-added': {
    recorded:
      'an escape the file did not have, added because the serializer sees one text node at a time',
  },
  'soft-break': { recorded: 'soft line breaks become spaces' },
  'lazy-line': { recorded: 'a lazy continuation line is written with the marker of its container' },
  'rule-hyphens': { recorded: 'a horizontal rule is written with three hyphens' },
  'rule-under-text': {
    recorded:
      'a paragraph directly over a rule spelled with stars, underscores or spaced hyphens, and a reference definition directly over any rule, are written a blank line apart',
  },
  'span-width': {
    recorded: "a code span's delimiter run is written at the shortest width that still closes it",
  },
  'mark-nesting': { recorded: 'two overlapping marks have exactly one nesting' },
  'redundant-escape': {
    recorded:
      'a redundant escape the file already had is not preserved where AgentEd no longer writes one',
  },
  'html-table': {
    recorded: 'raw HTML that is not one whole table at the top level is written as markdown',
  },
  'blank-run': {
    recorded:
      'a run of blank lines between two items of a list or holding spaces is written back as one, and a blank line at either end of the document is not kept',
  },
  'div-text': { recorded: 'a raw `div` holding text is written as that text' },
  'link-empty': { recorded: 'a raw `a` with an `href` and no text, or no end tag, is lost' },
  'link-nested': { recorded: 'a link inside a link is read as `marked` reads it' },
  'definition-spaces': {
    recorded: 'the spaces at the end of a line of a reference definition are not kept',
  },
  // Recorded for another case of the same mechanism.
  'marks-split': { recorded: 'two overlapping marks have exactly one nesting', caseNotNamed: true },
  'html-as-markdown': {
    recorded: 'raw HTML that is not one whole table at the top level is written as markdown',
    caseNotNamed: true,
  },
  'fence-blank-end': { recorded: 'a blank line at the end of a fenced block', caseNotNamed: true },
  // Respelled, rendering alike: named nowhere in R-C2.
  'indented-fenced': { breaks: 'R-C2 file', what: 'an indented code block is written fenced' },
  'fence-respelled': {
    breaks: 'R-C2 file',
    what: 'a fence loses its indentation, the spelling of its closing fence, the rest of its info string, or, when empty, its run',
  },
  'setext-atx': {
    breaks: 'R-C2 file',
    what: 'an underlined heading over two lines is written with hashes, and one loses its indentation or trailing spaces',
  },
  'list-item': { breaks: 'R-C2 file', what: 'a list item is written with other spacing' },
  'autolink-link': { breaks: 'R-C2 file', what: 'an autolink is written as an inline link' },
  destination: {
    breaks: 'R-C2 file',
    what: 'an image destination, or a link destination and title over two lines, is written another way',
  },
  'entity-char': { breaks: 'R-C2 file', what: 'a character reference is written as its character' },
  'inner-spaces': { breaks: 'R-C2 file', what: 'a run of spaces inside a line is written as one' },
  'atx-respelled': {
    breaks: 'R-C2 file',
    what: 'a heading loses the spacing around its hashes and its text',
  },
  indentation: { breaks: 'R-C2 file', what: 'the indentation of a block is not kept' },
  'quote-marker': { breaks: 'R-C2 file', what: 'a quote marker is written with a space' },
  tab: { breaks: 'R-C2 file', what: 'a tab is written as spaces or as a fence' },
  'image-alt': { breaks: 'R-C2 file', what: 'an image description is written as plain text' },
  // The meaning moves.
  'nested-em': { breaks: 'R-C2 document', what: 'nested emphasis of one kind is made one' },
  'span-padding': { breaks: 'R-C2 document', what: 'the spaces of a code span move or go' },
  'em-structure': { breaks: 'R-C2 document', what: 'emphasis is written with another nesting' },
  'list-spacing': { breaks: 'R-C2 document', what: 'a list changes between loose and tight' },
  'rule-in-item': { breaks: 'R-C2 document', what: 'a rule in a list item leaves the item' },
  // Content lost.
  'html-dropped': { breaks: 'Q4', what: 'raw HTML is dropped' },
};

interface Change {
  readonly n: number;
  readonly cause: string;
  readonly first: string;
  readonly second?: string;
}

const CHANGES: readonly Change[] = JSON.parse(changesJson);
const LISTED = new Map(CHANGES.map((change) => [change.n, change]));
const MOVED_AGAIN = CHANGES.filter((change) => change.second !== undefined).length;

/** What this run measured, read by the last case. */
const changed = new Set<number>();
const movedAgain = new Set<number>();

/** More examples than this means the spec is not the one this file was written for. */
const MAX_EXAMPLES = 1000;

/** The examples of `spec.txt`, numbered as the spec numbers them. */
function specExamples(text: string): { n: number; markdown: string }[] {
  const tests = text.replace(/\r\n?/g, '\n').split(/^<!-- END TESTS -->/m)[0];
  const fence = '`'.repeat(32);
  const pattern = new RegExp(`^${fence} example\\n([\\s\\S]*?)^\\.\\n[\\s\\S]*?^${fence}$`, 'gm');
  const examples = Array.from(tests.matchAll(pattern), (match, index) => ({
    n: index + 1,
    markdown: match[1].replace(/→/g, '\t'),
  }));
  if (examples.length > MAX_EXAMPLES) {
    throw new Error(`spec.txt holds ${examples.length} examples, over ${MAX_EXAMPLES}`);
  }
  return examples;
}

const EXAMPLES = specExamples(specText);

/** The first 16 hex characters of the SHA-256 of `text` in UTF-8. */
async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

// ── The open and save path, transcribed from `openAndSaveUnedited` in
// `roundtrip.test.ts`, as the other suites that need it do ──

const DOCUMENT_PATH = '/doc/notes.md';

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

/** Open `text` as a file, change nothing, save, and return what reached the disk. */
async function openAndSaveUnedited(text: string): Promise<string> {
  const disk = new Map<string, string>([[DOCUMENT_PATH, text]]);
  const io = recordingIO(disk);
  const loaded = await loadMarkdown(DOCUMENT_PATH, io);

  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = createEditor(host);
  editor.setMarkdown(loaded.document.markdownBody);

  const state = new AppState();
  state.filePath = DOCUMENT_PATH;
  state.frontmatter = loaded.document.frontmatterRaw;
  state.lineConventions = loaded.document.lineConventions;

  const result = await saveMarkdown(buildDocument(state, editor.getMarkdown), io);
  // Destroyed after every save: 1304 editors live in this one file.
  editor.destroy();
  host.remove();
  return result.writtenText;
}

describe('the CommonMark 0.31.2 examples, opened and saved unedited (R-C2, #557)', () => {
  it('reads the 652 examples of the spec', () => {
    expect(specText).toContain("version: '0.31.2'");
    expect(EXAMPLES).toHaveLength(652);
  });

  it('lists each example once, in order, under a cause that exists', () => {
    expect(CHANGES.map((change) => change.n)).toEqual([...LISTED.keys()].sort((a, b) => a - b));
    for (const change of CHANGES) {
      expect(change.n, `entry ${change.n} names no example`).toBeLessThanOrEqual(EXAMPLES.length);
      expect(
        CAUSES[change.cause],
        `entry ${change.n}: unknown cause ${change.cause}`,
      ).toBeDefined();
    }
  });

  it.each(
    Object.entries(CAUSES).filter((entry): entry is [string, Recorded] => 'recorded' in entry[1]),
  )('cause %s names an exception REQUIREMENTS records', (_id, cause) => {
    expect(requirementsMd).toContain(`Known exception — ${cause.recorded}`);
  });

  it.each(EXAMPLES)('example $n', async ({ n, markdown }) => {
    const first = await openAndSaveUnedited(markdown);
    const second = await openAndSaveUnedited(first);
    // No attribute the pipeline stamps for itself reaches a file that did not
    // spell it (#565): a prototype wrote `data-link-at` into 22 files.
    for (const name of STAMPED_ATTRIBUTES) {
      if (!markdown.includes(name))
        expect(first, `example ${n} writes ${name}`).not.toContain(name);
    }
    const listed = LISTED.get(n);
    if (first === markdown) {
      expect(listed, `example ${n} comes back unchanged: remove its entry`).toBeUndefined();
      return;
    }
    changed.add(n);
    if (second !== first) movedAgain.add(n);
    expect(listed, `example ${n} changes on the first save and is not listed`).toBeDefined();
    expect(await digest(first), `example ${n} writes other bytes on the first save`).toBe(
      listed?.first,
    );
    const moved = second === first ? undefined : await digest(second);
    expect(moved, `example ${n} writes other bytes on the second save`).toBe(listed?.second);
  });

  // The two counts of every run, in the name of the case that checks them: the
  // file promise of R-C2, then the document promise. Cases in a file run in
  // order, so this one reads what the 652 above measured.
  it(`counts ${CHANGES.length} examples changed by the first save, ${MOVED_AGAIN} again by the second`, () => {
    expect(changed.size).toBe(CHANGES.length);
    expect(movedAgain.size).toBe(MOVED_AGAIN);
  });
});
