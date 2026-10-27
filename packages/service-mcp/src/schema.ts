import type { MCPContext } from './types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LoggerOptions, TypedClient } from '@open-tomato/service';

import { z } from 'zod';

/**
 * Zod schema for validating and defaulting `MCPConfig` input.
 *
 * Fields:
 * - `serviceId` — required non-empty string; used as logger scope and service label
 * - `clients` — array of `TypedClient<unknown>` instances; defaults to `[]`
 * - `setup` — required callback that registers tools/resources/prompts against the `McpServer`
 * - `health.port` — port for the standalone health server; defaults to `3001`
 * - `health.path` — URL path for the health check route; defaults to `'/health'`
 * - `logger` — optional `LoggerOptions` forwarded to `@open-tomato/service-logger`; sensible defaults applied when omitted
 */
export const MCPConfigSchema = z.object({
  serviceId: z.string().min(1),
  clients: z.array(z.custom<TypedClient<unknown>>()).default([]),
  setup: z.custom<(server: McpServer, ctx: MCPContext) => void | Promise<void>>(
    (val) => typeof val === 'function',
  ),
  health: z.object({
    port: z.number().int()
      .default(3001),
    path: z.string().default('/health'),
  }).prefault({}),
  logger: z.custom<LoggerOptions>().optional(),
});
