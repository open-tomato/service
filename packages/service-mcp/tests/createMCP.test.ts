import type { MCPConfig } from '../src/types.js';
import type { Mock } from 'vitest';

import process from 'node:process';

import { PortInUseError } from '@open-tomato/service';
import { createLogger } from '@open-tomato/service-logger';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMCP } from '../src/create-mcp.js';
import { startHealthServer } from '../src/health.js';
import { resolveTransport, wireHttpTransport } from '../src/transport.js';

const mocks = vi.hoisted(() => {
  const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const mockTransportClose = vi.fn().mockResolvedValue(undefined);
  const mockTransportInstance = { close: mockTransportClose, port: 8080, requested: 8080, fellBack: false };
  const mockHealthStop = vi.fn();
  const mockHealthServerInstance = { stop: mockHealthStop, port: 3001, requested: 3001, fellBack: false };
  const serverInstances: object[] = [];
  const serverInfos: unknown[] = [];

  return {
    mockLogger,
    mockTransportClose,
    mockTransportInstance,
    mockHealthStop,
    mockHealthServerInstance,
    serverInstances,
    serverInfos,
  };
});

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  class McpServer {
    constructor(info: unknown) {
      mocks.serverInstances.push(this as object);
      mocks.serverInfos.push(info);
    }
  }
  return { McpServer };
});

vi.mock('@open-tomato/service-logger', () => ({
  createLogger: vi.fn().mockReturnValue(mocks.mockLogger),
}));

vi.mock('../src/transport.js', () => ({
  resolveTransport: vi.fn().mockReturnValue('http'),
  wireHttpTransport: vi.fn().mockResolvedValue(mocks.mockTransportInstance),
  wireStdioTransport: vi.fn().mockResolvedValue(mocks.mockTransportInstance),
}));

vi.mock('../src/health.js', () => ({
  startHealthServer: vi.fn().mockResolvedValue(mocks.mockHealthServerInstance),
  buildHealthResponse: vi.fn(),
}));

function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

type HttpHandle = Awaited<ReturnType<typeof wireHttpTransport>>;
type HealthHandle = Awaited<ReturnType<typeof startHealthServer>>;

/** Makes the next HTTP transport and health server report these picks. */
function pickPorts(http: Partial<HttpHandle>, health: Partial<HealthHandle>): void {
  vi.mocked(wireHttpTransport).mockResolvedValueOnce(
    { ...mocks.mockTransportInstance, ...http } as unknown as HttpHandle,
  );
  vi.mocked(startHealthServer).mockResolvedValueOnce(
    { ...mocks.mockHealthServerInstance, ...health } as unknown as HealthHandle,
  );
}

/** The `started` records the server's logger received. */
function startedRecords(): unknown[] {
  return mocks.mockLogger.info.mock.calls
    .filter(call => call[1] === 'started')
    .map(call => call[0] as unknown);
}

