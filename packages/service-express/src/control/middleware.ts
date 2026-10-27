import type { RequestHandler } from 'express';

import { createHash, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

/**
 * Zod schema for the `x-control-token` request header.
 *
 * Express may parse repeated headers as `string[]`. This schema treats any
 * non-string value (including arrays and `undefined`) as absent by
 * preprocessing to `undefined` before applying the optional string check.
 */
const controlTokenSchema = z.preprocess(
  (val) => (typeof val === 'string'
    ? val
    : undefined),
  z.string().optional(),
);

/**
 * Compares two tokens in constant time. Both are hashed first, so the
 * buffers `timingSafeEqual` compares have the same length whatever the
 * tokens' lengths, and the comparison reveals neither.
 */
function sameToken(given: string, expected: string): boolean {
  const digest = (value: string): Buffer => createHash('sha256').update(value)
    .digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * Express middleware that enforces shared-secret authentication for control
 * plane routes.
 *
 * Reads the `x-control-token` request header and compares it to `secret`.
 * Non-string header values (e.g. repeated headers parsed as arrays) are
 * treated as absent. Responds with HTTP 403 `{ error: 'forbidden' }` when the
 * header is absent or does not match. Calls `next()` when the token is valid.
 * The comparison runs in constant time.
 *
 * @param secret - The expected token value. Must match `x-control-token` exactly.
 */
export function controlAuth(secret: string): RequestHandler {
  return (req, res, next) => {
    const token = controlTokenSchema.parse(req.headers['x-control-token']);
    if (token === undefined || !sameToken(token, secret)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}

/**
 * Express middleware that gates control plane routes based on whether the
 * control plane is enabled.
 *
 * Responds with HTTP 404 `{ error: 'not found' }` when `enabled` is `false`.
 * Calls `next()` when `enabled` is `true`.
 *
 * @param enabled - Whether the control plane is enabled.
 */
export function controlEnabled(enabled: boolean): RequestHandler {
  return (_req, res, next) => {
    if (!enabled) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    next();
  };
}
