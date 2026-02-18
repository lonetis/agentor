import { useContainerManager } from '../../utils/services';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);

  let parsedMounts;
  if (body.mounts) {
    if (typeof body.mounts === 'string') {
      try {
        parsedMounts = JSON.parse(body.mounts);
      } catch {
        throw createError({ statusCode: 400, statusMessage: 'Invalid mounts JSON' });
      }
    } else {
      parsedMounts = body.mounts;
    }
  }

  let parsedRepos;
  if (body.repos) {
    if (typeof body.repos === 'string') {
      try {
        parsedRepos = JSON.parse(body.repos);
      } catch {
        throw createError({ statusCode: 400, statusMessage: 'Invalid repos JSON' });
      }
    } else {
      parsedRepos = body.repos;
    }
  }

  const cpuLimit = body.cpuLimit != null ? parseFloat(body.cpuLimit) : undefined;
  if (cpuLimit !== undefined && (Number.isNaN(cpuLimit) || cpuLimit <= 0)) {
    throw createError({ statusCode: 400, statusMessage: 'cpuLimit must be a positive number' });
  }

  const containerManager = useContainerManager();
  const container = await containerManager.create({
    name: body.name || undefined,
    displayName: body.displayName || undefined,
    repos: parsedRepos,
    cpuLimit,
    memoryLimit: body.memoryLimit || undefined,
    mounts: parsedMounts,
    environmentId: body.environmentId || undefined,
    initScript: body.initScript || undefined,
  });

  setResponseStatus(event, 201);
  return container;
});
