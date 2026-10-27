import type { Dependency, ServiceLogger } from '@open-tomato/service';
import type { Server } from 'http';

/**
 * Gracefully stops the HTTP server and all dependencies in reverse order.
 *
 * Closes the server to stop accepting new connections, then waits up to
 * `drainTimeout` ms for existing connections to drain before force-closing.
 * Dependencies are stopped in reverse of the order they were provided.
 *
 * In `NODE_ENV=test` mode, `process.exit` is suppressed so tests can assert
 * without the process terminating.
 *
 * @param server - The HTTP server to close.
 * @param dependencies - Dependencies to stop, in registration order (reversed internally).
 * @param logger - Logger for shutdown events.
 * @param drainTimeout - Milliseconds to wait for connections to drain before forcing close.
 */
export async function gracefulStop(
  server: Server,
  dependencies: Dependency[],
  logger: ServiceLogger,
  drainTimeout = 10_000,
): Promise<void> {
  logger.info('shutdown: stopping new connections');
  // Armed before waiting: close() resolves only once every open connection
  // has ended, so a timer set after it could never fire.
  const forceClose = setTimeout(() => {
    logger.warn('shutdown: drain timeout reached — forcing close');
    server.closeAllConnections();
  }, drainTimeout);
  await new Promise<void>(resolve => server.close(() => resolve()));
  clearTimeout(forceClose);

  for (const dep of [...dependencies].reverse()) {
    try {
      await dep.stop();
      logger.info({ dep: dep.name }, 'dependency stopped');
    } catch {
      logger.error({ dep: dep.name }, 'dependency stop failed');
    }
  }

  if (process.env.NODE_ENV !== 'test') process.exit(0);
}

/**
 * Registers `SIGTERM`, `SIGINT`, and `uncaughtException` handlers that trigger
 * a single graceful shutdown sequence.
 *
 * Multiple signals are de-duplicated via the `shutting` flag — only the first
 * signal triggers shutdown.
 *
 * @param server - The HTTP server to shut down.
 * @param dependencies - Dependencies to stop on shutdown.
 * @param logger - Logger for shutdown events.
 * @param drainTimeout - Milliseconds to wait for connections to drain before forcing close.
 */
export function registerShutdown(
  server: Server,
  dependencies: Dependency[],
  logger: ServiceLogger,
  drainTimeout: number,
): void {
  let shutting = false;
  const once = (signal: string) => async () => {
    if (shutting) return;
    shutting = true;
    logger.info({ signal }, 'shutdown initiated');
    await gracefulStop(server, dependencies, logger, drainTimeout);
  };
  process.once('SIGTERM', once('SIGTERM'));
  process.once('SIGINT', once('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error({ err: String(err) }, 'uncaught exception — shutting down');
    once('uncaughtException')();
  });
}
