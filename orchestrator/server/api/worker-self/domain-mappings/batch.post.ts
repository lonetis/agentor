defineRouteMeta({
  openAPI: {
    tags: ['Worker Self'],
    summary: 'Batch-create domain mappings for the calling worker',
    description: 'Creates multiple Traefik domain mappings in one call (single Traefik reconcile). All mappings target the calling worker — workerId/workerName are not accepted per item.',
    operationId: 'workerSelfBatchCreateDomainMappings',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['items'],
            properties: {
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['baseDomain', 'protocol', 'internalPort'],
                  properties: {
                    subdomain: { type: 'string' },
                    baseDomain: { type: 'string' },
                    path: { type: 'string' },
                    protocol: { type: 'string', enum: ['http', 'https', 'tcp'] },
                    wildcard: { type: 'boolean' },
                    internalPort: { type: 'integer' },
                    basicAuth: { type: 'object', properties: { username: { type: 'string' }, password: { type: 'string' } } },
                  },
                },
              },
            },
          },
        },
      },
    },
    responses: {
      201: { description: 'Created domain mappings', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/DomainMapping' } } } } },
      400: { description: 'Validation error' },
      401: { description: 'Caller IP did not resolve to a managed worker' },
      409: { description: 'Subdomain conflict' },
    },
  },
});

import { nanoid } from 'nanoid';
import { useDomainMappingStore, useTraefikManager, useConfig } from '../../../utils/services';
import { requireWorkerSelf } from '../../../utils/worker-auth';

export default defineEventHandler(async (event) => {
  const ctx = await requireWorkerSelf(event);
  const body = await readBody(event);
  const config = useConfig();

  if (config.baseDomains.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'Domain mapping is not enabled (BASE_DOMAINS not set)' });
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw createError({ statusCode: 400, statusMessage: 'items must be a non-empty array' });
  }

  const store = useDomainMappingStore();
  const created = [];

  for (const item of body.items) {
    if (!item.protocol || !item.internalPort || !item.baseDomain) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Each item requires: baseDomain, protocol, internalPort',
      });
    }

    if (item.subdomain === undefined || item.subdomain === null) item.subdomain = '';
    if (!item.path || item.path === '/') item.path = '';

    if (!config.baseDomains.includes(item.baseDomain)) {
      throw createError({
        statusCode: 400,
        statusMessage: `baseDomain must be one of: ${config.baseDomains.join(', ')}`,
      });
    }

    if (!['http', 'https', 'tcp'].includes(item.protocol)) {
      throw createError({ statusCode: 400, statusMessage: 'protocol must be "http", "https", or "tcp"' });
    }

    if (item.protocol === 'https' || item.protocol === 'tcp') {
      const domainConfig = config.baseDomainConfigs.find((c) => c.domain === item.baseDomain);
      if (!domainConfig || domainConfig.challengeType === 'none') {
        throw createError({
          statusCode: 400,
          statusMessage: `${item.protocol.toUpperCase()} requires TLS but '${item.baseDomain}' has no TLS configured`,
        });
      }
    }

    const itemWildcard = item.wildcard === true;
    if (itemWildcard) {
      const domainConfig = config.baseDomainConfigs.find((c) => c.domain === item.baseDomain);
      if (!domainConfig || domainConfig.challengeType === 'http') {
        throw createError({
          statusCode: 400,
          statusMessage: `wildcard routing is not supported on '${item.baseDomain}' — HTTP-01 ACME cannot issue wildcard certificates.`,
        });
      }
    }

    if (item.subdomain && !/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(item.subdomain)) {
      throw createError({ statusCode: 400, statusMessage: 'subdomain must be a valid DNS label' });
    }

    if (item.path) {
      if (item.protocol === 'tcp') {
        throw createError({ statusCode: 400, statusMessage: 'path is not supported for TCP protocol' });
      }
      if (!/^\/[a-zA-Z0-9\/_.-]+$/.test(item.path)) {
        throw createError({ statusCode: 400, statusMessage: 'path must start with / and contain only valid characters' });
      }
      item.path = item.path.replace(/\/+$/, '') || '';
    }

    const intPort = Number(item.internalPort);
    if (!Number.isInteger(intPort) || intPort < 1 || intPort > 65535) {
      throw createError({ statusCode: 400, statusMessage: 'internalPort must be an integer between 1 and 65535' });
    }

    const hasUser = !!item.basicAuth?.username;
    const hasPass = !!item.basicAuth?.password;
    if (hasUser !== hasPass) {
      throw createError({ statusCode: 400, statusMessage: 'basicAuth requires both username and password' });
    }

    const mapping = {
      id: nanoid(),
      subdomain: item.subdomain,
      baseDomain: item.baseDomain,
      path: item.path || '',
      protocol: item.protocol,
      wildcard: itemWildcard,
      workerName: ctx.container.name,
      containerName: ctx.containerName,
      internalPort: intPort,
      userId: ctx.userId,
      ...(hasUser && hasPass
        ? { basicAuth: { username: item.basicAuth.username, password: item.basicAuth.password } }
        : {}),
    };

    try {
      await store.add(mapping);
    } catch (err) {
      throw createError({
        statusCode: 409,
        statusMessage: err instanceof Error ? err.message : 'Subdomain conflict',
      });
    }

    created.push(mapping);
  }

  await useTraefikManager().reconcile();

  setResponseStatus(event, 201);
  return created;
});
