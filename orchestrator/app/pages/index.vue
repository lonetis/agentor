<script setup lang="ts">
import type { CreateContainerRequest } from '~/types';

useHead({ title: 'Agentor' });

const { gitProviders } = useGitProviders();
const { containers, refresh: refreshContainers, createContainer, stopContainer, restartContainer, removeContainer } = useContainers();
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
const showSkillsModal = ref(false);
const showAgentsMdModal = ref(false);
const showInitScriptsModal = ref(false);
const showSettingsModal = ref(false);

const { sidebarWidth, isDragging, isCollapsed, isMobile, startDrag, toggleCollapse } = useSidebarResize();

function handleOpenTab(containerId: string, type: 'terminal' | 'desktop' | 'apps' | 'editor') {
  const container = containers.value.find((c) => c.id === containerId);
  const name = container?.displayName || shortName(container?.name || containerId.slice(0, 12));
  openTab(containerId, name, type);
}

async function handleCreate(request: CreateContainerRequest, files: File[]) {
  const container = await createContainer(request);
  if (!container) return;

  // Auto-open terminal tab immediately — the container is already starting
  handleOpenTab(container.id, 'terminal');

  if (files.length > 0) {
    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file, file.name);
    }
    await $fetch(`/api/containers/${container.id}/workspace`, {
      method: 'POST',
      body: formData,
    });
  }
}

function handleDownloadWorkspace(id: string) {
  const link = document.createElement('a');
  link.href = `/api/containers/${id}/workspace`;
  link.download = '';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
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
      @manage-skills="showSkillsModal = true"
      @manage-agents-md="showAgentsMdModal = true"
      @manage-init-scripts="showInitScriptsModal = true"
      @open-terminal="(cid) => handleOpenTab(cid, 'terminal')"
      @open-desktop="(cid) => handleOpenTab(cid, 'desktop')"
      @open-apps="(cid) => handleOpenTab(cid, 'apps')"
      @open-editor="(cid) => handleOpenTab(cid, 'editor')"
      @stop-container="stopContainer"
      @restart-container="restartContainer"
      @remove-container="handleRemove"
      @archive-container="handleArchive"
      @download-workspace="handleDownloadWorkspace"
      @unarchive-worker="handleUnarchive"
      @delete-archived-worker="handleDeleteArchived"
      @open-settings="showSettingsModal = true"
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
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
      </svg>
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

    <SkillsModal v-model:open="showSkillsModal" />
    <AgentsMdModal v-model:open="showAgentsMdModal" />
    <InitScriptsModal v-model:open="showInitScriptsModal" />
    <SettingsModal v-model:open="showSettingsModal" />
  </div>
</template>
