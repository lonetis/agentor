<script setup lang="ts">
import type { AppInstanceInfo, AppTypeInfo } from '~/types';
import { copyText } from '~/utils/clipboard';

// `appType` / `containerName` are part of the shared app-row prop contract
// (AppsPane passes them uniformly via `<component :is>`); this specialised row
// does not read them — VS Code Tunnel has no port and is reached via the relay.
const props = defineProps<{
  instance: AppInstanceInfo;
  appType?: AppTypeInfo;
  containerName?: string;
}>();

const emit = defineEmits<{
  stop: [appType: string, id: string];
}>();

const dotColor = computed(() => {
  if (props.instance.status === 'running') return 'bg-green-500';
  if (props.instance.status === 'auth_required') return 'bg-amber-500';
  return 'bg-gray-500';
});

const statusLabel = computed(() => {
  if (props.instance.status === 'auth_required') {
    return props.instance.authCode
      ? 'Waiting for GitHub authentication'
      : 'Initialising — waiting for device code…';
  }
  if (props.instance.status === 'running') {
    return props.instance.machineName ? `Connected as ${props.instance.machineName}` : 'Connected';
  }
  return 'Stopped';
});

const toast = useToast();
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(copiedTimer));

async function copyCode() {
  if (!props.instance.authCode) return;
  if (!(await copyText(props.instance.authCode))) {
    toast.add({ title: 'Copy failed — select the text and copy it manually', color: 'error', icon: 'i-lucide-alert-circle' });
    return;
  }
  copied.value = true;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => { copied.value = false; }, 1500);
}
</script>

<template>
  <div class="px-3 py-2 border-b border-(--terminal-bar-border) last:border-0">
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-2 min-w-0">
        <span class="w-1.5 h-1.5 rounded-full flex-shrink-0" :class="dotColor" role="img" :aria-label="instance.status" />
        <span class="text-gray-700 dark:text-gray-300 text-xs font-mono truncate">{{ instance.id }}</span>
        <span class="text-gray-500 dark:text-gray-400 text-xs min-w-0 truncate" :title="statusLabel">{{ statusLabel }}</span>
      </div>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        class="shrink-0 pointer-coarse:p-2"
        @click="emit('stop', instance.appType, instance.id)"
      >
        Stop
      </UButton>
    </div>

    <!-- Auth required — show whatever we know. If we have the device code it
         renders with a clickable URL + copy button; if we're still waiting for
         the CLI to emit it, show a subdued placeholder so the user has a clear
         signal we're in the auth phase and not silently hung. -->
    <template v-if="instance.status === 'auth_required'">
      <div
        v-if="instance.authUrl && instance.authCode"
        class="mt-2 flex flex-wrap items-center gap-2 text-xs"
        data-testid="vscode-auth-block"
      >
        <a
          :href="instance.authUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="text-primary-600 dark:text-primary-400 underline truncate"
        >{{ instance.authUrl }}</a>
        <span class="text-gray-500 dark:text-gray-400">and enter code</span>
        <code
          class="font-mono px-2 py-0.5 bg-gray-200 dark:bg-gray-800 rounded text-gray-800 dark:text-gray-200 tracking-widest select-all"
          data-testid="vscode-auth-code"
        >{{ instance.authCode }}</code>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
          :aria-label="`Copy code ${instance.authCode}`"
          class="pointer-coarse:p-2"
          @click="copyCode"
        />
      </div>
      <p
        v-else
        class="mt-1.5 text-xs text-gray-500 dark:text-gray-400 italic"
        data-testid="vscode-auth-pending"
      >
        Booting the tunnel binary — the GitHub device code will appear here within a few seconds.
      </p>
    </template>

    <!-- Running: connection hint. -->
    <p
      v-else-if="instance.status === 'running'"
      class="mt-1.5 text-xs text-gray-500 dark:text-gray-400"
    >
      Open VS Code, install the <strong>Remote - Tunnels</strong> extension, and connect to
      <code class="font-mono">{{ instance.machineName || 'this machine' }}</code>.
    </p>
  </div>
</template>
