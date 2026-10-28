import { describe, expect, test } from 'bun:test';

import { isStagedConflict, publishCommand } from './publish-package';

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

describe('isStagedConflict', () => {
  test('reads npm refusing a version it has already staged', () => {
    const stderr = [
      'npm error code E409',
      'npm error 409 Conflict - PUT https://registry.npmjs.org/@open-tomato%2fservice-express'
        + ' - Cannot publish over previously staged version "1.0.0".',
    ].join('\n');

    expect(isStagedConflict(stderr)).toBe(true);
  });

  test('leaves every other refusal a failure', () => {
    expect(isStagedConflict('npm error code E409\nnpm error 409 Conflict - PUT x - Scope not found')).toBe(false);
    expect(isStagedConflict('npm error code E403\nnpm error 403 Forbidden - You cannot publish over the previously published versions: 1.0.0.')).toBe(false);
    expect(isStagedConflict('npm error code EOTP')).toBe(false);
  });
});
