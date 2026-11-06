/**
 * A Node resolve hook for the fixture server: the package source imports its
 * siblings as `./x.js`, which NodeNext writes for the file `./x.ts`. Node runs
 * `.ts` by stripping types but does not map the extension, so a relative
 * `.js` import that finds no file is retried as `.ts`.
 */

/** Resolves `specifier`, retrying a missing relative `.js` file as `.ts`. */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const isRelativeJs = specifier.startsWith('.') && specifier.endsWith('.js');
    if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !isRelativeJs) throw error;
    return nextResolve(specifier.replace(/\.js$/, '.ts'), context);
  }
}
