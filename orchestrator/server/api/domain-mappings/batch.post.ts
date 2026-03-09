defineRouteMeta({
  openAPI: {
    tags: ['Domain Mappings'],
    summary: 'Create multiple domain mappings',
    description: 'Creates multiple Traefik domain mappings in a single batch, reconciling Traefik only once.',
    operationId: 'createDomainMappingsBatch',
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
                    subdomain: { type: 'string', description: 'Subdomain (empty for bare domain)' },
                    baseDomain: { type: 'string', description: 'Base domain from BASE_DOMAINS' },
                    protocol: { type: 'string', enum: ['http', 'https', 'tcp'], description: 'Routing protocol' },
                    workerId: { type: 'string', description: 'Target worker container ID' },
                    workerName: { type: 'string', description: 'Target worker container name' },
                    internalPort: { type: 'integer', description: 'Worker internal port' },
                    basicAuth: {
                      type: 'object',
                      properties: {
                        username: { type: 'string' },
                        password: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    responses: {
      201: {
        description: 'Created domain mappings',
        content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/DomainMapping' } } } },
      },
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

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'items must be a non-empty array',
    });
  }

  const containerManager = useContainerManager();
  const store = useDomainMappingStore();
  const created = [];

  for (const item of body.items) {
    if (!item.protocol || (!item.workerId && !item.workerName) || !item.internalPort || !item.baseDomain) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Each item requires: baseDomain, protocol, workerId or workerName, internalPort',
      });
    }

    if (item.subdomain === undefined || item.subdomain === null) {
      item.subdomain = '';
    }

    if (!config.baseDomains.includes(item.baseDomain)) {
      throw createError({
        statusCode: 400,
        statusMessage: `baseDomain must be one of: ${config.baseDomains.join(', ')}`,
      });
    }

    if (!['http', 'https', 'tcp'].includes(item.protocol)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'protocol must be "http", "https", or "tcp"',
      });
    }

    if (item.protocol === 'https' || item.protocol === 'tcp') {
      const domainConfig = config.baseDomainConfigs.find((c) => c.domain === item.baseDomain);
      if (!domainConfig || domainConfig.challengeType === 'none') {
        throw createError({
          statusCode: 400,
          statusMessage: `${item.protocol.toUpperCase()} requires TLS but '${item.baseDomain}' has no TLS configured (use :http, :dns:provider, or :selfsigned in BASE_DOMAINS)`,
        });
      }
    }

    if (item.subdomain && !/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/.test(item.subdomain)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'subdomain must be a valid DNS label (alphanumeric and hyphens, no consecutive dots)',
      });
    }

    const intPort = Number(item.internalPort);
    if (!Number.isInteger(intPort) || intPort < 1 || intPort > 65535) {
      throw createError({
        statusCode: 400,
        statusMessage: 'internalPort must be an integer between 1 and 65535',
      });
    }

    let containerInfo;
    if (item.workerId) {
      containerInfo = containerManager.get(item.workerId);
    } else if (item.workerName) {
      containerInfo = containerManager.list().find((c) => c.name === item.workerName);
    }
    if (!containerInfo || containerInfo.status !== 'running') {
      throw createError({
        statusCode: 400,
        statusMessage: 'Worker container is not running',
      });
    }

    const hasUser = !!item.basicAuth?.username;
    const hasPass = !!item.basicAuth?.password;
    if (hasUser !== hasPass) {
      throw createError({
        statusCode: 400,
        statusMessage: 'basicAuth requires both username and password',
      });
    }

    const mapping = {
      id: nanoid(),
      subdomain: item.subdomain,
      baseDomain: item.baseDomain,
      protocol: item.protocol,
      workerId: containerInfo.id,
      workerName: containerInfo.name,
      internalPort: intPort,
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
