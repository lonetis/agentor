import { nanoid } from 'nanoid';
import { useDomainMappingStore, useTraefikManager, useContainerManager, useConfig } from '../../utils/services';

export default defineEventHandler(async (event) => {
  const body = await readBody(event);
  const config = useConfig();

  if (config.baseDomains.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Domain mapping is not enabled (BASE_DOMAINS not set)',
    });
  }

  if (!body.protocol || !body.workerId || !body.internalPort || !body.baseDomain) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required fields: baseDomain, protocol, workerId, internalPort',
    });
  }

  if (body.subdomain === undefined || body.subdomain === null) {
    body.subdomain = '';
  }

  if (!config.baseDomains.includes(body.baseDomain)) {
    throw createError({
      statusCode: 400,
      statusMessage: `baseDomain must be one of: ${config.baseDomains.join(', ')}`,
    });
  }

  if (!['http', 'https', 'tcp'].includes(body.protocol)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'protocol must be "http", "https", or "tcp"',
    });
  }

  if (body.protocol === 'https' || body.protocol === 'tcp') {
    const domainConfig = config.baseDomainConfigs.find((c) => c.domain === body.baseDomain);
    if (!domainConfig || domainConfig.challengeType === 'none') {
      throw createError({
        statusCode: 400,
        statusMessage: `${body.protocol.toUpperCase()} requires TLS but '${body.baseDomain}' has no ACME challenge configured (use :http or :dns:provider in BASE_DOMAINS)`,
      });
    }
  }

  if (body.subdomain && !/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(body.subdomain)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'subdomain must be a valid DNS label (alphanumeric and hyphens, no consecutive dots)',
    });
  }

  const intPort = Number(body.internalPort);
  if (!Number.isInteger(intPort) || intPort < 1 || intPort > 65535) {
    throw createError({
      statusCode: 400,
      statusMessage: 'internalPort must be an integer between 1 and 65535',
    });
  }

  const containerManager = useContainerManager();
  const containerInfo = containerManager.get(body.workerId);
  if (!containerInfo || containerInfo.status !== 'running') {
    throw createError({
      statusCode: 400,
      statusMessage: 'Worker container is not running',
    });
  }

  const hasUser = !!body.basicAuth?.username;
  const hasPass = !!body.basicAuth?.password;
  if (hasUser !== hasPass) {
    throw createError({
      statusCode: 400,
      statusMessage: 'basicAuth requires both username and password',
    });
  }

  const mapping = {
    id: nanoid(),
    subdomain: body.subdomain,
    baseDomain: body.baseDomain,
    protocol: body.protocol,
    workerId: body.workerId,
    workerName: containerInfo.name,
    internalPort: intPort,
    ...(hasUser && hasPass
      ? { basicAuth: { username: body.basicAuth.username, password: body.basicAuth.password } }
      : {}),
  };

  const store = useDomainMappingStore();
  try {
    await store.add(mapping);
  } catch (err) {
    throw createError({
      statusCode: 409,
      statusMessage: err instanceof Error ? err.message : 'Subdomain conflict',
    });
  }
  await useTraefikManager().reconcile();

  setResponseStatus(event, 201);
  return mapping;
});
