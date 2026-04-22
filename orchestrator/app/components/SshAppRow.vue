<script setup lang="ts">
import type { AppInstanceInfo, AppTypeInfo } from '~/types';
import type { UserEnvVars } from '../../shared/types';

const props = defineProps<{
  instance: AppInstanceInfo;
  appType?: AppTypeInfo;
  containerName?: string;
}>();

const emit = defineEmits<{
  stop: [appType: string, id: string];
}>();

// Best-effort check: does the user have an SSH public key configured? If not,
// warn them — sshd will refuse all logins otherwise. Fetched once per mount,
// not polled (low-value to keep refetching).
const hasKey = ref<boolean | null>(null);
onMounted(async () => {
  try {
    const env = await $fetch<UserEnvVars>('/api/account/env-vars');
    hasKey.value = Boolean(env.sshPublicKey && env.sshPublicKey.trim().length > 0);
  } catch {
    hasKey.value = null;
  }
});

const sshCommand = computed(() => {
  if (!props.instance.externalPort) return '';
  const host = typeof window !== 'undefined' && window.location?.hostname
    ? window.location.hostname
    : 'localhost';
  return `ssh agent@${host} -p ${props.instance.externalPort}`;
});

const dotColor = computed(() => (props.instance.status === 'running' ? 'bg-green-500' : 'bg-gray-500'));

async function copyCommand() {
  if (!sshCommand.value) return;
  try {
    await navigator.clipboard.writeText(sshCommand.value);
  } catch {
    // no-op
  }
}
</script>

<template>
  <div class="px-3 py-2 border-b border-gray-200 dark:border-gray-800 last:border-0">
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-2 min-w-0">
        <span class="w-1.5 h-1.5 rounded-full flex-shrink-0" :class="dotColor" />
        <span class="text-gray-700 dark:text-gray-300 text-xs font-mono truncate">{{ instance.id }}</span>
        <span v-if="instance.externalPort" class="text-gray-400 dark:text-gray-500 text-xs flex-shrink-0">
          :22 → host :{{ instance.externalPort }}
        </span>
      </div>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        @click="emit('stop', instance.appType, instance.id)"
      >
        Stop
      </UButton>
    </div>

    <!-- Running + key configured: show the SSH command. -->
    <div
      v-if="instance.status === 'running' && instance.externalPort && hasKey !== false"
      class="mt-2 flex items-center gap-2 text-xs"
    >
      <code
        class="flex-1 font-mono px-2 py-1 bg-gray-200 dark:bg-gray-800 rounded text-gray-800 dark:text-gray-200 truncate"
        :title="sshCommand"
      >{{ sshCommand }}</code>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-copy"
        aria-label="Copy SSH command"
        @click="copyCommand"
      />
    </div>

    <!-- Key missing: warn the user. -->
    <p
      v-if="instance.status === 'running' && hasKey === false"
      class="mt-1.5 text-xs text-amber-700 dark:text-amber-400"
    >
      Public key not configured — add one in <strong>Account → SSH Access</strong> so sshd will accept logins.
    </p>
  </div>
</template>
