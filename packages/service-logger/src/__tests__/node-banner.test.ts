import { logStarted } from '@open-tomato/service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from '../node.js';

/** How many times a raw JSON line spells the given key. */
function countKey(line: string, key: string): number {
  return line.split(`"${key}":`).length - 1;
}

describe('the started banner through createLogger', () => {
  let chunks: string[];

  beforeEach(() => {
    chunks = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(typeof chunk === 'string'
        ? chunk
        : chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes the service name once, from the logger binding', () => {
    logStarted(createLogger('users', { format: 'json' }), {
      version: '1.0.0',
      transport: 'http',
      url: 'http://localhost:3000',
      features: {},
    });

    expect(chunks).toHaveLength(1);
    const line = chunks[0] ?? '';
    expect(countKey(line, 'service')).toBe(1);
    expect(JSON.parse(line)).toMatchObject({ service: 'users', msg: 'started', transport: 'http' });
  });
});
