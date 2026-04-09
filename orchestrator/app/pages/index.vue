<script setup lang="ts">
import type { CreateContainerRequest } from '~/types';

useHead({ title: 'Agentor' });

const { gitProviders } = useGitProviders();
const { containers, refresh: refreshContainers, createContainer, stopContainer, restartContainer, rebuildContainer, removeContainer } = useContainers();
const { archivedWorkers, refresh: refreshArchived, archiveWorker, unarchiveWorker, deleteArchivedWorker } = useArchivedWorkers();
const {
  rootNode,
  focusedNodeId,
  tabs,
  activeTabId,
  openTab,
  closeTab,
  closeTabsForContainer,
  focusGroup,
  moveTab,
  splitWithTab,
  resizeNodes,
  activateTab,
} = useSplitPanes();

const showCreateModal = ref(false);
const showEnvironmentsModal = ref(false);
const showCapabilitiesModal = ref(false);
const showInstructionsModal = ref(false);
const showInitScriptsModal = ref(false);
const showSettingsModal = ref(false);
const showUsersModal = ref(false);
const showAccountModal = ref(false);

const { sidebarWidth, isDragging, isCollapsed, isMobile, startDrag, toggleCollapse } = useSidebarResize();

function handleOpenLogs() {
  openTab('__logs__', 'Logs', 'logs');
}

function handleOpenTab(containerId: string, type: 'terminal' | 'desktop' | 'apps' | 'editor' | 'vscode') {
  const container = containers.value.find((c) => c.id === containerId);
  const name = container?.displayName || shortName(container?.name || containerId.slice(0, 12));
  openTab(containerId, name, type);
}

async function handleCreate(request: CreateContainerRequest) {
  const container = await createContainer(request);
  if (!container) return;

  // Auto-open terminal tab immediately — the container is already starting
  handleOpenTab(container.id, 'terminal');
}

function handleDownloadWorkspace(id: string) {
  const link = document.createElement('a');
  link.href = `/api/containers/${id}/workspace`;
  link.download = '';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function handleRebuild(id: string) {
  if (!confirm('Rebuild this worker? The container will be destroyed and recreated with the latest image. Workspace data is preserved.')) return;
  closeTabsForContainer(id);
  const rebuilt = await rebuildContainer(id);
  if (rebuilt) {
    handleOpenTab(rebuilt.id, 'terminal');
  }
}

async function handleRemove(id: string) {
  if (!confirm('Remove this container and delete all workspace data? This cannot be undone.')) return;
  closeTabsForContainer(id);
  await removeContainer(id);
  await refreshArchived();
}

async function handleArchive(id: string) {
  if (!confirm('Archive this worker? The container will be removed but workspace data will be preserved.')) return;
  closeTabsForContainer(id);
  await archiveWorker(id);
  await refreshContainers();
}

async function handleUnarchive(name: string) {
  await unarchiveWorker(name);
  await refreshContainers();
}

async function handleDeleteArchived(name: string) {
  if (!confirm('Permanently delete this archived worker? All workspace data will be lost.')) return;
  await deleteArchivedWorker(name);
}

function openEnvironmentsFromModal() {
  showCreateModal.value = false;
  setTimeout(() => {
    showEnvironmentsModal.value = true;
  }, 350);
}

function openInitScriptsFromModal() {
  showCreateModal.value = false;
  setTimeout(() => {
    showInitScriptsModal.value = true;
  }, 350);
}

</script>

<template>
  <div class="flex h-screen bg-white dark:bg-gray-950 text-gray-800 dark:text-gray-200">
    <!-- Mobile backdrop -->
    <div
      v-if="isMobile && !isCollapsed"
      class="sidebar-backdrop"
      @click="toggleCollapse"
    />

    <!-- Sidebar -->
    <AppSidebar
      :style="{ width: isCollapsed ? '0px' : sidebarWidth + 'px' }"
      :class="[
        'sidebar-panel',
        { 'sidebar-collapsed': isCollapsed, 'sidebar-mobile': isMobile },
      ]"
      :containers="containers"
      :tabs="tabs"
      :active-tab-id="activeTabId"
      :archived-workers="archivedWorkers"
      @new-worker="showCreateModal = true"
      @manage-environments="showEnvironmentsModal = true"
      @manage-capabilities="showCapabilitiesModal = true"
      @manage-instructions="showInstructionsModal = true"
      @manage-init-scripts="showInitScriptsModal = true"
      @open-terminal="(cid) => handleOpenTab(cid, 'terminal')"
      @open-desktop="(cid) => handleOpenTab(cid, 'desktop')"
      @open-apps="(cid) => handleOpenTab(cid, 'apps')"
      @open-editor="(cid) => handleOpenTab(cid, 'editor')"
      @open-vs-code="(cid) => handleOpenTab(cid, 'vscode')"
      @stop-container="stopContainer"
      @restart-container="restartContainer"
      @rebuild-container="handleRebuild"
      @remove-container="handleRemove"
      @archive-container="handleArchive"
      @download-workspace="handleDownloadWorkspace"
      @unarchive-worker="handleUnarchive"
      @delete-archived-worker="handleDeleteArchived"
      @open-settings="showSettingsModal = true"
      @open-logs="handleOpenLogs"
      @open-users="showUsersModal = true"
      @open-account="showAccountModal = true"
      @toggle-collapse="toggleCollapse"
    />

    <!-- Sidebar resize handle -->
    <div
      v-if="!isCollapsed && !isMobile"
      class="sidebar-handle"
      :class="{ dragging: isDragging }"
      @mousedown="startDrag"
    />

    <!-- Collapsed sidebar expand button -->
    <button
      v-if="isCollapsed"
      class="sidebar-expand-fab"
      title="Expand sidebar"
      @click="toggleCollapse"
    >
      <UIcon name="i-lucide-menu" class="size-4" />
    </button>

    <!-- Main content -->
    <main class="flex-1 flex min-w-0 min-h-0">
      <SplitPaneLayout
        :root-node="rootNode"
        :focused-node-id="focusedNodeId"
        @activate-tab="activateTab"
        @close-tab="closeTab"
        @focus-node="focusGroup"
        @resize="resizeNodes"
        @move-tab="moveTab"
        @split-with-tab="splitWithTab"
      />
    </main>

    <CreateContainerModal
      v-model:open="showCreateModal"
      :git-providers="gitProviders"
      @create="handleCreate"
      @manage-environments="openEnvironmentsFromModal"
      @manage-init-scripts="openInitScriptsFromModal"
    />

    <EnvironmentsModal
      v-model:open="showEnvironmentsModal"
    />

    <CapabilitiesModal v-model:open="showCapabilitiesModal" />
    <InstructionsModal v-model:open="showInstructionsModal" />
    <InitScriptsModal v-model:open="showInitScriptsModal" />
    <SettingsModal v-model:open="showSettingsModal" />
    <UsersModal v-model:open="showUsersModal" />
    <AccountModal v-model:open="showAccountModal" />
  </div>
</template>
