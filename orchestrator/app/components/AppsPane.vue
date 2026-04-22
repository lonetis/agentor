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

const containerName = computed(() => props.containerId.slice(0, 12));

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
    // Best-effort: ignore 409 (already running) — the poll will pick it up.
    if (err?.statusCode !== 409 && err?.response?.status !== 409) {
      console.error(`[apps] start ${appTypeId} failed`, err);
    }
  }
}
</script>

<template>
  <div class="h-full overflow-y-auto p-6 bg-white dark:bg-gray-950">
    <h2 class="text-lg font-semibold text-gray-900 dark:text-white mb-4">Apps</h2>

    <div v-if="appTypes.length === 0" class="text-gray-400 dark:text-gray-500 text-sm text-center py-12">
      No app types available
    </div>

    <div class="space-y-4">
      <div
        v-for="at in appTypes"
        :key="at.id"
        class="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 overflow-hidden"
      >
        <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <div>
            <h3 class="text-sm font-medium text-gray-900 dark:text-white">{{ at.displayName }}</h3>
            <p class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{{ at.description }}</p>
          </div>
          <!-- Singleton apps: show "Start" only when no running instance. -->
          <UButton
            v-if="at.singleton && instancesForType(at.id).length === 0"
            size="xs"
            color="primary"
            variant="solid"
            :data-testid="`start-${at.id}`"
            @click="handleStart(at.id)"
          >
            Start
          </UButton>
          <UButton
            v-else-if="!at.singleton"
            size="xs"
            color="primary"
            variant="solid"
            @click="createInstance(at.id)"
          >
            + New Instance
          </UButton>
        </div>

        <div v-if="instancesForType(at.id).length === 0" class="text-gray-400 dark:text-gray-500 text-xs text-center py-4">
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
