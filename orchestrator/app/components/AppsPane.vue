<script setup lang="ts">
const props = defineProps<{
  containerId: string;
}>();

const containerIdRef = toRef(props, 'containerId');
const { appTypes, instances, createInstance, stopInstance } = useApps(containerIdRef as Ref<string>);

const containerName = computed(() => props.containerId.slice(0, 12));

function instancesForType(appTypeId: string) {
  return instances.value.filter((i) => i.appType === appTypeId);
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
          <UButton size="xs" color="primary" variant="solid" @click="createInstance(at.id)">
            + New Instance
          </UButton>
        </div>

        <div v-if="instancesForType(at.id).length === 0" class="text-gray-400 dark:text-gray-500 text-xs text-center py-4">
          No running instances
        </div>

        <AppInstanceRow
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
