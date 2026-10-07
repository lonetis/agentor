<script setup lang="ts">
import type { RepoConfig, GitProviderInfo, GitRepoInfo, GitBranchInfo } from '~/types';

// One repository row. With a token for the selected provider it offers a
// searchable list of the user's repos (plus "create"), and a branch picker for
// the chosen repo; otherwise it is a plain URL + branch input. Repo lists are
// shared per provider via useGitRepos; branch state is local to the row.
const props = defineProps<{
  modelValue: RepoConfig;
  providers: GitProviderInfo[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: RepoConfig];
  remove: [];
}>();

const { reposFor, load, fetchBranches, createRepo } = useGitRepos();

const providerOptions = computed(() =>
  props.providers.map((p) => ({ label: p.displayName, value: p.id }))
);

const provider = computed(() => props.providers.find((p) => p.id === props.modelValue.provider));

const placeholder = computed(() => provider.value?.placeholder || 'https://example.com/owner/repo');

const browsable = computed(() => provider.value?.tokenConfigured === true);

const repoState = computed(() => (provider.value ? reposFor(provider.value.id) : undefined));
const repos = computed(() => repoState.value?.repos ?? []);

watch([() => provider.value?.id, browsable], ([id, ok]) => {
  if (id && ok) load(id);
}, { immediate: true });

// The row may be removed while a request is in flight — never emit for it then.
let unmounted = false;
onUnmounted(() => { unmounted = true; });

// === Custom repo dropdown ===

const searchText = ref(props.modelValue.url || '');
const showDropdown = ref(false);
const highlightedIndex = ref(-1);
const dropdownRef = ref<HTMLElement>();
const creating = ref(false);
const createError = ref('');

// Keep searchText and modelValue.url in sync
watch(() => props.modelValue.url, (val) => {
  if (val !== searchText.value) searchText.value = val || '';
});

watch(searchText, (val) => {
  if (val !== props.modelValue.url) update('url', val);
  highlightedIndex.value = -1;
  createError.value = '';
});

const filteredRepos = computed(() => {
  const query = searchText.value.toLowerCase().trim();
  const filtered = query ? repos.value.filter((r) => r.fullName.toLowerCase().includes(query)) : repos.value;
  return filtered.slice(0, 50);
});

/** "Create" target for the typed text: a bare name goes to the user's own
 * namespace, a path to the namespace before its last segment (GitLab paths may
 * be nested: `group/subgroup/name`). */
const createTarget = computed(() => {
  const text = searchText.value.trim();
  if (!text || repos.value.some((r) => r.fullName === text)) return null;
  const username = repoState.value?.username;
  if (!text.includes('/')) return username ? { owner: username, name: text } : null;
  const fullName = toFullName(text);
  if (!fullName) return null;
  const cut = fullName.lastIndexOf('/');
  return { owner: fullName.slice(0, cut), name: fullName.slice(cut + 1) };
});

// Keyboard navigation indices
const createPublicIdx = computed(() => filteredRepos.value.length);
const createPrivateIdx = computed(() => filteredRepos.value.length + 1);
const totalItems = computed(() => filteredRepos.value.length + (createTarget.value ? 2 : 0));

const dropdownError = computed(() => createError.value || repoState.value?.error || '');

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

function selectRepo(repo: GitRepoInfo) {
  searchText.value = repo.fullName;
  showDropdown.value = false;
  loadBranches(repo.fullName);
}

function onContainerFocusout(e: FocusEvent) {
  // Close only when focus leaves the entire container
  const related = e.relatedTarget as Node | null;
  if (!related || !(e.currentTarget as HTMLElement)?.contains(related)) {
    showDropdown.value = false;
  }
}

async function handleCreate(isPrivate: boolean) {
  const target = createTarget.value;
  const providerId = provider.value?.id;
  if (!target || !providerId) return;
  searchText.value = `${target.owner}/${target.name}`;
  showDropdown.value = false;
  creating.value = true;
  createError.value = '';
  try {
    const repo = await createRepo(providerId, { ...target, isPrivate });
    if (unmounted || props.modelValue.provider !== providerId) return;
    searchText.value = repo.fullName;
    loadBranches(repo.fullName);
  } catch (err) {
    createError.value = fetchErrorMessage(err, 'Failed to create repository');
    showDropdown.value = true;
  } finally {
    creating.value = false;
  }
}

// === Branch field ===

const branches = ref<GitBranchInfo[]>([]);
const branchesLoading = ref(false);
const defaultBranch = ref('');
let branchRequest = 0;

const branchItems = computed(() => branches.value.map((b) => b.name));

