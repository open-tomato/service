import type { MCPConfig } from '../src/types.js';
import type { Mock } from 'vitest';

import process from 'node:process';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createMCP } from '../src/create-mcp.js';

const mocks = vi.hoisted(() => {
  const mockLogger = { info: vi.fn(), error: vi.fn() };
  const mockTransportClose = vi.fn().mockResolvedValue(undefined);
  const mockTransportInstance = { close: mockTransportClose };
  const mockHealthStop = vi.fn();
  const mockHealthServerInstance = { stop: mockHealthStop };
  const serverInstances: object[] = [];

  return {
    mockLogger,
    mockTransportClose,
    mockTransportInstance,
    mockHealthStop,
    mockHealthServerInstance,
    serverInstances,
  };
});

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  class McpServer {
    constructor() {
      mocks.serverInstances.push(this as object);
    }
  }
  return { McpServer };
});

vi.mock('@open-tomato/service', () => ({
  createServiceLogger: vi.fn().mockReturnValue(mocks.mockLogger),
}));

vi.mock('../src/transport.js', () => ({
  resolveTransport: vi.fn().mockReturnValue('http'),
  wireHttpTransport: vi.fn().mockResolvedValue(mocks.mockTransportInstance),
  wireStdioTransport: vi.fn().mockResolvedValue(mocks.mockTransportInstance),
}));

vi.mock('../src/health.js', () => ({
  startHealthServer: vi.fn().mockReturnValue(mocks.mockHealthServerInstance),
  buildHealthResponse: vi.fn(),
}));

function tick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
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
    mocks.mockTransportClose.mockResolvedValue(undefined);
    mockSetup = vi.fn<MCPConfig['setup']>().mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.removeAllListeners('SIGTERM');
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

  it('healthUrl() returns the correct URL from health config', () => {
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
    vi.mocked(startHealthServer).mockImplementationOnce(() => {
      healthCalledAfterTransport = transportResolved;
      return mocks.mockHealthServerInstance;
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

  it('calls process.exit(1) when start() throws', async () => {
    const { wireHttpTransport } = await import('../src/transport.js');
    vi.mocked(wireHttpTransport).mockRejectedValueOnce(new Error('boom'));

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);

    createMCP(makeConfig());
    await tick();

    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });
});
