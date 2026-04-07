<script setup lang="ts">
const props = defineProps<{
  containerId: string;
}>();

const containerIdRef = toRef(props, 'containerId');
const { status, start, stop } = useVsCodeTunnel(containerIdRef as Ref<string>);

const starting = ref(false);
const stopping = ref(false);

async function handleStart() {
  starting.value = true;
  try {
    await start();
  } finally {
    starting.value = false;
  }
}

async function handleStop() {
  stopping.value = true;
  try {
    await stop();
  } finally {
    stopping.value = false;
  }
}

const copied = ref(false);

function copyCode() {
  if (status.value.authCode) {
    navigator.clipboard.writeText(status.value.authCode);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 2000);
  }
}
</script>

<template>
  <div class="flex flex-col items-center justify-center h-full p-8 text-center">
    <!-- Stopped -->
    <template v-if="status.status === 'stopped'">
      <UIcon name="i-lucide-radio-tower" class="size-12 text-gray-400 dark:text-gray-500 mb-4" />
      <p class="text-sm text-gray-500 dark:text-gray-400 mb-4">VS Code Tunnel is not running</p>
      <UButton
        color="primary"
        :loading="starting"
        @click="handleStart"
      >
        Start Tunnel
      </UButton>
    </template>

    <!-- Auth required -->
    <template v-else-if="status.status === 'auth_required'">
      <UIcon name="i-lucide-key-round" class="size-12 text-amber-500 mb-4" />
      <p class="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">GitHub Authentication Required</p>
      <p class="text-xs text-gray-500 dark:text-gray-400 mb-6">
        Open the link below and enter the device code to authenticate.
      </p>

      <div class="flex flex-col items-center gap-4 mb-6">
        <a
          v-if="status.authUrl"
          :href="status.authUrl"
          target="_blank"
          class="text-sm text-blue-500 hover:text-blue-400 underline"
        >
          {{ status.authUrl }}
        </a>
        <div v-if="status.authCode" class="flex items-center gap-2">
          <code class="text-2xl font-bold font-mono tracking-widest px-4 py-2 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white">
            {{ status.authCode }}
          </code>
          <UButton
            size="xs"
            color="neutral"
            variant="ghost"
            :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
            @click="copyCode"
          />
        </div>
      </div>

      <div class="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
        <UIcon name="i-lucide-loader-2" class="size-3 animate-spin" />
        Waiting for authentication...
      </div>
    </template>

    <!-- Running -->
    <template v-else-if="status.status === 'running'">
      <div class="flex items-center gap-2 mb-4">
        <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        <span class="text-sm text-green-500 font-medium">Tunnel connected</span>
      </div>

      <p v-if="status.machineName" class="text-lg font-semibold font-mono text-gray-900 dark:text-white mb-6">
        {{ status.machineName }}
      </p>

      <div class="text-xs text-gray-500 dark:text-gray-400 space-y-1 mb-6 max-w-md">
        <p class="font-medium text-gray-700 dark:text-gray-300 mb-2">Connect from VS Code:</p>
        <p>1. Install the <strong>Remote - Tunnels</strong> extension</p>
        <p>2. Open Command Palette (<kbd class="px-1 py-0.5 text-[10px] rounded bg-gray-200 dark:bg-gray-700">⌘⇧P</kbd>)</p>
        <p>3. Run <strong>Remote-Tunnels: Connect to Tunnel</strong></p>
        <p v-if="status.machineName">4. Select <code class="px-1 py-0.5 rounded bg-gray-200 dark:bg-gray-700 font-mono">{{ status.machineName }}</code></p>
      </div>

      <UButton
        color="neutral"
        variant="subtle"
        :loading="stopping"
        @click="handleStop"
      >
        Stop Tunnel
      </UButton>
    </template>
  </div>
</template>
