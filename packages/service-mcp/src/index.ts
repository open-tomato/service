export { createMCP } from './create-mcp.js';
export type { MCPConfig, MCPContext, MCPHandle, MCPTransport, ResolvedMCPConfig, HealthConfig } from './types.js';

export { buildHealthResponse, startHealthServer } from './health.js';
export type { HealthResponse, HealthServerHandle } from './health.js';

export { resolveTransport } from './transport.js';

export { createHttpClient } from '@open-tomato/service';
export type { TypedClient, ClientsMap } from '@open-tomato/service';
