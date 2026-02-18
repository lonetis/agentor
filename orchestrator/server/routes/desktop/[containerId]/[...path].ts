import { useContainerManager } from '../../../utils/services';

export default defineEventHandler(async (event) => {
  const containerId = getRouterParam(event, 'containerId')!;
  const path = getRouterParam(event, 'path') || '';

  const containerManager = useContainerManager();
  const info = containerManager.get(containerId);

  if (!info || info.status !== 'running') {
    throw createError({ statusCode: 404, statusMessage: 'Container not found or not running' });
  }

  const url = getRequestURL(event);
  const target = `http://${info.name}:6080/${path}${url.search}`;

  return proxyRequest(event, target);
});
