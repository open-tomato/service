import { describe, expect, test } from 'bun:test';

import { publishCommand } from './publish-package';

describe('publishCommand', () => {
  test('publishes the tarball under its dist-tag, passing extra arguments through', () => {
    expect(publishCommand('/tmp/a.tgz', '2.0.0-next.3', ['--dry-run'])).toEqual([
      'npm',
      'publish',
      '/tmp/a.tgz',
      '--tag',
      'next',
      '--dry-run',
    ]);
  });
});
