import type { CircuitState } from './circuit-breaker.js';
import type { ErrorBody } from './errors.js';
import type { HealthStatus } from './health.js';
import type { DependencyRecord, Runtime } from './runtime.js';
import type { Dependency, DependencyStatus } from './types.js';

import { BadRequestError, InternalError, NotFoundError } from './errors.js';

/**
 * The outcome of a control operation, for any transport to answer with:
 * an HTTP status and a JSON-ready body.
 */
export interface ControlResult<B> {
  /** The HTTP status to answer with. */
  readonly status: number;
  /** The response body. */
  readonly body: B;
}

/** The body of an action: `{ ok: true }` on success, an {@link ErrorBody} otherwise. */
export type ControlActionBody = { readonly ok: true } | ErrorBody;

/** A dependency's entry in the control status. */
export interface DependencyControlStatus {
  /** The dependency's lifecycle status. */
  readonly status: DependencyStatus;
  /** What its `healthDetail()` returned; absent when it has none. */
  readonly detail?: Readonly<Record<string, unknown>>;
}

/** A client's entry in the control status. */
export interface ClientControlStatus {
  /** The client's lifecycle status. */
  readonly status: DependencyStatus;
  /** The breaker state its status implies; `"unknown"` when stopped or starting. */
  readonly circuitBreaker: CircuitState | 'unknown';
}

/** The body of {@link controlStatus}. */
export interface ControlStatusBody {
  /** The service's identifier. */
  readonly serviceId: string;
  /** The overall health, by the rule `aggregateHealth` applies. */
  readonly status: HealthStatus;
  /** Whole seconds since `startedAt`. */
  readonly uptime: number;
  /** The version given to {@link controlStatus}. */
  readonly version: string;
  /** Each dependency, by name. */
  readonly dependencies: Readonly<Record<string, DependencyControlStatus>>;
  /** Each client, by name. */
  readonly clients: Readonly<Record<string, ClientControlStatus>>;
}

/** Inputs to {@link controlStatus} that the runtime does not hold. */
export interface ControlStatusOptions {
  /** The service's version, from its config. */
  readonly version: string;
  /** When the service started, in milliseconds since the epoch. */
  readonly startedAt: number;
  /** The current time in the same unit; defaults to `Date.now()`. */
  readonly now?: number;
}

/** The parts of a {@link Runtime} the control operations read. */
export type ControlTarget = Pick<Runtime<DependencyRecord, DependencyRecord>, 'serviceId' | 'deps' | 'clients' | 'health'>;

type ActionResult = ControlResult<ControlActionBody>;

const OK: ActionResult = { status: 200, body: { ok: true } };

/** The result that answers with `error`'s status and body. */
function failure(error: BadRequestError | NotFoundError | InternalError): ActionResult {
  return { status: error.statusCode, body: error.toJSON() };
}

const BREAKER_STATE: Partial<Record<DependencyStatus, CircuitState>> = {
  running: 'closed',
  degraded: 'half-open',
  error: 'open',
};

/** The message of a thrown value: its `message` for an `Error`, its text otherwise. */
function errorMessage(err: unknown): string {
  return err instanceof Error
    ? err.message
    : String(err);
}

/** A dependency's status, with its health detail when it has one. */
function dependencyStatus(entry: Dependency): DependencyControlStatus {
  const detail = entry.healthDetail?.();
  return detail === undefined
    ? { status: entry.status }
    : { status: entry.status, detail };
}

/** A client's status, with the breaker state that status implies. */
function clientStatus(entry: Dependency): ClientControlStatus {
  return { status: entry.status, circuitBreaker: BREAKER_STATE[entry.status] ?? 'unknown' };
}

/** Finds the entry named `name` in `record`, or the result that says why there is none. */
function find(
  record: DependencyRecord,
  name: string,
  kind: 'dependency' | 'client',
): { readonly entry: Dependency } | { readonly result: ActionResult } {
  if (typeof name !== 'string' || name === '') return { result: failure(new BadRequestError('invalid name parameter')) };
  const entry = Object.values(record).find((candidate) => candidate.name === name);
  return entry === undefined
    ? { result: failure(new NotFoundError(`${kind} not found`)) }
    : { entry };
}

/** Runs `action`, answering 200 when it resolves and 500 with its message when it throws. */
async function run(action: () => Promise<void>): Promise<ActionResult> {
  try {
    await action();
    return OK;
  } catch (err) {
    return failure(new InternalError(errorMessage(err), undefined, { cause: err }));
  }
}

