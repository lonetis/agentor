defineRouteMeta({
  openAPI: {
    tags: ['Internal'],
    summary: 'Terminal WebSocket (named window)',
    description: 'WebSocket terminal connection to a named tmux window.',
    operationId: 'wsTerminalNamed',
    parameters: [
      { name: 'containerId', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' },
      { name: 'windowName', in: 'path', required: true, schema: { type: 'string' }, description: 'Tmux window name' },
    ],
    responses: {
      101: { description: 'WebSocket upgrade' },
    },
  },
});

import { terminalWsHandler } from '../../../../utils/terminal-handler';

export default defineWebSocketHandler(terminalWsHandler);
