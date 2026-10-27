import type { ClientsMap } from './types.js';
import type { TypedClient } from '@open-tomato/service';

/**
 * Builds a `ClientsMap` from a list of `TypedClient` instances.
 *
 * The map uses referential identity to look up clients — callers must pass the
 * same object reference that was provided to `createService`.
 *
 * @param clients - The typed client instances registered with the service.
 * @returns A `ClientsMap` whose `get` returns the client's proxy surface directly.
 *
 * @remarks Unlike `DepsMap`, which unwraps `.client` from a `TypedDependency`,
 * `ClientsMap.get` returns the `TypedClient` itself — the proxy surface is the client.
 */
export function buildClientsMap(clients: TypedClient<unknown>[]): ClientsMap {
  return {
    get<T>(client: TypedClient<T>): T {
      const found = clients.find(c => c === client);
      if (!found) {
        throw new Error(
          `Client "${(client as { name?: string }).name ?? 'unknown'}" not found in createService clients array`,
        );
      }
      return found as unknown as T;
    },
  };
}
