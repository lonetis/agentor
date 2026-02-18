<script setup lang="ts">
import type { RepoConfig, GitProviderInfo, GitHubRepoInfo, GitHubBranchInfo } from '~/types';

const props = defineProps<{
  modelValue: RepoConfig;
  providers: GitProviderInfo[];
  githubRepos?: GitHubRepoInfo[];
  githubReposLoading?: boolean;
  githubBranches?: GitHubBranchInfo[];
  githubBranchesLoading?: boolean;
  githubDefaultBranch?: string;
  githubUser?: string;
  githubOrgs?: string[];
  creatingRepo?: boolean;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: RepoConfig];
  remove: [];
  'repo-selected': [fullName: string];
  'create-repo': [payload: { owner: string; name: string; isPrivate: boolean }];
}>();

const providerOptions = computed(() =>
  props.providers.map((p) => ({ label: p.displayName, value: p.id }))
);

const placeholder = computed(() => {
  const provider = props.providers.find((p) => p.id === props.modelValue.provider);
  return provider?.placeholder || 'https://example.com/owner/repo';
});

const currentProvider = computed(() =>
  props.providers.find((p) => p.id === props.modelValue.provider)
);

const isGitHubWithToken = computed(() =>
  currentProvider.value?.id === 'github' && currentProvider.value?.tokenConfigured === true
);

// === Custom repo dropdown ===

const searchText = ref(props.modelValue.url || '');
const showDropdown = ref(false);
const highlightedIndex = ref(-1);
const dropdownRef = ref<HTMLElement>();

// Keep searchText and modelValue.url in sync
watch(() => props.modelValue.url, (val) => {
  if (val !== searchText.value) searchText.value = val || '';
});

watch(searchText, (val) => {
  if (val !== props.modelValue.url) update('url', val);
  highlightedIndex.value = -1;
});

const filteredRepos = computed(() => {
  const repos = props.githubRepos || [];
  const query = searchText.value.toLowerCase().trim();
  const filtered = query ? repos.filter((r) => r.fullName.toLowerCase().includes(query)) : repos;
  return filtered.slice(0, 50);
});

const createTarget = computed(() => {
  const text = searchText.value.trim();
  if (!text) return null;
  if ((props.githubRepos || []).some((r) => r.fullName === text)) return null;

  const parts = text.split('/');
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { owner: parts[0], name: parts[1].replace(/\.git$/, '') };
  }
  if (parts.length === 1 && parts[0] && props.githubUser) {
    return { owner: props.githubUser, name: parts[0] };
  }
  const fullName = extractFullName(text);
  if (fullName) {
    const [owner, name] = fullName.split('/') as [string, string];
    return { owner, name };
  }
  return null;
});

// Keyboard navigation indices
const createPublicIdx = computed(() => filteredRepos.value.length);
const createPrivateIdx = computed(() => filteredRepos.value.length + 1);
const totalItems = computed(() => filteredRepos.value.length + (createTarget.value ? 2 : 0));

function highlightNext() {
  if (!showDropdown.value) { showDropdown.value = true; return; }
  highlightedIndex.value = Math.min(highlightedIndex.value + 1, totalItems.value - 1);
  scrollToHighlighted();
}

function highlightPrev() {
  highlightedIndex.value = Math.max(highlightedIndex.value - 1, 0);
  scrollToHighlighted();
}

