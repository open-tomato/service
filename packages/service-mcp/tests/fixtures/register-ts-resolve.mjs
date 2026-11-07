/** Preloaded with `--import`: installs the `.js` to `.ts` resolve hook. */
import { register } from 'node:module';

register('./ts-resolve-hook.mjs', import.meta.url);
