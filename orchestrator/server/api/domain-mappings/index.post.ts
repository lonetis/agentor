defineRouteMeta({
  openAPI: {
    tags: ['Domain Mappings'],
    summary: 'Create domain mapping',
    description: 'Creates a new Traefik domain mapping for a worker port.',
    operationId: 'createDomainMapping',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['baseDomain', 'protocol', 'internalPort'],
            properties: {
              subdomain: { type: 'string', description: 'Subdomain (empty for bare domain)' },
              baseDomain: { type: 'string', description: 'Base domain from BASE_DOMAINS' },
              path: { type: 'string', description: 'URL path prefix for routing (e.g. /api). Prefix is stripped before forwarding. Not supported for TCP.' },
              protocol: { type: 'string', enum: ['http', 'https', 'tcp'], description: 'Routing protocol' },
              workerId: { type: 'string', description: 'Target worker container ID (either workerId or workerName required)' },
              workerName: { type: 'string', description: 'Target worker container name (either workerId or workerName required)' },
              internalPort: { type: 'integer', description: 'Worker internal port' },
              basicAuth: { type: 'object', description: 'HTTP basic auth credentials', properties: { username: { type: 'string' }, password: { type: 'string' } } },
            },
          },
        },
      },
    },
    responses: {
      201: { description: 'Created domain mapping', content: { 'application/json': { schema: { $ref: '#/components/schemas/DomainMapping' } } } },
      400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

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

  if (!body.protocol || (!body.workerId && !body.workerName) || !body.internalPort || !body.baseDomain) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required fields: baseDomain, protocol, workerId or workerName, internalPort',
    });
  }

  if (body.subdomain === undefined || body.subdomain === null) {
    body.subdomain = '';
  }

  // Normalize path: undefined/null/empty/'/' all mean "no path"
  if (!body.path || body.path === '/') {
    body.path = '';
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
        statusMessage: `${body.protocol.toUpperCase()} requires TLS but '${body.baseDomain}' has no TLS configured (use :http, :dns:provider, or :selfsigned in BASE_DOMAINS)`,
      });
    }
  }

  if (body.subdomain && !/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(body.subdomain)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'subdomain must be a valid DNS label (alphanumeric and hyphens, no consecutive dots)',
    });
  }

  if (body.path) {
    if (body.protocol === 'tcp') {
      throw createError({
        statusCode: 400,
        statusMessage: 'path is not supported for TCP protocol (TCP operates at the transport layer)',
      });
    }
    if (!/^\/[a-zA-Z0-9\/_.-]+$/.test(body.path)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'path must start with / and contain only alphanumeric characters, hyphens, underscores, dots, and slashes',
      });
    }
    // Strip trailing slash
    body.path = body.path.replace(/\/+$/, '') || '';
  }

  const intPort = Number(body.internalPort);
  if (!Number.isInteger(intPort) || intPort < 1 || intPort > 65535) {
    throw createError({
      statusCode: 400,
      statusMessage: 'internalPort must be an integer between 1 and 65535',
    });
  }

  const containerManager = useContainerManager();
  // Resolve worker by ID or name
  let containerInfo;
  if (body.workerId) {
    containerInfo = containerManager.get(body.workerId);
  } else if (body.workerName) {
    containerInfo = containerManager.list().find((c) => c.name === body.workerName);
  }
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
    path: body.path || '',
    protocol: body.protocol,
    workerId: containerInfo.id,
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
