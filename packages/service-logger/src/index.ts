/**
 * @module index
 * Convenience re-export of the Node.js entry point for IDE auto-import
 * resolution. This file is not referenced by `package.json` exports — bundlers
 * and runtimes use `dist/node.js` (or `dist/browser.js`) directly via the
 * conditional export map.
 */
export * from './node.js';
