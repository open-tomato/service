/** One MCP session per client over Streamable HTTP, keyed by `Mcp-Session-Id`. */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { randomUUID } from 'node:crypto';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

/** Upper bound on an initialize body, matching the SDK's own default. */
const MAX_INITIALIZE_BODY_BYTES = 4 * 1024 * 1024;

const SESSION_HEADER = 'mcp-session-id';

/** JSON-RPC error codes the session layer answers with. */
const RPC_SERVER_ERROR = -32000;
const RPC_SESSION_NOT_FOUND = -32001;
const RPC_PARSE_ERROR = -32700;
const RPC_INTERNAL_ERROR = -32603;

const SESSION_REQUIRED = 'Bad Request: Mcp-Session-Id header is required';

/** Builds a fresh `McpServer` with its tools registered, for one session. */
export type SessionServerFactory = () => McpServer | Promise<McpServer>;

/** What `createHttpSessions` needs. */
export interface HttpSessionsOptions {
  /** Called once per new session; its server is connected to that session's transport. */
  readonly createSessionServer: SessionServerFactory;
  /** Receives the error when a session cannot be created; the client gets a 500. */
  readonly onError?: (error: unknown) => void;
}

/** The live sessions of one HTTP MCP server. */
export interface HttpSessions {
  /** Routes one HTTP request to its session, or opens a session for an `initialize`. */
  handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void>;
  /** The number of sessions open right now. */
  count(): number;
  /** The number of `initialize` requests still opening their session. */
  pending(): number;
  /**
   * Closes every session's transport and forgets them all. An `initialize`
   * in flight gets `503`, and so does every later one.
   */
  closeAll(): Promise<void>;
}

/** Thrown by `readJsonBody` so the caller can answer with the right status. */
class BodyError extends Error {
  readonly status: number;
  readonly code: number;

  constructor(status: number, code: number, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function writeJsonError(res: ServerResponse, status: number, code: number, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
}

/** The session id header, with an empty value read as missing like the SDK does. */
function sessionIdOf(req: IncomingMessage): string | undefined {
  const value = req.headers[SESSION_HEADER];
  const id = Array.isArray(value)
    ? value[0]
    : value;
  return id === ''
    ? undefined
    : id;
}

/**
 * Discards the rest of a request body. Node closes the socket as soon as a
 * response ends, so a reply sent while the client is still writing never
 * reaches it; reading the rest first lets the status land.
 */
function drain(req: IncomingMessage): Promise<void> {
  return new Promise(resolve => {
    req.once('end', resolve);
    req.once('close', resolve);
    req.once('error', () => resolve());
    req.resume();
  });
}

/**
 * Reads and parses a JSON request body.
 *
 * @param req - The incoming request.
 * @returns The parsed body.
 * @throws {BodyError} 413 when the body is over `MAX_INITIALIZE_BODY_BYTES`,
 *   400 when it is not JSON.
 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const tooLarge = new BodyError(413, RPC_SERVER_ERROR, 'Request body too large');
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > MAX_INITIALIZE_BODY_BYTES) {
    await drain(req);
    throw tooLarge;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  // Leaving a plain `for await` destroys the stream, so the iterator is
  // asked to keep it open for the drain that follows an overrun.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_INITIALIZE_BODY_BYTES) break;
    chunks.push(buffer);
  }
  if (size > MAX_INITIALIZE_BODY_BYTES) {
    await drain(req);
    throw tooLarge;
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new BodyError(400, RPC_PARSE_ERROR, 'Parse error: Invalid JSON');
  }
}

/** True when `body` is an `initialize` request, alone or inside a batch. */
function holdsInitialize(body: unknown): boolean {
  return Array.isArray(body)
    ? body.some(isInitializeRequest)
    : isInitializeRequest(body);
}

/**
 * Creates the session table for one HTTP MCP server.
 *
 * A request that carries `Mcp-Session-Id` goes to that session's transport,
 * or gets `404` when no session has that id. A `POST` with no id whose body
 * is an `initialize` opens a session: a new transport, connected to a new
 * server from `createSessionServer`. Any other request without an id gets
 * `400`. A session leaves the table when its transport closes, which a
 * client's `DELETE` triggers.
 *
 * @param options - The server factory and the error sink.
 * @returns The session table.
 */
export function createHttpSessions(options: HttpSessionsOptions): HttpSessions {
  const sessions = new Map<string, StreamableHTTPServerTransport>();
  const opening = new Set<StreamableHTTPServerTransport>();
  let closing = false;

  /** Closes a transport, and the server behind it when one is connected. */
  async function discard(transport: StreamableHTTPServerTransport, server?: McpServer): Promise<void> {
    try {
      await (server?.close() ?? transport.close());
    } catch (error: unknown) {
      options.onError?.(error);
    }
  }

  async function openSession(req: IncomingMessage, res: ServerResponse, body: unknown): Promise<void> {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: id => {
        sessions.set(id, transport);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId !== undefined) sessions.delete(transport.sessionId);
    };
    opening.add(transport);
    let server: McpServer | undefined;
    try {
      server = await options.createSessionServer();
      await server.connect(transport);
    } catch (error: unknown) {
      opening.delete(transport);
      options.onError?.(error);
      writeJsonError(res, 500, RPC_INTERNAL_ERROR, 'Internal error: could not open a session');
      await discard(transport, server);
      return;
    }
    if (closing) {
      opening.delete(transport);
      writeJsonError(res, 503, RPC_SERVER_ERROR, 'Service Unavailable: server is shutting down');
      await discard(transport, server);
      return;
    }
    try {
      await transport.handleRequest(req, res, body);
    } finally {
      opening.delete(transport);
      // The SDK answers 406, 415 or 400 without a session when the headers
      // or the batch are wrong; the transport it never initialized would
      // otherwise live on with its server.
      if (transport.sessionId === undefined) await discard(transport, server);
    }
  }

  async function handleNewRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      writeJsonError(res, 400, RPC_SERVER_ERROR, SESSION_REQUIRED);
      return;
    }
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (error: unknown) {
      if (error instanceof BodyError) {
        writeJsonError(res, error.status, error.code, error.message);
        return;
      }
      throw error;
    }
    if (!holdsInitialize(body)) {
      writeJsonError(res, 400, RPC_SERVER_ERROR, SESSION_REQUIRED);
      return;
    }
    if (closing) {
      writeJsonError(res, 503, RPC_SERVER_ERROR, 'Service Unavailable: server is shutting down');
      return;
    }
    await openSession(req, res, body);
  }

  return {
    async handleRequest(req, res) {
      const sessionId = sessionIdOf(req);
      if (sessionId === undefined) {
        await handleNewRequest(req, res);
        return;
      }
      const transport = sessions.get(sessionId);
      if (transport === undefined) {
        writeJsonError(res, 404, RPC_SESSION_NOT_FOUND, 'Session not found');
        return;
      }
      await transport.handleRequest(req, res);
    },
    count: () => sessions.size,
    pending: () => opening.size,
    async closeAll() {
      closing = true;
      const open = [...sessions.values(), ...opening];
      sessions.clear();
      await Promise.all(open.map(transport => transport.close()));
    },
  };
}
