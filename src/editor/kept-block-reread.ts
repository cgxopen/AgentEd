import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { parseDocument } from './document-load';

/**
 * Kept bytes read again at save with the reference definitions they name
 * (#604, K5b of the step zero, owner decision 1 of 2026-10-17).
 *
 * ── What was lost ──
 *
 * The check at save of #461, #468 and #563 reads the bytes a block carries
 * again through the route a load takes and compares what they give with the
 * block the editor holds. Read alone, the bytes had none of the reference
 * definitions of the file, so a reference link inside them, `[implement
 * this][fs-blobs]` with `[fs-blobs]: ...` at the end of the file, came back as
 * its text where the editor holds a link. The block counted as edited and the
 * bytes went on an unedited save: measured on the step zero (comment
 * 6236166181), a `details` in 6 files (4 distinct) of the corpus snapshot.
 *
 * ── The route ──
 *
 * The definitions are read off the document being saved, once per save. The
 * bytes are read again with the definitions whose label they name appended
 * after a blank line, and the blocks those definitions become are taken off
 * the end before the comparison. A label is matched as CommonMark matches
 * one, case and runs of white space aside; a definition matched for a label
 * the bytes only mention costs a parse and nothing else.
 *
 * **Only the definitions named, and that is measured.** The step zero first
 * appended every definition, and the 884 KB file of the census on #20, which
 * holds 1504 of them, then took 1.7 s more to save, every kept block parsing
 * all 1504 again; with only those named, its save holds within the spread.
 */

/** One reference definition of the document: its label as matched, and its lines. */
interface Definition {
  readonly label: string;
  readonly text: string;
}

/** A label as CommonMark matches it: case and runs of white space aside. */
function matchable(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ');
}

/** The reference definitions of `doc`, each node of #570 as the lines it holds. */
function definitionsOf(doc: ProseMirrorNode): Definition[] {
  const found: Definition[] = [];
  doc.descendants((node) => {
    if (node.type.name !== 'footnoteDefinition') return;
    // A footnote definition carries `null` here, a reference one its indentation.
    if (typeof node.attrs.referenceIndent !== 'string') return false;
    const text = node.textBetween(0, node.content.size, '\n', (leaf) =>
      leaf.type.name === 'hardBreak' ? '\n' : '',
    );
    const label = /^\s*(\[[^\]]*\])/.exec(text)?.[1];
    if (label !== undefined) found.push({ label: matchable(label), text });
    return false;
  });
  return found;
}

/** Bytes read again as a load reads them, with what they need of the document. */
export type Reread = (source: string) => ProseMirrorNode;

/** The re-read for the document being saved: its definitions read once, here. */
export function rereadFor(doc: ProseMirrorNode, schema: Schema): Reread {
  const definitions = definitionsOf(doc);
  return (source) => {
    if (definitions.length === 0) return parseDocument(schema, source);
    const named = matchable(source);
    const used = definitions.filter((d) => named.includes(d.label));
    if (used.length === 0) return parseDocument(schema, source);
    const tail = used.map((d) => d.text).join('\n');
    const count = parseDocument(schema, tail).childCount;
    const read = parseDocument(schema, `${source.replace(/\n+$/, '')}\n\n${tail}\n`);
    const blocks: ProseMirrorNode[] = [];
    for (let i = 0; i < read.childCount - count; i++) blocks.push(read.child(i));
    return schema.topNodeType.create(null, blocks);
  };
}
