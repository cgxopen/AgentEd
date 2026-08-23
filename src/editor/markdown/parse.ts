import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { attachTableStyles, TABLE_STYLE_ATTRIBUTE } from './table-style';

// Configure marked for GFM compatibility
marked.setOptions({
  gfm: true,
  breaks: false,
});

// GFM turns a bare URL in running text into a link. The serializer then
// writes that link back as "[https://x](https://x)" — link syntax the user
// never typed, appearing in the file merely because a URL was mentioned.
// That is the stray fragment behind defect D2, and it breaks the R-C2
// round-trip on any document that names a URL. Returning undefined from the
// `url` inline tokenizer leaves those URLs as text; explicit links —
// "[text](url)" and "<url>" — are matched by other tokenizers and still parse.
marked.use({ tokenizer: { url: () => undefined } });

// Allow TipTap-specific attributes through sanitization
DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName === 'data-type' || data.attrName === 'data-checked') {
    data.forceKeepAttr = true;
  }
});

export interface ParseOptions {
  /**
   * Read a single newline as a line break rather than as a space. Off for
   * files, whose author chose where the paragraphs are; on for pasted text,
   * where the lines the user copied are the only structure on offer and
   * reflowing them into one line would lose it.
   */
  readonly breaks?: boolean;
}

export function markdownToHtml(markdown: string, options: ParseOptions = {}): string {
  const html = marked.parse(markdown, { async: false, breaks: options.breaks ?? false }) as string;

  // How each table was spelled — padded or hugged columns, the separator's
  // own shape — read from the markdown and pinned to the table it belongs to
  // (#93). It has to happen here: `marked` trims every cell, so by the time
  // this HTML exists the file's spacing is already gone.
  const withTableStyles = attachTableStyles(html, markdown);

  // Post-process: convert GFM task list items to TipTap-compatible attributes
  const processed = withTableStyles
    .replace(
      /<li><input checked="" disabled="" type="checkbox">\s*/g,
      '<li data-type="taskItem" data-checked="true">',
    )
    .replace(
      /<li><input disabled="" type="checkbox">\s*/g,
      '<li data-type="taskItem" data-checked="false">',
    );

  // Sanitize HTML to prevent XSS from malicious markdown.
  // blob: URIs must be allowed — image-registry.ts creates blob URLs
  // for all image display (both Tauri and Web).
  return DOMPurify.sanitize(processed, {
    ADD_ATTR: ['data-type', 'data-checked', TABLE_STYLE_ATTRIBUTE],
    ALLOWED_URI_REGEXP:
      /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
}
