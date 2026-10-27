import type { ControlConfig, ControlStatusResponse } from './types.js';
import type { Dependency } from '@open-tomato/service';
import type { Router as ExpressRouter } from 'express';

import { Router } from 'express';
import { z } from 'zod';

import { controlAuth, controlEnabled } from './middleware.js';
import {
  isHealthDetailProvider,
  isPausableDependency,
  isRestartableDependency,
} from './types.js';
import { aggregateStatus, circuitBreakerState, errorMessage } from './utils.js';
import { readServiceVersion } from './version.js';

/**
 * Zod schema for the `:name` route parameter in dependency and client routes.
 *
 * Rejects empty strings — a non-empty string is required. Express routing
 * ensures this param is always a string when the route matches; this schema
 * adds an explicit defence against empty values.
 */
const nameParamSchema = z.string().min(1);

/**
 * Creates and returns an Express `Router` implementing the `/_control` operator
 * interface.
 *
 * All routes are gated first by `controlEnabled` (returns 404 when the control
 * plane is disabled) then by `controlAuth` (returns 403 when the
 * `x-control-token` header does not match `config.secret`).
 *
 * @param deps - Array of managed `Dependency` instances registered with the service.
 * @param clients - Array of managed HTTP client `Dependency` instances.
 * @param config - Control plane configuration (`enabled`, `secret`).
 * @param serviceId - Unique identifier for this service, included in the status response.
 * @returns A configured Express `Router` that must be mounted at `/_control` in the
 *   host application.
 */
