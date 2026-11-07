/** The part of a Node-like `process` global the core reads, when there is one. */
interface ProcessLike {
  readonly env?: Readonly<Record<string, string | undefined>>
}

/**
 * Reads an environment variable without importing `node:process`.
 *
 * The core runs where `process` may not exist (a Worker, a browser bundle),
 * so it reads `globalThis.process` and answers `undefined` where there is no
 * such global or no such variable.
 *
 * @param name - The variable to read, such as `LOG_LEVEL`.
 * @returns The variable's value, or `undefined`.
 */
export function readEnv(name: string): string | undefined {
  const runtime = globalThis as { readonly process?: ProcessLike };
  return runtime.process?.env?.[name];
}
