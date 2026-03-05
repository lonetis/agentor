defineRouteMeta({
  openAPI: {
    tags: ['Containers'],
    summary: 'Download workspace',
    description: 'Downloads the workspace directory as a .tar.gz archive.',
    operationId: 'downloadWorkspace',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' }, description: 'Container ID' }],
    responses: {
      200: { description: 'Workspace archive', content: { 'application/gzip': { schema: { type: 'string', format: 'binary' } } } },
      404: { description: 'Container not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { createGzip } from 'node:zlib';

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!;
  const containerManager = useContainerManager();

  const info = containerManager.get(id);
  if (!info) {
    throw createError({ statusCode: 404, statusMessage: 'Container not found' });
  }

  const safeName = (info.displayName || info.name || id.slice(0, 12)).replace(/[^a-zA-Z0-9_-]/g, '_');
  const tarStream = await containerManager.downloadWorkspace(id);
  const gzip = createGzip();

  setResponseHeaders(event, {
    'Content-Type': 'application/gzip',
    'Content-Disposition': `attachment; filename="${safeName}-workspace.tar.gz"`,
    'Transfer-Encoding': 'chunked',
  });

  return sendStream(event, tarStream.pipe(gzip));
});