export function createControlRouter(
  deps: Dependency[],
  clients: Dependency[],
  config: ControlConfig,
  serviceId: string,
): ExpressRouter {
  const router = Router();
  const startTime = Date.now();
  const version = readServiceVersion();

  router.use(controlEnabled(config.enabled));
  router.use(controlAuth(config.secret));

  /**
   * GET /_control/status
   *
   * Returns the full runtime status for the service, all dependencies, and all
   * HTTP clients. Always responds HTTP 200 — the payload itself conveys health.
   *
   * `detail` is included per dependency when the dependency implements
   * `HealthDetailProvider`. `uptime` is measured in seconds from router
   * creation time.
   */
  router.get('/status', (_req, res) => {
    const dependenciesStatus: ControlStatusResponse['dependencies'] = {};
    for (const dep of deps) {
      const detail = isHealthDetailProvider(dep)
        ? dep.healthDetail()
        : undefined;
      dependenciesStatus[dep.name] = {
        status: dep.status,
        ...(detail !== undefined
          ? { detail }
          : {}),
      };
    }

    const clientsStatus: ControlStatusResponse['clients'] = {};
    for (const client of clients) {
      clientsStatus[client.name] = {
        status: client.status,
        circuitBreaker: circuitBreakerState(client.status),
      };
    }

    const payload: ControlStatusResponse = {
      serviceId,
      status: aggregateStatus(deps, clients),
      uptime: Math.floor((Date.now() - startTime) / 1000),
      version,
      dependencies: dependenciesStatus,
      clients: clientsStatus,
    };

    res.status(200).json(payload);
  });

  /**
   * GET /_control/dependencies
   *
   * Returns an array of `{ name, status, detail? }` objects — one per registered
   * dependency. `detail` is included only when the dependency implements
   * `HealthDetailProvider`.
   */
  router.get('/dependencies', (_req, res) => {
    const result = deps.map(dep => {
      const detail = isHealthDetailProvider(dep)
        ? dep.healthDetail()
        : undefined;
      return {
        name: dep.name,
        status: dep.status,
        ...(detail !== undefined
          ? { detail }
          : {}),
      };
    });
    res.status(200).json(result);
  });

  /**
   * POST /_control/dependencies/:name/pause
   *
   * Temporarily pauses the named dependency.
   *
   * **Side effects:** calls `dep.pause()` on the matched dependency instance.
   *
   * - `404` when no dependency matches `:name`.
   * - `400` when the dependency does not implement `pause`.
   * - `500` with `{ error: string }` when `dep.pause()` throws.
   * - `200` with `{ ok: true }` on success.
   */
  router.post('/dependencies/:name/pause', async (req, res) => {
    const nameResult = nameParamSchema.safeParse(req.params['name']);
    if (!nameResult.success) {
      res.status(400).json({ error: 'invalid name parameter' });
      return;
    }
    const dep = deps.find(d => d.name === nameResult.data);
    if (!dep) {
      res.status(404).json({ error: 'dependency not found' });
      return;
    }
    if (!isPausableDependency(dep)) {
      res.status(400).json({ error: 'dependency does not support pause' });
      return;
    }
    try {
      await dep.pause();
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  /**
   * POST /_control/dependencies/:name/resume
   *
   * Resumes a previously paused dependency.
   *
   * **Side effects:** calls `dep.resume()` on the matched dependency instance.
   *
   * - `404` when no dependency matches `:name`.
   * - `400` when the dependency does not implement `resume`.
   * - `500` with `{ error: string }` when `dep.resume()` throws.
   * - `200` with `{ ok: true }` on success.
   */
  router.post('/dependencies/:name/resume', async (req, res) => {
    const nameResult = nameParamSchema.safeParse(req.params['name']);
    if (!nameResult.success) {
      res.status(400).json({ error: 'invalid name parameter' });
      return;
    }
    const dep = deps.find(d => d.name === nameResult.data);
    if (!dep) {
      res.status(404).json({ error: 'dependency not found' });
      return;
    }
    if (!isPausableDependency(dep)) {
      res.status(400).json({ error: 'dependency does not support resume' });
      return;
    }
    try {
      await dep.resume();
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  /**
   * POST /_control/dependencies/:name/restart
   *
   * Restarts the named dependency by calling `stop()` then `start()` in sequence.
   *
   * **Side effects:** calls `dep.stop()` followed by `dep.start()` on the matched
   * dependency. `start()` is only called when `stop()` resolves successfully.
   *
   * - `404` when no dependency matches `:name`.
   * - `400` when the dependency does not implement `stop`/`start`.
   * - `500` with `{ error: string }` when `dep.stop()` or `dep.start()` throws.
   * - `200` with `{ ok: true }` on success.
   */
  router.post('/dependencies/:name/restart', async (req, res) => {
    const nameResult = nameParamSchema.safeParse(req.params['name']);
    if (!nameResult.success) {
      res.status(400).json({ error: 'invalid name parameter' });
      return;
    }
    const dep = deps.find(d => d.name === nameResult.data);
    if (!dep) {
      res.status(404).json({ error: 'dependency not found' });
      return;
    }
    if (!isRestartableDependency(dep)) {
      res.status(400).json({ error: 'dependency does not support restart' });
      return;
    }
    try {
      await dep.stop();
      await dep.start();
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  /**
   * POST /_control/clients/:name/reset
   *
   * Resets the named HTTP client by calling `stop()` then `start()`, which
   * clears any stopped state and returns circuit-breaker control to the client.
   *
   * **Side effects:** calls `client.stop()` followed by `client.start()`.
   *
   * - `404` when no client matches `:name`.
   * - `500` with `{ error: string }` when `client.stop()` or `client.start()` throws.
   * - `200` with `{ ok: true }` on success.
   */
  router.post('/clients/:name/reset', async (req, res) => {
    const nameResult = nameParamSchema.safeParse(req.params['name']);
    if (!nameResult.success) {
      res.status(400).json({ error: 'invalid name parameter' });
      return;
    }
    const client = clients.find(c => c.name === nameResult.data);
    if (!client) {
      res.status(404).json({ error: 'client not found' });
      return;
    }
    try {
      await client.stop();
      await client.start();
      res.status(200).json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err) });
    }
  });

  /**
   * POST /_control/stop
   *
   * Acknowledges the shutdown request with HTTP 200, then asynchronously
   * triggers the same graceful shutdown path as SIGTERM. The response is sent
   * before the signal is emitted so the caller receives confirmation.
   *
   * **Side effects:** emits `SIGTERM` to the current process via `setImmediate`,
   * activating any registered `registerShutdown` handlers.
   *
   * - `200` with `{ ok: true }` — always, before shutdown begins.
   */
  router.post('/stop', (_req, res) => {
    res.status(200).json({ ok: true });
    setImmediate(() => {
      process.kill(process.pid, 'SIGTERM');
    });
  });

  return router;
}
