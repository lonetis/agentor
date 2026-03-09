defineRouteMeta({
  openAPI: {
    tags: ['Domain Mappings'],
    summary: 'Download self-signed CA certificate',
    description: 'Returns the CA certificate PEM file used to sign self-signed domain certificates. Users must trust this CA in their browser to avoid TLS warnings for self-signed domains.',
    operationId: 'getCaCert',
    responses: {
      200: {
        description: 'CA certificate in PEM format',
        content: { 'application/x-pem-file': { schema: { type: 'string' } } },
      },
      404: { description: 'No self-signed domains configured', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
});

import { useConfig, useSelfSignedCertManager } from '../../utils/services';

export default defineEventHandler(async (event) => {
  const config = useConfig();
  const hasSelfSigned = config.baseDomainConfigs.some((c) => c.challengeType === 'selfsigned');

  if (!hasSelfSigned) {
    throw createError({
      statusCode: 404,
      statusMessage: 'No self-signed domains configured',
    });
  }

  const certManager = useSelfSignedCertManager();
  const pem = await certManager.getCaCertPem();

  setResponseHeader(event, 'Content-Type', 'application/x-pem-file');
  setResponseHeader(event, 'Content-Disposition', 'attachment; filename="agentor-ca.crt"');
  return pem;
});
