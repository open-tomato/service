import type { ServiceLogger } from '@open-tomato/service';
import type { Request, RequestHandler, Response } from 'express';

/** Middleware that unconditionally calls `next()` — used as a no-op passthrough. */
export const passthroughMiddleware: RequestHandler = (_req, _res, next) => next();

/**
 * Claims a session verifier resolves from a bearer token. Intentionally open —
 * the chassis doesn't own the auth service's exact claim shape; it only relies
 * on `sub` being present. Attached to `res.locals.auth` after `requireAuth`.
 */
export interface SessionClaims {
  sub: string;
  [key: string]: unknown;
}

/**
 * Pluggable token → claims verifier — the **key-resolver seam**. The HTTP
 * `/introspect` adapter below is today's implementation; a local RS256/JWKS
 * adapter (verify offline, select the signing key by `kid`) can replace it later
 * WITHOUT changing `buildRequireAuth`/`buildOptionalAuth` or any call site. This
 * is the graduation path off central per-request introspection (see the auth
 * architecture direction): shape the seam around "verify a token", never around
 * "a shared secret".
 */
export interface SessionVerifier {
  verify(token: string): Promise<SessionClaims | null>;
}

/** Read the verified session attached by {@link buildRequireAuth}, if any. */
export function getSession(res: Response): SessionClaims | undefined {
  return res.locals['auth'] as SessionClaims | undefined;
}

const BEARER = /^Bearer (.+)$/i;

function extractBearer(req: Request): string | null {
  const match = BEARER.exec(req.headers.authorization ?? '');
  const token = match?.[1]?.trim();
  return token == null || token === ''
    ? null
    : token;
}

/**
 * A {@link SessionVerifier} that validates a bearer token by calling the auth
 * service's `POST /introspect` (RFC 7662-shaped: `{ active, ...claims }`). This
 * is the first adapter behind the seam; the JWKS/offline adapter is the swap.
 *
 * `secret` is sent as `Authorization: Bearer <secret>` on every introspect
 * call — it authorizes *this service* to query introspect, since the endpoint
 * discloses full session claims (RFC 7662 §2.1 requires the endpoint be
 * protected). It is distinct from the end-user's session token.
 */
export function createIntrospectVerifier(introspectUrl: string, logger: ServiceLogger, secret: string): SessionVerifier {
  return {
    async verify(token: string): Promise<SessionClaims | null> {
      try {
        const res = await fetch(introspectUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${secret}`,
          },
          body: JSON.stringify({ token }),
        });
        if (!res.ok) return null;

        const body = (await res.json()) as { active?: unknown; sub?: unknown } & Record<string, unknown>;
        if (body.active !== true || typeof body.sub !== 'string') return null;

        // Return the claims without the RFC 7662 `active` status flag (copy, then
        // drop the key — no input mutation, no throwaway binding).
        const claims: SessionClaims = { ...body, sub: body.sub };
        Reflect.deleteProperty(claims, 'active');
        return claims;
      } catch (err) {
        logger.warn({ err }, 'session introspection failed');
        return null;
      }
    },
  };
}

/**
 * Builds middleware that requires a valid session. Extracts the bearer token,
 * verifies it through the introspect seam, and either attaches the claims to
 * `res.locals.auth` and continues, or responds `401`.
 */
export function buildRequireAuth(introspectUrl: string, logger: ServiceLogger, secret: string): RequestHandler {
  const verifier = createIntrospectVerifier(introspectUrl, logger, secret);
  return async (req, res, next) => {
    try {
      const token = extractBearer(req);
      const claims = token == null
        ? null
        : await verifier.verify(token);
      if (claims == null) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      res.locals['auth'] = claims;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Builds middleware that optionally validates a session: attaches
 * `res.locals.auth` when a valid token is present, but never rejects an
 * unauthenticated (or invalid-token) request.
 */
export function buildOptionalAuth(introspectUrl: string, logger: ServiceLogger, secret: string): RequestHandler {
  const verifier = createIntrospectVerifier(introspectUrl, logger, secret);
  return async (req, res, next) => {
    try {
      const token = extractBearer(req);
      if (token != null) {
        const claims = await verifier.verify(token);
        if (claims != null) res.locals['auth'] = claims;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
