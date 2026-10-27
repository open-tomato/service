/**
 * Publishes the package in the current folder: packs it with `bun pm pack`,
 * refuses a tarball the pack check rejects, and runs `npm publish` on the
 * tarball, so the published manifest carries the versions bun wrote over
 * `workspace:^`. A prerelease publishes under the `next` dist-tag.
 *
 * `rafa release publish` runs it in each package's folder as
 * `release.publishCommand`: `bun ../../scripts/publish-package.ts`. Extra
 * arguments pass through to `npm publish`, such as `--dry-run`.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { distTag, packPackage, readLegalFiles, tarballProblems } from './pack';

/**
 * The `npm publish` command for a packed tarball.
 *
 * @param tarball - Path of the tarball to publish.
 * @param version - The packed version, which picks the dist-tag.
 * @param extra - Arguments passed through to `npm publish`.
 * @returns The command and its arguments.
 */
export function publishCommand(tarball: string, version: string, extra: readonly string[] = []): string[] {
  return ['npm', 'publish', tarball, '--tag', distTag(version), ...extra];
}

if (import.meta.main) {
  const outDir = mkdtempSync(join(tmpdir(), 'publish-'));
  try {
    const { path, packed } = packPackage(process.cwd(), outDir);
    const label = `${packed.manifest.name}@${packed.manifest.version}`;
    const problems = tarballProblems(packed, readLegalFiles());
    if (problems.length > 0) {
      problems.forEach((problem) => console.error(`${label}: ${problem}`));
      process.exitCode = 1;
    } else {
      const command = publishCommand(path, packed.manifest.version, process.argv.slice(2));
      console.log(`${label}: ${command.join(' ')}`);
      const proc = Bun.spawnSync(command, { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
      process.exitCode = proc.exitCode ?? 1;
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}
