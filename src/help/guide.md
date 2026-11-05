# User Guide

AgentEd is an editor for markdown files. You write and format text the way you would in a word processor, and AgentEd saves it as an ordinary markdown file that any other tool can open.

This guide is itself a markdown document. You can scroll it, try things in it, and change it. Nothing you do here touches a file until you choose to save.

For the full list of keyboard shortcuts, open **Help, Keyboard Shortcuts**.

## What a markdown file is

A markdown file is plain text with a few simple marks for formatting. A line that starts with `#` is a heading, a line that starts with `-` is a list item, and a word between two `**` is bold. The file ends in `.md`.

You never have to type those marks in AgentEd. You see the formatted text, and AgentEd writes the marks for you when you save. If you already know markdown, you can still type them, and AgentEd turns them into formatting as you type.

Markdown files have become a common language for AI workflows — powering agent system prompts, context rules, task specs, handoffs, and LLM knowledge bases or wikis — alongside traditional project documentation, notes, and READMEs. Because these workflows rely on human oversight, many of these files need to be reviewed, verified, edited, or written from scratch by people.

## Your first document

1. AgentEd opens with an empty document. Start typing.
2. To save it, press **Ctrl+S**. The first time, AgentEd asks where to put the file and what to call it.
3. To open a file you already have, press **Ctrl+O**, or open the menu at the top left and choose **File, Open**. Files you opened recently are under **File, Open Recent**.
4. To start again with an empty document, choose **File, New**. **File, New from Template** offers a blank document, or one that starts with a metadata block.

AgentEd never saves on its own. If you try to close a document with unsaved changes, it asks whether to save them, discard them, or go back.

## Formatting text

Select some text and a small toolbar appears above it. Its buttons make the text bold, italic, underlined, struck through, or inline code, turn it into a link, or change the block into a heading, a list, a quote or a code block.

The same can be done from the keyboard, for example **Ctrl+B** for bold and **Ctrl+I** for italic.

You can also type the marks of markdown at the start of a line:

- `#` and a space makes a heading. `##` makes a smaller one, down to `######`.
- `-` and a space starts a bulleted list. `1.` and a space starts a numbered list.
- `>` and a space starts a quote.
- Three backticks and a space, or Enter, start a code block.

Press **Tab** in a list to move an item in, and **Shift+Tab** to move it back out.

To break a line without starting a new paragraph, press **Shift+Enter**.

## The Insert menu

The menu at the top left has an **Insert** section for things that are not plain text:

- **Table**: a table with the number of rows and columns you choose. Press **Tab** to move to the next cell. The **Table** section of the menu adds and removes rows and columns.
- **Image**: an image from your computer. See Images below.
- **Link**: a link to a web page or another file. **Ctrl+K** does the same. To follow a link, hold **Ctrl** and click it.
- **Code Block**: a block for code. Choose its language from the label at its corner, and copy its content with its **Copy** button.
- **Checklist**: a list of items with boxes you can tick.
- **Footnote**: a numbered reference in the text, with its note at the end of the document. Point at the reference to read the note.
- **Horizontal Rule**: a line across the page, to separate parts of a document.
- **Metadata**: a block of fields at the top of the document. See Metadata below.
- **Emoji**: a palette of emoji to insert.

## Images

Paste an image, drag it onto the document, or choose **Insert, Image**.

Although Markdown files prepared strictly for text LLMs rarely require images, visual assets are indispensable for standard software documentation, project overviews, and architecture graphs. Organizing them cleanly in an `assets` subfolder ensures standard repo hygiene: documents stay self-contained for human readers, while keeping image binaries isolated from text prompts.

AgentEd saves referenced images into a local `assets` folder beside your file. The first time, it asks before it uses that folder, and the folder and its images are written when you save the document. Remember to include this folder when sharing or versioning the document.

Select an image to resize it by dragging a corner, or choose **Image description** on the toolbar or in the **Edit** menu to manage alternative text.

## Metadata (Frontmatter)

Some Markdown files start with a structured block of fields at the top, commonly known as frontmatter. While traditionally used for blog posts, documentation, and digital gardens (titles, authors, tags), frontmatter is now critical in AI workflows — storing metadata for RAG indexing, agent routing, status flags (`draft`, `verified`), and document scopes.

AgentEd parses this block into a dedicated Metadata panel above the document, making it easy to inspect, verify, and edit structured attributes without syntax errors.

To add a metadata block to a document, choose **Insert, Metadata**.

## Finding and replacing

Press **Ctrl+F** to find text in the document, and **Ctrl+H** to find and replace it. **F3** goes to the next match and **Shift+F3** to the previous one. The search panel can match case, match whole words only, or use a regular expression.

## Counts and badges in the header

The header at the top of the window shows counts for the document: an estimate of its tokens, the number a language model would count, and its words and characters. They change as you type. Point at any of them for details.

Badges appear beside them when they apply: **Metadata** when the document has a metadata block, and **Images** when it uses images. Click **Images** to see the images of the document. In a narrow window, some of these move into the list behind the three dots.

## The files panel

When your document has an `assets` folder beside it, the files panel can show it. Open and close the panel with the button in the header, or with **Ctrl+Shift+E**.

## Appearance

The half-filled circle at the right of the header opens **Appearance**. Choose a light or dark mode, or Auto to follow your system, and a colour palette.

## Spell check

Spell check is off at first. Turn it on in the **Edit** menu, under **Spell check**.

## More than one document

Each document opens in a window of its own. Open another document from your file manager and it gets its own window, with its own history of changes.

## When a file changes outside AgentEd

If another program changes a file while you have it open, AgentEd notices when you save and asks what to do: reload the file from disk, overwrite it with your version, or save your version somewhere else. It never overwrites a changed file without asking.

## Keeping your file as it was

AgentEd is careful not to change what you did not edit. If you open a file and save it without changes, the file stays exactly as it was. Some rare constructions are written differently after you edit them; they are listed in the requirements of the project.
