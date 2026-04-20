import type { UserEnvVars, UserEnvVarsInput, CredentialInfo } from '~~/shared/types';

/** Thin wrapper around /api/account/env-vars and /api/account/agent-credentials.
 * Used by AccountModal so the component stays focused on presentation. */
export function useUserEnvVars() {
  const envVars = ref<UserEnvVars | null>(null);
  const credentials = ref<CredentialInfo[]>([]);
  const loading = ref(false);
  const error = ref<string>('');

  async function fetchAll() {
    loading.value = true;
    error.value = '';
    try {
      const [env, creds] = await Promise.all([
        $fetch<UserEnvVars>('/api/account/env-vars'),
        $fetch<CredentialInfo[]>('/api/account/agent-credentials'),
      ]);
      envVars.value = env;
      credentials.value = creds;
    } catch (err: any) {
      error.value = err?.data?.statusMessage || err?.message || 'Failed to load env vars';
    } finally {
      loading.value = false;
    }
  }

  async function save(input: UserEnvVarsInput): Promise<UserEnvVars> {
    const updated = await $fetch<UserEnvVars>('/api/account/env-vars', {
      method: 'PUT',
      body: input,
    });
    envVars.value = updated;
    return updated;
  }

  async function resetCredential(agentId: string): Promise<void> {
    await $fetch(`/api/account/agent-credentials/${agentId}`, { method: 'DELETE' });
    credentials.value = await $fetch<CredentialInfo[]>('/api/account/agent-credentials');
  }

  return { envVars, credentials, loading, error, fetchAll, save, resetCredential };
}
