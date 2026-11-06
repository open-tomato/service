import type { LoggerOptions } from '../types.js';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from '../node.js';

type StreamName = 'stdout' | 'stderr';

/** The descriptors both `isTTY` flags had before a test faked them. */
const originalIsTTY = {
  stdout: Object.getOwnPropertyDescriptor(process.stdout, 'isTTY'),
  stderr: Object.getOwnPropertyDescriptor(process.stderr, 'isTTY'),
};

/** Fakes a stream's `isTTY`; `undefined` is a pipe, which has none. */
function fakeIsTTY(name: StreamName, value: boolean | undefined): void {
  Object.defineProperty(process[name], 'isTTY', { value, configurable: true, writable: true });
}

function restoreIsTTY(name: StreamName): void {
  const descriptor = originalIsTTY[name];
  if (descriptor === undefined) {
    Reflect.deleteProperty(process[name], 'isTTY');
  } else {
    Object.defineProperty(process[name], 'isTTY', descriptor);
  }
}

const ENV_NAMES = ['NO_COLOR', 'LOG_FORMAT', 'LOG_LEVEL'] as const;
const originalEnv = new Map(ENV_NAMES.map(name => [name, process.env[name]]));

function setEnv(name: typeof ENV_NAMES[number], value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, name);
  else process.env[name] = value;
}

function isJson(chunk: string): boolean {
  try {
    JSON.parse(chunk);
    return true;
  } catch {
    return false;
  }
}

function asText(chunk: string | Uint8Array): string {
  return typeof chunk === 'string'
    ? chunk
    : Buffer.from(chunk).toString();
}

describe('createLogger — destination', () => {
  let stdoutChunks: string[];
  let stderrChunks: string[];

  beforeEach(() => {
    stdoutChunks = [];
    stderrChunks = [];
    setEnv('NO_COLOR', '1');
    setEnv('LOG_LEVEL', undefined);
    setEnv('LOG_FORMAT', undefined);
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdoutChunks.push(asText(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      stderrChunks.push(asText(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const name of ENV_NAMES) setEnv(name, originalEnv.get(name));
    restoreIsTTY('stdout');
    restoreIsTTY('stderr');
  });

  /** Fakes stderr a TTY and stdout a pipe, logs one record, returns stderr's line. */
  function logOnTtyStderr(options: LoggerOptions): string {
    fakeIsTTY('stderr', true);
    fakeIsTTY('stdout', undefined);
    createLogger('svc', options).info('hello');
    expect(stdoutChunks).toEqual([]);
    expect(stderrChunks).toHaveLength(1);
    return stderrChunks[0]!;
  }

  it('writes a json record to stderr and nothing to stdout', () => {
    createLogger('svc', { format: 'json', destination: 'stderr' }).info('hello');

    expect(stdoutChunks).toEqual([]);
    expect(stderrChunks).toHaveLength(1);
    const record = JSON.parse(stderrChunks[0]!) as Record<string, unknown>;
    expect(record['msg']).toBe('hello');
    expect(record['service']).toBe('svc');
  });

  it('writes a terminal line to stderr and nothing to stdout', () => {
    createLogger('svc', { format: 'terminal', destination: 'stderr' }).info('hello');

    expect(stdoutChunks).toEqual([]);
    expect(stderrChunks).toHaveLength(1);
    expect(isJson(stderrChunks[0]!)).toBe(false);
    expect(stderrChunks[0]).toContain('hello');
  });

  it('reads the TTY rung from stderr when the destination is stderr', () => {
    const line = logOnTtyStderr({ destination: 'stderr' });

    expect(isJson(line)).toBe(false);
    expect(line).toContain('hello');
  });

  it('reads the TTY rung from stdout by default', () => {
    fakeIsTTY('stderr', true);
    fakeIsTTY('stdout', undefined);
    createLogger('svc').info('hello');

    expect(stderrChunks).toEqual([]);
    expect(stdoutChunks).toHaveLength(1);
    expect(isJson(stdoutChunks[0]!)).toBe(true);
  });

  it('lets LOG_FORMAT outrank the TTY rung of stderr', () => {
    setEnv('LOG_FORMAT', 'json');
    const line = logOnTtyStderr({ destination: 'stderr' });

    expect(isJson(line)).toBe(true);
  });

  it('lets the format option outrank the TTY rung of stderr', () => {
    const line = logOnTtyStderr({ destination: 'stderr', format: 'json' });

    expect(isJson(line)).toBe(true);
  });

  it('honours a process.stderr.write swapped after createLogger ran', () => {
    const logger = createLogger('svc', { format: 'json', destination: 'stderr' });
    const spied = process.stderr.write;
    const swapped: string[] = [];
    process.stderr.write = ((chunk: string | Uint8Array) => {
      swapped.push(asText(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      logger.info('after the swap');
    } finally {
      process.stderr.write = spied;
    }

    expect(stderrChunks).toEqual([]);
    expect(swapped).toHaveLength(1);
    expect((JSON.parse(swapped[0]!) as Record<string, unknown>)['msg']).toBe('after the swap');
  });
});