function scrollToHighlighted() {
  nextTick(() => {
    dropdownRef.value
      ?.querySelector(`[data-idx="${highlightedIndex.value}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  });
}

function selectHighlighted() {
  if (!showDropdown.value || highlightedIndex.value < 0) return;
  if (highlightedIndex.value < filteredRepos.value.length) {
    selectRepo(filteredRepos.value[highlightedIndex.value]!);
  } else if (createTarget.value) {
    if (highlightedIndex.value === createPublicIdx.value) handleCreate(false);
    else if (highlightedIndex.value === createPrivateIdx.value) handleCreate(true);
  }
}

function selectRepo(repo: GitHubRepoInfo) {
  searchText.value = repo.fullName;
  showDropdown.value = false;
  emit('repo-selected', repo.fullName);
}

function onContainerFocusout(e: FocusEvent) {
  // Close only when focus leaves the entire container
  const related = e.relatedTarget as Node | null;
  if (!related || !(e.currentTarget as HTMLElement)?.contains(related)) {
    showDropdown.value = false;
  }
}

// === Branch field ===

const branchItems = computed(() =>
  (props.githubBranches || []).map((b) => b.name)
);

// === Helpers ===

function extractFullName(url: string): string | null {
  const match = url.match(/(?:github\.com\/)?([^/\s]+\/[^/\s]+)/);
  return match?.[1]?.replace(/\.git$/, '') ?? null;
}

function update(field: keyof RepoConfig, value: string) {
  emit('update:modelValue', { ...props.modelValue, [field]: value });
}

function handleCreate(isPrivate: boolean) {
  if (!createTarget.value) return;
  searchText.value = `${createTarget.value.owner}/${createTarget.value.name}`;
  showDropdown.value = false;
  emit('create-repo', { ...createTarget.value, isPrivate });
}
</script>

<template>
  <div class="flex gap-2 items-center">
    <USelect
      :model-value="modelValue.provider"
      :items="providerOptions"
      size="xs"
      class="w-28 shrink-0"
      @update:model-value="update('provider', $event)"
    />

    <!-- Custom searchable repo dropdown -->
    <div
      v-if="isGitHubWithToken"
      class="relative flex-1 min-w-0"
      @focusout="onContainerFocusout"
    >
      <UInput
        v-model="searchText"
        :loading="githubReposLoading || creatingRepo"
        size="xs"
        class="w-full"
        placeholder="Search or create repository..."
        @focus="showDropdown = true"
        @click="showDropdown = true"
        @keydown.escape="showDropdown = false"
        @keydown.arrow-down.prevent="highlightNext"
        @keydown.arrow-up.prevent="highlightPrev"
        @keydown.enter.prevent="selectHighlighted"
      />
      <div
        v-if="showDropdown && (filteredRepos.length || createTarget)"
        ref="dropdownRef"
        class="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-[calc(var(--ui-radius)*2)] bg-[var(--ui-bg-elevated)] ring ring-[var(--ui-border-accented)] shadow-lg py-1"
        @mousedown.prevent
      >
        <!-- Existing repos -->
        <button
          v-for="(repo, i) in filteredRepos"
          :key="repo.fullName"
          :data-idx="i"
          :class="[
            'w-full px-2.5 py-1.5 text-left text-xs flex items-center gap-2 transition-colors',
            i === highlightedIndex ? 'bg-[var(--ui-bg-accented)]' : 'hover:bg-[var(--ui-bg-accented)]/50',
          ]"
          @mousedown.prevent="selectRepo(repo)"
          @mouseenter="highlightedIndex = i"
        >
          <UIcon
            :name="repo.private ? 'i-lucide-lock' : 'i-lucide-book'"
            class="text-[var(--ui-text-dimmed)] shrink-0 size-3.5"
          />
          <span class="truncate">{{ repo.fullName }}</span>
        </button>

        <!-- Separator -->
        <div v-if="filteredRepos.length && createTarget" class="border-t border-[var(--ui-border)] my-1" />

        <!-- Create options -->
        <template v-if="createTarget">
          <button
            :data-idx="createPublicIdx"
            :class="[
              'w-full px-2.5 py-1.5 text-left text-xs flex items-center gap-2 transition-colors',
              highlightedIndex === createPublicIdx ? 'bg-[var(--ui-bg-accented)]' : 'hover:bg-[var(--ui-bg-accented)]/50',
            ]"
            @mousedown.prevent="handleCreate(false)"
            @mouseenter="highlightedIndex = createPublicIdx"
          >
            <UIcon name="i-lucide-plus" class="text-[var(--ui-text-dimmed)] shrink-0 size-3.5" />
            <span>
              Create
              <span class="font-medium text-[var(--ui-text-highlighted)]">{{ createTarget.owner }}/{{ createTarget.name }}</span>
            </span>
            <UBadge size="xs" variant="subtle" color="neutral" class="ml-auto">public</UBadge>
          </button>
          <button
            :data-idx="createPrivateIdx"
            :class="[
              'w-full px-2.5 py-1.5 text-left text-xs flex items-center gap-2 transition-colors',
              highlightedIndex === createPrivateIdx ? 'bg-[var(--ui-bg-accented)]' : 'hover:bg-[var(--ui-bg-accented)]/50',
            ]"
            @mousedown.prevent="handleCreate(true)"
            @mouseenter="highlightedIndex = createPrivateIdx"
          >
            <UIcon name="i-lucide-plus" class="text-[var(--ui-text-dimmed)] shrink-0 size-3.5" />
            <span>
              Create
              <span class="font-medium text-[var(--ui-text-highlighted)]">{{ createTarget.owner }}/{{ createTarget.name }}</span>
            </span>
            <UBadge size="xs" variant="subtle" color="neutral" class="ml-auto">private</UBadge>
          </button>
        </template>
      </div>
    </div>

    <!-- Plain text input (no token) -->
    <UInput
      v-else
      :model-value="modelValue.url"
      :placeholder="placeholder"
      size="xs"
      class="flex-1 min-w-0"
      @update:model-value="update('url', $event)"
    />

    <!-- Branch: searchable dropdown when GitHub token configured -->
    <UInputMenu
      v-if="isGitHubWithToken && modelValue.url"
      :model-value="modelValue.branch || ''"
      :items="branchItems"
      create-item="always"
      :loading="githubBranchesLoading"
      size="xs"
      class="w-44 shrink-0"
      :placeholder="githubDefaultBranch ? `${githubDefaultBranch} (default)` : 'branch (optional)'"
      @update:model-value="update('branch', $event)"
      @create="update('branch', $event)"
    />
    <UInput
      v-else
      :model-value="modelValue.branch || ''"
      placeholder="branch (optional)"
      size="xs"
      class="w-36 shrink-0"
      @update:model-value="update('branch', $event)"
    />

    <UButton
      icon="i-lucide-x"
      size="xs"
      color="neutral"
      variant="ghost"
      class="shrink-0"
      @click="emit('remove')"
    />
  </div>
</template>
