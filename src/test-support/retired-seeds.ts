/**
 * The markdown shapes the three retired template seeds carried (#403).
 *
 * `README`, `project document` and `meeting note` left the gallery by owner
 * decision - a product decision rather than the removal of machinery, since
 * none of them came from the Skills concept. The **files** left; these shapes
 * did not, because three guards were standing on them and a guard that loses
 * a shape when a feature leaves has quietly become weaker:
 *
 * - `editor/roundtrip.test.ts` held all three as repository documents, so each
 *   was diffed for unrecorded differences and for a second save that moves
 *   nothing.
 * - `editor/table-style.test.ts` used the project document **because it holds a
 *   table**, and its table rows are about a table nobody wrote by hand.
 * - `app/metadata-split.test.ts` drove all four seeds through the metadata
 *   split.
 *
 * Kept here byte for byte, so the count of documents those guards run over is
 * the count it was. They are fixtures now rather than files: nothing ships
 * them, and no route in the application can reach them.
 */

/** 519 bytes, as `src/templates/readme.md` spelled it. */
export const RETIRED_README_SEED = `# Project name

One sentence on what this project does and who it is for.

## Features

- First thing it does
- Second thing it does
- Third thing it does

## Getting started

Describe the prerequisites, then the shortest path from a clean machine to a
running project.

\`\`\`bash
# install
# run
\`\`\`

## Usage

Show the most common task first, with a short example.

## Contributing

How to propose a change: branch naming, tests to run, review expectations.

## License

State the license and link to the license file.
`;

/** 494 bytes, as `src/templates/project-document.md` spelled it. It holds the table. */
export const RETIRED_PROJECT_DOCUMENT_SEED = `# Document title

Short summary of what this document covers and who should read it.

## Context

What is the situation today, and why is this document being written now?

## Goals

- What success looks like
- What is explicitly out of scope

## Approach

Describe the proposed direction. Break it into sections as the document grows.

## Open questions

- Question that still needs an answer, and who can answer it

## Next steps

| Step | Owner | Target date |
| --- | --- | --- |
|  |  |  |
`;

/** 331 bytes, as `src/templates/meeting-note.md` spelled it. */
export const RETIRED_MEETING_NOTE_SEED = `# Meeting title

- **Date:**
- **Participants:**

## Agenda

1. First topic
2. Second topic

## Notes

Capture what was said, decided, and disputed — in that order of usefulness.

## Decisions

- Decision made, and the reasoning behind it

## Action items

- [ ] Action — owner — due date
- [ ] Action — owner — due date
`;
