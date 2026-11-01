<script setup lang="ts">
import type { AppInstanceInfo, AppTypeInfo } from '~/types';
import type { UserSshKey } from '../../shared/types';
import { copyText } from '~/utils/clipboard';

// `appType` / `containerName` are part of the shared app-row prop contract
// (AppsPane passes them uniformly via `<component :is>`); this specialised row
// does not read them — SSH connects via the window host + the external port.
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
    const { sshPublicKey } = await $fetch<UserSshKey>('/api/account/ssh-key');
    hasKey.value = Boolean(sshPublicKey && sshPublicKey.trim().length > 0);
  } catch (err) {
    console.warn('[ssh-app] could not check the SSH public key', err);
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

const toast = useToast();
const copied = ref(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(copiedTimer));

async function copyCommand() {
  if (!sshCommand.value) return;
  if (!(await copyText(sshCommand.value))) {
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
        <span v-if="instance.externalPort" class="text-gray-500 dark:text-gray-400 text-xs flex-shrink-0">
          :22 → host :{{ instance.externalPort }}
        </span>
      </div>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        class="pointer-coarse:p-2"
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
        class="flex-1 font-mono px-2 py-1 bg-gray-200 dark:bg-gray-800 rounded text-gray-800 dark:text-gray-200 truncate select-all"
        :title="sshCommand"
      >{{ sshCommand }}</code>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
        aria-label="Copy SSH command"
        class="pointer-coarse:p-2"
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
