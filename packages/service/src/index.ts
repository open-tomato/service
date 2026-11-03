// Public exports for @open-tomato/service

export { createDependency } from './dependency.js';
export type { CreateDependencyOpts, CreateTypedDependencyOpts } from './dependency.js';
export type { Dependency, DependencyStatus, TypedDependency, InferInstance, DepsMap } from './types.js';

export { createHttpClient } from './http-client.js';
export { CircuitBreaker, CircuitOpenError } from './circuit-breaker.js';
export type { CircuitState } from './circuit-breaker.js';
export { withRetry } from './retry.js';
export type { TypedClient, ClientsMap, HttpClientOpts, RetryConfig, CircuitBreakerConfig } from './types.js';

export { createConsoleLogger } from './logger.js';
export type { ConsoleLoggerOptions, Logger, LogLevel, LogSink } from './logger.js';
export type { ServicePlugin } from './types.js';
