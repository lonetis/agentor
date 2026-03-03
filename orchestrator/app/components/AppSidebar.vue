<script setup lang="ts">
import type { ContainerInfo, Tab, ArchivedWorker } from '~/types';

defineProps<{
  containers: ContainerInfo[];
  tabs: Tab[];
  activeTabId: string | null;
  archivedWorkers: ArchivedWorker[];
}>();

const emit = defineEmits<{
  newWorker: [];
  manageEnvironments: [];
  openTerminal: [containerId: string];
  openDesktop: [containerId: string];
  openApps: [containerId: string];
  openEditor: [containerId: string];
  stopContainer: [id: string];
  restartContainer: [id: string];
  removeContainer: [id: string];
  archiveContainer: [id: string];
  downloadWorkspace: [id: string];
  unarchiveWorker: [name: string];
  deleteArchivedWorker: [name: string];
  toggleCollapse: [];
}>();

const archivedCollapsed = ref(true);
const portMappingsCollapsed = ref(false);
const domainMappingsCollapsed = ref(false);
const usageCollapsed = ref(false);
const imagesCollapsed = ref(false);

const { data: domainMapperStatus } = useFetch<{ enabled: boolean }>('/api/domain-mapper/status', {
  default: () => ({ enabled: false }),
});

function isContainerActive(containerId: string, tabs: Tab[], activeTabId: string | null): boolean {
  if (!activeTabId) return false;
  const tab = tabs.find((t) => t.id === activeTabId);
  return tab?.containerId === containerId;
}
</script>

<template>
  <aside class="bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col flex-shrink-0 min-w-0">
    <!-- Header -->
    <div class="p-4 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
      <div class="flex items-center justify-between">
        <h1 class="text-lg font-bold text-gray-900 dark:text-white">Agentor</h1>
        <div class="flex items-center gap-1">
          <ThemeToggle />
          <button
            class="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800 transition-colors"
            title="Collapse sidebar"
            @click="emit('toggleCollapse')"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>
      </div>
      <p class="text-xs text-gray-500 mt-0.5">Orchestrator</p>
      <UButton class="w-full mt-3" @click="emit('newWorker')">
        + New Worker
      </UButton>
      <UButton class="w-full mt-2" color="neutral" variant="outline" size="sm" @click="emit('manageEnvironments')">
        Environments
      </UButton>
    </div>

    <!-- Workers (scrollable) -->
    <div class="flex-1 overflow-y-auto p-3 min-h-0">
      <p class="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2 px-1">Workers</p>

      <div v-if="containers.length === 0" class="text-gray-400 dark:text-gray-500 text-sm text-center py-8">
        No workers yet.
      </div>

      <div class="space-y-2">
        <ContainerCard
          v-for="c in containers"
          :key="c.id"
          :container="c"
          :is-active="isContainerActive(c.id, tabs, activeTabId)"
          @open-terminal="(cid) => emit('openTerminal', cid)"
          @open-desktop="(cid) => emit('openDesktop', cid)"
          @open-apps="(cid) => emit('openApps', cid)"
          @open-editor="(cid) => emit('openEditor', cid)"
          @stop="(id) => emit('stopContainer', id)"
          @restart="(id) => emit('restartContainer', id)"
          @remove="(id) => emit('removeContainer', id)"
          @archive="(id) => emit('archiveContainer', id)"
          @download-workspace="(id) => emit('downloadWorkspace', id)"
        />
      </div>
    </div>

    <!-- Archived Workers (collapsible, above Port Mappings) -->
    <div v-if="archivedWorkers.length > 0" class="flex-shrink-0 border-t border-gray-200 dark:border-gray-800">
      <button
        class="w-full flex items-center justify-between px-4 py-2 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
        @click="archivedCollapsed = !archivedCollapsed"
      >
        Archived ({{ archivedWorkers.length }})
        <svg
          class="w-3.5 h-3.5 transition-transform"
          :class="archivedCollapsed ? '-rotate-90' : ''"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div v-if="!archivedCollapsed" class="px-3 pb-3 space-y-2 overflow-y-auto max-h-48">
        <ArchivedWorkerCard
          v-for="w in archivedWorkers"
          :key="w.name"
          :worker="w"
          @unarchive="(name) => emit('unarchiveWorker', name)"
          @delete="(name) => emit('deleteArchivedWorker', name)"
        />
      </div>
    </div>

    <!-- Port Mappings (always visible, collapsible) -->
    <div class="flex-shrink-0 border-t border-gray-200 dark:border-gray-800">
      <button
        class="w-full flex items-center justify-between px-4 py-2 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
        @click="portMappingsCollapsed = !portMappingsCollapsed"
      >
        Port Mappings
        <svg
          class="w-3.5 h-3.5 transition-transform"
          :class="portMappingsCollapsed ? '-rotate-90' : ''"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div v-if="!portMappingsCollapsed" class="px-3 pb-3 overflow-y-auto max-h-64">
        <PortMappingsPanel :containers="containers" />
      </div>
    </div>

    <!-- Domain Mappings (only shown when baseDomain is configured) -->
    <div v-if="domainMapperStatus.enabled" class="flex-shrink-0 border-t border-gray-200 dark:border-gray-800">
      <button
        class="w-full flex items-center justify-between px-4 py-2 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
        @click="domainMappingsCollapsed = !domainMappingsCollapsed"
      >
        Domain Mappings
        <svg
          class="w-3.5 h-3.5 transition-transform"
          :class="domainMappingsCollapsed ? '-rotate-90' : ''"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div v-if="!domainMappingsCollapsed" class="px-3 pb-3 overflow-y-auto max-h-64">
        <DomainMappingsPanel :containers="containers" />
      </div>
    </div>

    <!-- Usage (always visible, collapsible) -->
    <div class="flex-shrink-0 border-t border-gray-200 dark:border-gray-800">
      <button
        class="w-full flex items-center justify-between px-4 py-2 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
        @click="usageCollapsed = !usageCollapsed"
      >
        Usage
        <svg
          class="w-3.5 h-3.5 transition-transform"
          :class="usageCollapsed ? '-rotate-90' : ''"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div v-if="!usageCollapsed">
        <UsagePanel />
      </div>
    </div>

    <!-- Images (always visible, collapsible) -->
    <div class="flex-shrink-0 border-t border-gray-200 dark:border-gray-800">
      <button
        class="w-full flex items-center justify-between px-4 py-2 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
        @click="imagesCollapsed = !imagesCollapsed"
      >
        Images
        <svg
          class="w-3.5 h-3.5 transition-transform"
          :class="imagesCollapsed ? '-rotate-90' : ''"
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div v-if="!imagesCollapsed">
        <UpdateNotification />
      </div>
    </div>
  </aside>
</template>
