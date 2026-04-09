<script setup lang="ts">
import type { ContainerInfo, Tab, ArchivedWorker } from '~/types';

const props = defineProps<{
  containers: ContainerInfo[];
  tabs: Tab[];
  activeTabId: string | null;
  archivedWorkers: ArchivedWorker[];
}>();

const emit = defineEmits<{
  newWorker: [];
  manageEnvironments: [];
  manageCapabilities: [];
  manageInstructions: [];
  manageInitScripts: [];
  openTerminal: [containerId: string];
  openDesktop: [containerId: string];
  openApps: [containerId: string];
  openEditor: [containerId: string];
  openVsCode: [containerId: string];
  stopContainer: [id: string];
  restartContainer: [id: string];
  rebuildContainer: [id: string];
  removeContainer: [id: string];
  archiveContainer: [id: string];
  downloadWorkspace: [id: string];
  unarchiveWorker: [name: string];
  deleteArchivedWorker: [name: string];
  openSettings: [];
  openLogs: [];
  openUsers: [];
  openAccount: [];
  toggleCollapse: [];
}>();

const { user: currentUser, isAdmin, signOut } = useAuth();

const { state: uiState, setActiveTab } = useUiState();
const { refreshing: usageRefreshing, refresh: usageRefresh } = useUsage();
const { mappings: portMappings } = usePortMappings();
const { mappings: domainMappings } = useDomainMappings();

const { data: domainMapperStatus } = useFetch<{ enabled: boolean }>('/api/domain-mapper/status', {
  default: () => ({ enabled: false }),
});

interface SidebarTabDef {
  id: string;
  label: string;
  icon: string;
  badge?: number;
}

const visibleTabs = computed<SidebarTabDef[]>(() => {
  const items: SidebarTabDef[] = [
    { id: 'workers', label: 'Workers', icon: 'i-lucide-server', badge: props.containers.length || undefined },
    { id: 'archived', label: 'Archived', icon: 'i-lucide-archive', badge: props.archivedWorkers.length || undefined },
    { id: 'ports', label: 'Ports', icon: 'i-lucide-plug', badge: portMappings.value.length || undefined },
  ];
  if (domainMapperStatus.value.enabled) {
    items.push({ id: 'domains', label: 'Domains', icon: 'i-lucide-globe', badge: domainMappings.value.length || undefined });
  }
  items.push({ id: 'usage', label: 'Usage', icon: 'i-lucide-activity' });
  // System tab (Images + Logs + System Settings + Users) is admin-only —
  // every action inside it calls an admin-only endpoint.
  if (isAdmin.value) {
    items.push({ id: 'system', label: 'System', icon: 'i-lucide-settings' });
  }
  return items;
});

const activeTab = computed(() => {
  const validIds = visibleTabs.value.map((t) => t.id);
  return validIds.includes(uiState.value.sidebar.activeTab)
    ? uiState.value.sidebar.activeTab
    : 'workers';
});

function selectTab(id: string) {
  setActiveTab(id);
  moreOpen.value = false;
}

// --- Overflow handling ---
const tabBarRef = ref<HTMLElement>();
const measureRef = ref<HTMLElement>();
const moreContainerRef = ref<HTMLElement>();
const moreOpen = ref(false);
const visibleCount = ref(100);

const inlineTabs = computed(() => visibleTabs.value.slice(0, visibleCount.value));
const overflowTabsList = computed(() => visibleTabs.value.slice(visibleCount.value));
const activeInOverflow = computed(() => overflowTabsList.value.some((t) => t.id === activeTab.value));

function recalcOverflow() {
  const bar = tabBarRef.value;
  const measure = measureRef.value;
  if (!bar || !measure) return;

  const available = bar.clientWidth;
  const tabEls = Array.from(measure.children) as HTMLElement[];
  const moreWidth = 38;

  let totalWidth = 0;
  for (const el of tabEls) totalWidth += el.offsetWidth;

  if (totalWidth <= available) {
    visibleCount.value = tabEls.length;
    return;
  }

  let used = 0;
  let count = 0;
  for (const el of tabEls) {
    if (used + el.offsetWidth > available - moreWidth) break;
    used += el.offsetWidth;
    count++;
  }
  visibleCount.value = Math.max(1, count);
}

function onClickOutside(e: MouseEvent) {
  if (moreContainerRef.value && !moreContainerRef.value.contains(e.target as Node)) {
    moreOpen.value = false;
  }
}

