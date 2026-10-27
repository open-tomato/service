import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as version from './version.js';

describe('readServiceVersion', () => {
  beforeEach(() => {
    // Reset the module-level cache before each test.
    version._resetVersionCache();
  });

  afterEach(() => {
    // Restore the real reader after each test.
    version._resetVersionCache();
  });

  it('returns the version from package.json', () => {
    version._impl.readFile = () => '{"name":"my-service","version":"1.2.3"}';
    expect(version.readServiceVersion()).toBe('1.2.3');
  });

  it('caches the result so the reader is only called once', () => {
    const readFn = vi.fn().mockReturnValue('{"version":"2.0.0"}');
    version._impl.readFile = readFn;
    version.readServiceVersion();
    version.readServiceVersion();
    expect(readFn).toHaveBeenCalledTimes(1);
  });

  it('returns "unknown" when the file does not exist', () => {
    version._impl.readFile = () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    };
    expect(version.readServiceVersion()).toBe('unknown');
  });

  it('returns "unknown" when the file contains malformed JSON', () => {
    version._impl.readFile = () => 'not valid json {{{';
    expect(version.readServiceVersion()).toBe('unknown');
  });

  it('returns "unknown" when the version field is absent', () => {
    version._impl.readFile = () => '{"name":"my-service"}';
    expect(version.readServiceVersion()).toBe('unknown');
  });
});
