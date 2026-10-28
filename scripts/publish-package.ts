/**
 * Publishes the package in the current folder: packs it as the pack check
 * does (`./pack.ts`), with every `workspace:` range filled in from the
 * sibling's own `package.json`, refuses a tarball the pack check rejects,
 * and runs `npm publish` on the tarball. A prerelease publishes under the
 * `next` dist-tag.
 *
 * `rafa release publish` runs it in each package's folder as
 * `release.publishCommand`: `bun ../../scripts/publish-package.ts`. Extra
 * arguments pass through to `npm publish`, such as `--dry-run`.
 *
 * npm stages an accepted upload for some minutes before it lists the
 * version, and `npm view` cannot see it meanwhile, so a second run uploads
 * again and npm answers 409 "previously staged version". The version is
 * already on its way, so that answer exits 0.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { distTag, packPackage, readLegalFiles, readWorkspaceVersions, tarballProblems } from './pack';

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

/**
 * Whether npm refused the upload because it already holds that version
 * staged: accepted, and not yet listed.
 *
 * @param stderr - What `npm publish` wrote to stderr.
 * @returns `true` only for the 409 that names a previously staged version.
 */
export function isStagedConflict(stderr: string): boolean {
  return /\bE409\b/.test(stderr) && /previously staged version/.test(stderr);
}

/**
 * Runs `command` with stdin and stdout inherited, and stderr passed through
 * as it arrives, so npm's prompts still reach the operator.
 *
 * @returns The exit code and everything written to stderr.
 */
async function runPassingStderr(command: readonly string[]): Promise<{ exitCode: number; stderr: string }> {
  const proc = Bun.spawn([...command], { stdin: 'inherit', stdout: 'inherit', stderr: 'pipe' });
  const decoder = new TextDecoder();
  let stderr = '';
  for await (const chunk of proc.stderr) {
    process.stderr.write(chunk);
    stderr += decoder.decode(chunk, { stream: true });
  }
  return { exitCode: await proc.exited, stderr };
}

if (import.meta.main) {
  const outDir = mkdtempSync(join(tmpdir(), 'publish-'));
  try {
    const versions = readWorkspaceVersions();
    const { path, packed } = packPackage(process.cwd(), outDir, versions);
    const label = `${packed.manifest.name}@${packed.manifest.version}`;
    const problems = tarballProblems(packed, readLegalFiles(), versions);
    if (problems.length > 0) {
      problems.forEach((problem) => console.error(`${label}: ${problem}`));
      process.exitCode = 1;
    } else {
      const command = publishCommand(path, packed.manifest.version, process.argv.slice(2));
      console.log(`${label}: ${command.join(' ')}`);
      const { exitCode, stderr } = await runPassingStderr(command);
      if (exitCode !== 0 && isStagedConflict(stderr)) {
        console.log(`${label}: npm already holds this version staged; it lists it once staging ends`);
        process.exitCode = 0;
      } else {
        process.exitCode = exitCode;
      }
    }
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
}
