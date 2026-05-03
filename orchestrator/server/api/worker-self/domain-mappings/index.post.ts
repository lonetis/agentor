defineRouteMeta({
  openAPI: {
    tags: ['Worker Self'],
    summary: 'Create a domain mapping for the calling worker',
    description: 'Creates a Traefik domain mapping pointing to a port on the calling worker. Caller identity is derived from the source IP — workerId/workerName fields are not accepted.',
    operationId: 'workerSelfCreateDomainMapping',
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
              path: { type: 'string', description: 'URL path prefix (e.g. /api). Stripped before forwarding. Not supported for TCP.' },
              protocol: { type: 'string', enum: ['http', 'https', 'tcp'] },
              wildcard: { type: 'boolean', description: 'Match any single-label prefix of the host. Requires base domain challenge type of none, dns, or selfsigned.' },
              internalPort: { type: 'integer', description: 'Worker internal port (1-65535)' },
              basicAuth: { type: 'object', properties: { username: { type: 'string' }, password: { type: 'string' } } },
            },
          },
        },
      },
    },
    responses: {
      201: { description: 'Created domain mapping', content: { 'application/json': { schema: { $ref: '#/components/schemas/DomainMapping' } } } },
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

  if (!body.protocol || !body.internalPort || !body.baseDomain) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing required fields: baseDomain, protocol, internalPort',
    });
  }

  if (body.subdomain === undefined || body.subdomain === null) body.subdomain = '';
  if (!body.path || body.path === '/') body.path = '';

  if (!config.baseDomains.includes(body.baseDomain)) {
    throw createError({
      statusCode: 400,
      statusMessage: `baseDomain must be one of: ${config.baseDomains.join(', ')}`,
    });
  }

  if (!['http', 'https', 'tcp'].includes(body.protocol)) {
    throw createError({ statusCode: 400, statusMessage: 'protocol must be "http", "https", or "tcp"' });
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

  const wildcard = body.wildcard === true;
  if (wildcard) {
    const domainConfig = config.baseDomainConfigs.find((c) => c.domain === body.baseDomain);
    if (!domainConfig || domainConfig.challengeType === 'http') {
      throw createError({
        statusCode: 400,
        statusMessage: `wildcard routing is not supported on '${body.baseDomain}' — HTTP-01 ACME cannot issue wildcard certificates. Configure the base domain as plain (:none), :dns:provider, or :selfsigned to use wildcard.`,
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
      throw createError({ statusCode: 400, statusMessage: 'path is not supported for TCP protocol' });
    }
    if (!/^\/[a-zA-Z0-9\/_.-]+$/.test(body.path)) {
      throw createError({
        statusCode: 400,
        statusMessage: 'path must start with / and contain only alphanumeric characters, hyphens, underscores, dots, and slashes',
      });
    }
    body.path = body.path.replace(/\/+$/, '') || '';
  }

  const intPort = Number(body.internalPort);
  if (!Number.isInteger(intPort) || intPort < 1 || intPort > 65535) {
    throw createError({ statusCode: 400, statusMessage: 'internalPort must be an integer between 1 and 65535' });
  }

  const hasUser = !!body.basicAuth?.username;
  const hasPass = !!body.basicAuth?.password;
  if (hasUser !== hasPass) {
    throw createError({ statusCode: 400, statusMessage: 'basicAuth requires both username and password' });
  }

  const mapping = {
    id: nanoid(),
    subdomain: body.subdomain,
    baseDomain: body.baseDomain,
    path: body.path || '',
    protocol: body.protocol,
    wildcard,
    workerName: ctx.container.name,
    containerName: ctx.containerName,
    internalPort: intPort,
    userId: ctx.userId,
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
