import type { Dependency, TypedDependency, DepsMap } from '@open-tomato/service';

/**
 * Builds a {@link DepsMap} from the resolved `dependencies` array.
 *
 * @param deps - The array of `Dependency` instances passed to `createService`.
 * @returns A `DepsMap` whose `get` method returns the typed `.client` for any
 *   `TypedDependency<T>` in the array, or throws for unknown dependencies.
 *
 * @remarks
 * Lookup is by reference identity — the same object passed to `createService`
 * must be passed to `deps.get()`. The `.client` property is read from
 * `TypedDependency<T>`, which is what `InferInstance<T>` extracts.
 */
export function buildDepsMap(deps: Dependency[]): DepsMap {
  return {
    get<T extends Dependency>(dep: T) {
      const found = deps.find(d => d === dep);
      if (!found) {
        throw new Error(`Dependency "${dep.name}" not found in createService dependencies array`);
      }
      return (found as TypedDependency<unknown>).client as ReturnType<DepsMap['get']>;
    },
  };
}
