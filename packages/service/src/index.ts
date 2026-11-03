// Public exports for @open-tomato/service

export { createDependency } from './dependency.js';
export type { CreateDependencyOpts, CreateTypedDependencyOpts } from './dependency.js';
export type { Dependency, DependencyStatus, TypedDependency, InferInstance, DepsMap } from './types.js';

export { createHttpClient } from './http-client.js';
export { CircuitBreaker, CircuitOpenError } from './circuit-breaker.js';
export type { CircuitState } from './circuit-breaker.js';
export { withRetry } from './retry.js';
export type { TypedClient, ClientsMap, HttpClientOpts, RetryConfig, CircuitBreakerConfig } from './types.js';

export { createRuntime } from './runtime.js';
export type { DependencyRecord, Runtime, RuntimeOptions, RuntimeState, StopResult } from './runtime.js';

export {
  controlStatus,
  listDependencies,
  pauseDependency,
  resetClient,
  restartDependency,
  resumeDependency,
  verifyControlToken,
} from './control.js';
export type {
  ClientControlStatus,
  ControlActionBody,
  ControlResult,
  ControlStatusBody,
  ControlStatusOptions,
  ControlTarget,
  DependencyControlStatus,
} from './control.js';

export { BaseServiceConfigSchema, ControlConfigSchema } from './schema.js';
export type { BaseServiceConfig, ControlConfig, ResolvedBaseServiceConfig } from './schema.js';

export { aggregateHealth, HEALTH_HTTP_STATUS } from './health.js';
export type { AggregateHealthOptions, HealthReport, HealthStatus } from './health.js';

export { createConsoleLogger } from './logger.js';
export type { ConsoleLoggerOptions, Logger, LogLevel, LogSink } from './logger.js';
export type { ServicePlugin } from './types.js';
