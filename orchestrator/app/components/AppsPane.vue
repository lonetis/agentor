<script setup lang="ts">
import type { AppTypeInfo } from '~/types';
import AppInstanceRow from './AppInstanceRow.vue';
import VsCodeAppRow from './VsCodeAppRow.vue';
import SshAppRow from './SshAppRow.vue';

const props = defineProps<{
  containerId: string;
}>();

const containerIdRef = toRef(props, 'containerId');
const { appTypes, instances, createInstance, stopInstance } = useApps(containerIdRef as Ref<string>);

// Resolve the real Docker container name (`agentor-worker-<id>`) for the
// app-row network hostname tooltip. `containerId` is the worker UUID, not the
// on-network DNS name, so a raw slice would advertise a host that does not resolve.
const { containers } = useContainers();
const toast = useToast();
const containerName = computed(
  () => containers.value.find((c) => c.id === props.containerId)?.containerName ?? '',
);

function instancesForType(appTypeId: string) {
  return instances.value.filter((i) => i.appType === appTypeId);
}

// Pass the component reference, not its name. Nuxt auto-imports handle
// statically-referenced components; dynamic `:is="'VsCodeAppRow'"` by string
// does not resolve in SPA builds, so the row silently rendered empty.
function rowComponentFor(appType: AppTypeInfo) {
  if (appType.id === 'vscode') return VsCodeAppRow;
  if (appType.id === 'ssh') return SshAppRow;
  return AppInstanceRow;
}

async function handleStart(appTypeId: string) {
  try {
    await createInstance(appTypeId);
  } catch (err: any) {
    // 409 means it is already running — the poll will pick it up.
    if (err?.statusCode === 409 || err?.response?.status === 409) return;
    console.error(`[apps] start ${appTypeId} failed`, err);
    toast.add({
      title: 'Could not start app',
      description: fetchErrorMessage(err, `Starting ${appTypeId} failed`),
      color: 'error',
      icon: 'i-lucide-alert-circle',
    });
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto p-4 sm:p-6 bg-(--terminal-bg)">
    <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">Apps</h2>

    <div v-if="appTypes.length === 0" class="text-gray-500 dark:text-gray-400 text-sm text-center py-12">
      No app types available
    </div>

    <div class="space-y-4">
      <div
        v-for="at in appTypes"
        :key="at.id"
        class="rounded-lg border border-(--terminal-bar-border) bg-(--terminal-bar-bg) overflow-hidden"
      >
        <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-(--terminal-bar-border)">
          <div class="min-w-0">
            <h3 class="text-sm font-medium text-gray-900 dark:text-white">{{ at.displayName }}</h3>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{{ at.description }}</p>
          </div>
          <!-- Singleton apps: show "Start" only when no running instance. -->
          <UButton
            v-if="at.singleton && instancesForType(at.id).length === 0"
            size="xs"
            color="primary"
            variant="soft"
            icon="i-lucide-play"
            class="shrink-0"
            :data-testid="`start-${at.id}`"
            @click="handleStart(at.id)"
          >
            Start
          </UButton>
          <UButton
            v-else-if="!at.singleton"
            size="xs"
            color="primary"
            variant="soft"
            class="shrink-0"
            @click="handleStart(at.id)"
          >
            + New Instance
          </UButton>
        </div>

        <div v-if="instancesForType(at.id).length === 0" class="text-gray-500 dark:text-gray-400 text-xs text-center py-4">
          {{ at.singleton ? 'Not running' : 'No running instances' }}
        </div>

        <component
          :is="rowComponentFor(at)"
          v-for="inst in instancesForType(at.id)"
          :key="inst.id"
          :instance="inst"
          :app-type="at"
          :container-name="containerName"
          @stop="stopInstance"
        />
      </div>
    </div>
  </div>
</template>
