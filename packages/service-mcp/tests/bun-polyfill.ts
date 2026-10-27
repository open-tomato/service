/**
 * Minimal Bun.serve polyfill for vitest (Node.js) integration tests.
 *
 * Vitest workers run in Node.js, where `Bun` is not defined. This setup
 * file provides just enough of the Bun.serve surface to allow startHealthServer
 * (and wireHttpTransport) to work in integration tests.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import { createServer } from 'node:http';

type BunServeOptions = {
  port: number;
  fetch: (req: Request) => Response | Promise<Response>;
};

type BunServer = {
  stop: () => void;
};

async function adaptRequest(nodeReq: IncomingMessage, port: number): Promise<Request> {
  const url = new URL(nodeReq.url ?? '/', `http://localhost:${port}`);
  const headers = new Headers();
  for (const [key, rawVal] of Object.entries(nodeReq.headers)) {
    if (rawVal !== undefined) {
      headers.set(
        key,
        Array.isArray(rawVal)
          ? rawVal.join(', ')
          : rawVal,
      );
    }
  }
  const chunks: Buffer[] = [];
  for await (const chunk of nodeReq) {
    chunks.push(chunk as Buffer);
  }
  const body = chunks.length > 0
    ? Buffer.concat(chunks)
    : null;
  return new Request(url.toString(), { method: nodeReq.method ?? 'GET', headers, body });
}

async function writeResponse(fetchRes: Response, nodeRes: ServerResponse): Promise<void> {
  const headers: Record<string, string> = {};
  fetchRes.headers.forEach((val, key) => {
    headers[key] = val;
  });
  nodeRes.writeHead(fetchRes.status, headers);
  nodeRes.end(await fetchRes.text());
}

function bunServePolyfill(options: BunServeOptions): BunServer {
  const server = createServer(async (req, res) => {
    try {
      const fetchReq = await adaptRequest(req, options.port);
      const fetchRes = await options.fetch(fetchReq);
      await writeResponse(fetchRes, res);
    } catch {
      res.writeHead(500);
      res.end('Internal Server Error');
    }
  });
  server.listen(options.port);
  return { stop: () => server.close() };
}

if (typeof globalThis.Bun === 'undefined') {
  (globalThis as Record<string, unknown>).Bun = { serve: bunServePolyfill };
}
