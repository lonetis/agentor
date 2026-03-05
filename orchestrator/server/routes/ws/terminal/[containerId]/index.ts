defineRouteMeta({
  openAPI: {
    tags: ['Internal'],
    summary: 'Terminal WebSocket (default)',
    description: 'WebSocket terminal connection to the default tmux window.',
    operationId: 'wsTerminalDefault',
    parameters: [{ name: 'containerId', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' }],
    responses: {
      101: { description: 'WebSocket upgrade' },
    },
  },
});

import { terminalWsHandler } from '../../../../utils/terminal-handler';

export default defineWebSocketHandler(terminalWsHandler);
