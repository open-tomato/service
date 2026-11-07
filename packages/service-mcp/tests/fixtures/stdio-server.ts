/**
 * A stdio MCP server for `stdio-logs.integration.test.ts`: one tool that logs
 * a `debug` and an `info` line through the `setup` logger. The test spawns it
 * under `MCP_TRANSPORT=stdio`; importing it starts a server, so the test
 * reads the shared names from `stdio-constants.ts` instead.
 */
import { createMCP } from '../../src/create-mcp.js';

import { DEBUG_MESSAGE, INFO_MESSAGE, TOOL_NAME, TOOL_RESULT } from './stdio-constants.js';

createMCP({
  serviceId: 'stdio-fixture',
  setup: (server, { logger }) => {
    server.registerTool(TOOL_NAME, { description: 'Logs a debug and an info line' }, async () => {
      logger.debug(DEBUG_MESSAGE);
      logger.info(INFO_MESSAGE);
      return { content: [{ type: 'text', text: TOOL_RESULT }] };
    });
  },
});
