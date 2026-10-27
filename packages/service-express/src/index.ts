export { createService } from './create-service.js';
export {
  buildRequireAuth,
  buildOptionalAuth,
  createIntrospectVerifier,
  getSession,
  passthroughMiddleware,
} from './auth.js';
export type { SessionClaims, SessionVerifier } from './auth.js';
export type { ServiceConfig, ResolvedServiceConfig } from './schema.js';
export type { ServiceHandle, ServiceContext, ClientsMap } from './types.js';
export { createDependency, createHttpClient } from '@open-tomato/service';
export type { Dependency, TypedDependency, DepsMap, TypedClient, ServicePlugin } from '@open-tomato/service';
export type {
  ControlConfig,
  DependencyControlStatus,
  ClientControlStatus,
  ControlStatusResponse,
  PausableDependency,
  RestartableDependency,
  HealthDetailProvider,
} from './control/types.js';
export { isPausableDependency, isRestartableDependency, isHealthDetailProvider } from './control/types.js';
