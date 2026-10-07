<script setup lang="ts">
definePageMeta({ layout: false });
useHead({ title: 'Authorize application — Agentor' });

interface PublicClient {
  client_id: string;
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
}

/** What each OAuth scope lets the application do, in user-facing terms. */
const SCOPE_DESCRIPTIONS: Record<string, string> = {
  agentor: 'Full control of your Agentor account: create, run and delete workers, execute commands and read their screens, and manage environments, capabilities, instructions, init scripts, port and domain mappings, account settings and usage. Admins additionally grant user management and system administration.',
  openid: 'Confirm your identity',
  profile: 'Read your name',
  email: 'Read your email address',
  offline_access: 'Stay connected until you revoke access',
};

const route = useRoute();
const { client, user } = useAuth();

const appClient = ref<PublicClient | null>(null);
const error = ref('');
const submitting = ref<'accept' | 'deny' | null>(null);

const clientId = computed(() => String(route.query.client_id ?? ''));
const scopes = computed(() => String(route.query.scope ?? '').split(' ').filter(Boolean));
/** Where approval sends the user (and the authorization code) — the best
 * signal for spotting a look-alike client name. */
const redirectOrigin = computed(() => {
  try {
    return new URL(String(route.query.redirect_uri ?? '')).origin;
  } catch {
    return '';
  }
});
const appName = computed(() => appClient.value?.client_name || clientId.value || 'An application');
/** The client's homepage, only when it is a web URL — registration is open, so
 * a `javascript:` URI must never become a link on this page. */
const appHomepage = computed(() => {
  try {
    const url = new URL(appClient.value?.client_uri ?? '');
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
  } catch {
    return '';
  }
});

onMounted(async () => {
  if (!isOAuthAuthorizationPage() || !clientId.value) {
    error.value = 'This page is only reachable from an application authorization request.';
    return;
  }
  const res = await client.$fetch<PublicClient>('/oauth2/public-client', {
    query: { client_id: clientId.value },
  });
  if (res.error) error.value = res.error.message || 'Unknown application';
  else appClient.value = res.data;
});

async function respond(accept: boolean) {
  error.value = '';
  submitting.value = accept ? 'accept' : 'deny';
  try {
    const res = await client.$fetch('/oauth2/consent', { method: 'POST', body: { accept } });
    if (res.error) error.value = res.error.message || 'Authorization failed';
    else if (!followOAuthRedirect(res.data)) error.value = 'Authorization finished without a redirect.';
  } finally {
    submitting.value = null;
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
    <div class="w-full max-w-md">
      <div class="text-center mb-8">
        <AppLogo class="block h-16 mx-auto mb-4" />
        <h1 class="text-3xl font-bold text-gray-900 dark:text-gray-100">Agentor</h1>
        <p class="text-gray-500 dark:text-gray-400 mt-1">Orchestrator</p>
      </div>

      <div class="bg-white dark:bg-gray-900 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 p-6" data-testid="oauth-consent">
        <h2 class="text-lg font-semibold text-gray-900 dark:text-gray-100">
          Authorize <span data-testid="oauth-client-name">{{ appName }}</span>
        </h2>
        <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
          wants to access your Agentor account<template v-if="user"> as <span class="font-medium text-gray-700 dark:text-gray-300">{{ user.email }}</span></template>.
        </p>
        <a
          v-if="appHomepage"
          :href="appHomepage"
          target="_blank"
          rel="noopener noreferrer"
          class="mt-1 block text-xs text-primary-600 dark:text-primary-400 truncate"
        >{{ appHomepage }}</a>
        <p v-if="redirectOrigin" class="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Approving sends you back to <span class="font-mono text-gray-700 dark:text-gray-300" data-testid="oauth-redirect-origin">{{ redirectOrigin }}</span>
        </p>

        <ul v-if="scopes.length" class="mt-5 space-y-3" data-testid="oauth-scopes">
          <li v-for="scope in scopes" :key="scope" class="flex gap-3 text-sm">
            <UIcon name="i-lucide-check" class="mt-0.5 size-4 shrink-0 text-green-600 dark:text-green-400" />
            <div>
              <div class="font-mono text-xs text-gray-500 dark:text-gray-400">{{ scope }}</div>
              <div class="text-gray-700 dark:text-gray-300">{{ SCOPE_DESCRIPTIONS[scope] ?? scope }}</div>
            </div>
          </li>
        </ul>

        <p class="mt-5 text-xs text-gray-500 dark:text-gray-400">
          Only approve applications you trust. You can revoke access at any time from your account settings.
        </p>

        <p v-if="error" class="mt-4 text-sm text-red-600 dark:text-red-400" data-testid="oauth-consent-error">{{ error }}</p>

        <div class="mt-6 flex gap-3">
          <UButton
            block
            color="neutral"
            variant="outline"
            :loading="submitting === 'deny'"
            :disabled="!!submitting || !appClient"
            data-testid="oauth-deny"
            @click="respond(false)"
          >
            Deny
          </UButton>
          <UButton
            block
            color="primary"
            :loading="submitting === 'accept'"
            :disabled="!!submitting || !appClient"
            data-testid="oauth-approve"
            @click="respond(true)"
          >
            Approve
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>
