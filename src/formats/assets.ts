/**
 * Image extensions we render inside the editor.
 * bmp/ico are included for completeness; validate WebView rendering on each
 * platform and remove if they don't render.
 */
export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']);

export function isImagePath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.has(ext);
}

/**
 * Rewrite image src paths in markdown body: attachments/* → assets/*.
 * Only rewrites image references (starts with !), not plain markdown links.
 * Used during legacy folder migration.
 */
export function rewriteAttachmentsPathsInBody(body: string): string {
  return body.replace(/(!\[[^\]]*\]\()attachments\//g, '$1assets/');
}
