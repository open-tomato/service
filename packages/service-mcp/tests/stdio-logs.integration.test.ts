/**
 * Integration test for a stdio createMCP server: stdout carries nothing but
 * JSON-RPC messages, and the logs go to stderr.
 *
 * Spawns `fixtures/stdio-server.ts` under `MCP_TRANSPORT=stdio` and
 * `LOG_LEVEL=debug`, drives it with JSON-RPC lines on its stdin, and collects
 * its stdout and stderr whole.
 */
import type { ChildProcess } from 'node:child_process';

import { spawn } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DEBUG_MESSAGE, INFO_MESSAGE, TOOL_NAME, TOOL_RESULT } from './fixtures/stdio-constants.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/stdio-server.ts', import.meta.url));
const REGISTER_HOOK = fileURLToPath(new URL('./fixtures/register-ts-resolve.mjs', import.meta.url));

/**
 * Node strips TypeScript types by default from 22.18 on. An older Node 22, which the engines range
 * allows, needs the flag to load the `.ts` fixture; Bun reports no `false` and runs it as is.
 */
const STRIP_TYPES_FLAGS = process.features.typescript === false
  ? ['--experimental-strip-types']
  : [];

const PROTOCOL_VERSION = '2025-03-26';
const INITIALIZE_ID = 1;
const CALL_ID = 2;
const EXCHANGE_TIMEOUT_MS = 20_000;

/** One JSON-RPC message as the test reads it back. */
interface RpcMessage {
  jsonrpc?: unknown;
  id?: number;
  result?: { content?: { type: string; text: string }[] };
}

describe('createMCP over stdio — log output', () => {
  let child: ChildProcess;
  let stdout = '';
  let stderr = '';
  let messages: RpcMessage[] = [];
  let stdoutLines: string[] = [];

  /** Resolves with the parsed message carrying `id`, once stdout holds it. */
  function waitForResponse(id: number): Promise<RpcMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`no response to request ${id}; stderr: ${stderr}`));
      }, EXCHANGE_TIMEOUT_MS);
      const check = (): void => {
        const found = stdout.split('\n')
          .filter(line => line.trim() !== '')
          .map(line => JSON.parse(line) as RpcMessage)
          .find(message => message.id === id);
        if (found === undefined) return;
        clearTimeout(timer);
        child.stdout?.off('data', check);
        resolve(found);
      };
      child.stdout?.on('data', check);
      check();
    });
  }

  /** Writes `message` to the child's stdin as one JSON-RPC line. */
  function send(message: object): void {
    child.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  }

  beforeAll(async () => {
    child = spawn(process.execPath, [...STRIP_TYPES_FLAGS, '--import', REGISTER_HOOK, FIXTURE], {
      env: {
        ...process.env,
        MCP_TRANSPORT: 'stdio',
        LOG_LEVEL: 'debug',
        LOG_FORMAT: 'json',
        NODE_ENV: 'test',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });

    const initialized = waitForResponse(INITIALIZE_ID);
    send({
      id: INITIALIZE_ID,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'stdio-logs-test', version: '1.0.0' },
      },
    });
    await initialized;
    send({ method: 'notifications/initialized' });

    const called = waitForResponse(CALL_ID);
    send({ id: CALL_ID, method: 'tools/call', params: { name: TOOL_NAME, arguments: {} } });
    await called;

    stdoutLines = stdout.split('\n').filter(line => line.trim() !== '');
    messages = stdoutLines.map(line => JSON.parse(line) as RpcMessage);
  }, EXCHANGE_TIMEOUT_MS * 2);

  afterAll(() => {
    child.kill();
  });

  it('writes only JSON-RPC 2.0 messages to stdout', () => {
    expect(stdoutLines.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(message.jsonrpc).toBe('2.0');
    }
  });

  it('answers the tool call with its result', () => {
    const response = messages.find(message => message.id === CALL_ID);

    expect(response?.result?.content).toEqual([{ type: 'text', text: TOOL_RESULT }]);
  });

  it('writes the debug and info lines to stderr', () => {
    expect(stderr).toContain(DEBUG_MESSAGE);
    expect(stderr).toContain(INFO_MESSAGE);
  });

  it('keeps the debug and info lines out of stdout', () => {
    expect(stdout).not.toContain(DEBUG_MESSAGE);
    expect(stdout).not.toContain(INFO_MESSAGE);
  });
});
