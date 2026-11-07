import type { MCPContext } from './types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TypedClient } from '@open-tomato/service';
import type { LoggerOptions } from '@open-tomato/service-logger';

import { z } from 'zod';

/**
 * Zod schema for validating and defaulting `MCPConfig` input.
 *
 * Fields:
 * - `serviceId` — required non-empty string; used as logger scope and service label
 * - `clients` — array of `TypedClient<unknown>` instances; defaults to `[]`
 * - `setup` — required callback that registers tools/resources/prompts against the `McpServer`
 * - `port` — optional port for the HTTP transport; left unset so `resolvePortConfig` can read `PORT`, then `8080`
 * - `strictPort` — optional; left unset so `resolvePortConfig` can read `PORT_STRICT`, then `false`
 * - `version` — the server version passed to `McpServer` and shown in the banner; defaults to `'unknown'`
 * - `features` — flags or settings shown in the startup banner; defaults to `{}`
 * - `health.port` — optional port for the health server; left unset so `resolvePortConfig` can read `HEALTH_PORT`, then `3001`
 * - `health.strictPort` — optional; left unset so `resolvePortConfig` can read `HEALTH_PORT_STRICT`, then `false`
 * - `health.path` — URL path for the health check route; defaults to `'/health'`
 * - `logger` — optional `LoggerOptions` forwarded to `@open-tomato/service-logger`; sensible defaults applied when omitted
 */
export const MCPConfigSchema: z.ZodObject<{
  serviceId: z.ZodString;
  clients: z.ZodDefault<z.ZodArray<z.ZodCustom<TypedClient<unknown>, TypedClient<unknown>>>>;
  setup: z.ZodCustom<
    (server: McpServer, ctx: MCPContext) => void | Promise<void>,
    (server: McpServer, ctx: MCPContext) => void | Promise<void>
  >;
  port: z.ZodOptional<z.ZodNumber>;
  strictPort: z.ZodOptional<z.ZodBoolean>;
  version: z.ZodDefault<z.ZodString>;
  features: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodUnion<readonly [z.ZodString, z.ZodNumber, z.ZodBoolean]>>>;
  health: z.ZodPrefault<z.ZodObject<{
    port: z.ZodOptional<z.ZodNumber>;
    strictPort: z.ZodOptional<z.ZodBoolean>;
    path: z.ZodDefault<z.ZodString>;
  }, z.core.$strip>>;
  logger: z.ZodOptional<z.ZodCustom<LoggerOptions, LoggerOptions>>;
}, z.core.$strip> = z.object({
  serviceId: z.string().min(1),
  clients: z.array(z.custom<TypedClient<unknown>>()).default([]),
  setup: z.custom<(server: McpServer, ctx: MCPContext) => void | Promise<void>>(
    (val) => typeof val === 'function',
  ),
  port: z.number().int()
    .optional(),
  strictPort: z.boolean().optional(),
  version: z.string().min(1)
    .default('unknown'),
  features: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default(() => ({})),
  health: z.object({
    port: z.number().int()
      .optional(),
    strictPort: z.boolean().optional(),
    path: z.string().default('/health'),
  }).prefault({}),
  logger: z.custom<LoggerOptions>().optional(),
});