watch(moreOpen, (open) => {
  if (open) {
    document.addEventListener('mousedown', onClickOutside);
  } else {
    document.removeEventListener('mousedown', onClickOutside);
  }
});

let resizeObs: ResizeObserver | null = null;

onMounted(() => {
  nextTick(recalcOverflow);
  if (tabBarRef.value) {
    resizeObs = new ResizeObserver(() => recalcOverflow());
    resizeObs.observe(tabBarRef.value);
  }
});

onUnmounted(() => {
  resizeObs?.disconnect();
  document.removeEventListener('mousedown', onClickOutside);
});

watch(visibleTabs, () => nextTick(recalcOverflow));

function isContainerActive(containerId: string, tabs: Tab[], activeTabId: string | null): boolean {
  if (!activeTabId) return false;
  const tab = tabs.find((t) => t.id === activeTabId);
  return tab?.containerId === containerId;
}
</script>

<template>
  <aside class="relative bg-gray-50 dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col flex-shrink-0 min-w-0">
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
            <UIcon name="i-lucide-chevrons-left" class="size-4" />
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
      <div class="flex gap-2 mt-2">
        <UButton class="flex-1" color="neutral" variant="outline" size="sm" @click="emit('manageCapabilities')">
          Capabilities
        </UButton>
        <UButton class="flex-1" color="neutral" variant="outline" size="sm" @click="emit('manageInstructions')">
          Instructions
        </UButton>
        <UButton class="flex-1" color="neutral" variant="outline" size="sm" @click="emit('manageInitScripts')">
          Init Scripts
        </UButton>
      </div>
    </div>

    <!-- Hidden measurement row (off-screen, for overflow calculation) -->
    <div ref="measureRef" class="sidebar-tab-measure">
      <div v-for="tab in visibleTabs" :key="'m-' + tab.id" class="sidebar-tab">
        <UIcon :name="tab.icon" class="size-3.5 flex-shrink-0" />
        <span class="sidebar-tab-label">{{ tab.label }}</span>
        <span v-if="tab.badge" class="sidebar-tab-badge">{{ tab.badge }}</span>
      </div>
    </div>

    <!-- Tab bar area -->
    <div ref="moreContainerRef" class="sidebar-tab-bar-wrap">
      <nav ref="tabBarRef" class="sidebar-tab-bar">
        <button
          v-for="tab in inlineTabs"
          :key="tab.id"
          class="sidebar-tab"
          :class="{ 'sidebar-tab-active': activeTab === tab.id }"
          :title="tab.label"
          @click="selectTab(tab.id)"
        >
          <UIcon :name="tab.icon" class="size-3.5 flex-shrink-0" />
          <span class="sidebar-tab-label">{{ tab.label }}</span>
          <span v-if="tab.badge" class="sidebar-tab-badge">{{ tab.badge }}</span>
        </button>

        <!-- More button (inside nav to participate in flex layout) -->
        <button
          v-if="overflowTabsList.length > 0"
          class="sidebar-tab sidebar-tab-more-btn"
          :class="{ 'sidebar-tab-active': activeInOverflow }"
          title="More tabs"
          @click="moreOpen = !moreOpen"
        >
          <UIcon name="i-lucide-chevrons-right" class="size-3.5" />
        </button>
      </nav>

      <!-- Dropdown rendered OUTSIDE the nav to escape overflow:hidden -->
      <div v-if="moreOpen && overflowTabsList.length > 0" class="sidebar-tab-dropdown">
        <button
          v-for="tab in overflowTabsList"
          :key="tab.id"
          class="sidebar-tab-dropdown-item"
          :class="{ 'sidebar-tab-dropdown-item-active': activeTab === tab.id }"
          @click="selectTab(tab.id)"
        >
          <UIcon :name="tab.icon" class="size-3.5 flex-shrink-0" />
          <span>{{ tab.label }}</span>
          <span v-if="tab.badge" class="sidebar-tab-dropdown-badge">{{ tab.badge }}</span>
        </button>
      </div>
    </div>

    <!-- Tab content -->
    <div class="flex-1 overflow-y-auto min-h-0">
      <!-- Workers -->
      <div v-if="activeTab === 'workers'" class="p-3">
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
            @open-vs-code="(cid) => emit('openVsCode', cid)"
            @stop="(id) => emit('stopContainer', id)"
            @restart="(id) => emit('restartContainer', id)"
            @rebuild="(id) => emit('rebuildContainer', id)"
            @remove="(id) => emit('removeContainer', id)"
            @archive="(id) => emit('archiveContainer', id)"
            @download-workspace="(id) => emit('downloadWorkspace', id)"
          />
        </div>
      </div>

      <!-- Archived -->
      <div v-if="activeTab === 'archived'" class="p-3">
        <div v-if="archivedWorkers.length === 0" class="text-gray-400 dark:text-gray-500 text-sm text-center py-8">
          No archived workers.
        </div>
        <div class="space-y-2">
          <ArchivedWorkerCard
            v-for="w in archivedWorkers"
            :key="w.name"
            :worker="w"
            @unarchive="(name) => emit('unarchiveWorker', name)"
            @delete="(name) => emit('deleteArchivedWorker', name)"
          />
        </div>
      </div>

      <!-- Port Mappings -->
      <div v-if="activeTab === 'ports'" class="p-3">
        <PortMappingsPanel :containers="containers" />
      </div>

      <!-- Domain Mappings -->
      <div v-if="activeTab === 'domains'" class="p-3">
        <DomainMappingsPanel :containers="containers" />
      </div>

      <!-- Usage -->
      <div v-if="activeTab === 'usage'" class="p-3 space-y-3">
        <UsagePanel />
        <!-- Actions card -->
        <div class="system-card">
          <div class="system-card-header">
            <UIcon name="i-lucide-zap" class="size-3.5" />
            <span>Actions</span>
          </div>
          <div class="p-1.5">
            <button
              class="system-card-link disabled:opacity-50"
              :disabled="usageRefreshing"
              @click="usageRefresh()"
            >
              <UIcon name="i-lucide-refresh-cw" class="size-3.5 flex-shrink-0" :class="{ 'animate-spin': usageRefreshing }" />
              {{ usageRefreshing ? 'Refreshing...' : 'Refresh usage' }}
            </button>
          </div>
        </div>
      </div>

      <!-- System (merged Images + Settings) -->
      <div v-if="activeTab === 'system'" class="p-3 space-y-3">
        <!-- Images card -->
        <div class="system-card">
          <div class="system-card-header">
            <UIcon name="i-lucide-box" class="size-3.5" />
            <span>Images</span>
          </div>
          <div class="px-3 py-2.5">
            <UpdateNotification />
          </div>
        </div>

        <!-- Quick links card -->
        <div class="system-card">
          <div class="system-card-header">
            <UIcon name="i-lucide-link" class="size-3.5" />
            <span>Quick Links</span>
          </div>
          <div class="p-1.5">
            <button
              class="system-card-link"
              @click="emit('openLogs')"
            >
              <UIcon name="i-lucide-scroll-text" class="size-3.5 flex-shrink-0" />
              Logs
            </button>
            <button
              class="system-card-link"
              @click="emit('openSettings')"
            >
              <UIcon name="i-lucide-sliders-horizontal" class="size-3.5 flex-shrink-0" />
              System Settings
            </button>
            <button
              v-if="isAdmin"
              class="system-card-link"
              @click="emit('openUsers')"
            >
              <UIcon name="i-lucide-users" class="size-3.5 flex-shrink-0" />
              Users
            </button>
            <a
              href="/api/docs"
              target="_blank"
              class="system-card-link"
            >
              <UIcon name="i-lucide-book-open" class="size-3.5 flex-shrink-0" />
              API Docs
              <UIcon name="i-lucide-external-link" class="size-3 flex-shrink-0 ml-auto opacity-40" />
            </a>
          </div>
        </div>

      </div>
    </div>

    <!-- Signed-in user card — pinned to the bottom of the sidebar -->
    <div class="flex-shrink-0 border-t border-gray-200 dark:border-gray-800 p-3">
      <div class="flex items-center gap-2 min-w-0">
        <button
          type="button"
          class="flex items-center gap-2 min-w-0 flex-1 text-left rounded-md px-1 py-1 -mx-1 -my-1 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          title="Account settings"
          @click="emit('openAccount')"
        >
          <div class="flex items-center justify-center size-8 rounded-full bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-300 flex-shrink-0">
            <UIcon name="i-lucide-user" class="size-4" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <span class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {{ (currentUser as any)?.name || 'User' }}
              </span>
              <UBadge v-if="isAdmin" size="xs" color="warning">admin</UBadge>
            </div>
            <div class="text-xs text-gray-500 dark:text-gray-400 truncate">
              {{ (currentUser as any)?.email }}
            </div>
          </div>
        </button>
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-log-out"
          aria-label="Sign out"
          title="Sign out"
          class="flex-shrink-0"
          @click="signOut"
        />
      </div>
    </div>
  </aside>
</template>
