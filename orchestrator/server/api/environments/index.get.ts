defineRouteMeta({
  openAPI: {
    tags: ['Environments'],
    summary: 'List environments',
    description: 'Returns all worker environment configurations.',
    operationId: 'listEnvironments',
    responses: {
      200: {
        description: 'Array of environments',
        content: {
          'application/json': {
            schema: {
              type: 'array',
              items: { $ref: '#/components/schemas/Environment' },
            },
          },
        },
      },
    },
    $global: {
      components: {
        schemas: {
          EnvironmentInput: {
            type: 'object',
            description: 'Reusable worker configuration: resources, network policy, Docker-in-Docker, env vars, setup script, and which capabilities / instructions / worker-self APIs its workers get. Changes apply to a worker on its next create or rebuild.',
            properties: {
              name: { type: 'string', description: 'Display name' },
              cpuLimit: { type: 'number', minimum: 0, description: 'CPU cores per worker (0 = unrestricted)' },
              memoryLimit: { type: 'string', description: 'Memory per worker, e.g. 4g or 512m (empty = unrestricted)' },
              networkMode: {
                type: 'string',
                enum: ['full', 'block', 'block-all', 'package-managers', 'custom'],
                description: 'Outbound network policy: full (no restrictions), package-managers (package registries only), custom (allowedDomains, optionally plus package registries), block (agent API domains only), block-all (nothing). Agent API domains stay reachable in every mode except block-all.',
              },
              allowedDomains: { type: 'array', items: { type: 'string' }, description: 'Allowed domains for networkMode custom (wildcards like *.example.com allowed)' },
              includePackageManagerDomains: { type: 'boolean', description: 'In custom mode, also allow the package-registry domains' },
              dockerEnabled: { type: 'boolean', description: 'Run a Docker daemon inside the worker (Docker-in-Docker, privileged container)' },
              envVars: { type: 'string', description: 'Extra environment variables as KEY=VALUE lines (override per-user account env vars)' },
              setupScript: { type: 'string', description: 'Script run (as the agent user, sudo available) on every worker start, after repos are cloned and before the init script' },
              exposeApis: {
                type: 'object',
                description: 'Which orchestrator APIs workers may call from inside (and get skill docs for)',
                properties: {
                  portMappings: { type: 'boolean' },
                  domainMappings: { type: 'boolean' },
                  usage: { type: 'boolean' },
                },
              },
              enabledGitProviderIds: {
                type: 'array',
                items: { type: 'string' },
                nullable: true,
                description: "Git provider ids (see list_git_providers) whose credentials workers get (null = all, also providers configured later; [] = none; default null). For every other provider the owner's token env var (GITHUB_TOKEN, GITLAB_TOKEN, GITLAB_<NAME>_TOKEN) is withheld — also from this environment's own envVars — together with the provider CLI's own variables (GH_TOKEN, … / GITLAB_ACCESS_TOKEN, OAUTH_TOKEN), and git, gh / glab and the Docker registry login are not authenticated for it, so code running in the worker cannot reach the owner's repositories there. Public repositories still clone. Use [] to run untrusted code.",
              },
              enabledCapabilityIds: { type: 'array', items: { type: 'string' }, nullable: true, description: 'Capability ids installed in workers (null = all, [] = none)' },
              enabledInstructionIds: { type: 'array', items: { type: 'string' }, nullable: true, description: 'Instruction ids installed in workers (null = all, [] = none)' },
            },
          },
          Environment: {
            type: 'object',
            allOf: [
              { $ref: '#/components/schemas/EnvironmentInput' },
              {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  builtIn: { type: 'boolean', description: 'Platform-provided default environment; read-only' },
                  userId: { type: 'string', nullable: true, description: 'Owner (null for built-in/global environments)' },
                  createdAt: { type: 'string', format: 'date-time' },
                  updatedAt: { type: 'string', format: 'date-time' },
                },
              },
            ],
          },
        },
      },
    },
  },
});

import { useEnvironmentStore } from '../../utils/services';
import { requireAuth } from '../../utils/auth-helpers';

export default defineEventHandler((event) => {
  const { user } = requireAuth(event);
  const all = useEnvironmentStore().list();
  if (user.role === 'admin') return all;
  return all.filter((e) => e.userId === null || e.userId === user.id);
});
