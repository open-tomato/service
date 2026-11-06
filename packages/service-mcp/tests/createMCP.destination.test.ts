import type { MCPConfig } from '../src/types.js';
import type { MockInstance } from 'vitest';

import process from 'node:process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMCP } from '../src/create-mcp.js';
import { resolveTransport } from '../src/transport.js';

const mocks = vi.hoisted(() => {
  const transportClose = vi.fn().mockResolvedValue(undefined);
  const transport = { close: transportClose, port: 8080, requested: 8080, fellBack: false };
  const healthServer = { stop: vi.fn(), port: 3001, requested: 3001, fellBack: false };
  return { transportClose, transport, healthServer };
});

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class McpServer {},
}));

vi.mock('../src/transport.js', () => ({
  resolveTransport: vi.fn().mockReturnValue('http'),
  wireHttpTransport: vi.fn().mockResolvedValue(mocks.transport),
  wireStdioTransport: vi.fn().mockResolvedValue(mocks.transport),
}));

vi.mock('../src/health.js', () => ({
  startHealthServer: vi.fn().mockResolvedValue(mocks.healthServer),
  buildHealthResponse: vi.fn(),
}));

const SETUP_MESSAGE = 'setup line for destination test';

/** Every line the spy received, joined. */
function written(spy: MockInstance): string {
  return spy.mock.calls.map(call => String(call[0])).join('');
}

describe('createMCP log destination', () => {
  let stdoutSpy: MockInstance;
  let stderrSpy: MockInstance;
  let savedFormat: string | undefined;
  let savedLevel: string | undefined;

  function makeConfig(overrides?: Partial<MCPConfig>): MCPConfig {
    return {
      serviceId: 'destination-mcp',
      setup: (_server, { logger }) => {
        logger.info(SETUP_MESSAGE);
      },
      ...overrides,
    };
  }

  beforeEach(() => {
    process.removeAllListeners('SIGTERM');
    savedFormat = process.env['LOG_FORMAT'];
    savedLevel = process.env['LOG_LEVEL'];
    process.env['LOG_FORMAT'] = 'json';
    process.env['LOG_LEVEL'] = 'info';
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    if (savedFormat === undefined) delete process.env['LOG_FORMAT'];
    else process.env['LOG_FORMAT'] = savedFormat;
    if (savedLevel === undefined) delete process.env['LOG_LEVEL'];
    else process.env['LOG_LEVEL'] = savedLevel;
    process.removeAllListeners('SIGTERM');
    vi.mocked(resolveTransport).mockReturnValue('http');
  });

  it('writes the setup line, the started banner and the shutdown lines to stderr only on stdio', async () => {
    vi.mocked(resolveTransport).mockReturnValue('stdio');

    const handle = createMCP(makeConfig());
    await handle.ready();
    await handle.stop();

    const err = written(stderrSpy);
    expect(err).toContain(SETUP_MESSAGE);
    expect(err).toContain('"transport":"stdio"');
    expect(err).toContain('started');
    expect(err).toContain('Shutting down MCP server...');
    expect(err).toContain('Shutdown complete');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('writes the service name once on the started line, from the logger binding', async () => {
    vi.mocked(resolveTransport).mockReturnValue('stdio');

    const handle = createMCP(makeConfig());
    await handle.ready();
    await handle.stop();

    const started = written(stderrSpy).split('\n')
      .find(line => line.includes('"msg":"started"'));
    expect(started).toBeDefined();
    expect(started!.split('"service":')).toHaveLength(2);
  });

  it('writes the setup line to stdout only on HTTP', async () => {
    const handle = createMCP(makeConfig());
    await handle.ready();

    expect(written(stdoutSpy)).toContain(SETUP_MESSAGE);
    expect(written(stderrSpy)).not.toContain(SETUP_MESSAGE);
    await handle.stop();
  });

  it('writes the setup line to stdout on stdio when the logger config names stdout', async () => {
    vi.mocked(resolveTransport).mockReturnValue('stdio');

    const handle = createMCP(makeConfig({ logger: { destination: 'stdout' } }));
    await handle.ready();

    expect(written(stdoutSpy)).toContain(SETUP_MESSAGE);
    expect(written(stderrSpy)).not.toContain(SETUP_MESSAGE);
    await handle.stop();
  });
});
