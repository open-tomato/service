/**
 * Loads every publishable package's built entry under real Node, the
 * runtime its consumers use. Bun resolves loosely, so a package can pass its
 * own tests on Bun and still fail to import under Node's ESM rules.
 *
 * Run by `bun run check-node` after `bun run build`. It exits 1 when it runs
 * under Bun (no Node on PATH puts Bun's `node` shim there), when a package has
 * no build, or when an entry fails to import or exports nothing.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PACKAGES = new URL('../packages/', import.meta.url);

if (process.versions.bun !== undefined) {
  console.error('check-node: running under Bun, not Node');
  process.exit(1);
}

const failures = [];
for (const dir of readdirSync(PACKAGES)) {
  const root = join(PACKAGES.pathname, dir);
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (manifest.private === true) continue;
  const entry = join(root, manifest.exports['.'].default);
  if (!existsSync(entry)) {
    failures.push(`${manifest.name}: no build at ${manifest.exports['.'].default}`);
    continue;
  }
  try {
    const exported = Object.keys(await import(pathToFileURL(entry).href));
    if (exported.length === 0) failures.push(`${manifest.name}: the entry exports nothing`);
    else console.log(`${manifest.name}: ${exported.length} exports under Node ${process.version}`);
  } catch (error) {
    failures.push(`${manifest.name}: ${error.message}`);
  }
}

failures.forEach((line) => console.error(`check-node: ${line}`));
process.exit(failures.length === 0
  ? 0
  : 1);
