import { createAuthClient } from 'better-auth/vue';
import { adminClient } from 'better-auth/client/plugins';
import { passkeyClient } from '@better-auth/passkey/client';

const client = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : '',
  plugins: [adminClient(), passkeyClient()],
});

export function useAuth() {
  const session = client.useSession();

  const user = computed(() => session.value?.data?.user);
  const isLoggedIn = computed(() => !!session.value?.data);
  const isAdmin = computed(() => (user.value as any)?.role === 'admin');
  const isLoading = computed(() => session.value?.isPending ?? false);

  async function signIn(email: string, password: string) {
    return client.signIn.email({ email, password });
  }

  async function signOut() {
    await client.signOut();
    // Force-reload to wipe client state and re-evaluate route guards
    if (typeof window !== 'undefined') window.location.href = '/login';
  }

  return {
    client,
    session,
    user,
    isLoggedIn,
    isAdmin,
    isLoading,
    signIn,
    signOut,
  };
}