async function loadBranches(fullName: string) {
  const providerId = provider.value?.id;
  if (!providerId || !browsable.value) return;
  const request = ++branchRequest;
  branchesLoading.value = true;
  try {
    const data = await fetchBranches(providerId, fullName);
    if (request !== branchRequest) return;
    branches.value = data.branches;
    defaultBranch.value = data.defaultBranch;
  } catch {
    // Unknown repo or a typed URL that isn't on the provider — the branch
    // field stays free-text.
    if (request !== branchRequest) return;
    branches.value = [];
    defaultBranch.value = '';
  } finally {
    if (request === branchRequest) branchesLoading.value = false;
  }
}

watch(() => props.modelValue.provider, () => {
  branchRequest++;
  branches.value = [];
  defaultBranch.value = '';
  branchesLoading.value = false;
  createError.value = '';
});

// Rows opened with a repo already set (worker settings) get their branch list
// once the provider's token status is known.
watch(browsable, (ok) => {
  const fullName = ok ? toFullName(props.modelValue.url || '') : null;
  if (fullName) loadBranches(fullName);
}, { immediate: true });

// === Helpers ===

/** The repo path on the selected provider (`owner/repo`, `group/sub/project`)
 * for a typed path, web/clone URL or `git@host:` URL — null when the text points
 * at another host or is not a repo path. */
function toFullName(text: string): string | null {
  let path = text.trim();
  const base = provider.value?.url;
  if (base) {
    const host = base.replace(/^[a-z]+:\/\//i, '').split('/')[0]!.split(':')[0];
    if (path.startsWith(`${base}/`)) path = path.slice(base.length + 1);
    else if (path.startsWith(`git@${host}:`)) path = path.slice(`git@${host}:`.length);
  }
  if (/^[a-z]+:\/\//i.test(path) || path.startsWith('git@')) return null;
  path = path.replace(/\/+$/, '').replace(/\.git$/, '');
  const parts = path.split('/');
  if (parts.length < 2 || parts.some((p) => !p)) return null;
  if (provider.value?.type === 'github' && parts.length !== 2) return null;
  return path;
}

function update<K extends keyof RepoConfig>(field: K, value: RepoConfig[K]) {
  if (unmounted) return;
  emit('update:modelValue', { ...props.modelValue, [field]: value });
}
</script>

<template>
  <div class="flex gap-2 items-center">
    <USelect
      :model-value="modelValue.provider"
      :items="providerOptions"
      size="xs"
      class="w-32 shrink-0"
      aria-label="Git provider"
      @update:model-value="update('provider', $event)"
    />

    <!-- Custom searchable repo dropdown -->
    <div
      v-if="browsable"
      class="relative flex-1 min-w-0"
      @focusout="onContainerFocusout"
    >
      <UInput
        v-model="searchText"
        :loading="repoState?.loading || creating"
        size="xs"
        class="w-full"
        placeholder="Search or create repository..."
        aria-label="Repository"
        @focus="showDropdown = true"
        @click="showDropdown = true"
        @keydown.escape="showDropdown = false"
        @keydown.arrow-down.prevent="highlightNext"
        @keydown.arrow-up.prevent="highlightPrev"
        @keydown.enter.prevent="selectHighlighted"
      />
      <div
        v-if="showDropdown && (filteredRepos.length || createTarget || dropdownError)"
        ref="dropdownRef"
        class="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-[calc(var(--ui-radius)*2)] bg-[var(--ui-bg-elevated)] ring ring-[var(--ui-border-accented)] shadow-lg py-1"
        @mousedown.prevent
      >
        <!-- Provider error (token set but the request failed, or create failed) -->
        <div
          v-if="dropdownError"
          class="px-2.5 py-1.5 text-xs text-red-600 dark:text-red-400 flex items-center gap-2"
          data-testid="repo-dropdown-error"
        >
          <UIcon name="i-lucide-alert-triangle" class="shrink-0 size-3.5" />
          <span class="truncate" :title="dropdownError">{{ dropdownError }}</span>
        </div>

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
      aria-label="Repository URL"
      @update:model-value="update('url', $event)"
    />

    <!-- Branch: searchable dropdown when the provider is browsable -->
    <UInputMenu
      v-if="browsable && modelValue.url"
      :model-value="modelValue.branch || ''"
      :items="branchItems"
      create-item="always"
      :loading="branchesLoading"
      size="xs"
      class="w-44 shrink-0"
      :placeholder="defaultBranch ? `${defaultBranch} (default)` : 'branch (optional)'"
      aria-label="Branch"
      @update:model-value="update('branch', $event)"
      @create="update('branch', $event)"
    />
    <UInput
      v-else
      :model-value="modelValue.branch || ''"
      placeholder="branch (optional)"
      size="xs"
      class="w-36 shrink-0"
      aria-label="Branch"
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
