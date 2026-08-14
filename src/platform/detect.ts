/** Single source of truth for Tauri vs Web environment detection */
export const isTauri = '__TAURI_INTERNALS__' in window;