describe('createMCP', () => {
  let mockSetup: Mock<MCPConfig['setup']>;

  function makeConfig(overrides?: Partial<MCPConfig>): MCPConfig {
    return { serviceId: 'test-mcp', setup: mockSetup, ...overrides };
  }

  beforeEach(() => {
    process.removeAllListeners('SIGTERM');
    vi.clearAllMocks();
    mocks.serverInstances.length = 0;
    mocks.serverInfos.length = 0;
    mocks.mockTransportClose.mockResolvedValue(undefined);
    mockSetup = vi.fn<MCPConfig['setup']>().mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.removeAllListeners('SIGTERM');
    vi.unstubAllEnvs();
  });

  // Negative tests

  it('throws synchronously when serviceId is missing', () => {
    // MCPConfigSchema.parse throws for missing required fields
    expect(() => createMCP({ serviceId: '', setup: mockSetup })).toThrow();
  });

  it('does not start health server when setup rejects', async () => {
    const { startHealthServer } = await import('../src/health.js');
    mockSetup.mockRejectedValueOnce(new Error('setup failed'));

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    createMCP(makeConfig());
    await tick();

    expect(startHealthServer).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('SIGTERM before startup completes does not hang', async () => {
    // Emit SIGTERM synchronously after createMCP (before start() resolves).
    // The handler is registered before start() is called, so shutdown() fires
    // immediately with transportInstance and healthServer still null — both
    // optional-chain calls are safe no-ops and the promise resolves.
    createMCP(makeConfig());
    process.emit('SIGTERM');

    // Allow all microtasks / macrotasks to settle.
    await tick();

    // No assertions needed — the test passes if it does not hang or throw.
  });

  // Positive tests

  it('minimal config registers no clients and starts health server at default port', async () => {
    const { startHealthServer } = await import('../src/health.js');

    createMCP(makeConfig());
    await tick();

    expect(startHealthServer).toHaveBeenCalledWith(
      expect.objectContaining({ port: 3001 }),
    );
    expect(mockSetup).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ clients: {} }),
    );
  });

  it('calls setup with the McpServer instance and context', async () => {
    createMCP(makeConfig());
    await tick();

    expect(mockSetup).toHaveBeenCalledOnce();
    expect(mockSetup).toHaveBeenCalledWith(
      mocks.serverInstances[0],
      expect.objectContaining({
        logger: mocks.mockLogger,
        clients: {},
      }),
    );
  });

  it('clients are accessible in MCPContext', async () => {
    const mockClient = { name: 'test-client' } as NonNullable<Parameters<typeof createMCP>[0]['clients']>[number];

    createMCP(makeConfig({ clients: [mockClient] }));
    await tick();

    expect(mockSetup).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        clients: { 'test-client': mockClient },
      }),
    );
  });

  it('SIGTERM triggers shutdown: closes transport and stops health server', async () => {
    createMCP(makeConfig());
    await tick();

    process.emit('SIGTERM');
    await tick();

    expect(mocks.mockTransportClose).toHaveBeenCalled();
    expect(mocks.mockHealthStop).toHaveBeenCalled();
  });

  it('healthUrl() names the asked health port before ready', () => {
    const handle = createMCP(makeConfig({ health: { port: 3099, path: '/health' } }));
    expect(handle.healthUrl()).toBe('http://localhost:3099/health');
  });

  it('calls wireHttpTransport when resolveTransport returns "http"', async () => {
    const { resolveTransport, wireHttpTransport, wireStdioTransport } = await import('../src/transport.js');
    vi.mocked(resolveTransport).mockReturnValueOnce('http');

    createMCP(makeConfig());
    await tick();

    expect(wireHttpTransport).toHaveBeenCalledOnce();
    expect(wireStdioTransport).not.toHaveBeenCalled();
  });

  it('calls wireStdioTransport when resolveTransport returns "stdio"', async () => {
    const { resolveTransport, wireHttpTransport, wireStdioTransport } = await import('../src/transport.js');
    vi.mocked(resolveTransport).mockReturnValueOnce('stdio');

    createMCP(makeConfig());
    await tick();

    expect(wireStdioTransport).toHaveBeenCalledOnce();
    expect(wireHttpTransport).not.toHaveBeenCalled();
  });

  it('starts health server after transport is connected in HTTP mode', async () => {
    const { startHealthServer } = await import('../src/health.js');
    const { resolveTransport, wireHttpTransport } = await import('../src/transport.js');
    vi.mocked(resolveTransport).mockReturnValueOnce('http');

    let transportResolved = false;
    vi.mocked(wireHttpTransport).mockImplementationOnce(async () => {
      transportResolved = true;
      return mocks.mockTransportInstance as unknown as Awaited<ReturnType<typeof wireHttpTransport>>;
    });

    let healthCalledAfterTransport = false;
    vi.mocked(startHealthServer).mockImplementationOnce(async () => {
      healthCalledAfterTransport = transportResolved;
      return mocks.mockHealthServerInstance as unknown as Awaited<ReturnType<typeof startHealthServer>>;
    });

    createMCP(makeConfig());
    await tick();

    expect(startHealthServer).toHaveBeenCalledOnce();
    expect(healthCalledAfterTransport).toBe(true);
  });

  it('does not start health server in stdio mode', async () => {
    const { startHealthServer } = await import('../src/health.js');
    const { resolveTransport } = await import('../src/transport.js');
    vi.mocked(resolveTransport).mockReturnValueOnce('stdio');

    createMCP(makeConfig());
    await tick();

    expect(startHealthServer).not.toHaveBeenCalled();
  });

  it('calls process.exit(1) when start() throws outside NODE_ENV=test', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { wireHttpTransport } = await import('../src/transport.js');
    vi.mocked(wireHttpTransport).mockRejectedValueOnce(new Error('boom'));

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const handle = createMCP(makeConfig());
    await expect(handle.ready()).rejects.toThrow('boom');
    await tick();

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('rejects ready() with the start error and does not exit under NODE_ENV=test', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const error = new PortInUseError({ port: 8080, configKey: 'port' });
    vi.mocked(wireHttpTransport).mockRejectedValueOnce(error);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    const handle = createMCP(makeConfig());
    await expect(handle.ready()).rejects.toBe(error);
    await tick();

    expect(exitSpy).not.toHaveBeenCalled();
    expect(mocks.mockLogger.error).toHaveBeenCalledWith({ err: error }, 'Failed to start MCP server');
    expect(startedRecords()).toEqual([]);
    exitSpy.mockRestore();
  });

  it('leaves no rejection unhandled when ready() is never called', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    vi.mocked(wireHttpTransport).mockRejectedValueOnce(new Error('boom'));

    createMCP(makeConfig());
    await tick();
    await tick();

    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toEqual([]);
  });

  it('closes the transport and rejects ready() when the health server cannot listen', async () => {
    const error = new PortInUseError({ port: 3001, configKey: 'health.port' });
    vi.mocked(startHealthServer).mockRejectedValueOnce(error);

    const handle = createMCP(makeConfig());

    await expect(handle.ready()).rejects.toBe(error);
    expect(mocks.mockTransportClose).toHaveBeenCalledOnce();
    expect(startedRecords()).toEqual([]);
  });

  // ready(), healthUrl() and the banner

  it('resolves ready() with the bound ports and URLs in HTTP mode', async () => {
    pickPorts({ port: 8123 }, { port: 3123 });

    const handle = createMCP(makeConfig({ health: { path: '/healthz' } }));

    await expect(handle.ready()).resolves.toEqual({
      transport: 'http',
      port: 8123,
      url: 'http://localhost:8123',
      healthPort: 3123,
      healthUrl: 'http://localhost:3123/healthz',
    });
  });

  it('healthUrl() names the bound health port once ready', async () => {
    pickPorts({}, { port: 3005, requested: 3001, fellBack: true });

    const handle = createMCP(makeConfig());
    await handle.ready();

    expect(handle.healthUrl()).toBe('http://localhost:3005/health');
  });

  it('resolves ready() with the transport alone in stdio mode', async () => {
    vi.mocked(resolveTransport).mockReturnValueOnce('stdio');

    const handle = createMCP(makeConfig());

    await expect(handle.ready()).resolves.toEqual({ transport: 'stdio' });
    expect(handle.healthUrl()).toBe('');
  });

  it('logs the stdio started record with transport stdio and no url once connected', async () => {
    vi.mocked(resolveTransport).mockReturnValueOnce('stdio');

    const handle = createMCP(makeConfig({ version: '1.4.0', features: { search: true } }));
    await handle.ready();

    expect(startedRecords()).toEqual([{
      service: 'test-mcp',
      version: '1.4.0',
      transport: 'stdio',
      features: { search: true },
    }]);
  });

  it('writes no stdio started record before the transport is connected', async () => {
    const { wireStdioTransport } = await import('../src/transport.js');
    vi.mocked(resolveTransport).mockReturnValueOnce('stdio');
    vi.mocked(wireStdioTransport).mockRejectedValueOnce(new Error('no stdin'));

    const handle = createMCP(makeConfig());

    await expect(handle.ready()).rejects.toThrow('no stdin');
    expect(startedRecords()).toEqual([]);
  });

  // The logger's destination

  it('resolves the transport once, before the logger is built', () => {
    createMCP(makeConfig());

    expect(resolveTransport).toHaveBeenCalledOnce();
    expect(vi.mocked(resolveTransport).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(createLogger).mock.invocationCallOrder[0] ?? 0);
  });

  it('hands createLogger destination stderr on stdio', () => {
    vi.mocked(resolveTransport).mockReturnValueOnce('stdio');

    createMCP(makeConfig());

    expect(createLogger).toHaveBeenCalledWith('test-mcp', { destination: 'stderr' });
  });

  it('hands createLogger destination stdout on HTTP', () => {
    vi.mocked(resolveTransport).mockReturnValueOnce('http');

    createMCP(makeConfig({ logger: { format: 'json' } }));

    expect(createLogger).toHaveBeenCalledWith('test-mcp', { format: 'json', destination: 'stdout' });
  });

  it('lets a destination in the logger config win over the stdio pick', () => {
    vi.mocked(resolveTransport).mockReturnValueOnce('stdio');

    createMCP(makeConfig({ logger: { destination: 'stdout' } }));

    expect(createLogger).toHaveBeenCalledWith('test-mcp', { destination: 'stdout' });
  });

  it('logs one started record with the bound URLs, version and features', async () => {
    pickPorts({ port: 8080 }, { port: 3001 });

    const handle = createMCP(makeConfig({ version: '2.1.0', features: { cache: 'redis', auth: true } }));
    await handle.ready();

    expect(startedRecords()).toEqual([{
      service: 'test-mcp',
      version: '2.1.0',
      transport: 'http',
      url: 'http://localhost:8080',
      features: { cache: 'redis', auth: true },
      healthUrl: 'http://localhost:3001/health',
    }]);
  });

  it('puts fallbackPort and healthFallbackPort on the started record when both fell back', async () => {
    pickPorts(
      { port: 8081, requested: 8080, fellBack: true },
      { port: 3002, requested: 3001, fellBack: true },
    );

    const handle = createMCP(makeConfig());
    await handle.ready();

    expect(startedRecords()).toEqual([expect.objectContaining({
      url: 'http://localhost:8081',
      fallbackPort: 8080,
      healthUrl: 'http://localhost:3002/health',
      healthFallbackPort: 3001,
    })]);
  });

  it('defaults the banner version and features to unknown and {}', async () => {
    const handle = createMCP(makeConfig());
    await handle.ready();

    expect(startedRecords()).toEqual([expect.objectContaining({ version: 'unknown', features: {} })]);
  });

  it('passes the configured version to McpServer, unknown when none is given', () => {
    createMCP(makeConfig({ version: '3.0.0' }));
    createMCP(makeConfig());

    expect(mocks.serverInfos).toEqual([
      { name: 'test-mcp', version: '3.0.0' },
      { name: 'test-mcp', version: 'unknown' },
    ]);
  });
});
