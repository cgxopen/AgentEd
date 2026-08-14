import DOMPurify from 'dompurify';
import { marked } from 'marked';

// Configure marked for GFM compatibility
marked.setOptions({
  gfm: true,
  breaks: false,
});

// Allow TipTap-specific attributes through sanitization
DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName === 'data-type' || data.attrName === 'data-checked') {
    data.forceKeepAttr = true;
  }
});

export function markdownToHtml(markdown: string): string {
  const html = marked.parse(markdown, { async: false }) as string;

  // Post-process: convert GFM task list items to TipTap-compatible attributes
  const processed = html
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
    ADD_ATTR: ['data-type', 'data-checked'],
    ALLOWED_URI_REGEXP:
      /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|data|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
  });
}
