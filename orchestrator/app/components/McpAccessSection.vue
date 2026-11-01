<script setup lang="ts">
import { copyText } from '~/utils/clipboard';

/**
 * Account modal section for MCP access: the MCP server URL to configure in an
 * agent (Claude Code, Codex, …) and the OAuth applications the user has
 * authorized, each revocable. Hidden when MCP is disabled on the server.
 */
const props = defineProps<{ active: boolean }>();

const toast = useToast();

interface AuthorizedApp {
  clientId: string;
  name: string;
  uri?: string;
  scopes: string[];
  authorizedAt: string;
}

const mcpUrl = ref<string | null>(null);
const apps = ref<AuthorizedApp[]>([]);
const error = ref('');
const copied = ref(false);
const revokeConfirmId = ref<string | null>(null);

const setupCommand = computed(() => (mcpUrl.value ? `claude mcp add --transport http agentor ${mcpUrl.value}` : ''));

function errorMessage(err: any, fallback: string): string {
  return err?.data?.statusMessage || err?.message || fallback;
}

async function load() {
  error.value = '';
  revokeConfirmId.value = null;
  try {
    const status = await $fetch<{ mcpUrl: string | null }>('/api/setup/status');
    mcpUrl.value = status.mcpUrl;
    if (mcpUrl.value) apps.value = await $fetch<AuthorizedApp[]>('/api/account/oauth-apps');
  } catch (err) {
    error.value = errorMessage(err, 'Failed to load MCP access');
  }
}

watch(() => props.active, (active) => {
  if (active) load();
}, { immediate: true });

async function copy(text: string) {
  if (await copyText(text)) {
    copied.value = true;
    setTimeout(() => (copied.value = false), 1500);
    return;
  }
  toast.add({
    title: 'Copy failed — select the URL and copy it manually',
    color: 'error',
    icon: 'i-lucide-alert-circle',
  });
}

async function revoke(app: AuthorizedApp) {
  if (revokeConfirmId.value !== app.clientId) {
    revokeConfirmId.value = app.clientId;
    return;
  }
  error.value = '';
  try {
    await $fetch(`/api/account/oauth-apps/${encodeURIComponent(app.clientId)}`, { method: 'DELETE' });
    apps.value = apps.value.filter((a) => a.clientId !== app.clientId);
  } catch (err) {
    error.value = errorMessage(err, 'Failed to revoke access');
  } finally {
    revokeConfirmId.value = null;
  }
}
</script>

<template>
  <div v-if="mcpUrl" class="space-y-6">
    <div class="border-t border-gray-200 dark:border-gray-800"></div>
    <section class="space-y-3" data-testid="account-mcp">
      <h3 class="text-sm font-medium text-gray-900 dark:text-gray-100">MCP access</h3>
      <p class="text-xs text-gray-500 dark:text-gray-400">
        Connect an AI agent to Agentor through the MCP server below. It signs in with your account via OAuth and can do
        everything you can do in the dashboard.
      </p>
      <div class="flex items-center gap-2">
        <code class="flex-1 min-w-0 truncate select-all rounded-md bg-gray-100 dark:bg-gray-800 px-2 py-1 text-xs" data-testid="mcp-url">{{ mcpUrl }}</code>
        <UButton size="xs" color="neutral" variant="ghost" :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'" aria-label="Copy MCP URL" @click="copy(mcpUrl)" />
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-400">
        Claude Code: <code class="text-[11px]">{{ setupCommand }}</code>
      </p>

      <div class="text-xs font-medium text-gray-700 dark:text-gray-300">Authorized applications</div>
      <div v-if="apps.length === 0" class="text-sm text-gray-500 dark:text-gray-400 italic" data-testid="mcp-apps-empty">
        No applications authorized.
      </div>
      <div v-else class="space-y-2">
        <div
          v-for="app in apps"
          :key="app.clientId"
          class="flex items-center gap-3 p-2 rounded-md border border-gray-200 dark:border-gray-800"
          data-testid="mcp-app"
        >
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{{ app.name }}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 truncate">
              Authorized {{ new Date(app.authorizedAt).toLocaleString() }} · {{ app.scopes.join(' ') }}
            </div>
          </div>
          <UButton
            size="xs"
            color="error"
            :variant="revokeConfirmId === app.clientId ? 'solid' : 'ghost'"
            data-testid="mcp-app-revoke"
            @click="revoke(app)"
          >
            {{ revokeConfirmId === app.clientId ? 'Confirm revoke' : 'Revoke' }}
          </UButton>
        </div>
      </div>
      <p v-if="error" role="alert" class="text-sm text-red-600 dark:text-red-400">{{ error }}</p>
    </section>
  </div>
</template>
