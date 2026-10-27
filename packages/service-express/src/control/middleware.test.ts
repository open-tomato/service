import type { NextFunction, Request, Response } from 'express';

import { timingSafeEqual } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { controlAuth, controlEnabled } from './middleware.js';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

function makeMocks() {
  const req = {} as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

// ---------------------------------------------------------------------------
// controlAuth
// ---------------------------------------------------------------------------

describe('controlAuth', () => {
  it('returns 403 when x-control-token header is missing', () => {
    const { req, res, next } = makeMocks();
    (req as Request & { headers: Record<string, string> }).headers = {};
    controlAuth('secret')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'forbidden' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when x-control-token header is wrong', () => {
    const { req, res, next } = makeMocks();
    (req as Request & { headers: Record<string, string> }).headers = {
      'x-control-token': 'wrong',
    };
    controlAuth('secret')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'forbidden' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when x-control-token header is an array (treated as absent)', () => {
    const { req, res, next } = makeMocks();
    (req as Request & { headers: Record<string, unknown> }).headers = {
      'x-control-token': ['secret', 'secret'],
    };
    controlAuth('secret')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'forbidden' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 for a token of a different length, without throwing', () => {
    const { req, res, next } = makeMocks();
    (req as Request & { headers: Record<string, string> }).headers = {
      'x-control-token': 'a-much-longer-token-than-the-secret',
    };
    controlAuth('secret')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 for a token that differs only in its last character', () => {
    const { req, res, next } = makeMocks();
    (req as Request & { headers: Record<string, string> }).headers = {
      'x-control-token': 'secreT',
    };
    controlAuth('secret')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('compares the token in constant time', () => {
    vi.mocked(timingSafeEqual).mockClear();
    const { req, res, next } = makeMocks();
    (req as Request & { headers: Record<string, string> }).headers = {
      'x-control-token': 'secret',
    };
    controlAuth('secret')(req, res, next);
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);
  });

  it('calls next() when x-control-token matches', () => {
    const { req, res, next } = makeMocks();
    (req as Request & { headers: Record<string, string> }).headers = {
      'x-control-token': 'secret',
    };
    controlAuth('secret')(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// controlEnabled
// ---------------------------------------------------------------------------

describe('controlEnabled', () => {
  it('returns 404 when enabled is false', () => {
    const { req, res, next } = makeMocks();
    controlEnabled(false)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'not found' });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when enabled is true', () => {
    const { req, res, next } = makeMocks();
    controlEnabled(true)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});
