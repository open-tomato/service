import { describe, expect, it } from 'vitest';

import { isErrorBody, parseApiError } from './error-client.js';

/** A `Response` with the given status, content type and body. */
function response(status: number, body: string, contentType?: string, statusText = ''): Response {
  const headers = contentType === undefined
    ? undefined
    : { 'content-type': contentType };
  return new Response(body, { status, statusText, headers });
}

describe('isErrorBody', () => {
  it('accepts an object with a string code and a string message', () => {
    expect(isErrorBody({ code: 'X', message: 'Y' })).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'string'],
    ['a numeric code', { code: 123, message: 'Y' }],
    ['a missing message', { code: 'X' }],
    ['an empty object', {}],
  ])('rejects %s', (_label, value) => {
    expect(isErrorBody(value)).toBe(false);
  });
});

describe('parseApiError', () => {
  it('reads an error body, adding the status', async () => {
    const body = JSON.stringify({ code: 'NOT_FOUND', message: 'order not found', details: { orderId: 'o-1' } });

    expect(await parseApiError(response(404, body, 'application/json'))).toStrictEqual({
      code: 'NOT_FOUND',
      message: 'order not found',
      details: { orderId: 'o-1' },
      statusCode: 404,
    });
  });

  it('reads a problem+json content type as JSON', async () => {
    const body = JSON.stringify({ code: 'CONFLICT', message: 'taken' });

    expect(await parseApiError(response(409, body, 'application/problem+json'))).toMatchObject({ code: 'CONFLICT' });
  });

  it('reads a 1.x { error } body, taking the code from the status', async () => {
    const body = JSON.stringify({ error: 'order not found' });

    expect(await parseApiError(response(404, body, 'application/json'))).toStrictEqual({
      code: 'NOT_FOUND',
      message: 'order not found',
      statusCode: 404,
    });
  });

  it('falls back to the status and its text for a body that is not JSON', async () => {
    expect(await parseApiError(response(503, '<html>down</html>', 'text/html', 'Service Unavailable'))).toStrictEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Service Unavailable',
      statusCode: 503,
    });
  });

  it('falls back to the status\'s message when there is no status text', async () => {
    expect(await parseApiError(response(502, ''))).toStrictEqual({
      code: 'BAD_GATEWAY',
      message: 'Bad gateway',
      statusCode: 502,
    });
  });

  it('falls back when a JSON body does not parse or has neither shape', async () => {
    expect(await parseApiError(response(500, '{not json', 'application/json'))).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(await parseApiError(response(400, '{"reason":"x"}', 'application/json'))).toMatchObject({
      code: 'BAD_REQUEST',
      message: 'Bad request',
    });
  });
});
