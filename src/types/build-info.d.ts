/**
 * Build identity, substituted by Vite's `define` at build time (see
 * vite.config.ts). Compile-time constants, not runtime lookups: nothing
 * reads them from disk or from the network.
 */
declare const __APP_VERSION__: string;
declare const __BUILD_COMMIT__: string;
