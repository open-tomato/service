import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger, ClientsMap, TypedClient } from '@open-tomato/service';
import type { LoggerOptions } from '@open-tomato/service-logger';

export type { ClientsMap };

/**
 * Transport mode for the MCP server.
 *
 * - `'http'` — default; used for deployed servers via `StreamableHTTPServerTransport` on a Node HTTP server
 * - `'stdio'` — enabled via `MCP_TRANSPORT=stdio`; used for local dev and Claude Desktop
 */
export type MCPTransport = 'http' | 'stdio';

/**
 * Runtime context injected into the `setup` callback by `createMCP`.
 *
 * Provides access to the scoped logger and the map of started HTTP clients
 * so that tool implementations can log and call external services without
 * importing infrastructure directly.
 */
export interface MCPContext {
  /** Structured logger scoped to the MCP service's `serviceId`. */
  logger: Logger
  /**
   * Map of started `TypedClient` instances keyed by their identifier.
   * Populated from the `clients` array passed to `MCPConfig`.
   */
  clients: ClientsMap
}

/**
 * Handle returned by `createMCP` after the server has started.
 *
 * Use this to gracefully shut down the server and discover the health
 * endpoint URL for readiness checks.
 */
export interface MCPHandle {
  /**
   * Gracefully stop the MCP server and all managed HTTP clients.
   * Resolves once all resources have been released.
   */
  stop(): Promise<void>

  /**
   * Returns the full URL of the health endpoint (e.g. `http://localhost:3001/health`).
   * Not available in `stdio` mode — returns an empty string in that case.
   */
  healthUrl(): string
}

/**
 * Configuration for the standalone HTTP health endpoint used by `createMCP`.
 *
 * All fields are optional; `createMCP` applies defaults via the Zod schema
 * in `schema.ts` before starting the health server.
 *
 * Not used in `stdio` transport mode.
 */
export interface HealthConfig {
  /**
   * Port on which the health server listens. When omitted, the
   * `HEALTH_PORT` environment variable is read, then `3001`.
   */
  port?: number
  /**
   * When `true`, a taken health port rejects with `PortInUseError` instead
   * of falling back to a later port. When omitted, the
   * `HEALTH_PORT_STRICT` environment variable is read (`true` or `1`), then
   * `false`.
   */
  strictPort?: boolean
  /**
   * URL path for the health check route.
   * @default '/health'
   */
  path?: string
}

/**
 * Input configuration accepted by `createMCP`.
 *
 * All fields except `serviceId` and `setup` are optional; `createMCP` applies
 * safe defaults via {@link ResolvedMCPConfig} before starting the server.
 */
export interface MCPConfig {
  /**
   * Unique identifier for this MCP service.
   * Used as the logger scope, service name in health responses, and as a
   * human-readable label in logs and error messages.
   */
  serviceId: string

  /**
   * HTTP clients to start before invoking `setup`.
   * Each client is wrapped with retry and circuit-breaker protection by
   * `createHttpClient` and made available via `MCPContext.clients`.
   *
   * @default []
   */
  clients?: TypedClient<unknown>[]

  /**
   * Callback that registers tools, resources, and prompts against the
   * `McpServer` instance. Called once during server startup after all
   * clients have been started.
   *
   * May be async — `createMCP` awaits it before opening the transport.
   *
   * @param server - The MCP SDK server instance to register tools against.
   * @param ctx    - Runtime context providing the logger and clients map.
   */
  setup: (server: McpServer, ctx: MCPContext) => void | Promise<void>

  /**
   * Port for the HTTP transport. When omitted, the `PORT` environment
   * variable is read, then `8080`. Not used in `stdio` transport mode.
   */
  port?: number

  /**
   * When `true`, a taken transport port rejects with `PortInUseError`
   * instead of falling back to a later port. When omitted, the
   * `PORT_STRICT` environment variable is read (`true` or `1`), then
   * `false`.
   */
  strictPort?: boolean

  /**
   * Version of the MCP server, passed to `McpServer` and shown in the
   * startup banner.
   *
   * @default 'unknown'
   */
  version?: string

  /**
   * Feature flags or settings shown in the startup banner.
   *
   * @default {}
   */
  features?: Record<string, string | number | boolean>

  /**
   * Configuration for the standalone HTTP health endpoint.
   * Not used in `stdio` transport mode.
   */
  health?: HealthConfig

  /**
   * Logger configuration forwarded to `@open-tomato/service-logger` `createLogger`.
   * When omitted, sensible defaults are applied (level from `LOG_LEVEL` env var,
   * falls back to `'info'`).
   */
  logger?: LoggerOptions
}

/**
 * Fully resolved MCP configuration after defaults have been applied.
 *
 * This is the shape that `createMCP` works with internally after validating
 * and defaulting the caller-supplied {@link MCPConfig} through the Zod schema
 * in `schema.ts`. All optional fields with defaults are now required.
 */
export interface ResolvedMCPConfig {
  /** @see MCPConfig.serviceId */
  serviceId: string
  /** Started HTTP clients; defaults to `[]` when not provided by the caller. */
  clients: TypedClient<unknown>[]
  /** @see MCPConfig.setup */
  setup: (server: McpServer, ctx: MCPContext) => void | Promise<void>
  /** @see MCPConfig.port — left unset so `resolvePortConfig` can read `PORT`. */
  port?: number
  /** @see MCPConfig.strictPort — left unset so `resolvePortConfig` can read `PORT_STRICT`. */
  strictPort?: boolean
  /** @see MCPConfig.version */
  version: string
  /** @see MCPConfig.features */
  features: Record<string, string | number | boolean>
  /** Health endpoint configuration with the path default applied. */
  health: {
    /** @see HealthConfig.port — left unset so `resolvePortConfig` can read `HEALTH_PORT`. */
    port?: number
    /** @see HealthConfig.strictPort — left unset so `resolvePortConfig` can read `HEALTH_PORT_STRICT`. */
    strictPort?: boolean
    /** @default '/health' */
    path: string
  }
  /** @see MCPConfig.logger */
  logger?: LoggerOptions
}
