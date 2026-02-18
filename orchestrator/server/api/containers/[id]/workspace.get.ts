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
