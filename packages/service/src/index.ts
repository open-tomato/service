// Public exports for @open-tomato/service

export { createDependency } from './dependency.js';
export type { CreateDependencyOpts, CreateTypedDependencyOpts } from './dependency.js';
export type { Dependency, DependencyStatus, TypedDependency, InferInstance, DepsMap } from './types.js';

export { createHttpClient } from './http-client.js';
export { CircuitOpenError } from './circuit-breaker.js';
export type { TypedClient, ClientsMap, HttpClientOpts, RetryConfig, CircuitBreakerConfig } from './types.js';

export { createServiceLogger } from './logger.js';
export type { Logger, LoggerOptions, ServiceLogger } from './logger.js';
export type { ServicePlugin } from './types.js';