/** Calls `pause` or `resume` on the dependency named `name`, if it has both. */
async function suspendOrResume(target: ControlTarget, name: string, method: 'pause' | 'resume'): Promise<ActionResult> {
  const found = find(target.deps, name, 'dependency');
  if ('result' in found) return found.result;
  const { entry } = found;
  const call = entry[method];
  if (typeof entry.pause !== 'function' || typeof entry.resume !== 'function' || call === undefined) {
    return failure(new BadRequestError(`dependency does not support ${method}`));
  }
  return run(() => call.call(entry));
}

/** Stops then starts the entry named `name` in `record`. */
async function cycle(record: DependencyRecord, name: string, kind: 'dependency' | 'client'): Promise<ActionResult> {
  const found = find(record, name, kind);
  if ('result' in found) return found.result;
  const { entry } = found;
  return run(async () => {
    await entry.stop();
    await entry.start();
  });
}

/**
 * The service's status: its overall health, uptime and version, and each
 * dependency and client. Always answers 200; the body carries the health.
 *
 * @param target - The runtime to report on.
 * @param options - The version, the start time, and optionally the current time.
 */
export function controlStatus(target: ControlTarget, options: ControlStatusOptions): ControlResult<ControlStatusBody> {
  const now = options.now ?? Date.now();
  const dependencies = Object.fromEntries(Object.values(target.deps).map((entry) => [entry.name, dependencyStatus(entry)]));
  const clients = Object.fromEntries(Object.values(target.clients).map((entry) => [entry.name, clientStatus(entry)]));

  return {
    status: 200,
    body: {
      serviceId: target.serviceId,
      status: target.health().status,
      uptime: Math.floor((now - options.startedAt) / 1000),
      version: options.version,
      dependencies,
      clients,
    },
  };
}

/** Each dependency's name, status and health detail, in start order. Answers 200. */
export function listDependencies(
  target: ControlTarget,
): ControlResult<readonly ({ readonly name: string } & DependencyControlStatus)[]> {
  return {
    status: 200,
    body: Object.values(target.deps).map((entry) => ({ name: entry.name, ...dependencyStatus(entry) })),
  };
}

/**
 * Pauses the dependency named `name`. Answers 400 for an empty name or a
 * dependency without `pause` and `resume`, 404 for an unknown name, 500 with
 * the message when `pause()` throws, and 200 otherwise.
 */
export function pauseDependency(target: ControlTarget, name: string): Promise<ActionResult> {
  return suspendOrResume(target, name, 'pause');
}

/** Resumes the dependency named `name`; answers as {@link pauseDependency} does. */
export function resumeDependency(target: ControlTarget, name: string): Promise<ActionResult> {
  return suspendOrResume(target, name, 'resume');
}

/**
 * Restarts the dependency named `name`: `stop()`, then `start()` once the
 * stop resolves. Answers 400 for an empty name, 404 for an unknown one, 500
 * with the message when either throws, and 200 otherwise.
 */
export function restartDependency(target: ControlTarget, name: string): Promise<ActionResult> {
  return cycle(target.deps, name, 'dependency');
}

/**
 * Resets the client named `name`: `stop()`, then `start()`, which hands its
 * status back to the breaker. Answers as {@link restartDependency} does.
 */
export function resetClient(target: ControlTarget, name: string): Promise<ActionResult> {
  return cycle(target.clients, name, 'client');
}

const encoder = new TextEncoder();

/** The SHA-256 digest of `value`, through WebCrypto. */
async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

/**
 * Whether `given` is the control token `expected`, compared in constant
 * time. Both are hashed first, so the compared bytes have the same length
 * whatever the tokens' lengths, and the comparison reveals neither. Uses
 * WebCrypto, so it runs wherever `crypto.subtle` exists.
 *
 * @param given - The token the caller sent; anything but a string is rejected,
 *   such as a repeated header parsed as an array.
 * @param expected - The configured secret; an empty one rejects every token.
 */
export async function verifyControlToken(given: unknown, expected: string): Promise<boolean> {
  if (typeof given !== 'string' || expected === '') return false;
  const [actual, wanted] = await Promise.all([sha256(given), sha256(expected)]);
  let difference = 0;
  for (let index = 0; index < wanted.length; index++) {
    difference |= (actual[index] ?? 0) ^ (wanted[index] ?? 0);
  }
  return difference === 0;
}
