import { describe, expect, it } from 'vitest';

import { isAppError, parseApiError } from '../client.js';

describe('isAppError', () => {
  it('returns true for a valid AppErrorShape', () => {
    expect(isAppError({ code: 'X', message: 'Y' })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isAppError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isAppError(undefined)).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isAppError('string')).toBe(false);
  });

  it('returns false when code is not a string', () => {
    expect(isAppError({ code: 123, message: 'Y' })).toBe(false);
  });

  it('returns false when message is missing', () => {
    expect(isAppError({ code: 'X' })).toBe(false);
  });

  it('returns false for an empty object', () => {
    expect(isAppError({})).toBe(false);
  });
});

describe('parseApiError', () => {
  function makeResponse(opts: {
    status?: number;
    statusText?: string;
    contentType?: string;
    body?: unknown;
    jsonThrows?: boolean;
  }): Response {
    const { status = 400, statusText = 'Bad Request', contentType, body, jsonThrows } = opts;
    return {
      status,
      statusText,
      headers: {
        get: (name: string) => (name === 'content-type'
          ? (contentType ?? null)
          : null),
      },
      json: jsonThrows
        ? () => Promise.reject(new Error('parse error'))
        : () => Promise.resolve(body),
    } as unknown as Response;
  }

  it('returns a typed AppErrorShape from a JSON response', async () => {
    const response = makeResponse({
      contentType: 'application/json',
      body: { code: 'NOT_FOUND', message: 'Not found' },
    });
    const result = await parseApiError(response);
    expect(result.code).toBe('NOT_FOUND');
    expect(result.message).toBe('Not found');
  });

  it('returns NETWORK_ERROR for a non-JSON content-type', async () => {
    const response = makeResponse({
      status: 503,
      statusText: 'Service Unavailable',
      contentType: 'text/html',
    });
    const result = await parseApiError(response);
    expect(result.code).toBe('NETWORK_ERROR');
    expect(result.statusCode).toBe(503);
    expect(result.message).toBe('Service Unavailable');
  });

  it('returns NETWORK_ERROR when JSON body does not match AppErrorShape', async () => {
    const response = makeResponse({
      status: 400,
      statusText: 'Bad Request',
      contentType: 'application/json',
      body: { error: 'missing code field' },
    });
    const result = await parseApiError(response);
    expect(result.code).toBe('NETWORK_ERROR');
    expect(result.statusCode).toBe(400);
  });

  it('returns NETWORK_ERROR when response.json() throws', async () => {
    const response = makeResponse({
      status: 500,
      statusText: 'Internal Server Error',
      contentType: 'application/json',
      jsonThrows: true,
    });
    const result = await parseApiError(response);
    expect(result.code).toBe('NETWORK_ERROR');
    expect(result.statusCode).toBe(500);
  });

  it('returns NETWORK_ERROR when content-type is absent', async () => {
    const response = makeResponse({
      status: 502,
      statusText: 'Bad Gateway',
    });
    const result = await parseApiError(response);
    expect(result.code).toBe('NETWORK_ERROR');
    expect(result.statusCode).toBe(502);
  });
});
