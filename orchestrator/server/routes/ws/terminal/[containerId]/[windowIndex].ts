defineRouteMeta({
  openAPI: {
    tags: ['Internal'],
    summary: 'Terminal WebSocket (named window)',
    description: 'WebSocket terminal connection to a tmux window by index.',
    operationId: 'wsTerminalNamed',
    parameters: [
      { name: 'containerId', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' },
      { name: 'windowIndex', in: 'path', required: true, schema: { type: 'integer' }, description: 'Tmux window index' },
    ],
    responses: {
      101: { description: 'WebSocket upgrade' },
    },
  },
});

import { terminalWsHandler } from '../../../../utils/terminal-handler';

export default defineWebSocketHandler(terminalWsHandler);
