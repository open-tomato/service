import * as fs from 'node:fs';
import { join } from 'node:path';

let cachedVersion: string | undefined;

/** @internal Mutable impl object so tests can replace readFile without module mocking. */
export const _impl = {
  readFile: (path: string, enc: string) => fs.readFileSync(path, enc as Parameters<typeof fs.readFileSync>[1]) as string,
};

/** @internal Resets the module-level cache and restores the real reader. Used only in tests. */
export function _resetVersionCache(): void {
  cachedVersion = undefined;
  _impl.readFile = (path, enc) => fs.readFileSync(path, enc as Parameters<typeof fs.readFileSync>[1]) as string;
}

/**
 * Returns the `version` field from the service's `package.json`.
 *
 * The result is cached after the first read so the file is not re-read on
 * subsequent calls. Returns `'unknown'` when the file cannot be read or the
 * `version` field is absent or not a string.
 */
export function readServiceVersion(): string {
  if (cachedVersion !== undefined) return cachedVersion;

  try {
    const raw = _impl.readFile(join(process.cwd(), 'package.json'), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    const version =
      parsed !== null &&
      typeof parsed === 'object' &&
      'version' in parsed &&
      typeof (parsed as Record<string, unknown>)['version'] === 'string'
        ? (parsed as Record<string, string>)['version']
        : undefined;
    cachedVersion = version ?? 'unknown';
  } catch {
    cachedVersion = 'unknown';
  }

  return cachedVersion;
}
